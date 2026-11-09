use rusqlite::params;
use rusqlite::OptionalExtension;

use crate::productivity_db::coordinator::{in_transaction, with_write, with_write_expected};
use crate::productivity_db::error::{DomainError, DomainResult};
use crate::productivity_db::execution::{action_started, has_any_interval, has_open_interval};
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

fn action_write<T>(data_dir: &str, expected: Option<&str>, f: impl FnOnce(&rusqlite::Connection) -> DomainResult<T>) -> DomainResult<T> {
    // Keep the rendered root bound through the coordinator lock (docs/specs/0012-project-task-mvp.proposed.md §10).
    if let Some(expected) = expected {
        if std::path::Path::new(expected) != std::path::Path::new(data_dir) {
            return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消"));
        }
        with_write_expected(expected, f)
    } else {
        with_write(data_dir, f)
    }
}

pub(crate) fn guard_arrangement_target(
    tx: &rusqlite::Transaction<'_>, action: &ActionSnapshot, root: Option<&RevisionRef>,
) -> DomainResult<()> {
    match (action.target_kind.as_deref(), action.target_id.as_deref(), root) {
        (None, None, None) => return Ok(()),
        (Some("item"), Some(id), Some(root)) if root.id == id => {
            let (item, extra) = load_item_row(tx, id, true)?;
            guard_unknown(&extra)?;
            check_revision(root.expected_revision, item.revision)?;
            ensure_item_writable(tx, id)?;
        }
        (Some(kind @ ("project" | "task")), Some(id), Some(root)) => {
            let (project, extra) = load_project_row(tx, &root.id, true)?;
            guard_unknown(&extra)?;
            check_revision(root.expected_revision, project.revision)?;
            guard_project_members(tx, &root.id)?;
            if kind == "project" && root.id != id {
                return Err(DomainError::invalid_patch("target owning root mismatch"));
            }
            if kind == "task" && !load_tasks_for_project(tx, &root.id, true)?.iter().any(|t| t.id == id) {
                return Err(DomainError::invalid_patch("target owning root mismatch"));
            }
            if project.status == "已归档" {
                return Err(DomainError::invalid_status("archived project target is read-only"));
            }
        }
        _ => return Err(DomainError::invalid_patch("target owning root mismatch")),
    }
    if let (Some(kind), Some(id)) = (action.target_kind.as_deref(), action.target_id.as_deref()) {
        ensure_reopen_target_available(tx, kind, id)?;
    }
    Ok(())
}

pub(crate) fn guard_arrangement_action(tx: &rusqlite::Transaction<'_>, action: &ActionSnapshot) -> DomainResult<()> {
    ensure_action_writable(tx, &action.id)?;
    if action.ended || has_any_interval(&load_intervals(tx, &action.id, true)?) {
        return Err(DomainError::action_execution_invalid("plan restore requires an unstarted, unended action"));
    }
    Ok(())
}

