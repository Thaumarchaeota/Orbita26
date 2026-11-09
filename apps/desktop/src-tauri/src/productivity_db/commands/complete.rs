use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::error::{DomainError, DomainResult};
use crate::productivity_db::execution::has_open_interval;
use crate::productivity_db::execution::action_started;
use crate::productivity_db::repository::*;
use crate::productivity_db::types::*;
use crate::productivity_db::util::{new_uuid, utc_now};
use crate::productivity_db::validation::{
    ensure_action_writable, ensure_item_writable, ensure_list_writable, related_unended_action_refs,
};

// SPEC-0003 U91–U92: confirmation is an explicit request fact; the domain rechecks
// the active set and closes intervals in the same transaction as the lifecycle cascade.
pub fn commit_thing_lifecycle(data_dir: &str, req: CommitThingLifecycleRequest) -> DomainResult<CompleteThingResponse> {
    commit_thing_lifecycle_with_disposition(data_dir, req, "end")
}

pub fn commit_thing_lifecycle_mvp(data_dir:&str,req:CommitThingLifecycleMvpRequest)->DomainResult<CompleteThingResponse>{
    if req.action_disposition!="end"&&req.action_disposition!="preserve"{return Err(DomainError::invalid_patch("actionDisposition must be end or preserve"));}
    let disposition=req.action_disposition.clone();
    let legacy=CommitThingLifecycleRequest{thing_kind:req.thing_kind,owning_root:req.owning_root,task_id:req.task_id,outcome:req.outcome,expected_members:req.expected_members,confirm_active_intervals:req.confirm_active_intervals,expected_data_dir:Some(req.expected_data_dir),expected_checkpoints:req.expected_checkpoints,complete_checkpoints_without_actual:req.complete_checkpoints_without_actual};
    commit_thing_lifecycle_with_disposition(data_dir,legacy,&disposition)
}

