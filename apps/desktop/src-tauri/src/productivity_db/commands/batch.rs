use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::error::{DomainError, DomainResult};
use crate::productivity_db::execution::{has_any_interval, has_open_interval};
use crate::productivity_db::point::{point_to_json, validate_point};
use crate::productivity_db::repository::*;
use crate::productivity_db::types::*;
use crate::productivity_db::util::{new_uuid, utc_now};
use crate::productivity_db::validation::*;

fn validate_target_pair(kind: Option<&str>, id: Option<&str>) -> DomainResult<()> {
    match (kind, id) {
        (None, None) => Ok(()),
        (Some(k), Some(i)) => {
            validate_target_kind(k)?;
            if i.is_empty() {
                return Err(DomainError::invalid_patch("targetId required"));
            }
            Ok(())
        }
        _ => Err(DomainError::invalid_patch("targetKind and targetId must be paired")),
    }
}

fn apply_action_update_in_tx(tx: &rusqlite::Transaction, draft: &CommitActionUpdateDraft) -> DomainResult<()> {
    ensure_action_writable(tx, &draft.action.id)?;
    let (action, extra) = load_action_row(tx, &draft.action.id, true)?;
    guard_unknown(&extra)?;
    check_revision(draft.action.expected_revision, action.revision)?;
    let intervals = load_intervals(tx, &draft.action.id, true)?;
    if has_any_interval(&intervals) {
        if draft.patch.planned_start_at.is_some()
            || draft.patch.planned_end_at.is_some()
            || draft.patch.planned_duration.is_some()
        {
            return Err(DomainError::action_execution_invalid(
                "cannot change planned time after intervals exist",
            ));
        }
    }
    let planned_start = if draft.patch.planned_start_at.is_some() {
        draft.patch.planned_start_at.clone().flatten()
    } else {
        action.planned_start_at.clone()
    };
    let planned_end = if draft.patch.planned_end_at.is_some() {
        draft.patch.planned_end_at.clone().flatten()
    } else {
        action.planned_end_at.clone()
    };
    let planned_duration = if draft.patch.planned_duration.is_some() {
        draft.patch.planned_duration.clone().flatten()
    } else {
        action.planned_duration
    };
    validate_action_plan(
        planned_start.as_deref(),
        planned_end.as_deref(),
        planned_duration,
    )?;
    if let Some(session_id) = &action.session_id {
        if let (Some(s), Some(e)) = (&planned_start, &planned_end) {
            ensure_action_fits_session(tx, s, e, session_id)?;
        }
    }
    let title = draft.patch.title.as_deref().unwrap_or(&action.title);
    let name_link_mode = next_name_link_mode(
        &action.name_link_mode,
        draft.patch.name_link_mode.as_deref(),
        draft.patch.title.is_some(),
    )?;
    let summary = if draft.patch.summary.is_some() {
        draft.patch.summary.clone().flatten()
    } else {
        action.summary.clone()
    };
    let appearance = if let Some(next) = &draft.patch.appearance {
        if let Some(app) = next {
            validate_appearance(app)?;
        }
        next.clone()
    } else {
        action.appearance.clone()
    };
    let appearance_json = match &appearance {
        None => "{}".to_string(),
        Some(a) => serde_json::to_string(a)
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
    };
    let now = utc_now();
    tx.execute(
        "UPDATE productivity_action SET title = ?1, summary = ?2, planned_start_at = ?3, planned_end_at = ?4, planned_duration_seconds = ?5, appearance_json = ?6, name_link_mode = ?7, updated_at_utc = ?8 WHERE id = ?9",
        params![
            title,
            summary,
            planned_start,
            planned_end,
            planned_duration,
            appearance_json,
            name_link_mode,
            now,
            draft.action.id
        ],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    bump_action(tx, &draft.action.id, &now)?;
    Ok(())
}

fn apply_action_delete_in_tx(tx: &rusqlite::Transaction, action_ref: &RevisionRef) -> DomainResult<()> {
    ensure_action_writable(tx, &action_ref.id)?;
    let (action, extra) = load_action_row(tx, &action_ref.id, true)?;
    guard_unknown(&extra)?;
    check_revision(action_ref.expected_revision, action.revision)?;
    ensure_action_deletable(tx, &action_ref.id)?;
    let now = utc_now();
    let batch = new_uuid();
    tx.execute(
        "UPDATE productivity_action SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3",
        params![now, batch, action_ref.id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "UPDATE productivity_interval SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE action_id = ?3 AND deleted_at_utc IS NULL",
        params![now, batch, action_ref.id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    bump_action(tx, &action_ref.id, &now)?;
    Ok(())
}

fn apply_action_create_for_item_in_tx(
    tx: &rusqlite::Transaction,
    item_id: &str,
    draft: &CommitActionCreateDraft,
) -> DomainResult<String> {
    let name_link_mode = draft.name_link_mode.as_deref().unwrap_or("unlinked");
    validate_name_link_mode(name_link_mode)?;
    validate_action_plan(
        draft.planned_start_at.as_deref(),
        draft.planned_end_at.as_deref(),
        draft.planned_duration,
    )?;
    if let Some(session_id) = &draft.session_id {
        let _ = session_snapshot(tx, session_id, true)?;
        if let (Some(s), Some(e)) = (&draft.planned_start_at, &draft.planned_end_at) {
            ensure_action_fits_session(tx, s, e, session_id)?;
        } else if draft.planned_start_at.is_some() || draft.planned_end_at.is_some() {
            return Err(DomainError::action_outside_session(
                "session action needs complete planned range",
            ));
        }
    }
    if let Some(app) = &draft.appearance {
        validate_appearance(app)?;
    }
    let id = new_uuid();
    let now = utc_now();
    insert_action(
        tx,
        &id,
        &draft.title,
        draft.summary.as_deref(),
        draft.session_id.as_deref(),
        Some("item"),
        Some(item_id),
        draft.planned_start_at.as_deref(),
        draft.planned_end_at.as_deref(),
        draft.planned_duration,
        false,
        draft.appearance.as_ref(),
        &now,
    )?;
    tx.execute("UPDATE productivity_action SET name_link_mode = ?1 WHERE id = ?2", params![name_link_mode, id])
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(id)
}

pub fn commit_item_with_actions(
    data_dir: &str,
    req: CommitItemWithActionsRequest,
) -> DomainResult<CommitItemWithActionsResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let now = utc_now();
            let item_id = if let Some(id) = &req.item_id {
                let expected = req
                    .item_expected_revision
                    .ok_or_else(|| DomainError::invalid_patch("item expectedRevision required"))?;
                let (item, extra) = load_item_row(tx, id, true)?;
                guard_unknown(&extra)?;
                check_revision(expected, item.revision)?;
                ensure_item_writable(tx, id)?;
                if req.item_create.is_some() {
                    return Err(DomainError::invalid_patch("itemCreate invalid for update"));
                }
                if let Some(patch) = &req.item_patch {
                    let (planned, due) = apply_point_patch(
                        &item.planned_point,
                        &item.due_point,
                        &patch.planned_point,
                        &patch.due_point,
                    )?;
                    let title = patch.title.as_deref().unwrap_or(&item.title);
                    let description = if patch.description.is_some() {
                        patch.description.clone().flatten()
                    } else {
                        item.description.clone()
                    };
                    let status = if let Some(status) = &patch.status {
                        validate_item_status(status)?;
                        status.as_str()
                    } else {
                        item.status.as_str()
                    };
                    let priority = if let Some(priority) = &patch.priority {
                        validate_item_priority(priority)?;
                        priority.as_str()
                    } else {
                        item.priority.as_str()
                    };
                    let scalar_changed = title != item.title || description != item.description || status != item.status || priority != item.priority || planned != item.planned_point || due != item.due_point;
                    let classification_changed = crate::productivity_db::classification::apply_item_patch_classification(tx,id,patch)?;
                    if scalar_changed {
                        tx.execute(
                            "UPDATE productivity_item SET title = ?1, description = ?2, status = ?3, priority = ?4, planned_point_json = ?5, due_point_json = ?6, updated_at_utc = ?7 WHERE id = ?8",
                            params![title,description,status,priority,point_to_json(&planned),point_to_json(&due),now,id],
                        )
                        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    }
                    if scalar_changed || classification_changed { bump_item(tx, id, &now)?; }
                }
                id.clone()
            } else {
                if req.item_expected_revision.is_some() {
                    return Err(DomainError::invalid_patch(
                        "item expectedRevision invalid for create",
                    ));
                }
                let create = req
                    .item_create
                    .as_ref()
                    .ok_or_else(|| DomainError::invalid_patch("itemCreate required"))?;
                if req.item_patch.is_some() {
                    return Err(DomainError::invalid_patch("itemPatch invalid for create"));
                }
                validate_item_status(&create.status)?;
                validate_item_priority(&create.priority)?;
                if let Some(p) = &create.planned_point {
                    validate_point(p)?;
                }
                if let Some(p) = &create.due_point {
                    validate_point(p)?;
                }
                if let Some(list_id) = &create.list_id {
                    let _ = list_snapshot(tx, list_id, true)?;
                }
                ensure_list_writable(tx, create.list_id.as_deref())?;
                let id = new_uuid();
                insert_item(
                    tx,
                    &id,
                    create.list_id.as_deref(),
                    &create.title,
                    create.description.as_deref(),
                    &create.status,
                    &create.priority,
                    point_to_json(&create.planned_point).as_deref(),
                    point_to_json(&create.due_point).as_deref(),
                    &now,
                )?;
                crate::productivity_db::classification::create_item_classification(tx,&id,create.item_type_id.as_deref(),&create.tag_ids,create.classification_expected.as_ref())?;
                append_item_to_order(tx, &id, &now)?;
                id
            };

            let actual_associated = actions_targeting_item_refs(tx, &item_id)?;
            check_members(&req.expected_associated_actions, &actual_associated)?;

            for delete in &req.action_deletes {
                if !actual_associated.iter().any(|a| a.id == delete.id) {
                    return Err(DomainError::invalid_patch("action delete not associated"));
                }
            }
            for update in &req.action_updates {
                if !actual_associated.iter().any(|a| a.id == update.action.id) {
                    return Err(DomainError::invalid_patch("action update not associated"));
                }
            }

            let mut affected_ids: Vec<String> = Vec::new();
            for draft in &req.action_creates {
                let id = apply_action_create_for_item_in_tx(tx, &item_id, draft)?;
                affected_ids.push(id);
            }
            for draft in &req.action_updates {
                apply_action_update_in_tx(tx, draft)?;
                affected_ids.push(draft.action.id.clone());
            }
            for delete in &req.action_deletes {
                if has_open_interval(&load_intervals(tx, &delete.id, true)?) {
                    return Err(DomainError::action_execution_invalid(
                        "running action cannot be deleted in batch",
                    ));
                }
                apply_action_delete_in_tx(tx, delete)?;
                affected_ids.push(delete.id.clone());
            }

            let mut actions = Vec::new();
            for id in affected_ids {
                actions.push(finished_action_snapshot(tx, &id)?);
            }
            Ok(CommitItemWithActionsResponse {
                item: item_snapshot(tx, &item_id, true)?,
                actions,
            })
        })
    })
}