pub fn restore_action_arrangement_state(data_dir: &str, req: RestoreActionArrangementStateRequest) -> DomainResult<ActionResponse> {
    validate_action_plan(req.target_state.planned_start_at.as_deref(), req.target_state.planned_end_at.as_deref(), req.target_state.planned_duration)?;
    // SPEC-0015 §6.1: bind the captured path through the actual write lock.
    action_write(data_dir, Some(&req.expected_data_dir), |conn| in_transaction(conn, |tx| {
        let (action, extra) = load_action_row(tx, &req.action.id, true)?;
        guard_unknown(&extra)?;
        check_revision(req.action.expected_revision, action.revision)?;
        guard_arrangement_action(tx, &action)?;
        guard_arrangement_target(tx, &action, req.target_owning_root.as_ref())?;
        let current = ActionArrangementState {
            planned_start_at: action.planned_start_at.clone(), planned_end_at: action.planned_end_at.clone(),
            planned_duration: action.planned_duration, session_id: action.session_id.clone(),
        };
        if current != req.expected_state {
            return Err(DomainError::revision_conflict("action arrangement projection changed"));
        }
        if current.session_id.as_deref() != req.current_session.as_ref().map(|s| s.id.as_str())
            || req.target_state.session_id.as_deref() != req.next_session.as_ref().map(|s| s.id.as_str()) {
            return Err(DomainError::invalid_patch("session projection/ref mismatch"));
        }
        for (session_ref, members) in [(&req.current_session, &req.current_session_members), (&req.next_session, &req.next_session_members)] {
            if let Some(reference) = session_ref {
                let (session, extra) = load_session_row(tx, &reference.id, true)?;
                guard_unknown(&extra)?;
                check_revision(reference.expected_revision, session.revision)?;
                check_members(members, &session_member_refs(tx, &reference.id)?)?;
            } else if !members.is_empty() {
                return Err(DomainError::invalid_patch("members without session"));
            }
        }
        if let Some(session) = &req.next_session {
            let (Some(start), Some(end)) = (&req.target_state.planned_start_at, &req.target_state.planned_end_at) else {
                return Err(DomainError::action_outside_session("session action needs complete planned range"));
            };
            ensure_action_fits_session(tx, start, end, &session.id)?;
        }
        if current == req.target_state {
            return Ok(ActionResponse { action: finished_action_snapshot(tx, &action.id)? });
        }
        let now = utc_now();
        tx.execute("UPDATE productivity_action SET planned_start_at=?1, planned_end_at=?2, planned_duration_seconds=?3, session_id=?4, updated_at_utc=?5 WHERE id=?6",
            params![req.target_state.planned_start_at, req.target_state.planned_end_at, req.target_state.planned_duration, req.target_state.session_id, now, action.id])
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        bump_action(tx, &action.id, &now)?;
        Ok(ActionResponse { action: finished_action_snapshot(tx, &action.id)? })
    }))
}

pub fn create_action(data_dir: &str, req: CreateActionRequest) -> DomainResult<ActionResponse> {
    let name_link_mode = req.name_link_mode.as_deref().unwrap_or("unlinked");
    validate_name_link_mode(name_link_mode)?;
    validate_target_pair(req.target_kind.as_deref(), req.target_id.as_deref())?;
    validate_action_plan(
        req.planned_start_at.as_deref(),
        req.planned_end_at.as_deref(),
        req.planned_duration,
    )?;
    action_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            if let Some(session_id) = &req.session_id {
                let _ = session_snapshot(tx, session_id, true)?;
                if let (Some(s), Some(e)) = (&req.planned_start_at, &req.planned_end_at) {
                    ensure_action_fits_session(tx, s, e, session_id)?;
                } else {
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
            tx.execute(
                "UPDATE productivity_action SET name_link_mode = ?1 WHERE id = ?2",
                params![name_link_mode, id],
            ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &id)?,
            })
        })
    })
}

pub fn update_action(data_dir: &str, req: UpdateActionRequest) -> DomainResult<ActionResponse> {
    action_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            let intervals = load_intervals(tx, &req.action.id, true)?;
            if has_any_interval(&intervals) {
                if req.patch.planned_start_at.is_some()
                    || req.patch.planned_end_at.is_some()
                    || req.patch.planned_duration.is_some()
                {
                    return Err(DomainError::action_execution_invalid(
                        "cannot change planned time after intervals exist",
                    ));
                }
            }
            let planned_start = if req.patch.planned_start_at.is_some() {
                req.patch.planned_start_at.clone().flatten()
            } else {
                action.planned_start_at.clone()
            };
            let planned_end = if req.patch.planned_end_at.is_some() {
                req.patch.planned_end_at.clone().flatten()
            } else {
                action.planned_end_at.clone()
            };
            let planned_duration = if req.patch.planned_duration.is_some() {
                req.patch.planned_duration.clone().flatten()
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
            let title = req.patch.title.as_deref().unwrap_or(&action.title);
            let name_link_mode = next_name_link_mode(
                &action.name_link_mode,
                req.patch.name_link_mode.as_deref(),
                req.patch.title.is_some(),
            )?;
            let summary = if req.patch.summary.is_some() {
                req.patch.summary.clone().flatten()
            } else {
                action.summary.clone()
            };
            let appearance = if let Some(next) = &req.patch.appearance {
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
                params![title, summary, planned_start, planned_end, planned_duration, appearance_json, name_link_mode, now, req.action.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &req.action.id)?,
            })
        })
    })
}