fn commit_thing_lifecycle_with_disposition(data_dir: &str, req: CommitThingLifecycleRequest, disposition:&str) -> DomainResult<CompleteThingResponse> {
    if req.outcome != "complete" && req.outcome != "cancel" {
        return Err(DomainError::invalid_patch("invalid outcome"));
    }
    if req.thing_kind != "item" && req.thing_kind != "task" && req.thing_kind != "project" {
        return Err(DomainError::invalid_patch("unsupported lifecycle target"));
    }
    if req.outcome == "cancel" && (req.complete_checkpoints_without_actual || !req.expected_checkpoints.is_empty()) {
        return Err(DomainError::invalid_patch("cancel cannot complete checkpoints"));
    }
    if req.expected_data_dir.as_deref().is_some_and(|root| root.trim().is_empty()) {
        return Err(DomainError::invalid_patch("expectedDataDir must not be empty"));
    }
    let run = |conn: &rusqlite::Connection| in_transaction(conn, |tx| {
            if req.thing_kind == "project" {
                return commit_project_lifecycle(tx, &req, disposition);
            }
            let task_id = if req.thing_kind == "task" {
                Some(req.task_id.as_deref().ok_or_else(|| DomainError::invalid_patch("taskId required"))?)
            } else {
                None
            };
            if let Some(task_id) = task_id {
                let (project, extra) = load_project_row(tx, &req.owning_root.id, true)?;
                guard_unknown(&extra)?;
                check_revision(req.owning_root.expected_revision, project.revision)?;
                guard_project_members(tx, &req.owning_root.id)?;
                require_live_task_in_project(tx, &req.owning_root.id, task_id)?;
                let pending = crate::productivity_db::checkpoint::pending_refs_for_target(tx, "task", task_id)?;
                if !pending.is_empty() {
                    if req.outcome != "complete" || !req.complete_checkpoints_without_actual || req.expected_data_dir.as_deref().is_none() {
                        return Err(DomainError::revision_conflict("未完成 Checkpoint 需先确认不记录实际时间并同时完成"));
                    }
                    check_members(&req.expected_checkpoints, &pending)?;
                    for checkpoint in &pending { crate::productivity_db::checkpoint::snapshot(tx, &checkpoint.id, false)?; }
                } else if req.complete_checkpoints_without_actual || !req.expected_checkpoints.is_empty() {
                    return Err(DomainError::revision_conflict("Checkpoint 确认范围已变化"));
                }
            } else {
                let (item, extra) = load_item_row(tx, &req.owning_root.id, true)?;
                guard_unknown(&extra)?;
                check_revision(req.owning_root.expected_revision, item.revision)?;
                ensure_item_writable(tx, &req.owning_root.id)?;
                crate::productivity_db::health_plan::guard_item(tx, &req.owning_root.id)?;
                let pending = crate::productivity_db::checkpoint::pending_refs_for_target(tx, "item", &req.owning_root.id)?;
                if !pending.is_empty() {
                    if req.outcome != "complete" || !req.complete_checkpoints_without_actual || req.expected_data_dir.as_deref().is_none() {
                        return Err(DomainError::revision_conflict("未完成 Checkpoint 需先确认不记录实际时间并同时完成"));
                    }
                    check_members(&req.expected_checkpoints, &pending)?;
                    for checkpoint in &pending { crate::productivity_db::checkpoint::snapshot(tx, &checkpoint.id, false)?; }
                } else if req.complete_checkpoints_without_actual || !req.expected_checkpoints.is_empty() {
                    return Err(DomainError::revision_conflict("Checkpoint 确认范围已变化"));
                }
            }
            let actual = related_unended_action_refs(tx, &req.thing_kind, &req.owning_root.id, task_id)?;
            check_members(&req.expected_members, &actual)?;
            if req.thing_kind == "task" && (req.outcome == "cancel" || disposition == "preserve") {
                for member in &req.expected_members {
                    if action_started(&load_intervals(tx, &member.id, true)?) {
                        return Err(DomainError::active_action_blocks());
                    }
                }
            }
            for member in &req.expected_members {
                let (_, extra) = load_action_row(tx, &member.id, true)?;
                guard_unknown(&extra)?;
                ensure_action_writable(tx, &member.id)?;
                if has_open_interval(&load_intervals(tx, &member.id, true)?) && !req.confirm_active_intervals {
                    return Err(DomainError::action_execution_invalid("active interval confirmation required"));
                }
            }
            let now = utc_now();
            let mut checkpoints = Vec::new();
            if req.outcome == "complete" && req.complete_checkpoints_without_actual {
                for member in &req.expected_checkpoints {
                    checkpoints.push(crate::productivity_db::checkpoint::complete_without_actual(tx, member, &now)?);
                }
            }
            if let Some(task_id) = task_id {
                let status = if req.outcome == "complete" { "完成" } else { "取消" };
                tx.execute("UPDATE productivity_task SET status = ?1, updated_at_utc = ?2 WHERE id = ?3", params![status, now, task_id])
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                bump_project(tx, &req.owning_root.id, &now)?;
            } else {
                let status = if req.outcome == "complete" { "完成" } else { "取消" };
                tx.execute("UPDATE productivity_item SET status = ?1, updated_at_utc = ?2 WHERE id = ?3", params![status, now, req.owning_root.id])
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                bump_item(tx, &req.owning_root.id, &now)?;
            }
            let mut actions = Vec::new();
            for member in &req.expected_members {
                if req.thing_kind == "task" && (req.outcome == "cancel" || disposition == "preserve") {
                    continue;
                } else if req.outcome == "complete" {
                    end_action_inner(tx, &member.id, &now)?;
                    bump_action(tx, &member.id, &now)?;
                    actions.push(finished_action_snapshot(tx, &member.id)?);
                } else {
                    // Closing an active Interval and tombstoning it happen in one revision.
                    let batch = new_uuid();
                    tx.execute("UPDATE productivity_interval SET ended_at = COALESCE(ended_at, ?1), deleted_at_utc = ?1, deletion_batch_id = ?2, updated_at_utc = ?1 WHERE action_id = ?3 AND deleted_at_utc IS NULL", params![now, batch, member.id])
                        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    tx.execute("UPDATE productivity_action SET deleted_at_utc = ?1, deletion_batch_id = ?2, updated_at_utc = ?1 WHERE id = ?3", params![now, batch, member.id])
                        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    bump_action(tx, &member.id, &now)?;
                    actions.push(action_snapshot(tx, &member.id, false)?);
                }
            }
            Ok(CompleteThingResponse {
                project: if task_id.is_some() { Some(project_snapshot(tx, &req.owning_root.id, true)?) } else { None },
                checkpoints: if checkpoints.is_empty() { None } else { Some(checkpoints) },
                list: None,
                item: if task_id.is_none() { Some(item_snapshot(tx, &req.owning_root.id, true)?) } else { None },
                actions,
            })
    });
    if let Some(expected) = req.expected_data_dir.as_deref() {
        crate::productivity_db::coordinator::with_write_expected(expected, run)
    } else {
        with_write(data_dir, run)
    }
}

