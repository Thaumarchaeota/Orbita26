use rusqlite::params;
use rusqlite::OptionalExtension;

use crate::productivity_db::coordinator::{in_transaction, with_write, with_write_expected};
use crate::productivity_db::point::{range_inside, ranges_overlap};
use crate::productivity_db::error::{DomainError, DomainResult};
use crate::productivity_db::repository::*;
use crate::productivity_db::types::*;
use crate::productivity_db::util::{new_uuid, utc_now};
use crate::productivity_db::validation::*;

pub(crate) fn reject_travel_v2_session_checkpoints(
    tx: &rusqlite::Transaction<'_>,
    checkpoints: &[RevisionRef],
) -> DomainResult<()> {
    for checkpoint in checkpoints {
        ensure_not_travel_v2_checkpoint(tx, &checkpoint.id)?;
    }
    Ok(())
}

pub(crate) fn reject_travel_v2_session_actions(
    tx: &rusqlite::Transaction<'_>,
    action_ids: &[RevisionRef],
) -> DomainResult<()> {
    for member in action_ids {
        ensure_not_travel_action(tx, &member.id)?;
    }
    Ok(())
}

fn check_member_ids(expected: &[String], actual: impl IntoIterator<Item = String>) -> DomainResult<()> {
    let mut expected_sorted = expected.to_vec();
    expected_sorted.sort();
    if expected_sorted.windows(2).any(|p| p[0] == p[1]) {
        return Err(DomainError::invalid_patch("duplicate target member"));
    }
    let mut actual_sorted: Vec<_> = actual.into_iter().collect();
    actual_sorted.sort();
    if expected_sorted != actual_sorted {
        return Err(DomainError::revision_conflict("target member set mismatch"));
    }
    Ok(())
}

pub fn restore_session_boundary_state(data_dir: &str, req: RestoreSessionBoundaryStateRequest) -> DomainResult<SessionAndActionsResponse> {
    validate_session_range(&req.target_state.planned_start_at, &req.target_state.planned_end_at)?;
    if std::path::Path::new(data_dir) != std::path::Path::new(&req.expected_data_dir) {
        return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消"));
    }
    // SPEC-0015 §6.1: boundary and exact detach effect restore together; the
    // request carries current guards, not a claimed backend history credential.
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        let (session, extra) = load_session_row(tx, &req.session.id, true)?;
        guard_unknown(&extra)?;
        check_revision(req.session.expected_revision, session.revision)?;
        if session.planned_start_at != req.expected_state.planned_start_at || session.planned_end_at != req.expected_state.planned_end_at {
            return Err(DomainError::revision_conflict("session boundary projection changed"));
        }
        let members = session_member_refs(tx, &session.id)?;
        check_members(&req.expected_members, &members)?;
        let checkpoints = crate::productivity_db::checkpoint::session_member_refs(tx, &session.id)?;
        check_members(&req.expected_checkpoints, &checkpoints)?;
        check_member_ids(&req.target_checkpoint_ids, checkpoints.iter().map(|m| m.id.clone()))?;
        for member in &checkpoints {
            ensure_not_travel_v2_checkpoint(tx, &member.id)?;
            crate::productivity_db::checkpoint::snapshot(tx, &member.id, false)?;
        }
        let start = &req.target_state.planned_start_at;
        let end = &req.target_state.planned_end_at;
        ensure_no_session_overlap(tx, start, end, Some(&session.id))?;
        crate::productivity_db::checkpoint::validate_session_members(tx, &session.id, start, end)?;
        let mut target_ids: std::collections::BTreeSet<_> = members.iter().map(|m| m.id.clone()).collect();
        let mut changed_ids = std::collections::BTreeSet::new();
        for change in &req.membership_changes {
            if !changed_ids.insert(change.action.id.clone()) {
                return Err(DomainError::invalid_patch("duplicate membership change"));
            }
            let attaching = change.expected_session_id.is_none() && change.target_session_id.as_deref() == Some(session.id.as_str());
            let detaching = change.expected_session_id.as_deref() == Some(session.id.as_str()) && change.target_session_id.is_none();
            if !attaching && !detaching {
                return Err(DomainError::invalid_patch("membership restore permits only this session to/from null"));
            }
            let (action, extra) = load_action_row(tx, &change.action.id, true)?;
            guard_unknown(&extra)?;
            check_revision(change.action.expected_revision, action.revision)?;
            if action.session_id != change.expected_session_id {
                return Err(DomainError::revision_conflict("action session ownership changed"));
            }
            super::action::guard_arrangement_action(tx, &action)?;
            super::action::guard_arrangement_target(tx, &action, change.target_owning_root.as_ref())?;
            let (Some(action_start), Some(action_end)) = (&action.planned_start_at, &action.planned_end_at) else {
                return Err(DomainError::action_outside_session("member needs complete planned range"));
            };
            if attaching {
                ensure_action_fits_range(action_start, action_end, start, end)?;
                target_ids.insert(action.id.clone());
            } else {
                // Redo only detaches the original effect, never silently cuts or
                // removes a member that the restored boundary still contains.
                if ranges_overlap(action_start, action_end, start, end)? {
                    return Err(DomainError::action_outside_session("detached action overlaps restored boundary"));
                }
                target_ids.remove(&action.id);
            }
        }
        check_member_ids(&req.target_member_ids, target_ids.iter().cloned())?;
        for id in &target_ids {
            let (action, extra) = load_action_row(tx, id, true)?;
            guard_unknown(&extra)?;
            ensure_action_writable(tx, id)?;
            ensure_action_has_complete_plan(&action)?;
            ensure_action_fits_range(action.planned_start_at.as_deref().unwrap(), action.planned_end_at.as_deref().unwrap(), start, end)?;
        }
        let now = utc_now();
        let boundary_changed = req.expected_state != req.target_state;
        if boundary_changed {
            tx.execute("UPDATE productivity_session SET planned_start_at=?1, planned_end_at=?2, updated_at_utc=?3 WHERE id=?4", params![start, end, now, session.id])
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        }
        let mut actions = Vec::new();
        for change in &req.membership_changes {
            tx.execute("UPDATE productivity_action SET session_id=?1, updated_at_utc=?2 WHERE id=?3", params![change.target_session_id, now, change.action.id])
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &change.action.id, &now)?;
            actions.push(finished_action_snapshot(tx, &change.action.id)?);
        }
        if boundary_changed { bump_session(tx, &session.id, &now)?; }
        check_member_ids(&req.target_member_ids, session_member_refs(tx, &session.id)?.into_iter().map(|m| m.id))?;
        Ok(SessionAndActionsResponse { session: session_snapshot(tx, &session.id, true)?, actions })
    }))
}