fn batch_op_kind(op: &ProductivityAiBatchOp) -> DomainResult<&'static str> {
    let count = [
        op.create_project.is_some(),
        op.update_project.is_some(),
        op.create_task.is_some(),
        op.update_task.is_some(),
        op.create_list.is_some(),
        op.update_list.is_some(),
        op.create_item.is_some(),
        op.update_item.is_some(),
        op.create_session.is_some(),
        op.update_session.is_some(),
        op.create_action.is_some(),
        op.update_action.is_some(),
    ]
    .into_iter()
    .filter(|v| *v)
    .count();
    if count != 1 {
        return Err(DomainError::invalid_patch("batch op must have exactly one change"));
    }
    if op.create_project.is_some() {
        Ok("createProject")
    } else if op.update_project.is_some() {
        Ok("updateProject")
    } else if op.create_task.is_some() {
        Ok("createTask")
    } else if op.update_task.is_some() {
        Ok("updateTask")
    } else if op.create_list.is_some() {
        Ok("createList")
    } else if op.update_list.is_some() {
        Ok("updateList")
    } else if op.create_item.is_some() {
        Ok("createItem")
    } else if op.update_item.is_some() {
        Ok("updateItem")
    } else if op.create_session.is_some() {
        Ok("createSession")
    } else if op.update_session.is_some() {
        Ok("updateSession")
    } else if op.create_action.is_some() {
        Ok("createAction")
    } else {
        Ok("updateAction")
    }
}

