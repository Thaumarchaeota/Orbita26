use chrono::Utc;
use rusqlite::{params, OptionalExtension, Transaction};

use super::model::*;
use super::read::load_action_actual;
use super::validation::ensure_actual_not_future;
use super::super::error::{DomainError, DomainResult};
use super::super::util::{new_uuid, utc_now};

#[derive(Debug, Clone, Default)]
pub struct ActualSideWrite {
    pub origin: Option<String>,
    pub source_ref: Option<String>,
}

pub fn apply_set_actual(
    tx: &Transaction<'_>,
    payload: &SetActualPayload,
    cancelled_at: Option<&str>,
    side_write: Option<ActualSideWrite>,
) -> DomainResult<bool> {
    let now = Utc::now();
    match &payload.target {
        SetActualTarget::Checkpoint { checkpoint_id } => {
            if payload.mode == "clear" || payload.value.is_none() {
                let current: Option<String> = tx
                    .query_row(
                        "SELECT actual_at_utc FROM productivity_checkpoint WHERE id = ?1",
                        [checkpoint_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
                    .flatten();
                if current.is_none() {
                    return Ok(false);
                }
                tx.execute(
                    "UPDATE productivity_checkpoint SET actual_at_utc = NULL, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2",
                    params![utc_now(), checkpoint_id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                return Ok(true);
            }
            let value = payload.value.as_ref().unwrap();
            ensure_actual_not_future(value, &now, cancelled_at)?;
            let current: Option<String> = tx
                .query_row(
                    "SELECT actual_at_utc FROM productivity_checkpoint WHERE id = ?1",
                    [checkpoint_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
                .flatten();
            if current.as_deref() == Some(value.as_str()) {
                return Ok(false);
            }
            tx.execute(
                "UPDATE productivity_checkpoint SET actual_at_utc = ?1, completed = 1, updated_at_utc = ?2, revision = revision + 1 WHERE id = ?3",
                params![value, utc_now(), checkpoint_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            return Ok(true);
        }
        SetActualTarget::ActionBoundary { action_id, side } => {
            let current = load_action_actual(tx, action_id)?;
            let value = payload.value.clone();
            if payload.mode == "clear" {
                let had = match side.as_str() {
                    "start" => current.start_at_utc.is_some() || current.pending_start_at_utc.is_some(),
                    "end" => current.end_at_utc.is_some() || current.pending_end_at_utc.is_some(),
                    _ => return Err(DomainError::invalid_patch("side must be start or end")),
                };
                if !had && current.interval_id.is_none() {
                    return Ok(false);
                }
                clear_boundary(tx, action_id, side, &current)?;
                return Ok(true);
            }
            if let Some(v) = &value {
                ensure_actual_not_future(v, &now, cancelled_at)?;
            }
            let changed = match side.as_str() {
                "start" => set_start(tx, action_id, value, &payload.mode, &current, side_write)?,
                "end" => set_end(tx, action_id, value, &payload.mode, &current, side_write)?,
                _ => return Err(DomainError::invalid_patch("side must be start or end")),
            };
            return Ok(changed);
        }
    }
}

fn set_start(
    tx: &Transaction<'_>,
    action_id: &str,
    value: Option<String>,
    mode: &str,
    current: &ActionActualProjection,
    side_write: Option<ActualSideWrite>,
) -> DomainResult<bool> {
    if let Some(v) = &value {
        if same_instant_value(current.start_at_utc.as_deref().or(current.pending_start_at_utc.as_deref()), v) {
            return Ok(false);
        }
    }
    if current.start_at_utc.is_some() && mode != "correct" && value.is_some() {
        return Err(DomainError::actual_invalid("existing start requires correct mode"));
    }
    let write = side_write.unwrap_or_else(|| ActualSideWrite {
        origin: Some("manual".into()),
        source_ref: None,
    });
    upsert_pending(tx, action_id, value, None, current, Some("start"), write)?;
    Ok(true)
}

fn set_end(
    tx: &Transaction<'_>,
    action_id: &str,
    value: Option<String>,
    mode: &str,
    current: &ActionActualProjection,
    side_write: Option<ActualSideWrite>,
) -> DomainResult<bool> {
    if let Some(v) = &value {
        if same_instant_value(current.end_at_utc.as_deref().or(current.pending_end_at_utc.as_deref()), v) {
            return Ok(false);
        }
    }
    if current.end_at_utc.is_some() && mode != "correct" && value.is_some() {
        return Err(DomainError::actual_invalid("existing end requires correct mode"));
    }
    let write = side_write.unwrap_or_else(|| ActualSideWrite {
        origin: Some("manual".into()),
        source_ref: None,
    });
    upsert_pending(tx, action_id, None, value, current, Some("end"), write)?;
    Ok(true)
}

fn same_instant_value(existing: Option<&str>, incoming: &str) -> bool {
    match existing {
        None => false,
        // Actuals can retain source seconds; treating two values in the same
        // minute as equal would silently discard a more precise correction.
        Some(cur) => chrono::DateTime::parse_from_rfc3339(cur).ok()
            == chrono::DateTime::parse_from_rfc3339(incoming).ok(),
    }
}

fn clear_boundary(
    tx: &Transaction<'_>,
    action_id: &str,
    side: &str,
    current: &ActionActualProjection,
) -> DomainResult<()> {
    let now = utc_now();
    if current.interval_id.is_some() {
        let interval_id = current.interval_id.clone().unwrap();
        tx.execute(
            "UPDATE productivity_interval SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE id = ?2",
            params![now, interval_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    let (pending_start, pending_end, block_start, block_end) = match side {
        "start" => (
            None,
            current.pending_end_at_utc.clone().or(current.end_at_utc.clone()),
            1,
            0,
        ),
        "end" => (
            current.pending_start_at_utc.clone().or(current.start_at_utc.clone()),
            None,
            0,
            1,
        ),
        _ => return Err(DomainError::invalid_patch("invalid side")),
    };
    let state = load_detail_state(tx, action_id)?;
    upsert_detail_row(
        tx,
        action_id,
        None,
        pending_start,
        pending_end,
        block_start,
        block_end,
        state.start_origin,
        state.end_origin,
        state.start_source_ref,
        state.end_source_ref,
    )?;
    Ok(())
}

fn upsert_pending(
    tx: &Transaction<'_>,
    action_id: &str,
    start: Option<String>,
    end: Option<String>,
    current: &ActionActualProjection,
    touched_side: Option<&str>,
    side_write: ActualSideWrite,
) -> DomainResult<()> {
    // A one-sided correction to a closed Interval must carry its untouched
    // counterpart forward; otherwise switching to pending detail hides it.
    let pending_start = start
        .or_else(|| current.pending_start_at_utc.clone())
        .or_else(|| current.start_at_utc.clone());
    let pending_end = end
        .or_else(|| current.pending_end_at_utc.clone())
        .or_else(|| current.end_at_utc.clone());
    let state = load_detail_state(tx, action_id)?;
    let (start_origin, start_ref, end_origin, end_ref) = merge_provenance(&state, touched_side, &side_write);
    if let (Some(s), Some(e)) = (&pending_start, &pending_end) {
        let sdt = chrono::DateTime::parse_from_rfc3339(s).map_err(|_| DomainError::actual_invalid("invalid start"))?;
        let edt = chrono::DateTime::parse_from_rfc3339(e).map_err(|_| DomainError::actual_invalid("invalid end"))?;
        if sdt >= edt {
            return Err(DomainError::actual_invalid("start must be before end"));
        }
        materialize_interval(
            tx,
            action_id,
            s,
            e,
            current.interval_id.as_deref(),
            start_origin,
            end_origin,
            start_ref,
            end_ref,
        )?;
        return Ok(());
    }
    upsert_detail_row(
        tx,
        action_id,
        current.interval_id.clone(),
        pending_start,
        pending_end,
        0,
        0,
        start_origin,
        end_origin,
        start_ref,
        end_ref,
    )?;
    Ok(())
}

fn merge_provenance(
    state: &DetailState,
    touched_side: Option<&str>,
    write: &ActualSideWrite,
) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let mut start_origin = state.start_origin.clone();
    let mut start_ref = state.start_source_ref.clone();
    let mut end_origin = state.end_origin.clone();
    let mut end_ref = state.end_source_ref.clone();
    if touched_side == Some("start") {
        start_origin = write.origin.clone();
        start_ref = write.source_ref.clone();
    }
    if touched_side == Some("end") {
        end_origin = write.origin.clone();
        end_ref = write.source_ref.clone();
    }
    (start_origin, start_ref, end_origin, end_ref)
}

struct DetailState {
    start_origin: Option<String>,
    end_origin: Option<String>,
    start_source_ref: Option<String>,
    end_source_ref: Option<String>,
}

fn load_detail_state(tx: &Transaction<'_>, action_id: &str) -> DomainResult<DetailState> {
    let row = tx
        .query_row(
            "SELECT start_origin, end_origin, start_source_ref, end_source_ref
             FROM productivity_action_travel_actual_v2 WHERE action_id = ?1 AND deleted_at_utc IS NULL",
            [action_id],
            |row| {
                Ok(DetailState {
                    start_origin: row.get(0)?,
                    end_origin: row.get(1)?,
                    start_source_ref: row.get(2)?,
                    end_source_ref: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(row.unwrap_or(DetailState {
        start_origin: None,
        end_origin: None,
        start_source_ref: None,
        end_source_ref: None,
    }))
}

fn materialize_interval(
    tx: &Transaction<'_>,
    action_id: &str,
    start: &str,
    end: &str,
    existing_interval: Option<&str>,
    start_origin: Option<String>,
    end_origin: Option<String>,
    start_source_ref: Option<String>,
    end_source_ref: Option<String>,
) -> DomainResult<()> {
    let now = utc_now();
    let interval_id = existing_interval
        .map(|s| s.to_string())
        .unwrap_or_else(new_uuid);
    let exists = tx
        .query_row(
            "SELECT COUNT(*) FROM productivity_interval WHERE id = ?1",
            [&interval_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if exists == 0 {
        tx.execute(
            "INSERT INTO productivity_interval (id, action_id, started_at, ended_at, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![interval_id, action_id, start, end, now],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    } else {
        tx.execute(
            "UPDATE productivity_interval SET started_at = ?1, ended_at = ?2, deleted_at_utc = NULL, updated_at_utc = ?3 WHERE id = ?4",
            params![start, end, now, interval_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    upsert_detail_row(
        tx,
        action_id,
        Some(interval_id),
        None,
        None,
        0,
        0,
        start_origin,
        end_origin,
        start_source_ref,
        end_source_ref,
    )?;
    Ok(())
}

fn upsert_detail_row(
    tx: &Transaction<'_>,
    action_id: &str,
    interval_id: Option<String>,
    pending_start: Option<String>,
    pending_end: Option<String>,
    block_start: i64,
    block_end: i64,
    start_origin: Option<String>,
    end_origin: Option<String>,
    start_source_ref: Option<String>,
    end_source_ref: Option<String>,
) -> DomainResult<()> {
    let now = utc_now();
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM productivity_action_travel_actual_v2 WHERE action_id = ?1)",
            [action_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if exists {
        tx.execute(
            "UPDATE productivity_action_travel_actual_v2 SET interval_id = ?1, pending_start_at_utc = ?2, pending_end_at_utc = ?3,
             start_origin = ?4, end_origin = ?5, start_source_ref = ?6, end_source_ref = ?7,
             start_auto_fill_block = ?8, end_auto_fill_block = ?9, updated_at_utc = ?10 WHERE action_id = ?11",
            params![
                interval_id,
                pending_start,
                pending_end,
                start_origin,
                end_origin,
                start_source_ref,
                end_source_ref,
                block_start,
                block_end,
                now,
                action_id
            ],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    } else {
        tx.execute(
            "INSERT INTO productivity_action_travel_actual_v2
             (action_id, schema_version, interval_id, pending_start_at_utc, pending_end_at_utc,
              start_origin, end_origin, start_source_ref, end_source_ref,
              start_auto_fill_block, end_auto_fill_block, created_at_utc, updated_at_utc)
             VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                action_id,
                interval_id,
                pending_start,
                pending_end,
                start_origin,
                end_origin,
                start_source_ref,
                end_source_ref,
                block_start,
                block_end,
                now
            ],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    Ok(())
}