pub fn create_session(data_dir: &str, req: CreateSessionRequest) -> DomainResult<SessionResponse> {
    validate_session_range(&req.planned_start_at, &req.planned_end_at)?;
    let track_lane = req.track_lane.unwrap_or(0);
    let track_span = req.track_span.unwrap_or(1);
    validate_session_track(track_lane, track_span)?;
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
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
            Ok(SessionResponse {
                session: session_snapshot(tx, &id, true)?,
            })
        })
    })
}

pub fn update_session(data_dir: &str, req: UpdateSessionRequest) -> DomainResult<SessionResponse> {
    if let Some(expected_data_dir) = req.expected_data_dir.as_deref() {
        if std::path::Path::new(expected_data_dir) != std::path::Path::new(data_dir) {
            return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消"));
        }
    }
    with_write_expected(data_dir, |conn| {
        in_transaction(conn, |tx| {
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
            let checkpoint_members = crate::productivity_db::checkpoint::session_member_refs(tx, &req.session.id)?;
            if !checkpoint_members.is_empty() && req.expected_data_dir.is_none() { return Err(DomainError::revision_conflict("expectedDataDir is required when Session has Checkpoints")); }
            check_members(&req.expected_checkpoints, &checkpoint_members)?;
            reject_travel_v2_session_checkpoints(tx, &checkpoint_members)?;
            crate::productivity_db::checkpoint::validate_session_members(tx, &req.session.id, start, end)?;
            let actions = actions_for_session(tx, &req.session.id, true)?;
            for action in &actions {
                ensure_not_travel_action(tx, &action.id)?;
            }
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
                params![title, description, start, end, track_lane, track_span, now, req.session.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_session(tx, &req.session.id, &now)?;
            Ok(SessionResponse {
                session: session_snapshot(tx, &req.session.id, true)?,
            })
        })
    })
}

// ADR-0030 / SPEC-0003: fully excluded members detach; a partially cut member
// rejects the whole boundary edit, so no Action plan is silently truncated.
pub fn commit_session_boundary(data_dir: &str, req: CommitSessionBoundaryRequest) -> DomainResult<SessionAndActionsResponse> {
    validate_session_range(&req.planned_start_at, &req.planned_end_at)?;
    if let Some(expected_data_dir) = req.expected_data_dir.as_deref() {
        if std::path::Path::new(expected_data_dir) != std::path::Path::new(data_dir) {
            return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消"));
        }
    }
    with_write_expected(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (session, extra) = load_session_row(tx, &req.session.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.session.expected_revision, session.revision)?;
            ensure_no_session_overlap(tx, &req.planned_start_at, &req.planned_end_at, Some(&req.session.id))?;
            let actual = session_member_refs(tx, &req.session.id)?;
            check_members(&req.expected_members, &actual)?;
            let checkpoints = crate::productivity_db::checkpoint::session_member_refs(tx, &req.session.id)?;
            if !checkpoints.is_empty() && req.expected_data_dir.is_none() { return Err(DomainError::revision_conflict("expectedDataDir is required when Session has Checkpoints")); }
            check_members(&req.expected_checkpoints, &checkpoints)?;
            reject_travel_v2_session_checkpoints(tx, &checkpoints)?;
            reject_travel_v2_session_actions(tx, &req.expected_members)?;
            crate::productivity_db::checkpoint::validate_session_members(tx, &req.session.id, &req.planned_start_at, &req.planned_end_at)?;
            let mut detach = Vec::new();
            for member in &req.expected_members {
                let (action, action_extra) = load_action_row(tx, &member.id, true)?;
                guard_unknown(&action_extra)?;
                let (Some(start), Some(end)) = (&action.planned_start_at, &action.planned_end_at) else {
                    return Err(DomainError::action_outside_session("session member needs complete planned range"));
                };
                if range_inside(start, end, &req.planned_start_at, &req.planned_end_at)? {
                    continue;
                }
                if ranges_overlap(start, end, &req.planned_start_at, &req.planned_end_at)? {
                    return Err(DomainError::action_outside_session("session boundary partially excludes action"));
                }
                ensure_action_writable(tx, &member.id)?;
                detach.push(member.id.as_str());
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_session SET planned_start_at = ?1, planned_end_at = ?2, updated_at_utc = ?3 WHERE id = ?4",
                params![req.planned_start_at, req.planned_end_at, now, req.session.id],
            ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            for id in &detach {
                tx.execute("UPDATE productivity_action SET session_id = NULL, updated_at_utc = ?1 WHERE id = ?2", params![now, id])
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                bump_action(tx, id, &now)?;
            }
            bump_session(tx, &req.session.id, &now)?;
            let actions = detach.into_iter().map(|id| finished_action_snapshot(tx, id)).collect::<DomainResult<Vec<_>>>()?;
            Ok(SessionAndActionsResponse { session: session_snapshot(tx, &req.session.id, true)?, actions })
        })
    })
}