struct BatchCollect {
    project_ids: std::collections::HashSet<String>,
    list_ids: std::collections::HashSet<String>,
    item_ids: std::collections::HashSet<String>,
    item_expected: std::collections::HashMap<String, i64>,
    item_changed: std::collections::HashSet<String>,
    session_ids: std::collections::HashSet<String>,
    action_ids: std::collections::HashSet<String>,
    item_order_touched: bool,
}

impl BatchCollect {
    fn new() -> Self {
        Self {
            project_ids: std::collections::HashSet::new(),
            list_ids: std::collections::HashSet::new(),
            item_ids: std::collections::HashSet::new(),
            item_expected: std::collections::HashMap::new(),
            item_changed: std::collections::HashSet::new(),
            session_ids: std::collections::HashSet::new(),
            action_ids: std::collections::HashSet::new(),
            item_order_touched: false,
        }
    }
}

fn reject_travel_v2_batch_op(tx: &rusqlite::Transaction, op: &ProductivityAiBatchOp) -> DomainResult<()> {
    match batch_op_kind(op)? {
        "updateItem" => {
            let req = op.update_item.as_ref().unwrap();
            ensure_not_travel_item(tx, &req.item.id)?;
        }
        "createAction" => {
            let req = op.create_action.as_ref().unwrap();
            if let (Some("item"), Some(id)) = (req.target_kind.as_deref(), req.target_id.as_deref()) {
                ensure_not_travel_item(tx, id)?;
            }
        }
        "updateAction" => {
            let req = op.update_action.as_ref().unwrap();
            ensure_not_travel_action(tx, &req.action.id)?;
        }
        "updateSession" => {
            let req = op.update_session.as_ref().unwrap();
            let checkpoint_members =
                crate::productivity_db::checkpoint::session_member_refs(tx, &req.session.id)?;
            super::reject_travel_v2_session_checkpoints(tx, &checkpoint_members)?;
            let actions = actions_for_session(tx, &req.session.id, true)?;
            let action_refs: Vec<RevisionRef> = actions
                .iter()
                .map(|a| RevisionRef {
                    id: a.id.clone(),
                    expected_revision: a.revision,
                })
                .collect();
            super::reject_travel_v2_session_actions(tx, &action_refs)?;
        }
        _ => {}
    }
    Ok(())
}