// SPEC-0003 §10.3: a gesture commits exactly the previewed plan and explicit membership
// in one Archive transaction; two independent commands could leave half a gesture saved.
pub fn commit_action_arrangement(
    data_dir: &str,
    req: CommitActionArrangementRequest,
) -> DomainResult<ActionResponse> {
    validate_action_plan(Some(&req.planned_start_at), Some(&req.planned_end_at), None)?;
    action_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            // SPEC-0003 §10.3 and ADR 0027: the target is a separate aggregate. Its
            // owning root must still match the gesture baseline inside this write transaction.
            match (action.target_kind.as_deref(), action.target_id.as_deref(), req.target_owning_root.as_ref()) {
                (None, None, None) => {}
                (Some("project"), Some(target_id), Some(root)) if root.id == target_id => {
                    let (project, extra) = load_project_row(tx, target_id, true)?;
                    guard_unknown(&extra)?;
                    check_revision(root.expected_revision, project.revision)?;
                    if project.status == "已归档" {
                        return Err(DomainError::invalid_status("archived project target is read-only"));
                    }
                    if project.status == "已完成" {
                        return Err(DomainError::invalid_status("completed project target is read-only"));
                    }
                }
                (Some("task"), Some(target_id), Some(root)) => {
                    let (project, extra) = load_project_row(tx, &root.id, true)?;
                    guard_unknown(&extra)?;
                    check_revision(root.expected_revision, project.revision)?;
                    let tasks = load_tasks_for_project(tx, &root.id, true)?;
                    let task = tasks.iter().find(|task| task.id == target_id)
                        .ok_or_else(|| DomainError::root_not_found("target task not found"))?;
                    if project.status == "已归档" {
                        return Err(DomainError::invalid_status("archived project target is read-only"));
                    }
                    if project.status == "已完成" || task.status == "完成" {
                        return Err(DomainError::invalid_status("completed task target is read-only"));
                    }
                }
                (Some("item"), Some(target_id), Some(root)) if root.id == target_id => {
                    let (item, extra) = load_item_row(tx, target_id, true)?;
                    guard_unknown(&extra)?;
                    check_revision(root.expected_revision, item.revision)?;
                    ensure_item_writable(tx, target_id)?;
                    if item.status == "完成" {
                        return Err(DomainError::invalid_status("completed item target is read-only"));
                    }
                }
                _ => return Err(DomainError::invalid_patch("target owning root mismatch")),
            }
            if action.session_id.as_deref() != req.current_session.as_ref().map(|s| s.id.as_str()) {
                return Err(DomainError::invalid_patch("currentSession mismatch"));
            }
            for (session_ref, expected_members) in [
                (&req.current_session, &req.current_session_members),
                (&req.next_session, &req.next_session_members),
            ] {
                let Some(session_ref) = session_ref else {
                    if !expected_members.is_empty() {
                        return Err(DomainError::invalid_patch("members without session"));
                    }
                    continue;
                };
                let (session, session_extra) = load_session_row(tx, &session_ref.id, true)?;
                guard_unknown(&session_extra)?;
                check_revision(session_ref.expected_revision, session.revision)?;
                let actual_members = session_member_refs(tx, &session_ref.id)?;
                check_members(expected_members, &actual_members)?;
            }
            if has_any_interval(&load_intervals(tx, &req.action.id, true)?) {
                return Err(DomainError::action_execution_invalid("cannot change planned time after intervals exist"));
            }
            if action.session_id.as_deref() != req.next_session.as_ref().map(|s| s.id.as_str()) {
                ensure_action_unstarted_for_session(tx, &req.action.id)?;
            }
            if let Some(next) = &req.next_session {
                ensure_action_fits_session(tx, &req.planned_start_at, &req.planned_end_at, &next.id)?;
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_action SET planned_start_at = ?1, planned_end_at = ?2, planned_duration_seconds = NULL, session_id = ?3, updated_at_utc = ?4 WHERE id = ?5",
                params![req.planned_start_at, req.planned_end_at, req.next_session.as_ref().map(|s| s.id.as_str()), now, req.action.id],
            ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse { action: finished_action_snapshot(tx, &req.action.id)? })
        })
    })
}