pub fn delete_session_only(data_dir: &str, req: DeleteSessionOnlyRequest) -> DomainResult<SessionAndActionsResponse> {
    if let Some(expected_data_dir) = req.expected_data_dir.as_deref() {
        if std::path::Path::new(expected_data_dir) != std::path::Path::new(data_dir) {
            return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消"));
        }
    }
    with_write_expected(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (session, extra) = load_session_row(tx, &req.session.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.session.expected_revision, session.revision)?;
            let actual = session_member_refs(tx, &req.session.id)?;
            check_members(&req.expected_members, &actual)?;
            let checkpoints = crate::productivity_db::checkpoint::session_member_refs(tx, &req.session.id)?;
            if !checkpoints.is_empty() && req.expected_data_dir.is_none() { return Err(DomainError::revision_conflict("expectedDataDir is required when Session has Checkpoints")); }
            reject_travel_v2_session_checkpoints(tx, &req.expected_checkpoints)?;
            reject_travel_v2_session_actions(tx, &req.expected_members)?;
            crate::productivity_db::checkpoint::detach_session_members(tx, &req.session.id, &req.expected_checkpoints, &utc_now())?;
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_session SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.session.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            for member in &req.expected_members {
                ensure_action_writable(tx, &member.id)?;
                tx.execute(
                    "UPDATE productivity_action SET session_id = NULL, updated_at_utc = ?1 WHERE id = ?2",
                    params![now, member.id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                bump_action(tx, &member.id, &now)?;
            }
            bump_session(tx, &req.session.id, &now)?;
            let mut actions = Vec::new();
            for member in &req.expected_members {
                actions.push(action_snapshot(tx, &member.id, true)?);
            }
            Ok(SessionAndActionsResponse {
                session: session_snapshot(tx, &req.session.id, false)?,
                actions,
            })
        })
    })
}