fn apply_batch_op(tx: &rusqlite::Transaction, op: &ProductivityAiBatchOp, collect: &mut BatchCollect) -> DomainResult<()> {
    match batch_op_kind(op)? {
        "createProject" => {
            let req = op.create_project.as_ref().unwrap();
            validate_project_status(&req.status)?;
            if let Some(p) = &req.planned_point {
                validate_point(p)?;
            }
            if let Some(p) = &req.due_point {
                validate_point(p)?;
            }
            let id = new_uuid();
            let now = utc_now();
            insert_project(
                tx,
                &id,
                &req.title,
                req.description.as_deref(),
                &req.status,
                point_to_json(&req.planned_point).as_deref(),
                point_to_json(&req.due_point).as_deref(),
                &now,
            )?;
            crate::workspace_db::repository::insert_domain_member(
                tx,
                crate::workspace_db::repository::ROOT_CONTAINER_ID,
                "project",
                crate::workspace_db::repository::DOMAIN_PRODUCTIVITY,
                crate::workspace_db::repository::TYPE_PROJECT,
                &id,
                None,
                &now,
            )?;
            crate::workspace_db::repository::bump_container(
                tx,
                crate::workspace_db::repository::ROOT_CONTAINER_ID,
                &now,
            )?;
            collect.project_ids.insert(id);
        }
        "updateProject" => {
            let req = op.update_project.as_ref().unwrap();
            let (project, extra) = load_project_row(tx, &req.project.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            let (planned, due) = apply_point_patch(
                &project.planned_point,
                &project.due_point,
                &req.patch.planned_point,
                &req.patch.due_point,
            )?;
            let title = req.patch.title.as_deref().unwrap_or(&project.title);
            let description = if req.patch.description.is_some() {
                req.patch.description.clone().flatten()
            } else {
                project.description.clone()
            };
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_project SET title = ?1, description = ?2, planned_point_json = ?3, due_point_json = ?4, updated_at_utc = ?5 WHERE id = ?6",
                params![
                    title,
                    description,
                    point_to_json(&planned),
                    point_to_json(&due),
                    now,
                    req.project.id
                ],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_project(tx, &req.project.id, &now)?;
            collect.project_ids.insert(req.project.id.clone());
        }
        "createTask" => {
            let req = op.create_task.as_ref().unwrap();
            validate_task_status(&req.status)?;
            if let Some(p) = &req.planned_point {
                validate_point(p)?;
            }
            if let Some(p) = &req.due_point {
                validate_point(p)?;
            }
            let (project, extra) = load_project_row(tx, &req.project.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            super::super::repository::guard_project_members(tx, &req.project.id)?;
            if let Some(parent) = &req.parent_task_id {
                let tasks = load_tasks_for_project(tx, &req.project.id, true)?;
                if !tasks.iter().any(|t| t.id == *parent) {
                    return Err(DomainError::root_not_found("parent task not found"));
                }
            }
            let now = utc_now();
            let id = new_uuid();
            insert_task(
                tx,
                &id,
                &req.project.id,
                req.parent_task_id.as_deref(),
                &req.title,
                req.description.as_deref(),
                &req.status,
                point_to_json(&req.planned_point).as_deref(),
                point_to_json(&req.due_point).as_deref(),
                &now,
            )?;
            super::super::classification::set_task_classification(tx, &id, req.item_type_id.as_deref(), req.classification_expected.as_ref())?;
            bump_project(tx, &req.project.id, &now)?;
            collect.project_ids.insert(req.project.id.clone());
        }
        "updateTask" => {
            let req = op.update_task.as_ref().unwrap();
            let (project, extra) = load_project_row(tx, &req.project.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            super::super::repository::guard_project_members(tx, &req.project.id)?;
            let tasks = load_tasks_for_project(tx, &req.project.id, true)?;
            let task = tasks
                .iter()
                .find(|t| t.id == req.task_id)
                .ok_or_else(|| DomainError::root_not_found("task not found"))?;
            let (planned, due) = apply_point_patch(
                &task.planned_point,
                &task.due_point,
                &req.patch.planned_point,
                &req.patch.due_point,
            )?;
            let title = req.patch.title.as_deref().unwrap_or(&task.title);
            let description = if req.patch.description.is_some() {
                req.patch.description.clone().flatten()
            } else {
                task.description.clone()
            };
            if let Some(target) = &req.patch.item_type_id {
                super::super::classification::set_task_classification(tx, &req.task_id, target.as_deref(), req.patch.classification_expected.as_ref())?;
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_task SET title = ?1, description = ?2, planned_point_json = ?3, due_point_json = ?4, updated_at_utc = ?5 WHERE id = ?6",
                params![
                    title,
                    description,
                    point_to_json(&planned),
                    point_to_json(&due),
                    now,
                    req.task_id
                ],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_project(tx, &req.project.id, &now)?;
            collect.project_ids.insert(req.project.id.clone());
        }
        "createList" => {
            let req = op.create_list.as_ref().unwrap();
            validate_list_status(&req.status)?;
            if let Some(p) = &req.planned_point {
                validate_point(p)?;
            }
            if let Some(p) = &req.due_point {
                validate_point(p)?;
            }
            let id = new_uuid();
            let now = utc_now();
            insert_list(
                tx,
                &id,
                &req.title,
                req.description.as_deref(),
                &req.status,
                point_to_json(&req.planned_point).as_deref(),
                point_to_json(&req.due_point).as_deref(),
                &now,
            )?;
            collect.list_ids.insert(id);
        }
        "updateList" => {
            let req = op.update_list.as_ref().unwrap();
            let (list, extra) = load_list_row(tx, &req.list.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.list.expected_revision, list.revision)?;
            let (planned, due) = apply_point_patch(
                &list.planned_point,
                &list.due_point,
                &req.patch.planned_point,
                &req.patch.due_point,
            )?;
            let title = req.patch.title.as_deref().unwrap_or(&list.title);
            let description = if req.patch.description.is_some() {
                req.patch.description.clone().flatten()
            } else {
                list.description.clone()
            };
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_list SET title = ?1, description = ?2, planned_point_json = ?3, due_point_json = ?4, updated_at_utc = ?5 WHERE id = ?6",
                params![
                    title,
                    description,
                    point_to_json(&planned),
                    point_to_json(&due),
                    now,
                    req.list.id
                ],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_list(tx, &req.list.id, &now)?;
            collect.list_ids.insert(req.list.id.clone());
        }
        "createItem" => {
            let req = op.create_item.as_ref().unwrap();
            validate_item_status(&req.status)?;
            validate_item_priority(&req.priority)?;
            if let Some(p) = &req.planned_point {
                validate_point(p)?;
            }
            if let Some(p) = &req.due_point {
                validate_point(p)?;
            }
            if let Some(list_id) = &req.list_id {
                let _ = list_snapshot(tx, list_id, true)?;
            }
            ensure_list_writable(tx, req.list_id.as_deref())?;
            let id = new_uuid();
            let now = utc_now();
            insert_item(
                tx,
                &id,
                req.list_id.as_deref(),
                &req.title,
                req.description.as_deref(),
                &req.status,
                &req.priority,
                point_to_json(&req.planned_point).as_deref(),
                point_to_json(&req.due_point).as_deref(),
                &now,
            )?;
            crate::productivity_db::classification::create_item_classification(tx,&id,req.item_type_id.as_deref(),&req.tag_ids,req.classification_expected.as_ref())?;
            append_item_to_order(tx, &id, &now)?;
            collect.item_ids.insert(id);
            collect.item_order_touched = true;
        }
        "updateItem" => {
            let req = op.update_item.as_ref().unwrap();
            let (item, extra) = load_item_row(tx, &req.item.id, true)?;
            guard_unknown(&extra)?;
            if let Some(initial) = collect.item_expected.get(&req.item.id) {
                check_revision(req.item.expected_revision, *initial)?;
            } else {
                check_revision(req.item.expected_revision, item.revision)?;
                collect.item_expected.insert(req.item.id.clone(), item.revision);
            }
            ensure_item_writable(tx, &req.item.id)?;
            let (planned, due) = apply_point_patch(
                &item.planned_point,
                &item.due_point,
                &req.patch.planned_point,
                &req.patch.due_point,
            )?;
            let title = req.patch.title.as_deref().unwrap_or(&item.title);
            let description = if req.patch.description.is_some() {
                req.patch.description.clone().flatten()
            } else {
                item.description.clone()
            };
            let status = if let Some(status) = &req.patch.status {
                validate_item_status(status)?;
                status.as_str()
            } else {
                item.status.as_str()
            };
            let priority = if let Some(priority) = &req.patch.priority {
                validate_item_priority(priority)?;
                priority.as_str()
            } else {
                item.priority.as_str()
            };
            let scalar_changed = title != item.title || description != item.description || status != item.status || priority != item.priority || planned != item.planned_point || due != item.due_point;
            let classification_changed = crate::productivity_db::classification::apply_item_patch_classification(tx,&req.item.id,&req.patch)?;
            if scalar_changed {
                tx.execute(
                    "UPDATE productivity_item SET title = ?1, description = ?2, status = ?3, priority = ?4, planned_point_json = ?5, due_point_json = ?6 WHERE id = ?7",
                    params![title, description, status, priority, point_to_json(&planned), point_to_json(&due), req.item.id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
            if scalar_changed || classification_changed {
                collect.item_changed.insert(req.item.id.clone());
            }
            collect.item_ids.insert(req.item.id.clone());
        }
        "createSession" => {
            let req = op.create_session.as_ref().unwrap();
            validate_session_range(&req.planned_start_at, &req.planned_end_at)?;
            let track_lane = req.track_lane.unwrap_or(0);
            let track_span = req.track_span.unwrap_or(1);
            validate_session_track(track_lane, track_span)?;
            ensure_no_session_overlap(tx, &req.planned_start_at, &req.planned_end_at, None)?;
            let id = new_uuid();
            let now = utc_now();
            insert_session(
                tx,
                &id,
                &req.title,
                req.description.as_deref(),
                &req.planned_start_at,
                &req.planned_end_at,
                track_lane,
                track_span,
                &now,
            )?;
            collect.session_ids.insert(id);
        }
        "updateSession" => {
            let req = op.update_session.as_ref().unwrap();
            let (session, extra) = load_session_row(tx, &req.session.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.session.expected_revision, session.revision)?;
            let start = req
                .patch
                .planned_start_at
                .as_deref()
                .unwrap_or(&session.planned_start_at);
            let end = req
                .patch
                .planned_end_at
                .as_deref()
                .unwrap_or(&session.planned_end_at);
            validate_session_range(start, end)?;
            ensure_no_session_overlap(tx, start, end, Some(&req.session.id))?;
            let actions = actions_for_session(tx, &req.session.id, true)?;
            for action in &actions {
                if let (Some(plan_start), Some(plan_end)) =
                    (&action.planned_start_at, &action.planned_end_at)
                {
                    ensure_action_fits_range(plan_start, plan_end, start, end)?;
                }
            }
            let title = req.patch.title.as_deref().unwrap_or(&session.title);
            let description = if req.patch.description.is_some() {
                req.patch.description.clone().flatten()
            } else {
                session.description.clone()
            };
            let track_lane = 0;
            let track_span = req.patch.track_span.unwrap_or(session.track_span);
            validate_session_track(track_lane, track_span)?;
            if track_span != session.track_span {
                return Err(DomainError::invalid_patch("Session span change requires 2D member validation"));
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_session SET title = ?1, description = ?2, planned_start_at = ?3, planned_end_at = ?4, track_lane = ?5, track_span = ?6, updated_at_utc = ?7 WHERE id = ?8",
                params![
                    title,
                    description,
                    start,
                    end,
                    track_lane,
                    track_span,
                    now,
                    req.session.id
                ],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_session(tx, &req.session.id, &now)?;
            collect.session_ids.insert(req.session.id.clone());
        }
        "createAction" => {
            let req = op.create_action.as_ref().unwrap();
            let name_link_mode = req.name_link_mode.as_deref().unwrap_or("unlinked");
            validate_name_link_mode(name_link_mode)?;
            validate_target_pair(req.target_kind.as_deref(), req.target_id.as_deref())?;
            validate_action_plan(
                req.planned_start_at.as_deref(),
                req.planned_end_at.as_deref(),
                req.planned_duration,
            )?;
            if let Some(session_id) = &req.session_id {
                let _ = session_snapshot(tx, session_id, true)?;
                if let (Some(s), Some(e)) = (&req.planned_start_at, &req.planned_end_at) {
                    ensure_action_fits_session(tx, s, e, session_id)?;
                } else if req.planned_start_at.is_some() || req.planned_end_at.is_some() {
                    return Err(DomainError::action_outside_session(
                        "session action needs complete planned range",
                    ));
                }
            }
            if let (Some(k), Some(id)) = (&req.target_kind, &req.target_id) {
                validate_target_kind(k)?;
                target_exists_live(tx, k, id)?;
                ensure_action_item_target_writable(tx, Some(k.as_str()), Some(id.as_str()))?;
            }
            if let Some(app) = &req.appearance {
                validate_appearance(app)?;
            }
            let id = new_uuid();
            let now = utc_now();
            insert_action(
                tx,
                &id,
                &req.title,
                req.summary.as_deref(),
                req.session_id.as_deref(),
                req.target_kind.as_deref(),
                req.target_id.as_deref(),
                req.planned_start_at.as_deref(),
                req.planned_end_at.as_deref(),
                req.planned_duration,
                false,
                req.appearance.as_ref(),
                &now,
            )?;
            tx.execute("UPDATE productivity_action SET name_link_mode = ?1 WHERE id = ?2", params![name_link_mode, id])
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            collect.action_ids.insert(id);
        }
        "updateAction" => {
            let req = op.update_action.as_ref().unwrap();
            apply_action_update_in_tx(
                tx,
                &CommitActionUpdateDraft {
                    action: req.action.clone(),
                    patch: req.patch.clone(),
                },
            )?;
            collect.action_ids.insert(req.action.id.clone());
        }
        _ => return Err(DomainError::invalid_patch("unsupported batch op")),
    }
    Ok(())
}

pub fn apply_productivity_ai_batch(
    data_dir: &str,
    req: ApplyProductivityAiBatchRequest,
) -> DomainResult<ApplyProductivityAiBatchResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            for op in &req.ops {
                reject_travel_v2_batch_op(tx, op)?;
            }
            let mut collect = BatchCollect::new();
            for op in &req.ops {
                apply_batch_op(tx, op, &mut collect)?;
            }
            let now = utc_now();
            // See docs/specs/productivity-local-commands.md: only changed roots
            // advance once per batch, even after several updates to the same Item.
            for id in &collect.item_changed { bump_item(tx, id, &now)?; }
            let mut projects = Vec::new();
            for id in collect.project_ids {
                projects.push(project_snapshot(tx, &id, true)?);
            }
            let mut lists = Vec::new();
            for id in collect.list_ids {
                lists.push(list_snapshot(tx, &id, true)?);
            }
            let mut items = Vec::new();
            for id in collect.item_ids {
                items.push(item_snapshot(tx, &id, true)?);
            }
            let mut sessions = Vec::new();
            for id in collect.session_ids {
                sessions.push(session_snapshot(tx, &id, true)?);
            }
            let mut actions = Vec::new();
            for id in collect.action_ids {
                actions.push(finished_action_snapshot(tx, &id)?);
            }
            let item_order = if collect.item_order_touched {
                Some(item_order_snapshot(tx)?)
            } else {
                None
            };
            Ok(ApplyProductivityAiBatchResponse {
                projects,
                lists,
                items,
                sessions,
                actions,
                item_order,
            })
        })
    })
}
