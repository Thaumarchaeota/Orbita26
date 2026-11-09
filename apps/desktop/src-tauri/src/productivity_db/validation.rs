use rusqlite::{OptionalExtension, Transaction};

use super::error::{DomainError, DomainResult};
use super::execution::{action_started, has_open_interval};
use super::point::{instant_lt, range_inside, ranges_overlap, validate_utc_instant};
use super::repository::{
    actions_for_session, load_action_row, load_intervals, load_tasks_for_project,
    require_live_item, require_live_project, task_descendants,
};
use super::types::*;

pub fn validate_name_link_mode(mode: &str) -> DomainResult<()> {
    match mode {
        "initial-linked" | "manually-linked" | "unlinked" | "custom" => Ok(()),
        _ => Err(DomainError::invalid_patch("invalid nameLinkMode")),
    }
}

// SPEC-0003 U109: editing an initially linked title disconnects it atomically.
pub fn next_name_link_mode(current: &str, requested: Option<&str>, title_changed: bool) -> DomainResult<String> {
    let next = requested.unwrap_or(if title_changed && current == "initial-linked" { "unlinked" } else { current });
    validate_name_link_mode(next)?;
    if next == "initial-linked" && current != "initial-linked" {
        return Err(DomainError::invalid_patch("initial-linked is creation-only"));
    }
    if title_changed && current == "initial-linked" && next != "unlinked" {
        return Err(DomainError::invalid_patch("initial-linked title edit must unlink"));
    }
    Ok(next.to_string())
}

pub fn validate_project_status(status: &str) -> DomainResult<()> {
    if !PROJECT_STATUSES.contains(&status) {
        return Err(DomainError::invalid_status("invalid project status"));
    }
    Ok(())
}

pub fn validate_task_status(status: &str) -> DomainResult<()> {
    if !TASK_STATUSES.contains(&status) {
        return Err(DomainError::invalid_status("invalid task status"));
    }
    Ok(())
}

pub fn validate_list_status(status: &str) -> DomainResult<()> {
    if !LIST_STATUSES.contains(&status) {
        return Err(DomainError::invalid_status("invalid list status"));
    }
    Ok(())
}

pub fn validate_item_status(status: &str) -> DomainResult<()> {
    if !ITEM_STATUSES.contains(&status) {
        return Err(DomainError::invalid_status("invalid item status"));
    }
    Ok(())
}

pub fn validate_item_priority(priority: &str) -> DomainResult<()> {
    if !ITEM_PRIORITIES.contains(&priority) {
        return Err(DomainError::invalid_patch("invalid item priority"));
    }
    Ok(())
}

pub fn check_sibling_ids(expected: &[String], actual: &[String]) -> DomainResult<()> {
    if expected.len() != actual.len() {
        return Err(DomainError::revision_conflict("sibling set mismatch"));
    }
    let mut exp = expected.to_vec();
    exp.sort();
    let mut act = actual.to_vec();
    act.sort();
    if exp != act {
        return Err(DomainError::revision_conflict("sibling set mismatch"));
    }
    Ok(())
}

pub fn validate_target_kind(kind: &str) -> DomainResult<()> {
    if !TARGET_KINDS.contains(&kind) {
        return Err(DomainError::invalid_patch("invalid target kind"));
    }
    Ok(())
}

pub fn validate_appearance(appearance: &ActionAppearance) -> DomainResult<()> {
    let color = appearance.color.trim();
    if !color.starts_with('#')
        || color.len() != 7
        || !color[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(DomainError::invalid_patch("appearance.color must be #RRGGBB"));
    }
    if !(0.15..=1.0).contains(&appearance.opacity) {
        return Err(DomainError::invalid_patch("appearance.opacity must be 0.15–1"));
    }
    if !APPEARANCE_STROKES.contains(&appearance.stroke.as_str()) {
        return Err(DomainError::invalid_patch("invalid appearance.stroke"));
    }
    Ok(())
}