pub fn restore_session(data_dir: &str, req: RestoreSessionRequest) -> DomainResult<SessionResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (session, extra) = load_session_row(tx, &req.session.id, false)?;
            guard_unknown(&extra)?;
            check_revision(req.session.expected_revision, session.revision)?;
            ensure_no_session_overlap(
                tx,
                &session.planned_start_at,
                &session.planned_end_at,
                Some(&req.session.id),
            )?;
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_session SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.session.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_session(tx, &req.session.id, &now)?;
            Ok(SessionResponse {
                session: session_snapshot(tx, &req.session.id, true)?,
            })
        })
    })
}

pub fn delete_session_with_actions(
    data_dir: &str,
    req: DeleteSessionWithActionsRequest,
) -> DomainResult<SessionAndActionsResponse> {
    if let Some(expected_data_dir) = req.expected_data_dir.as_deref() {
        if std::path::Path::new(expected_data_dir) != std::path::Path::new(data_dir) {
            return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消"));
        }
    }
    with_write_expected(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (session, extra) = load_session_row(tx, &req.session.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.session.expected_revision, session.revision)?;
            let actual = session_member_refs(tx, &req.session.id)?;
            check_members(&req.expected_members, &actual)?;
            let checkpoints = crate::productivity_db::checkpoint::session_member_refs(tx, &req.session.id)?;
            if !checkpoints.is_empty() && req.expected_data_dir.is_none() { return Err(DomainError::revision_conflict("expectedDataDir is required when Session has Checkpoints")); }
            reject_travel_v2_session_checkpoints(tx, &req.expected_checkpoints)?;
            reject_travel_v2_session_actions(tx, &req.expected_members)?;
            crate::productivity_db::checkpoint::detach_session_members(tx, &req.session.id, &req.expected_checkpoints, &utc_now())?;
            let now = utc_now();
            let batch = new_uuid();
            tx.execute(
                "UPDATE productivity_session SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3",
                params![now, batch, req.session.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            for member in &req.expected_members {
                ensure_action_writable(tx, &member.id)?;
                ensure_action_deletable(tx, &member.id)?;
                tx.execute(
                    "UPDATE productivity_action SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3",
                    params![now, batch, member.id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                tx.execute(
                    "UPDATE productivity_interval SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE action_id = ?3 AND deleted_at_utc IS NULL",
                    params![now, batch, member.id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                bump_action(tx, &member.id, &now)?;
            }
            bump_session(tx, &req.session.id, &now)?;
            let mut actions = Vec::new();
            for member in &req.expected_members {
                actions.push(action_snapshot(tx, &member.id, false)?);
            }
            Ok(SessionAndActionsResponse {
                session: session_snapshot(tx, &req.session.id, false)?,
                actions,
            })
        })
    })
}

pub fn restore_session_with_actions(
    data_dir: &str,
    req: RestoreSessionWithActionsRequest,
) -> DomainResult<SessionAndActionsResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (session, extra) = load_session_row(tx, &req.session.id, false)?;
            guard_unknown(&extra)?;
            check_revision(req.session.expected_revision, session.revision)?;
            let batch: Option<String> = tx
                .query_row(
                    "SELECT deletion_batch_id FROM productivity_session WHERE id = ?1",
                    [&req.session.id],
                    |row| row.get(0),
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let batch = batch.ok_or_else(|| DomainError::delete_batch_mismatch())?;
            let mut actual_members = Vec::new();
            let mut stmt = tx
                .prepare(
                    "SELECT id, revision FROM productivity_action WHERE session_id = ?1 AND deletion_batch_id = ?2",
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let rows = stmt
                .query_map(params![req.session.id, batch], |row| {
                    Ok(RevisionRef {
                        id: row.get(0)?,
                        expected_revision: row.get(1)?,
                    })
                })
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            for row in rows {
                actual_members.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
            }
            check_members(&req.expected_members, &actual_members)?;
            reject_travel_v2_session_actions(tx, &req.expected_members)?;
            ensure_no_session_overlap(
                tx,
                &session.planned_start_at,
                &session.planned_end_at,
                Some(&req.session.id),
            )?;
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_session SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.session.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            for member in &req.expected_members {
                ensure_action_writable(tx, &member.id)?;
                tx.execute(
                    "UPDATE productivity_action SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2",
                    params![now, member.id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                tx.execute(
                    "UPDATE productivity_interval SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE action_id = ?2 AND deletion_batch_id = ?3",
                    params![now, member.id, batch],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                bump_action(tx, &member.id, &now)?;
            }
            bump_session(tx, &req.session.id, &now)?;
            let mut actions = Vec::new();
            for member in &req.expected_members {
                actions.push(action_snapshot(tx, &member.id, true)?);
            }
            Ok(SessionAndActionsResponse {
                session: session_snapshot(tx, &req.session.id, true)?,
                actions,
            })
        })
    })
}