pub fn start_action(data_dir: &str, req: StartActionRequest) -> DomainResult<ActionResponse> {
    action_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            let intervals = load_intervals(tx, &req.action.id, true)?;
            if !action.ended && has_open_interval(&intervals) {
                return Err(DomainError::action_execution_invalid("action already running"));
            }
            if !action.ended && action_started(&intervals) && !has_open_interval(&intervals) {
                return Err(DomainError::action_execution_invalid(
                    "paused action must use ResumeAction",
                ));
            }
            if action.ended {
                // Start never clears ended implicitly; use explicit ReopenAction (ADR 0025, 2026-10-16).
                return Err(DomainError::action_execution_invalid("action ended"));
            }
            if let (Some(k), Some(id)) = (&action.target_kind, &action.target_id) {
                target_is_startable(tx, k, id)?;
            }
            let now = utc_now();
            insert_interval(tx, &new_uuid(), &req.action.id, &now, None, &now)?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &req.action.id)?,
            })
        })
    })
}

pub fn pause_action(data_dir: &str, req: PauseActionRequest) -> DomainResult<ActionResponse> {
    action_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            if action.ended {
                return Err(DomainError::action_execution_invalid("action ended"));
            }
            let intervals = load_intervals(tx, &req.action.id, true)?;
            if !has_open_interval(&intervals) {
                return Err(DomainError::action_execution_invalid("no open interval"));
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_interval SET ended_at = ?1, updated_at_utc = ?1 WHERE action_id = ?2 AND ended_at IS NULL AND deleted_at_utc IS NULL",
                params![now, req.action.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &req.action.id)?,
            })
        })
    })
}

pub fn resume_action(data_dir: &str, req: ResumeActionRequest) -> DomainResult<ActionResponse> {
    action_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            if action.ended {
                return Err(DomainError::action_execution_invalid("action ended"));
            }
            let intervals = load_intervals(tx, &req.action.id, true)?;
            if !action_started(&intervals) || has_open_interval(&intervals) {
                return Err(DomainError::action_execution_invalid("action not paused"));
            }
            let now = utc_now();
            insert_interval(tx, &new_uuid(), &req.action.id, &now, None, &now)?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &req.action.id)?,
            })
        })
    })
}

pub fn end_action(data_dir: &str, req: EndActionRequest) -> DomainResult<ActionResponse> {
    action_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            if action.ended {
                return Err(DomainError::action_execution_invalid("action already ended"));
            }
            let now = utc_now();
            if has_open_interval(&load_intervals(tx, &req.action.id, true)?) {
                tx.execute(
                    "UPDATE productivity_interval SET ended_at = ?1, updated_at_utc = ?1 WHERE action_id = ?2 AND ended_at IS NULL AND deleted_at_utc IS NULL",
                    params![now, req.action.id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
            tx.execute(
                "UPDATE productivity_action SET ended = 1, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.action.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &req.action.id)?,
            })
        })
    })
}

pub(crate) fn ensure_reopen_target_available(tx: &rusqlite::Transaction<'_>, kind: &str, id: &str) -> DomainResult<()> {
    // Reopen follows the rail's readonly boundary, including Task ancestors (ADR 0025, 2026-10-16).
    let available = match kind {
        "item" => tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM productivity_item WHERE id = ?1 AND deleted_at_utc IS NULL AND status NOT IN ('完成', '已完成', '取消', '已取消'))",
            [id], |row| row.get::<_, bool>(0)),
        "project" => tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM productivity_project WHERE id = ?1 AND deleted_at_utc IS NULL AND status NOT IN ('完成', '已完成', '取消', '已取消'))",
            [id], |row| row.get::<_, bool>(0)),
        "task" => tx.query_row(
            "WITH RECURSIVE lineage(id, parent_task_id, status, deleted_at_utc) AS (
                SELECT id, parent_task_id, status, deleted_at_utc FROM productivity_task WHERE id = ?1
                UNION
                SELECT t.id, t.parent_task_id, t.status, t.deleted_at_utc FROM productivity_task t JOIN lineage l ON t.id = l.parent_task_id
            )
            SELECT EXISTS(SELECT 1 FROM productivity_task t JOIN productivity_project p ON p.id = t.project_id
                WHERE t.id = ?1 AND p.deleted_at_utc IS NULL AND p.status NOT IN ('完成', '已完成', '取消', '已取消'))
                AND NOT EXISTS(SELECT 1 FROM lineage WHERE deleted_at_utc IS NOT NULL OR status IN ('完成', '已完成', '取消', '已取消'))",
            [id], |row| row.get::<_, bool>(0)),
        _ => return Err(DomainError::invalid_patch("invalid target kind")),
    }.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if !available { return Err(DomainError::target_not_startable("target is readonly or unavailable")); }
    Ok(())
}

