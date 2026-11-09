use super::{
    coordinator::{in_transaction, with_read, with_write_expected},
    error::{DomainError, DomainResult},
    point::validate_utc_instant,
    repository::{
        check_revision, load_item_row, load_project_row, load_session_row, load_tasks_for_project,
    },
    types::*,
    util::{new_uuid, utc_now},
    validation::{
        ensure_list_writable, ensure_not_travel_item, ensure_not_travel_v2_checkpoint,
        validate_appearance, validate_target_kind,
    },
};
use rusqlite::{params, OptionalExtension, Transaction};
fn decode(raw: String) -> DomainResult<Option<ActionAppearance>> {
    if raw.trim().is_empty() || raw.trim() == "{}" || raw.trim() == "null" {
        return Ok(None);
    }

    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|_| DomainError::unknown_field_blocked())
}
pub(crate) fn snapshot(
    tx: &Transaction<'_>,
    id: &str,
    include_deleted: bool,
) -> DomainResult<CheckpointSnapshot> {
    let sql = if include_deleted {
        "SELECT * FROM productivity_checkpoint WHERE id=?1"
    } else {
        "SELECT * FROM productivity_checkpoint WHERE id=?1 AND deleted_at_utc IS NULL"
    };

    let row = tx
        .query_row(sql, [id], |r| {
            Ok((
                CheckpointSnapshot {
                    id: r.get("id")?,
                    name_link_mode: r.get("name_link_mode")?,
                    schema_version: r.get("schema_version")?,
                    revision: r.get("revision")?,
                    title: r.get("title")?,
                    description: r.get("description")?,
                    appearance: decode(r.get("appearance_json")?).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            0,
                            rusqlite::types::Type::Text,
                            Box::new(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                e.to_string(),
                            )),
                        )
                    })?,
                    planned_at_utc: r.get("planned_at_utc")?,
                    actual_at_utc: r.get("actual_at_utc")?,
                    completed: r.get::<_, i64>("completed")? != 0,
                    session_id: r.get("session_id")?,
                    target_kind: r.get("target_kind")?,
                    target_id: r.get("target_id")?,
                    created_at_utc: r.get("created_at_utc")?,
                    updated_at_utc: r.get("updated_at_utc")?,
                    deleted_at_utc: r.get("deleted_at_utc")?,
                },
                r.get::<_, String>("extra_json")?,
            ))
        })
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;

    let Some((value, extra)) = row else {
        return Err(DomainError::root_not_found("checkpoint not found"));
    };

    if value.schema_version != 1 {
        return Err(DomainError::unknown_field_blocked());
    }

    super::repository::guard_unknown(&extra)?;
    super::validation::validate_name_link_mode(&value.name_link_mode)?;

    Ok(value)
}
fn validate_title(title: &str) -> DomainResult<()> {
    if title.trim().is_empty() {
        return Err(DomainError::invalid_patch("checkpoint title required"));
    }

    if title.trim() != title {
        return Err(DomainError::invalid_patch(
            "checkpoint title must be trimmed",
        ));
    }

    Ok(())
}
fn validate_actual(value: Option<&str>) -> DomainResult<()> {
    if let Some(value) = value {
        validate_utc_instant(value)?;

        if chrono::DateTime::parse_from_rfc3339(value)
            .map_err(|_| DomainError::invalid_time("invalid utc instant"))?
            .with_timezone(&chrono::Utc)
            > chrono::Utc::now()
        {
            return Err(DomainError::invalid_time(
                "actual checkpoint time cannot be in the future",
            ));
        }
    }

    Ok(())
}
fn current(
    tx: &Transaction<'_>,
    id: &str,
    revision: i64,
    live: bool,
) -> DomainResult<CheckpointSnapshot> {
    let value = snapshot(tx, id, !live)?;

    check_revision(revision, value.revision)?;

    if value.target_kind.as_deref() == Some("item") {
        if let Some(id) = value.target_id.as_deref() {
            let (item, extra) = load_item_row(tx, id, false)?;
            super::repository::guard_unknown(&extra)?;
            if let Some(list_id) = item.list_id.as_deref() {
                let (list, list_extra) = super::repository::load_list_row(tx, list_id, false)?;
                super::repository::guard_unknown(&list_extra)?;
                if list.deleted_at_utc.is_none() {
                    ensure_list_writable(tx, Some(list_id))?;
                }
            }
        }
    }

    Ok(value)
}
fn bump(tx: &Transaction<'_>, id: &str, now: &str) -> DomainResult<()> {
    let changed = tx
        .execute(
            "UPDATE productivity_checkpoint SET revision=revision+1,updated_at_utc=?1 WHERE id=?2",
            params![now, id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;

    if changed != 1 {
        return Err(DomainError::root_not_found("checkpoint not found"));
    }

    Ok(())
}
fn validate_target(
    tx: &Transaction<'_>,
    kind: &str,
    id: &str,
    owner: &RevisionRef,
) -> DomainResult<()> {
    validate_target_kind(kind)?;

    match kind {
        "project" => {
            let (root, extra) = load_project_row(tx, id, true)?;
            super::repository::guard_unknown(&extra)?;
            check_revision(owner.expected_revision, root.revision)?;
            if owner.id != id {
                return Err(DomainError::invalid_patch("owning root mismatch"));
            }
        }

        "item" => {
            let (root, extra) = load_item_row(tx, id, true)?;
            super::repository::guard_unknown(&extra)?;
            check_revision(owner.expected_revision, root.revision)?;
            if owner.id != id {
                return Err(DomainError::invalid_patch("owning root mismatch"));
            }
            ensure_not_travel_item(tx, id)?;
            ensure_list_writable(tx, root.list_id.as_deref())?;
        }

        "task" => {
            let (root, extra) = load_project_row(tx, &owner.id, true)?;
            super::repository::guard_unknown(&extra)?;
            check_revision(owner.expected_revision, root.revision)?;
            let tasks = load_tasks_for_project(tx, &owner.id, true)?;
            if !tasks.iter().any(|t| t.id == id) {
                return Err(DomainError::root_not_found("task not found in project"));
            }
        }

        _ => return Err(DomainError::invalid_patch("invalid target kind")),
    }

    Ok(())
}
pub(crate) fn validate_session_point(
    tx: &Transaction<'_>,
    session_id: &str,
    planned: Option<&str>,
    session_ref: &RevisionRef,
) -> DomainResult<()> {
    let (session, extra) = load_session_row(tx, session_id, true)?;
    super::repository::guard_unknown(&extra)?;
    check_revision(session_ref.expected_revision, session.revision)?;

    let Some(planned) = planned else {
        return Err(DomainError::action_outside_session(
            "checkpoint needs plannedAt for session assignment",
        ));
    };

    let value = chrono::DateTime::parse_from_rfc3339(planned)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;

    let start = chrono::DateTime::parse_from_rfc3339(&session.planned_start_at)
        .map_err(|_| DomainError::invalid_time("invalid session time"))?;

    let end = chrono::DateTime::parse_from_rfc3339(&session.planned_end_at)
        .map_err(|_| DomainError::invalid_time("invalid session time"))?;

    if value < start || value > end {
        return Err(DomainError::action_outside_session(
            "checkpoint point is outside session",
        ));
    }

    Ok(())
}
pub fn create(data_dir: &str, req: CreateCheckpointRequest) -> DomainResult<CheckpointResponse> {
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            validate_title(&req.title)?;
            let name_link_mode = req.name_link_mode.as_deref().unwrap_or("unlinked");
            super::validation::validate_name_link_mode(name_link_mode)?;

            if let Some(a) = req.appearance.as_ref() {
                validate_appearance(a)?;
            }

            if let (Some(k), Some(id)) = (&req.target_kind, &req.target_id) {
                validate_target(
                    tx,
                    k,
                    id,
                    req.owning_root.as_ref().ok_or_else(|| {
                        DomainError::invalid_patch("target owner revision required")
                    })?,
                )?;
            } else if req.target_kind.is_some()
                || req.target_id.is_some()
                || req.owning_root.is_some()
            {
                return Err(DomainError::invalid_patch(
                    "target kind, id and owner must be supplied together",
                ));
            }

            if let Some(t) = &req.planned_at_utc {
                validate_utc_instant(t)?;
            }

            if let Some(session) = req.session.as_ref() {
                validate_session_point(tx, &session.id, req.planned_at_utc.as_deref(), session)?;
            }

            let now = utc_now();
            let id = new_uuid();
            let appearance = serde_json::to_string(&req.appearance)
                .map_err(|e| DomainError::invalid_patch(e.to_string()))?;

            tx.execute("INSERT INTO productivity_checkpoint(id,revision,title,name_link_mode,description,appearance_json,planned_at_utc,completed,session_id,created_at_utc,updated_at_utc,target_kind,target_id) VALUES(?1,1,?2,?3,?4,?5,?6,0,?7,?8,?8,?9,?10)",
        params![id,
        req.title,
        name_link_mode,
        req.description,
        appearance,
        req.planned_at_utc,
        req.session.as_ref().map(|s| s.id.as_str()),
        now,
        req.target_kind,
        req.target_id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;

            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &id, false)?,
            })
        })
    })
}
pub fn get(data_dir: &str, req: GetCheckpointRequest) -> DomainResult<CheckpointResponse> {
    with_read(data_dir, |conn| {
        let conn = conn.ok_or_else(|| DomainError::root_not_found("checkpoint not found"))?;
        in_transaction(conn, |tx| {
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.id, req.include_deleted)?,
            })
        })
    })
}
pub fn list(data_dir: &str, req: ListCheckpointsRequest) -> DomainResult<CheckpointsListResponse> {
    with_read(data_dir, |conn| {
        let Some(conn) = conn else {
            return Ok(CheckpointsListResponse {
                checkpoints: vec![],
            });
        };
        in_transaction(conn, |tx| {
            let sql = if req.include_deleted {
                "SELECT id FROM productivity_checkpoint ORDER BY COALESCE(planned_at_utc,created_at_utc),id"
            } else {
                "SELECT id FROM productivity_checkpoint WHERE deleted_at_utc IS NULL ORDER BY COALESCE(planned_at_utc,created_at_utc),id"
            };
            let mut stmt = tx
                .prepare(sql)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let ids = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let mut checkpoints = Vec::new();
            for id in ids {
                checkpoints.push(snapshot(
                    tx,
                    &id.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
                    req.include_deleted,
                )?);
            }
            Ok(CheckpointsListResponse { checkpoints })
        })
    })
}
pub fn update(data_dir: &str, req: UpdateCheckpointRequest) -> DomainResult<CheckpointResponse> {
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
            let old = current(
                tx,
                &req.checkpoint.id,
                req.checkpoint.expected_revision,
                true,
            )?;
            if old.actual_at_utc.is_some()
                && req.planned_at_utc.is_some()
                && req.planned_at_utc.as_ref().unwrap().as_deref() != old.planned_at_utc.as_deref()
            {
                return Err(DomainError::action_execution_invalid(
                    "checkpoint plan is frozen after actual time",
                ));
            }

            let title = req
                .title
                .unwrap_or(Some(old.title.clone()))
                .unwrap_or_default();
            validate_title(&title)?;
            let name_link_mode = super::validation::next_name_link_mode(
                &old.name_link_mode, req.name_link_mode.as_deref(), title != old.title,
            )?;
            let description = req.description.unwrap_or(old.description.clone());
            let appearance = req.appearance.unwrap_or(old.appearance.clone());
            if let Some(a) = appearance.as_ref() {
                validate_appearance(a)?;
            }
            let plan = req.planned_at_utc.unwrap_or(old.planned_at_utc.clone());
            if let Some(t) = &plan {
                validate_utc_instant(t)?;
            }

            if plan != old.planned_at_utc {
                if let Some(session_id) = old.session_id.as_deref() {
                    let (session, extra) = load_session_row(tx, session_id, true)?;
                    super::repository::guard_unknown(&extra)?;
                    let session_ref = RevisionRef {
                        id: session_id.to_string(),
                        expected_revision: session.revision,
                    };
                    validate_session_point(tx, session_id, plan.as_deref(), &session_ref)?;
                }
            }

            if title == old.title
                && name_link_mode == old.name_link_mode
                && description == old.description
                && appearance == old.appearance
                && plan == old.planned_at_utc
            {
                return Ok(CheckpointResponse { checkpoint: old });
            }

            let appearance = serde_json::to_string(&appearance)
                .map_err(|e| DomainError::invalid_patch(e.to_string()))?;
            let now = utc_now();
            tx.execute("UPDATE productivity_checkpoint SET title=?1,name_link_mode=?2,description=?3,appearance_json=?4,planned_at_utc=?5 WHERE id=?6",
        params![title,
        name_link_mode,
        description,
        appearance,
        plan,
        req.checkpoint.id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
            bump(tx, &req.checkpoint.id, &now)?;
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.checkpoint.id, false)?,
            })
        })
    })
}
pub fn complete(
    data_dir: &str,
    req: CompleteCheckpointRequest,
) -> DomainResult<CheckpointResponse> {
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
            let old = current(
                tx,
                &req.checkpoint.id,
                req.checkpoint.expected_revision,
                true,
            )?;
            if old.completed {
                return Ok(CheckpointResponse { checkpoint: old });
            }
            let actual = req.actual_at_utc.unwrap_or_else(|| Some(utc_now()));
            validate_actual(actual.as_deref())?;
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_checkpoint SET completed=1,actual_at_utc=?1 WHERE id=?2",
                params![actual, req.checkpoint.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump(tx, &req.checkpoint.id, &now)?;
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.checkpoint.id, false)?,
            })
        })
    })
}
pub fn correct_actual(
    data_dir: &str,
    req: CorrectCheckpointActualRequest,
) -> DomainResult<CheckpointResponse> {
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
            let old = current(
                tx,
                &req.checkpoint.id,
                req.checkpoint.expected_revision,
                true,
            )?;
            if !old.completed {
                return Err(DomainError::action_execution_invalid(
                    "checkpoint is not completed",
                ));
            }
            let actual = req.actual_at_utc.ok_or_else(|| {
                DomainError::invalid_patch("actualAtUtc must be supplied; use null to revoke")
            })?;
            validate_actual(actual.as_deref())?;
            if actual == old.actual_at_utc {
                return Ok(CheckpointResponse { checkpoint: old });
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_checkpoint SET actual_at_utc=?1 WHERE id=?2",
                params![actual, req.checkpoint.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump(tx, &req.checkpoint.id, &now)?;
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.checkpoint.id, false)?,
            })
        })
    })
}
fn reject_detach_outside_restore(req: &CheckpointRequest) -> DomainResult<()> {
    if req.detach_session {
        return Err(DomainError::invalid_patch(
            "detachSession is only valid for RestoreCheckpoint",
        ));
    }
    Ok(())
}