pub fn validate_action_plan(
    start: Option<&str>,
    end: Option<&str>,
    duration: Option<i64>,
) -> DomainResult<()> {
    let has_range = start.is_some() || end.is_some();
    let has_duration = duration.is_some();
    if has_range && has_duration {
        return Err(DomainError::invalid_patch(
            "planned range and plannedDuration cannot both be set",
        ));
    }
    if has_range {
        let s = start.ok_or_else(|| DomainError::invalid_patch("plannedStartAt required"))?;
        let e = end.ok_or_else(|| DomainError::invalid_patch("plannedEndAt required"))?;
        validate_utc_instant(s)?;
        validate_utc_instant(e)?;
        if !instant_lt(s, e)? {
            return Err(DomainError::invalid_time("plannedStartAt must be before plannedEndAt"));
        }
    }
    if let Some(d) = duration {
        if d <= 0 {
            return Err(DomainError::invalid_time("plannedDuration must be positive"));
        }
    }
    Ok(())
}

pub fn validate_session_track(lane: i32, span: i32) -> DomainResult<()> {
    // track_lane == 0 invariant: docs/adr/0030-timeline-session-action-interaction.md
    if lane != 0 {
        return Err(DomainError::invalid_patch("trackLane must be 0"));
    }
    if !(1..=3).contains(&span) {
        return Err(DomainError::invalid_patch("trackSpan must be 1–3"));
    }
    Ok(())
}

pub fn validate_session_range(start: &str, end: &str) -> DomainResult<()> {
    validate_utc_instant(start)?;
    validate_utc_instant(end)?;
    if !instant_lt(start, end)? {
        return Err(DomainError::invalid_time("plannedStartAt must be before plannedEndAt"));
    }
    // 18h cap: docs/specs/productivity-local-commands.md, ADR 0025
    let a = chrono::DateTime::parse_from_rfc3339(start)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    let b = chrono::DateTime::parse_from_rfc3339(end)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    if b.signed_duration_since(a).num_seconds() > 18 * 3600 {
        return Err(DomainError::invalid_time("session cannot exceed 18 hours"));
    }
    Ok(())
}

pub fn ensure_no_session_overlap(
    tx: &Transaction,
    start: &str,
    end: &str,
    exclude_id: Option<&str>,
) -> DomainResult<()> {
    let mut stmt = tx
        .prepare(
            "SELECT id, planned_start_at, planned_end_at FROM productivity_session WHERE deleted_at_utc IS NULL",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    for row in rows {
        let (id, s, e) = row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if exclude_id == Some(id.as_str()) {
            continue;
        }
        if ranges_overlap(start, end, &s, &e)? {
            return Err(DomainError::session_interval_conflict(
                "session planned ranges overlap",
            ));
        }
    }
    Ok(())
}

pub fn would_create_cycle(
    tasks: &[TaskSnapshot],
    task_id: &str,
    new_parent: Option<&str>,
) -> bool {
    if let Some(parent) = new_parent {
        if parent == task_id {
            return true;
        }
        let mut cur = Some(parent);
        while let Some(pid) = cur {
            if pid == task_id {
                return true;
            }
            cur = tasks
                .iter()
                .find(|t| t.id == pid && t.deleted_at_utc.is_none())
                .and_then(|t| t.parent_task_id.as_deref());
        }
    }
    false
}

fn action_is_active(tx: &Transaction, action_id: &str) -> DomainResult<bool> {
    let (action, _) = load_action_row(tx, action_id, true)?;
    if action.ended {
        return Ok(false);
    }
    let intervals = load_intervals(tx, action_id, true)?;
    Ok(action_started(&intervals))
}

pub fn find_active_actions_for_targets(tx: &Transaction, target_ids: &[String]) -> DomainResult<Vec<String>> {
    if target_ids.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = target_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT id FROM productivity_action WHERE deleted_at_utc IS NULL AND ended = 0 AND target_id IN ({placeholders})"
    );
    let mut stmt = tx.prepare(&sql).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let params: Vec<&dyn rusqlite::ToSql> = target_ids
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params), |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut active = Vec::new();
    for id in rows {
        let id = id.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if action_is_active(tx, &id)? {
            active.push(id);
        }
    }
    Ok(active)
}

pub fn ensure_no_active_actions(tx: &Transaction, target_ids: &[String]) -> DomainResult<()> {
    let active = find_active_actions_for_targets(tx, target_ids)?;
    if !active.is_empty() {
        return Err(DomainError::active_action_blocks());
    }
    Ok(())
}