pub fn reopen_action(data_dir: &str, req: ReopenActionRequest) -> DomainResult<ActionResponse> {
    action_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            if !action.ended {
                return Err(DomainError::action_execution_invalid("action is not ended"));
            }
            let intervals = load_intervals(tx, &req.action.id, true)?;
            if has_open_interval(&intervals) {
                return Err(DomainError::action_execution_invalid("ended action has an open interval"));
            }
            validate_target_pair(action.target_kind.as_deref(), action.target_id.as_deref())?;
            if let (Some(kind), Some(id)) = (&action.target_kind, &action.target_id) {
                ensure_reopen_target_available(tx, kind, id)?;
            }
            let now = utc_now();
            // Explicit undo keeps every historical interval closed; see ADR 0025's 2026-10-16 amendment.
            tx.execute(
                "UPDATE productivity_action SET ended = 0, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.action.id],
            ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse { action: finished_action_snapshot(tx, &req.action.id)? })
        })
    })
}

pub fn delete_action(data_dir: &str, req: DeleteActionRequest) -> DomainResult<ActionResponse> {
    action_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            ensure_action_deletable(tx, &req.action.id)?;
            ensure_not_travel_action(tx, &req.action.id)?;
            let now = utc_now();
            let batch = new_uuid();
            tx.execute(
                "UPDATE productivity_action SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3",
                params![now, batch, req.action.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            tx.execute(
                "UPDATE productivity_interval SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE action_id = ?3 AND deleted_at_utc IS NULL",
                params![now, batch, req.action.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: action_snapshot(tx, &req.action.id, false)?,
            })
        })
    })
}

pub fn restore_action(data_dir: &str, req: RestoreActionRequest) -> DomainResult<ActionResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, false)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            // C13: travel legs stay linked through tombstones; generic restore
            // would revive one Action while the rest of the trip stays deleted.
            ensure_not_travel_action(tx, &req.action.id)?;
            if action.deleted_at_utc.is_none() {
                return Err(DomainError::invalid_patch("action is not deleted"));
            }
            let batch: Option<String> = tx
                .query_row(
                    "SELECT deletion_batch_id FROM productivity_action WHERE id = ?1",
                    [&req.action.id],
                    |row| row.get(0),
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let restored_session_id = if let Some(session_id) = &action.session_id {
                let session_ref = req
                    .session
                    .as_ref()
                    .ok_or_else(|| DomainError::invalid_patch("session revision required"))?;
                if session_ref.id != *session_id {
                    return Err(DomainError::invalid_patch("session id mismatch"));
                }
                let (session, session_extra) = load_session_row(tx, session_id, false)?;
                guard_unknown(&session_extra)?;
                check_revision(session_ref.expected_revision, session.revision)?;
                if session.deleted_at_utc.is_some() {
                    None
                } else {
                    Some(session_id.clone())
                }
            } else {
                None
            };
            let now = utc_now();
            if let Some(ref batch) = batch {
                tx.execute(
                    "UPDATE productivity_interval SET deleted_at_utc = NULL, deletion_batch_id = NULL, updated_at_utc = ?1 WHERE action_id = ?2 AND deletion_batch_id = ?3",
                    params![now, req.action.id, batch],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
            tx.execute(
                "UPDATE productivity_action SET deleted_at_utc = NULL, deletion_batch_id = NULL, session_id = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![restored_session_id, now, req.action.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &req.action.id)?,
            })
        })
    })
}