pub fn reopen(data_dir: &str, req: CheckpointRequest) -> DomainResult<CheckpointResponse> {
    reject_detach_outside_restore(&req)?;
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
            let old = current(
                tx,
                &req.checkpoint.id,
                req.checkpoint.expected_revision,
                true,
            )?;
            if !old.completed {
                return Ok(CheckpointResponse { checkpoint: old });
            }
            if let (Some(k), Some(id)) = (&old.target_kind, &old.target_id) {
                crate::productivity_db::commands::ensure_reopen_target_available(tx, k, id)?;
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_checkpoint SET completed=0,actual_at_utc=NULL WHERE id=?1",
                [&req.checkpoint.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump(tx, &req.checkpoint.id, &now)?;
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.checkpoint.id, false)?,
            })
        })
    })
}
pub fn delete(data_dir: &str, req: CheckpointRequest) -> DomainResult<CheckpointResponse> {
    reject_detach_outside_restore(&req)?;
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
            let old = current(
                tx,
                &req.checkpoint.id,
                req.checkpoint.expected_revision,
                false,
            )?;
            if old.deleted_at_utc.is_some() {
                return Ok(CheckpointResponse { checkpoint: old });
            }
            let now = utc_now();
            let batch = new_uuid();
            tx.execute("UPDATE productivity_checkpoint SET deleted_at_utc=?1,deletion_batch_id=?2 WHERE id=?3",
        params![now,
        batch,
        req.checkpoint.id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
            bump(tx, &req.checkpoint.id, &now)?;
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.checkpoint.id, true)?,
            })
        })
    })
}
pub fn restore(data_dir: &str, req: CheckpointRequest) -> DomainResult<CheckpointResponse> {
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
            let current_value = snapshot(tx, &req.checkpoint.id, true)?;
            check_revision(req.checkpoint.expected_revision, current_value.revision)?;
            if current_value.deleted_at_utc.is_none() {
                if req.detach_session {
                    return Err(DomainError::invalid_patch(
                        "detachSession only applies when restoring a deleted Checkpoint",
                    ));
                }
                return Ok(CheckpointResponse {
                    checkpoint: current_value,
                });
            }
            let old = current(
                tx,
                &req.checkpoint.id,
                req.checkpoint.expected_revision,
                false,
            )?;
            let session_id: Option<String> = tx
                .query_row(
                    "SELECT session_id FROM productivity_checkpoint WHERE id=?1",
                    [&req.checkpoint.id],
                    |r| r.get(0),
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let session_id = if req.detach_session {
                None
            } else if let Some(id) = session_id {
                if let Some(sref) = &req.session {
                    if sref.id != id {
                        return Err(DomainError::invalid_patch("session id mismatch"));
                    }
                    let (s, extra) = load_session_row(tx, &id, false)?;
                    super::repository::guard_unknown(&extra)?;
                    check_revision(sref.expected_revision, s.revision)?;
                    if s.deleted_at_utc.is_some() {
                        None
                    } else {
                        validate_session_point(tx, &id, old.planned_at_utc.as_deref(), sref)?;
                        Some(id)
                    }
                } else {
                    return Err(DomainError::invalid_patch("session revision required"));
                }
            } else {
                None
            };
            let now = utc_now();
            tx.execute("UPDATE productivity_checkpoint SET deleted_at_utc=NULL,deletion_batch_id=NULL,session_id=?1 WHERE id=?2",
        params![session_id,
        req.checkpoint.id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
            bump(tx, &req.checkpoint.id, &now)?;
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.checkpoint.id, false)?,
            })
        })
    })
}
pub fn set_target(
    data_dir: &str,
    req: SetCheckpointTargetRequest,
) -> DomainResult<CheckpointResponse> {
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
            let old = current(
                tx,
                &req.checkpoint.id,
                req.checkpoint.expected_revision,
                true,
            )?;
            if old.completed || old.actual_at_utc.is_some() {
                return Err(DomainError::action_execution_invalid(
                    "cannot change target after completion or actual time",
                ));
            }
            validate_target(tx, &req.target_kind, &req.target_id, &req.owning_root)?;
            if old.target_kind.as_deref() == Some(&req.target_kind)
                && old.target_id.as_deref() == Some(&req.target_id)
            {
                return Ok(CheckpointResponse { checkpoint: old });
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_checkpoint SET target_kind=?1,target_id=?2 WHERE id=?3",
                params![req.target_kind, req.target_id, req.checkpoint.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump(tx, &req.checkpoint.id, &now)?;
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.checkpoint.id, false)?,
            })
        })
    })
}
pub fn clear_target(data_dir: &str, req: CheckpointRequest) -> DomainResult<CheckpointResponse> {
    reject_detach_outside_restore(&req)?;
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
            let old = current(
                tx,
                &req.checkpoint.id,
                req.checkpoint.expected_revision,
                true,
            )?;
            if old.completed || old.actual_at_utc.is_some() {
                return Err(DomainError::action_execution_invalid(
                    "cannot change target after completion or actual time",
                ));
            }
            if old.target_id.is_none() {
                return Ok(CheckpointResponse { checkpoint: old });
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_checkpoint SET target_kind=NULL,target_id=NULL WHERE id=?1",
                [&req.checkpoint.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump(tx, &req.checkpoint.id, &now)?;
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.checkpoint.id, false)?,
            })
        })
    })
}
pub fn assign_session(
    data_dir: &str,
    req: AssignCheckpointSessionRequest,
) -> DomainResult<CheckpointResponse> {
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
            let old = current(
                tx,
                &req.checkpoint.id,
                req.checkpoint.expected_revision,
                true,
            )?;
            validate_session_point(
                tx,
                &req.session.id,
                old.planned_at_utc.as_deref(),
                &req.session,
            )?;
            if old.session_id.as_deref() == Some(&req.session.id) {
                return Ok(CheckpointResponse { checkpoint: old });
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_checkpoint SET session_id=?1 WHERE id=?2",
                params![req.session.id, req.checkpoint.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump(tx, &req.checkpoint.id, &now)?;
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.checkpoint.id, false)?,
            })
        })
    })
}
pub fn remove_session(data_dir: &str, req: CheckpointRequest) -> DomainResult<CheckpointResponse> {
    reject_detach_outside_restore(&req)?;
    with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
            let old = current(
                tx,
                &req.checkpoint.id,
                req.checkpoint.expected_revision,
                true,
            )?;
            if old.session_id.is_none() {
                return Ok(CheckpointResponse { checkpoint: old });
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_checkpoint SET session_id=NULL WHERE id=?1",
                [&req.checkpoint.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump(tx, &req.checkpoint.id, &now)?;
            Ok(CheckpointResponse {
                checkpoint: snapshot(tx, &req.checkpoint.id, false)?,
            })
        })
    })
}
pub(crate) fn pending_for_target(tx: &Transaction<'_>, kind: &str, id: &str) -> DomainResult<bool> {
    tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_checkpoint WHERE target_kind=?1 AND target_id=?2 AND completed=0 AND deleted_at_utc IS NULL)",
    params![kind,
    id],
    |r|r.get(0)).map_err(|e|DomainError::archive_lifecycle(e.to_string()))
}
pub(crate) fn session_member_refs(
    tx: &Transaction<'_>,
    session_id: &str,
) -> DomainResult<Vec<RevisionRef>> {
    let mut st=tx.prepare("SELECT id,revision FROM productivity_checkpoint WHERE session_id=?1 AND deleted_at_utc IS NULL").map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
    let rows = st
        .query_map([session_id], |r| {
            Ok(RevisionRef {
                id: r.get(0)?,
                expected_revision: r.get(1)?,
            })
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))
}
pub(crate) fn detach_session_members(
    tx: &Transaction<'_>,
    session_id: &str,
    expected: &[RevisionRef],
    now: &str,
) -> DomainResult<()> {
    let actual = session_member_refs(tx, session_id)?;
    super::repository::check_members(expected, &actual)?;
    for member in expected {
        ensure_not_travel_v2_checkpoint(tx, &member.id)?;
        let old = current(tx, &member.id, member.expected_revision, true)?;
        if old.session_id.as_deref() != Some(session_id) {
            return Err(DomainError::revision_conflict(
                "checkpoint session membership changed",
            ));
        }
        tx.execute(
            "UPDATE productivity_checkpoint SET session_id=NULL WHERE id=?1",
            [&member.id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        bump(tx, &member.id, now)?;
    }
    Ok(())
}
pub(crate) fn validate_session_members(
    tx: &Transaction<'_>,
    session_id: &str,
    start: &str,
    end: &str,
) -> DomainResult<()> {
    let mut st=tx.prepare("SELECT id,planned_at_utc FROM productivity_checkpoint WHERE session_id=?1 AND deleted_at_utc IS NULL").map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
    let rows = st
        .query_map([session_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let s = chrono::DateTime::parse_from_rfc3339(start)
        .map_err(|_| DomainError::invalid_time("invalid session time"))?;
    let e = chrono::DateTime::parse_from_rfc3339(end)
        .map_err(|_| DomainError::invalid_time("invalid session time"))?;
    for row in rows {
        let (id, p) = row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let Some(p) = p else {
            return Err(DomainError::action_outside_session(format!(
                "checkpoint {id} has no planned point"
            )));
        };
        let p = chrono::DateTime::parse_from_rfc3339(&p)
            .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
        if p < s || p > e {
            return Err(DomainError::action_outside_session(format!(
                "checkpoint {id} is outside session"
            )));
        }
    }
    Ok(())
}


// SPEC-0011 §5.2: create the Item and its initial-linked point under one expected-root lock.
pub fn create_item_with_checkpoint(data_dir: &str, req: CommitItemWithCheckpointRequest) -> DomainResult<ItemWithCheckpointResponse> {
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        validate_title(&req.item_title)?;
        validate_title(&req.checkpoint_title)?;
        let planned = req.planned_at_utc.unwrap_or(None);
        if let Some(value) = planned.as_deref() { validate_utc_instant(value)?; }
        if let Some(session) = req.session.as_ref() {
            validate_session_point(tx, &session.id, planned.as_deref(), session)?;
        }
        let item_id = new_uuid();
        let checkpoint_id = new_uuid();
        let now = utc_now();
        super::repository::insert_item(tx, &item_id, None, &req.item_title, None, "进行中", "none", None, None, &now)?;
        super::repository::append_item_to_order(tx, &item_id, &now)?;
        let appearance = "null";
        tx.execute(
            "INSERT INTO productivity_checkpoint(id,revision,title,name_link_mode,description,appearance_json,planned_at_utc,completed,session_id,target_kind,target_id,created_at_utc,updated_at_utc,extra_json) VALUES(?1,1,?2,'initial-linked',NULL,?3,?4,0,?5,'item',?6,?7,?7,'{}')",
            params![checkpoint_id, req.checkpoint_title, appearance, planned, req.session.as_ref().map(|s| s.id.as_str()), item_id, now],
        ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        Ok(ItemWithCheckpointResponse {
            item: super::repository::item_snapshot(tx, &item_id, true)?,
            checkpoint: snapshot(tx, &checkpoint_id, false)?,
        })
    }))
}

// SPEC-0011 §5.3: freeze the gesture baseline and commit plan plus membership in one Archive transaction.
pub fn commit_arrangement(data_dir: &str, req: CommitCheckpointArrangementRequest) -> DomainResult<CheckpointResponse> {
    let planned_at_utc = req.planned_at_utc.clone().ok_or_else(|| DomainError::invalid_patch("plannedAtUtc is required"))?;
    if let Some(value) = planned_at_utc.as_deref() { validate_utc_instant(value)?; }
    let current_session = req.current_session.clone().unwrap_or(None);
    let next_session = req.next_session.clone().unwrap_or(None);
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        ensure_not_travel_v2_checkpoint(tx, &req.checkpoint.id)?;
        let point = current(tx, &req.checkpoint.id, req.checkpoint.expected_revision, true)?;
        if point.session_id.as_deref() != current_session.as_ref().map(|s| s.id.as_str()) {
            return Err(DomainError::revision_conflict("currentSession mismatch"));
        }
        if point.actual_at_utc.is_some() && point.planned_at_utc != planned_at_utc {
            return Err(DomainError::action_execution_invalid("checkpoint plan is frozen after actual time"));
        }
        match (&current_session, &next_session) {
            (Some(current), Some(next)) if current.id == next.id => {
                super::repository::check_members(&req.expected_current_checkpoints, &req.expected_next_checkpoints)?;
            }
            _ => {}
        }
        for (session_ref, expected) in [(&current_session, &req.expected_current_checkpoints), (&next_session, &req.expected_next_checkpoints)] {
            match session_ref {
                Some(session) => {
                    let (row, extra) = load_session_row(tx, &session.id, true)?;
                    super::repository::guard_unknown(&extra)?;
                    check_revision(session.expected_revision, row.revision)?;
                    let members = session_member_refs(tx, &session.id)?;
                    super::repository::check_members(expected, &members)?;
                    for member in expected { current(tx, &member.id, member.expected_revision, true)?; }
                }
                None if !expected.is_empty() => return Err(DomainError::invalid_patch("checkpoints without session")),
                None => {}
            }
        }
        if current_session.is_some() {
            if !req.expected_current_checkpoints.iter().any(|r| r.id == req.checkpoint.id && r.expected_revision == req.checkpoint.expected_revision) {
                return Err(DomainError::revision_conflict("current session checkpoint set must include checkpoint"));
            }
        }
        if next_session.is_some() {
            let next = next_session.as_ref().unwrap();
            validate_session_point(tx, &next.id, planned_at_utc.as_deref(), next)?;
        }
        if planned_at_utc.is_none() && next_session.is_some() {
            return Err(DomainError::action_outside_session("checkpoint needs plannedAt for session assignment"));
        }
        let session_id = next_session.as_ref().map(|s| s.id.as_str());
        if point.planned_at_utc == planned_at_utc && point.session_id.as_deref() == session_id {
            return Ok(CheckpointResponse { checkpoint: point });
        }
        if point.actual_at_utc.is_some() {
            return Err(DomainError::action_execution_invalid("checkpoint plan and arrangement are frozen after actual time"));
        }
        let now = utc_now();
        tx.execute("UPDATE productivity_checkpoint SET planned_at_utc=?1,session_id=?2 WHERE id=?3", params![planned_at_utc, session_id, req.checkpoint.id])
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        bump(tx, &req.checkpoint.id, &now)?;
        Ok(CheckpointResponse { checkpoint: snapshot(tx, &req.checkpoint.id, false)? })
    }))
}


pub(crate) fn pending_refs_for_target(tx: &Transaction<'_>, kind: &str, id: &str) -> DomainResult<Vec<RevisionRef>> {
    let mut stmt = tx.prepare("SELECT id,revision FROM productivity_checkpoint WHERE target_kind=?1 AND target_id=?2 AND completed=0 AND deleted_at_utc IS NULL ORDER BY id")
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt.query_map(params![kind,id], |r| Ok(RevisionRef { id:r.get(0)?, expected_revision:r.get(1)? }))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e| DomainError::archive_lifecycle(e.to_string()))
}
pub(crate) fn complete_without_actual(tx: &Transaction<'_>, expected: &RevisionRef, now: &str) -> DomainResult<CheckpointSnapshot> {
    ensure_not_travel_v2_checkpoint(tx, &expected.id)?;
    let old = current(tx, &expected.id, expected.expected_revision, true)?;
    if old.completed { return Err(DomainError::revision_conflict("checkpoint is no longer pending")); }
    tx.execute("UPDATE productivity_checkpoint SET completed=1,actual_at_utc=NULL WHERE id=?1", [&expected.id])
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    bump(tx, &expected.id, now)?;
    snapshot(tx, &expected.id, false)
}