pub fn collect_project_scope_targets(tx: &Transaction, project_id: &str) -> DomainResult<Vec<String>> {
    let tasks = load_tasks_for_project(tx, project_id, true)?;
    let mut ids = vec![project_id.to_string()];
    ids.extend(tasks.iter().map(|t| t.id.clone()));
    Ok(ids)
}

pub fn collect_task_subtree_targets(tx: &Transaction, project_id: &str, task_id: &str) -> DomainResult<Vec<String>> {
    Ok(task_descendants(tx, project_id, task_id)?)
}

pub fn collect_list_item_targets(tx: &Transaction, list_id: &str) -> DomainResult<Vec<String>> {
    let mut ids = vec![list_id.to_string()];
    let mut stmt = tx
        .prepare("SELECT id FROM productivity_item WHERE list_id = ?1 AND deleted_at_utc IS NULL")
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([list_id], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    for row in rows {
        ids.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
    }
    Ok(ids)
}

pub fn target_exists_live(tx: &Transaction, kind: &str, target_id: &str) -> DomainResult<()> {
    match kind {
        "project" => {
            require_live_project(tx, target_id)?;
        }
        "task" => {
            let deleted: Option<Option<String>> = tx
                .query_row(
                    "SELECT deleted_at_utc FROM productivity_task WHERE id = ?1",
                    [target_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            match deleted {
                None => return Err(DomainError::root_not_found("target task not found")),
                Some(Some(_)) => return Err(DomainError::root_deleted("target task deleted")),
                Some(None) => {}
            }
        }
        "item" => {
            require_live_item(tx, target_id)?;
        }
        _ => return Err(DomainError::invalid_patch("invalid target kind")),
    }
    Ok(())
}

pub fn related_unended_action_refs(
    tx: &Transaction,
    thing_kind: &str,
    owning_root_id: &str,
    task_id: Option<&str>,
) -> DomainResult<Vec<RevisionRef>> {
    let mut stmt = tx
        .prepare(
            "SELECT id, revision, target_kind, target_id FROM productivity_action
             WHERE deleted_at_utc IS NULL AND ended = 0",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let scope_task_ids: Option<Vec<String>> = if thing_kind == "task" {
        Some(task_descendants(
            tx,
            owning_root_id,
            task_id.ok_or_else(|| DomainError::invalid_patch("taskId required"))?,
        )?)
    } else {
        None
    };
    let scope_item_ids: Option<Vec<String>> = if thing_kind == "list" {
        Some(list_item_ids(tx, owning_root_id)?)
    } else {
        None
    };
    let mut out = Vec::new();
    for row in rows {
        let (id, revision, kind, target_id) =
            row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let (Some(kind), Some(target_id)) = (kind.as_deref(), target_id.as_deref()) else {
            continue;
        };
        let in_scope = match thing_kind {
            "project" => {
                (kind == "project" && target_id == owning_root_id)
                    || (kind == "task"
                        && load_tasks_for_project(tx, owning_root_id, true)?
                            .iter()
                            .any(|t| t.id == target_id))
            }
            "task" => {
                kind == "task"
                    && scope_task_ids
                        .as_ref()
                        .map(|ids| ids.iter().any(|t| t == target_id))
                        .unwrap_or(false)
            }
            "list" => {
                kind == "item"
                    && scope_item_ids
                        .as_ref()
                        .map(|ids| ids.iter().any(|i| i == target_id))
                        .unwrap_or(false)
            }
            "item" => kind == "item" && target_id == owning_root_id,
            _ => false,
        };
        if in_scope {
            out.push(RevisionRef {
                id,
                expected_revision: revision,
            });
        }
    }
    Ok(out)
}

fn list_item_ids(tx: &Transaction, list_id: &str) -> DomainResult<Vec<String>> {
    let mut stmt = tx
        .prepare("SELECT id FROM productivity_item WHERE list_id = ?1 AND deleted_at_utc IS NULL")
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([list_id], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
    }
    Ok(out)
}

pub fn target_is_startable(tx: &Transaction, kind: &str, target_id: &str) -> DomainResult<()> {
    if kind == "item" { super::health_plan::guard_item(tx, target_id)?; }
    match kind {
        "project" => {
            let row = tx
                .query_row(
                    "SELECT status, deleted_at_utc FROM productivity_project WHERE id = ?1",
                    [target_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let Some((status, deleted)) = row else {
                return Err(DomainError::target_not_startable("target project not found"));
            };
            if deleted.is_some() {
                return Err(DomainError::target_not_startable("target project deleted"));
            }
            if status == "已完成" {
                return Err(DomainError::target_not_startable("target project completed"));
            }
        }
        "task" => {
            let row = tx
                .query_row(
                    "SELECT status, deleted_at_utc FROM productivity_task WHERE id = ?1",
                    [target_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let Some((status, deleted)) = row else {
                return Err(DomainError::target_not_startable("target task not found"));
            };
            if deleted.is_some() {
                return Err(DomainError::target_not_startable("target task deleted"));
            }
            if status == "完成" {
                return Err(DomainError::target_not_startable("target task completed"));
            }
        }
        "item" => {
            let row = tx
                .query_row(
                    "SELECT status, deleted_at_utc FROM productivity_item WHERE id = ?1",
                    [target_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let Some((status, deleted)) = row else {
                return Err(DomainError::target_not_startable("target item not found"));
            };
            if deleted.is_some() {
                return Err(DomainError::target_not_startable("target item deleted"));
            }
            if status == "完成" {
                return Err(DomainError::target_not_startable("target item completed"));
            }
        }
        _ => return Err(DomainError::invalid_patch("invalid target kind")),
    }
    Ok(())
}

pub fn ensure_action_fits_range(
    action_start: &str,
    action_end: &str,
    session_start: &str,
    session_end: &str,
) -> DomainResult<()> {
    if !range_inside(action_start, action_end, session_start, session_end)? {
        return Err(DomainError::action_outside_session(
            "action planned range outside session",
        ));
    }
    Ok(())
}

pub fn ensure_action_fits_session(
    tx: &Transaction,
    action_start: &str,
    action_end: &str,
    session_id: &str,
) -> DomainResult<()> {
    let row = tx
        .query_row(
            "SELECT planned_start_at, planned_end_at, deleted_at_utc FROM productivity_session WHERE id = ?1",
            [session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let Some((s_start, s_end, deleted)) = row else {
        return Err(DomainError::root_not_found("session not found"));
    };
    if deleted.is_some() {
        return Err(DomainError::root_deleted("session deleted"));
    }
    ensure_action_fits_range(action_start, action_end, &s_start, &s_end)
}

pub fn ensure_action_unstarted_for_session(tx: &Transaction, action_id: &str) -> DomainResult<()> {
    super::health_plan::guard_action(tx, action_id)?;
    let intervals = load_intervals(tx, action_id, true)?;
    if action_started(&intervals) {
        return Err(DomainError::action_execution_invalid(
            "action already started",
        ));
    }
    Ok(())
}

pub fn ensure_action_has_complete_plan(action: &ActionSnapshot) -> DomainResult<()> {
    match (&action.planned_start_at, &action.planned_end_at) {
        (Some(s), Some(e)) => validate_action_plan(Some(s), Some(e), None),
        _ => Err(DomainError::action_outside_session(
            "action needs complete planned range for session assignment",
        )),
    }
}

pub fn ensure_action_deletable(tx: &Transaction, action_id: &str) -> DomainResult<()> {
    let intervals = load_intervals(tx, action_id, true)?;
    if has_open_interval(&intervals) {
        return Err(DomainError::action_execution_invalid(
            "action has open interval",
        ));
    }
    Ok(())
}

pub fn session_member_refs(tx: &Transaction, session_id: &str) -> DomainResult<Vec<RevisionRef>> {
    let actions = actions_for_session(tx, session_id, true)?;
    Ok(actions
        .into_iter()
        .map(|a| RevisionRef {
            id: a.id,
            expected_revision: a.revision,
        })
        .collect())
}

pub fn ensure_list_writable(tx: &Transaction, list_id: Option<&str>) -> DomainResult<()> {
    let Some(list_id) = list_id else {
        return Ok(());
    };
    let status: Option<String> = tx
        .query_row(
            "SELECT status FROM productivity_list WHERE id = ?1 AND deleted_at_utc IS NULL",
            [list_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    match status {
        None => Err(DomainError::root_not_found("list not found")),
        Some(s) if s == "已归档" => Err(DomainError::archived_list_readonly()),
        Some(_) => Ok(()),
    }
}

pub fn ensure_item_writable(tx: &Transaction, item_id: &str) -> DomainResult<()> {
    let list_id: Option<Option<String>> = tx
        .query_row(
            "SELECT list_id FROM productivity_item WHERE id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let Some(list_id) = list_id else {
        return Err(DomainError::root_not_found("item not found"));
    };
    super::travel_foundation::guard_generic_item_write(tx, item_id)?;
    ensure_list_writable(tx, list_id.as_deref())
}

pub fn ensure_action_item_target_writable(
    tx: &Transaction,
    target_kind: Option<&str>,
    target_id: Option<&str>,
) -> DomainResult<()> {
    if target_kind == Some("item") {
        if let Some(id) = target_id {
            ensure_item_writable(tx, id)?;
        }
    }
    Ok(())
}

pub fn ensure_action_writable(tx: &Transaction, action_id: &str) -> DomainResult<()> {
    let row: Option<(Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT target_kind, target_id FROM productivity_action WHERE id = ?1",
            [action_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let Some((kind, id)) = row else {
        return Err(DomainError::root_not_found("action not found"));
    };
    // Travel Actions are members of an Item aggregate. Generic Action/session/batch
    // commands must not mutate or detach one member; travel.rs is the only writer.
    ensure_not_travel_action(tx, action_id)?;
    super::travel_foundation::guard_generic_action_write(tx, action_id)?;
    ensure_action_item_target_writable(tx, kind.as_deref(), id.as_deref())
}

/// Reject generic operations that can detach or destroy a travel aggregate.
/// This includes tombstones so a generic restore cannot revive only one member.
pub fn ensure_not_travel_action(tx: &Transaction, action_id: &str) -> DomainResult<()> {
    super::health_plan::guard_action(tx, action_id)?;
    if super::travel_v2::guards::action_requires_travel_command(tx, action_id)? {
        return Err(DomainError::travel_command_required(
            "travel v2 actions require productivity_travel_v2_* commands",
        ));
    }
    let linked: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM productivity_item_travel_leg l JOIN productivity_item_travel_detail d ON d.item_id=l.item_id WHERE l.action_id=?1)",
        [action_id], |row| row.get(0),
    ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if linked {
        Err(DomainError::travel_command_required(
            "legacy travel actions require the travel aggregate command",
        ))
    } else {
        Ok(())
    }
}

pub fn ensure_not_travel_item(tx: &Transaction, item_id: &str) -> DomainResult<()> {
    super::health_plan::guard_item(tx, item_id)?;
    ensure_not_travel_v2_item(tx, item_id)?;
    let linked: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_travel_detail WHERE item_id=?1)", [item_id], |row| row.get(0)).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if linked {
        Err(DomainError::travel_command_required(
            "legacy travel items require the travel aggregate command",
        ))
    } else {
        Ok(())
    }
}

pub fn ensure_not_travel_v2_item(tx: &Transaction, item_id: &str) -> DomainResult<()> {
    if super::travel_v2::guards::item_has_v2_profile(tx, item_id)? {
        return Err(DomainError::travel_command_required(
            "travel v2 items require productivity_travel_v2_* commands",
        ));
    }
    Ok(())
}

pub fn ensure_not_travel_v2_checkpoint(tx: &Transaction, checkpoint_id: &str) -> DomainResult<()> {
    let target: Option<(Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT target_kind, target_id FROM productivity_checkpoint WHERE id = ?1",
            [checkpoint_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if let Some((Some(kind), Some(id))) = target {
        if kind == "item" && super::travel_v2::guards::item_has_v2_profile(tx, &id)? {
            return Err(DomainError::travel_command_required(
                "travel v2 checkpoints require productivity_travel_v2_* commands",
            ));
        }
    }
    Ok(())
}

pub fn list_item_member_refs(tx: &Transaction, list_id: &str) -> DomainResult<Vec<RevisionRef>> {
    let mut stmt = tx
        .prepare("SELECT id, revision FROM productivity_item WHERE list_id = ?1 AND deleted_at_utc IS NULL")
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([list_id], |row| {
            Ok(RevisionRef {
                id: row.get(0)?,
                expected_revision: row.get(1)?,
            })
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
    }
    Ok(out)
}