fn commit_project_lifecycle(tx: &rusqlite::Transaction, req: &CommitThingLifecycleRequest, disposition:&str) -> DomainResult<CompleteThingResponse> {
    let disposition=if req.outcome=="cancel"{"preserve"}else{disposition};
    let (project, extra)=load_project_row(tx,&req.owning_root.id,true)?;guard_unknown(&extra)?;check_revision(req.owning_root.expected_revision,project.revision)?;guard_project_members(tx,&req.owning_root.id)?;
    if req.task_id.is_some(){return Err(DomainError::invalid_patch("project lifecycle cannot include taskId"));}
    let pending=crate::productivity_db::checkpoint::pending_refs_for_target(tx,"project",&req.owning_root.id)?;
    if !pending.is_empty(){if req.outcome!="complete"||!req.complete_checkpoints_without_actual||req.expected_data_dir.is_none(){return Err(DomainError::revision_conflict("未完成 Checkpoint 需先确认不记录实际时间并同时完成"));}check_members(&req.expected_checkpoints,&pending)?;}else if !req.expected_checkpoints.is_empty()||req.complete_checkpoints_without_actual{return Err(DomainError::revision_conflict("Checkpoint 确认范围已变化"));}
    let computed=related_unended_action_refs(tx,"project",&req.owning_root.id,None)?;check_members(&req.expected_members,&computed)?;
    for member in &req.expected_members {let (_,extra)=load_action_row(tx,&member.id,true)?;guard_unknown(&extra)?;ensure_action_writable(tx,&member.id)?;let intervals=load_intervals(tx,&member.id,true)?;if disposition=="preserve"&&action_started(&intervals){return Err(DomainError::active_action_blocks());}if disposition=="end"&&has_open_interval(&intervals)&&!req.confirm_active_intervals{return Err(DomainError::action_execution_invalid("active interval confirmation required"));}}
    let now=utc_now();let mut checkpoints=Vec::new();if req.outcome=="complete"&&req.complete_checkpoints_without_actual{for member in &req.expected_checkpoints{checkpoints.push(crate::productivity_db::checkpoint::complete_without_actual(tx,member,&now)?);}}
    let status=if req.outcome=="complete"{"已完成"}else{"已取消"};tx.execute("UPDATE productivity_project SET status=?1,updated_at_utc=?2 WHERE id=?3",params![status,now,req.owning_root.id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;bump_project(tx,&req.owning_root.id,&now)?;
    let mut actions=Vec::new();if disposition=="end"&&req.outcome=="complete"{for member in &req.expected_members{end_action_inner(tx,&member.id,&now)?;bump_action(tx,&member.id,&now)?;actions.push(finished_action_snapshot(tx,&member.id)?);}}
    Ok(CompleteThingResponse{project:Some(project_snapshot(tx,&req.owning_root.id,true)?),checkpoints:if checkpoints.is_empty(){None}else{Some(checkpoints)},list:None,item:None,actions})
}

pub fn complete_thing_and_end_related_actions(
    data_dir: &str,
    req: CompleteThingRequest,
) -> DomainResult<CompleteThingResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let now = utc_now();
            let mut ended_actions = Vec::new();
            match req.thing_kind.as_str() {
                "project" => {
                    let (project, extra) = load_project_row(tx, &req.owning_root.id, true)?;
                    guard_unknown(&extra)?;
                    check_revision(req.owning_root.expected_revision, project.revision)?;
                    if crate::productivity_db::checkpoint::pending_for_target(tx,"project",&req.owning_root.id)? { return Err(DomainError::revision_conflict("未完成 Checkpoint 需先显式处理")); }
                    let computed = related_unended_action_refs(
                        tx,
                        &req.thing_kind,
                        &req.owning_root.id,
                        req.task_id.as_deref(),
                    )?;
                    check_members(&req.expected_members, &computed)?;
                    reject_unconfirmed_active(tx, &req.expected_members)?;
                    tx.execute(
                        "UPDATE productivity_project SET status = '已完成', updated_at_utc = ?1 WHERE id = ?2",
                        params![now, req.owning_root.id],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    bump_project(tx, &req.owning_root.id, &now)?;
                    for member in &req.expected_members {
                        ensure_action_writable(tx, &member.id)?;
                        end_action_inner(tx, &member.id, &now)?;
                        bump_action(tx, &member.id, &now)?;
                        ended_actions.push(finished_action_snapshot(tx, &member.id)?);
                    }
                    Ok(CompleteThingResponse {
                        project: Some(project_snapshot(tx, &req.owning_root.id, true)?),
                        checkpoints: None,
                        list: None,
                        item: None,
                        actions: ended_actions,
                    })
                }
                "task" => {
                    let task_id = req
                        .task_id
                        .as_ref()
                        .ok_or_else(|| DomainError::invalid_patch("taskId required"))?;
                    let (project, extra) = load_project_row(tx, &req.owning_root.id, true)?;
                    guard_unknown(&extra)?;
                    check_revision(req.owning_root.expected_revision, project.revision)?;
                    require_live_task_in_project(tx, &req.owning_root.id, task_id)?;
                    if crate::productivity_db::checkpoint::pending_for_target(tx,"task",task_id)? { return Err(DomainError::revision_conflict("未完成 Checkpoint 需先显式处理")); }
                    let computed = related_unended_action_refs(
                        tx,
                        &req.thing_kind,
                        &req.owning_root.id,
                        Some(task_id.as_str()),
                    )?;
                    check_members(&req.expected_members, &computed)?;
                    reject_unconfirmed_active(tx, &req.expected_members)?;
                    tx.execute(
                        "UPDATE productivity_task SET status = '完成', updated_at_utc = ?1 WHERE id = ?2",
                        params![now, task_id],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    bump_project(tx, &req.owning_root.id, &now)?;
                    for member in &req.expected_members {
                        ensure_action_writable(tx, &member.id)?;
                        end_action_inner(tx, &member.id, &now)?;
                        bump_action(tx, &member.id, &now)?;
                        ended_actions.push(finished_action_snapshot(tx, &member.id)?);
                    }
                    Ok(CompleteThingResponse {
                        project: Some(project_snapshot(tx, &req.owning_root.id, true)?),
                        checkpoints: None,
                        list: None,
                        item: None,
                        actions: ended_actions,
                    })
                }
                "list" => {
                    let (list, extra) = load_list_row(tx, &req.owning_root.id, true)?;
                    guard_unknown(&extra)?;
                    check_revision(req.owning_root.expected_revision, list.revision)?;
                    let computed = related_unended_action_refs(
                        tx,
                        &req.thing_kind,
                        &req.owning_root.id,
                        None,
                    )?;
                    check_members(&req.expected_members, &computed)?;
                    reject_unconfirmed_active(tx, &req.expected_members)?;
                    ensure_list_writable(tx, Some(&req.owning_root.id))?;
                    tx.execute(
                        "UPDATE productivity_list SET status = '完成', updated_at_utc = ?1 WHERE id = ?2",
                        params![now, req.owning_root.id],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    bump_list(tx, &req.owning_root.id, &now)?;
                    for member in &req.expected_members {
                        ensure_action_writable(tx, &member.id)?;
                        end_action_inner(tx, &member.id, &now)?;
                        bump_action(tx, &member.id, &now)?;
                        ended_actions.push(finished_action_snapshot(tx, &member.id)?);
                    }
                    Ok(CompleteThingResponse {
                        project: None,
                        checkpoints: None,
                        list: Some(list_snapshot(tx, &req.owning_root.id, true)?),
                        item: None,
                        actions: ended_actions,
                    })
                }
                "item" => {
                    let (item, extra) = load_item_row(tx, &req.owning_root.id, true)?;
                    guard_unknown(&extra)?;
                    check_revision(req.owning_root.expected_revision, item.revision)?;
                    ensure_item_writable(tx, &req.owning_root.id)?;
                    if crate::productivity_db::checkpoint::pending_for_target(tx,"item",&req.owning_root.id)? { return Err(DomainError::revision_conflict("未完成 Checkpoint 需先显式处理")); }
                crate::productivity_db::health_plan::guard_item(tx, &req.owning_root.id)?;
                    let computed = related_unended_action_refs(
                        tx,
                        &req.thing_kind,
                        &req.owning_root.id,
                        None,
                    )?;
                    check_members(&req.expected_members, &computed)?;
                    reject_unconfirmed_active(tx, &req.expected_members)?;
                    tx.execute(
                        "UPDATE productivity_item SET status = '完成', updated_at_utc = ?1 WHERE id = ?2",
                        params![now, req.owning_root.id],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    bump_item(tx, &req.owning_root.id, &now)?;
                    for member in &req.expected_members {
                        ensure_action_writable(tx, &member.id)?;
                        end_action_inner(tx, &member.id, &now)?;
                        bump_action(tx, &member.id, &now)?;
                        ended_actions.push(finished_action_snapshot(tx, &member.id)?);
                    }
                    Ok(CompleteThingResponse {
                        project: None,
                        checkpoints: None,
                        list: None,
                        item: Some(item_snapshot(tx, &req.owning_root.id, true)?),
                        actions: ended_actions,
                    })
                }
                _ => Err(DomainError::invalid_patch("invalid thing kind")),
            }
        })
    })
}

fn end_action_inner(tx: &rusqlite::Transaction, action_id: &str, now: &str) -> DomainResult<()> {
    crate::productivity_db::health_plan::guard_action(tx,action_id)?;
    let intervals = load_intervals(tx, action_id, true)?;
    if has_open_interval(&intervals) {
        tx.execute(
            "UPDATE productivity_interval SET ended_at = ?1, updated_at_utc = ?1 WHERE action_id = ?2 AND ended_at IS NULL AND deleted_at_utc IS NULL",
            params![now, action_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    tx.execute(
        "UPDATE productivity_action SET ended = 1, updated_at_utc = ?1 WHERE id = ?2",
        params![now, action_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

fn reject_unconfirmed_active(tx: &rusqlite::Transaction, members: &[RevisionRef]) -> DomainResult<()> {
    for member in members {
        if has_open_interval(&load_intervals(tx, &member.id, true)?) {
            return Err(DomainError::action_execution_invalid("active interval confirmation required"));
        }
    }
    Ok(())
}