pub fn assign_action_to_session(
    data_dir: &str,
    req: AssignActionToSessionRequest,
) -> DomainResult<ActionResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            let (session, session_extra) = load_session_row(tx, &req.session.id, true)?;
            guard_unknown(&session_extra)?;
            check_revision(req.session.expected_revision, session.revision)?;
            ensure_action_unstarted_for_session(tx, &req.action.id)?;
            let snapshot = action_snapshot(tx, &req.action.id, true)?;
            ensure_action_has_complete_plan(&snapshot)?;
            if let (Some(s), Some(e)) = (&snapshot.planned_start_at, &snapshot.planned_end_at) {
                ensure_action_fits_session(tx, s, e, &req.session.id)?;
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_action SET session_id = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![req.session.id, now, req.action.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &req.action.id)?,
            })
        })
    })
}

pub fn move_action_to_session(
    data_dir: &str,
    req: MoveActionToSessionRequest,
) -> DomainResult<ActionResponse> {
    assign_action_to_session(
        data_dir,
        AssignActionToSessionRequest {
            action: req.action,
            session: req.session,
        },
    )
}

pub fn remove_action_from_session(
    data_dir: &str,
    req: RemoveActionFromSessionRequest,
) -> DomainResult<ActionResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_action SET session_id = NULL, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.action.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &req.action.id)?,
            })
        })
    })
}

pub fn set_action_target(data_dir: &str, req: SetActionTargetRequest) -> DomainResult<ActionResponse> {
    validate_target_kind(&req.target_kind)?;
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            let intervals = load_intervals(tx, &req.action.id, true)?;
            if action_started(&intervals) || action.ended {
                return Err(DomainError::action_execution_invalid(
                    "cannot change target after start or end",
                ));
            }
            match req.target_kind.as_str() {
                "project" => {
                    let (project, pextra) = load_project_row(tx, &req.target_id, true)?;
                    guard_unknown(&pextra)?;
                    check_revision(req.owning_root.expected_revision, project.revision)?;
                    if req.owning_root.id != req.target_id {
                        return Err(DomainError::invalid_patch("owning root mismatch"));
                    }
                }
                "task" => {
                    let (project, pextra) = load_project_row(tx, &req.owning_root.id, true)?;
                    guard_unknown(&pextra)?;
                    check_revision(req.owning_root.expected_revision, project.revision)?;
                    let tasks = load_tasks_for_project(tx, &req.owning_root.id, true)?;
                    if !tasks.iter().any(|t| t.id == req.target_id) {
                        return Err(DomainError::root_not_found("task not found"));
                    }
                }
                "item" => {
                    let (item, iextra) = load_item_row(tx, &req.target_id, true)?;
                    guard_unknown(&iextra)?;
                    check_revision(req.owning_root.expected_revision, item.revision)?;
                    if req.owning_root.id != req.target_id {
                        return Err(DomainError::invalid_patch("owning root mismatch"));
                    }
                    ensure_item_writable(tx, &req.target_id)?;
                    if action.session_id.is_some() { crate::productivity_db::health_plan::guard_item(tx,&req.target_id)?; }
                }
                _ => return Err(DomainError::invalid_patch("invalid target kind")),
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_action SET target_kind = ?1, target_id = ?2, updated_at_utc = ?3 WHERE id = ?4",
                params![req.target_kind, req.target_id, now, req.action.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &req.action.id)?,
            })
        })
    })
}

pub fn clear_action_target(data_dir: &str, req: ClearActionTargetRequest) -> DomainResult<ActionResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (action, extra) = load_action_row(tx, &req.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.action.expected_revision, action.revision)?;
            ensure_action_writable(tx, &req.action.id)?;
            let intervals = load_intervals(tx, &req.action.id, true)?;
            if action_started(&intervals) || action.ended {
                return Err(DomainError::action_execution_invalid(
                    "cannot clear target after start or end",
                ));
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_action SET target_kind = NULL, target_id = NULL, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.action.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &req.action.id, &now)?;
            Ok(ActionResponse {
                action: finished_action_snapshot(tx, &req.action.id)?,
            })
        })
    })
}

// ADR 0049: guard the aggregate and its target under the same write transaction.
pub fn edit_action_interval(data_dir: &str, req: EditActionIntervalRequest) -> DomainResult<ActionResponse> {
    use chrono::Timelike;
    action_write(data_dir, Some(&req.expected_data_dir), |conn| in_transaction(conn, |tx| {
        let (action, extra) = load_action_row(tx, &req.action.id, true)?;
        guard_unknown(&extra)?;
        check_revision(req.action.expected_revision, action.revision)?;
        ensure_action_writable(tx, &action.id)?;
        ensure_not_travel_action(tx, &action.id)?;
        crate::productivity_db::health_plan::guard_action(tx, &action.id)?;
        if !matches!(action.target_kind.as_deref(), Some("item" | "task")) {
            return Err(DomainError::invalid_patch("interval editing requires an Item or Task Action"));
        }
        guard_arrangement_target(tx, &action, req.target_owning_root.as_ref())?;
        let intervals = load_intervals(tx, &action.id, true)?;
        if has_open_interval(&intervals) { return Err(DomainError::action_execution_invalid("action has an open interval")); }
        let now = utc_now();
        match req.operation.as_str() {
            "create" | "update" => {
                let start = req.started_at.as_deref().ok_or_else(|| DomainError::invalid_time("start required"))?;
                let end = req.ended_at.as_deref().ok_or_else(|| DomainError::invalid_time("end required"))?;
                let a = chrono::DateTime::parse_from_rfc3339(start).map_err(|_| DomainError::invalid_time("invalid start"))?;
                let b = chrono::DateTime::parse_from_rfc3339(end).map_err(|_| DomainError::invalid_time("invalid end"))?;
                if a.second() != 0 || a.nanosecond() != 0 || b.second() != 0 || b.nanosecond() != 0 || a >= b || b > chrono::Utc::now() {
                    return Err(DomainError::invalid_time("interval must be minute precision, ordered and not in the future"));
                }
                // Canonical UTC keeps lexical interval ordering consistent across offsets (ADR 0049).
                let canonical_start = a.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                let canonical_end = b.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                let start = canonical_start.as_str();
                let end = canonical_end.as_str();
                let id = if req.operation == "update" { Some(req.interval_id.as_deref().ok_or_else(|| DomainError::invalid_patch("interval id required"))?) } else { None };
                if req.operation == "create" && req.interval_id.is_some() { return Err(DomainError::invalid_patch("unexpected interval id")); }
                if let Some(id) = id { if !intervals.iter().any(|i| i.id == id) { return Err(DomainError::revision_conflict("interval changed")); } }
                for other in &intervals {
                    if Some(other.id.as_str()) != id && crate::productivity_db::execution::intervals_overlap(start, Some(end), &other.started_at, other.ended_at.as_deref())? {
                        return Err(DomainError::invalid_time("intervals overlap"));
                    }
                }
                if let Some(id) = id {
                    tx.execute("UPDATE productivity_interval SET started_at=?1, ended_at=?2, updated_at_utc=?3 WHERE id=?4 AND action_id=?5 AND deleted_at_utc IS NULL", params![start,end,now,id,action.id]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                } else { insert_interval(tx, &new_uuid(), &action.id, start, Some(end), &now)?; }
            }
            "delete" => {
                let id = req.interval_id.as_deref().ok_or_else(|| DomainError::invalid_patch("interval id required"))?;
                if req.started_at.is_some() || req.ended_at.is_some() || !intervals.iter().any(|i| i.id == id) { return Err(DomainError::revision_conflict("interval changed")); }
                tx.execute("UPDATE productivity_interval SET deleted_at_utc=?1, updated_at_utc=?1 WHERE id=?2 AND action_id=?3 AND deleted_at_utc IS NULL", params![now,id,action.id]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
            _ => return Err(DomainError::invalid_patch("invalid interval operation")),
        }
        bump_action(tx, &action.id, &now)?;
        Ok(ActionResponse { action: finished_action_snapshot(tx, &action.id)? })
    }))
}
