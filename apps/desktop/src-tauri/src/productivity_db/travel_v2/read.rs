use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::Value;

use super::model::*;
use super::point_transfer::build_canonical_points;
use super::validation::{compute_capabilities, validate_trip_plan};
use super::super::checkpoint;
use super::super::error::{DomainError, DomainResult};
use super::super::types::RevisionRef;

fn flight_action_ids(actions: &[TripActionView], transportations: &[TransportationDto]) -> std::collections::HashSet<String> {
    let flight_transport_ids: std::collections::HashSet<&str> = transportations
        .iter()
        .filter(|t| t.transportation_type.as_deref() == Some("flight"))
        .map(|t| t.id.as_str())
        .collect();
    actions
        .iter()
        .filter(|action| action.transportation_id.as_deref().is_some_and(|id| flight_transport_ids.contains(id)))
        .map(|action| action.id.clone())
        .collect()
}

pub fn load_trip_snapshot(tx: &Transaction<'_>, item_id: &str) -> DomainResult<TripSnapshot> {
    let profile_exists = super::guards::item_has_v2_profile(tx, item_id)?;
    if !profile_exists {
        return Err(DomainError::root_not_found("travel v2 profile not found"));
    }
    let (title, revision, status, list_id): (String, i64, String, Option<String>) = tx
        .query_row(
            "SELECT title, revision, status, list_id FROM productivity_item WHERE id = ?1 AND deleted_at_utc IS NULL",
            [item_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| DomainError::root_not_found("item not found"))?;
    let cancelled_at: Option<String> = tx
        .query_row(
            "SELECT cancelled_at_utc FROM productivity_item_travel_profile WHERE item_id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let schema_version: i64 = tx
        .query_row(
            "SELECT schema_version FROM productivity_item_travel_profile WHERE item_id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if schema_version > SUPPORTED_PROFILE_SCHEMA {
        return Err(DomainError::unknown_format_readonly("travel profile schema is newer than supported"));
    }
    let completed = status == "完成";
    let cancelled = cancelled_at.is_some();
    let actions = load_actions(tx, item_id)?;
    let checkpoints = load_checkpoints(tx, item_id)?;
    let transportations = load_transportations(tx, item_id)?;
    let points = load_points(tx, item_id)?;
    validate_trip_plan(&actions, &checkpoints)?;
    let flight_action_ids = flight_action_ids(&actions, &transportations);
    let canonical_points = build_canonical_points(&actions, &checkpoints, &points, &flight_action_ids)?;
    let segments = actions
        .iter()
        .map(|a| TripSegmentDto {
            action_id: a.id.clone(),
            transportation_id: a.transportation_id.clone(),
            transportation_type: a.transportation_id.as_ref().and_then(|id| {
                transportations
                    .iter()
                    .find(|t| t.id == *id)
                    .and_then(|t| t.transportation_type.clone())
            }),
            planned_start_at: a.planned_start_at.clone(),
            planned_end_at: a.planned_end_at.clone(),
        })
        .collect();
    let member_refs = TripMemberRefs {
        actions: actions
            .iter()
            .map(|a| RevisionRef {
                id: a.id.clone(),
                expected_revision: a.revision,
            })
            .collect(),
        checkpoints: checkpoints
            .iter()
            .map(|c| RevisionRef {
                id: c.id.clone(),
                expected_revision: c.revision,
            })
            .collect(),
    };
    let capabilities = compute_capabilities(completed, cancelled, &actions, &checkpoints, &canonical_points);
    Ok(TripSnapshot {
        item: TripItemView {
            id: item_id.to_string(),
            revision,
            title,
            completed,
            list_id,
            cancelled,
        },
        profile: TravelProfileView {
            schema_version,
            cancelled_at_utc: cancelled_at,
        },
        actions,
        checkpoints,
        transportations,
        points,
        canonical_points,
        segments,
        member_refs,
        capabilities,
    })
}

fn load_actions(tx: &Transaction<'_>, item_id: &str) -> DomainResult<Vec<TripActionView>> {
    let mut stmt = tx
        .prepare(
            "SELECT id, revision, transportation_id, planned_start_at, planned_end_at, ended
             FROM productivity_action
             WHERE target_kind = 'item' AND target_id = ?1 AND deleted_at_utc IS NULL
             ORDER BY planned_start_at, id",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([item_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)? != 0,
            ))
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, revision, transportation_id, start, end, ended) =
            row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let actual = load_action_actual(tx, &id)?;
        out.push(TripActionView {
            id,
            revision,
            transportation_id,
            planned_start_at: start,
            planned_end_at: end,
            ended,
            actual,
        });
    }
    Ok(out)
}

pub(crate) fn load_action_actual(tx: &Transaction<'_>, action_id: &str) -> DomainResult<ActionActualProjection> {
    let row = tx
        .query_row(
            "SELECT interval_id, pending_start_at_utc, pending_end_at_utc FROM productivity_action_travel_actual_v2 WHERE action_id = ?1 AND deleted_at_utc IS NULL",
            [action_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if let Some((Some(interval_id), None, None)) = row {
        let (start, end): (String, Option<String>) = tx
            .query_row(
                "SELECT started_at, ended_at FROM productivity_interval WHERE id = ?1 AND deleted_at_utc IS NULL",
                [&interval_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        return Ok(ActionActualProjection {
            interval_id: Some(interval_id),
            start_at_utc: Some(start),
            end_at_utc: end,
            pending_start_at_utc: None,
            pending_end_at_utc: None,
        });
    }
    if let Some((interval_id, pending_start, pending_end)) = row {
        return Ok(ActionActualProjection {
            interval_id,
            start_at_utc: None,
            end_at_utc: None,
            pending_start_at_utc: pending_start,
            pending_end_at_utc: pending_end,
        });
    }
    Ok(ActionActualProjection {
        interval_id: None,
        start_at_utc: None,
        end_at_utc: None,
        pending_start_at_utc: None,
        pending_end_at_utc: None,
    })
}

fn load_checkpoints(tx: &Transaction<'_>, item_id: &str) -> DomainResult<Vec<super::super::types::CheckpointSnapshot>> {
    let mut stmt = tx
        .prepare(
            "SELECT id FROM productivity_checkpoint WHERE target_kind = 'item' AND target_id = ?1 AND deleted_at_utc IS NULL ORDER BY planned_at_utc, id",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let ids = stmt
        .query_map([item_id], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for id in ids {
        let id = id.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        out.push(checkpoint::snapshot(tx, &id, false)?);
    }
    Ok(out)
}

fn load_transportations(tx: &Transaction<'_>, item_id: &str) -> DomainResult<Vec<TransportationDto>> {
    let mut stmt = tx
        .prepare(
            "SELECT id, schema_version, transportation_type, name, note, service_number, operator, vehicle_model,
                    aircraft_registration, license_plate, carriage, seat, departure_name, arrival_name,
                    departure_code, arrival_code, departure_terminal, arrival_terminal, departure_gate, arrival_gate,
                    source_snapshot_json
             FROM productivity_transportation WHERE item_id = ?1 AND deleted_at_utc IS NULL",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([item_id], |row| {
            let raw: Option<String> = row.get(20)?;
            let source_snapshot = raw
                .filter(|s| !s.trim().is_empty())
                .and_then(|s| serde_json::from_str::<Value>(&s).ok());
            Ok(TransportationDto {
                id: row.get(0)?,
                item_id: item_id.to_string(),
                schema_version: row.get(1)?,
                transportation_type: row.get(2)?,
                name: row.get(3)?,
                note: row.get(4)?,
                service_number: row.get(5)?,
                operator: row.get(6)?,
                vehicle_model: row.get(7)?,
                aircraft_registration: row.get(8)?,
                license_plate: row.get(9)?,
                carriage: row.get(10)?,
                seat: row.get(11)?,
                departure_name: row.get(12)?,
                arrival_name: row.get(13)?,
                departure_code: row.get(14)?,
                arrival_code: row.get(15)?,
                departure_terminal: row.get(16)?,
                arrival_terminal: row.get(17)?,
                departure_gate: row.get(18)?,
                arrival_gate: row.get(19)?,
                source_snapshot,
            })
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        let dto = row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if dto.schema_version > SUPPORTED_MEMBER_SCHEMA {
            return Err(DomainError::unknown_format_readonly("transportation schema is newer than supported"));
        }
        out.push(dto);
    }
    Ok(out)
}

fn load_points(tx: &Transaction<'_>, item_id: &str) -> DomainResult<Vec<TravelPointDto>> {
    let mut stmt = tx
        .prepare(
            "SELECT id, attachment_kind, role, action_id, checkpoint_id, action_label, location, note, origin_checkpoint_id
             FROM productivity_item_travel_point WHERE item_id = ?1 AND deleted_at_utc IS NULL",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([item_id], |row| {
            Ok(TravelPointDto {
                id: row.get(0)?,
                attachment_kind: row.get(1)?,
                role: row.get(2)?,
                action_id: row.get(3)?,
                checkpoint_id: row.get(4)?,
                action_label: row.get(5)?,
                location: row.get(6)?,
                note: row.get(7)?,
                origin_checkpoint_id: row.get(8)?,
            })
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
    }
    Ok(out)
}

/// Post-mutation snapshot: live trips use the normal loader; soft-deleted items return an empty member projection.
pub fn load_trip_write_result_snapshot(tx: &Transaction<'_>, item_id: &str) -> DomainResult<TripSnapshot> {
    let deleted_at: Option<String> = tx
        .query_row(
            "SELECT deleted_at_utc FROM productivity_item WHERE id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
        .flatten();
    if deleted_at.is_some() {
        let (title, revision, status, list_id): (String, i64, String, Option<String>) = tx
            .query_row(
                "SELECT title, revision, status, list_id FROM productivity_item WHERE id = ?1",
                [item_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|_| DomainError::root_not_found("item not found"))?;
        let cancelled_at: Option<String> = tx
            .query_row(
                "SELECT cancelled_at_utc FROM productivity_item_travel_profile WHERE item_id = ?1",
                [item_id],
                |row| row.get(0),
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let completed = status == "完成";
        let cancelled = cancelled_at.is_some();
        return Ok(TripSnapshot {
            item: TripItemView {
                id: item_id.to_string(),
                revision,
                title,
                completed,
                list_id,
                cancelled,
            },
            profile: TravelProfileView {
                schema_version: SUPPORTED_PROFILE_SCHEMA,
                cancelled_at_utc: cancelled_at,
            },
            actions: vec![],
            checkpoints: vec![],
            transportations: vec![],
            points: vec![],
            canonical_points: vec![],
            segments: vec![],
            member_refs: TripMemberRefs {
                actions: vec![],
                checkpoints: vec![],
            },
            capabilities: compute_capabilities(completed, cancelled, &[], &[], &[]),
        });
    }
    load_trip_snapshot(tx, item_id)
}

pub fn get_trip(data_dir: &str, req: TravelV2GetRequest) -> DomainResult<TravelV2GetResponse> {
    super::super::coordinator::with_strict_read(&req.expected_data_dir, |conn| {
        let Some(conn) = conn else {
            return Ok(TravelV2GetResponse {
                status: "legacy_or_not_travel".into(),
                snapshot: None,
            });
        };
        super::super::coordinator::in_transaction(conn, |tx| {
            if !super::guards::item_has_v2_profile(tx, &req.item_id)? {
                return Ok(TravelV2GetResponse {
                    status: "legacy_or_not_travel".into(),
                    snapshot: None,
                });
            }
            let snapshot = load_trip_snapshot(tx, &req.item_id)?;
            Ok(TravelV2GetResponse {
                status: "ok".into(),
                snapshot: Some(snapshot),
            })
        })
    })
}

pub fn list_week(data_dir: &str, req: TravelV2ListWeekRequest) -> DomainResult<TravelV2ListWeekResponse> {
    let _ = data_dir;
    super::super::coordinator::with_strict_read(&req.expected_data_dir, |conn| {
        let Some(conn) = conn else {
            return Ok(TravelV2ListWeekResponse { items: vec![] });
        };
        super::super::coordinator::in_transaction(conn, |tx| {
            let mut stmt = tx
                .prepare(
                    "SELECT DISTINCT i.id, i.revision
                     FROM productivity_item i
                     JOIN productivity_item_travel_profile p ON p.item_id = i.id AND p.deleted_at_utc IS NULL
                     WHERE i.deleted_at_utc IS NULL AND p.cancelled_at_utc IS NULL
                     AND (
                       (i.status != '完成' AND (
                         EXISTS (
                           SELECT 1 FROM productivity_action a
                           WHERE a.target_kind='item' AND a.target_id=i.id AND a.deleted_at_utc IS NULL
                           AND a.planned_end_at >= ?1 AND a.planned_start_at <= ?2
                         )
                         OR EXISTS (
                           SELECT 1 FROM productivity_checkpoint c
                           WHERE c.target_kind='item' AND c.target_id=i.id AND c.deleted_at_utc IS NULL
                           AND c.planned_at_utc >= ?1 AND c.planned_at_utc <= ?2
                         )
                         OR EXISTS (
                           SELECT MIN(planned_at) FROM (
                             SELECT a.planned_start_at AS planned_at FROM productivity_action a
                             WHERE a.target_kind='item' AND a.target_id=i.id AND a.deleted_at_utc IS NULL
                             UNION ALL
                             SELECT a.planned_end_at FROM productivity_action a
                             WHERE a.target_kind='item' AND a.target_id=i.id AND a.deleted_at_utc IS NULL
                             UNION ALL
                             SELECT c.planned_at_utc FROM productivity_checkpoint c
                             WHERE c.target_kind='item' AND c.target_id=i.id AND c.deleted_at_utc IS NULL
                           )
                           HAVING MIN(planned_at) <= ?2 AND MAX(planned_at) >= ?1
                         )
                       ))
                       OR (i.status = '完成' AND (
                         EXISTS (
                           SELECT 1
                           FROM productivity_action a
                           JOIN productivity_action_travel_actual_v2 d
                             ON d.action_id=a.id AND d.deleted_at_utc IS NULL
                           LEFT JOIN productivity_interval iv
                             ON iv.id=d.interval_id AND iv.action_id=a.id AND iv.deleted_at_utc IS NULL
                           WHERE a.target_kind='item' AND a.target_id=i.id AND a.deleted_at_utc IS NULL
                           AND (
                             (d.pending_start_at_utc IS NOT NULL AND d.pending_start_at_utc >= ?1 AND d.pending_start_at_utc <= ?2)
                             OR (d.pending_end_at_utc IS NOT NULL AND d.pending_end_at_utc >= ?1 AND d.pending_end_at_utc <= ?2)
                             OR (iv.started_at IS NOT NULL AND iv.started_at >= ?1 AND iv.started_at <= ?2)
                             OR (iv.ended_at IS NOT NULL AND iv.ended_at >= ?1 AND iv.ended_at <= ?2)
                             OR (iv.started_at IS NOT NULL AND iv.ended_at IS NOT NULL AND iv.started_at <= ?2 AND iv.ended_at >= ?1)
                           )
                         )
                         OR EXISTS (
                           SELECT 1 FROM productivity_checkpoint c
                           WHERE c.target_kind='item' AND c.target_id=i.id AND c.deleted_at_utc IS NULL
                           AND c.actual_at_utc IS NOT NULL AND c.actual_at_utc >= ?1 AND c.actual_at_utc <= ?2
                         )
                       ))
                     )",
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let rows = stmt
                .query_map(params![req.from_utc, req.to_utc], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let mut items = Vec::new();
            for row in rows {
                let (item_id, revision) = row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                let snapshot = load_trip_snapshot(tx, &item_id)?;
                items.push(TravelV2WeekItemEntry {
                    item_id: item_id.clone(),
                    item_ref: RevisionRef {
                        id: item_id,
                        expected_revision: revision,
                    },
                    title: snapshot.item.title.clone(),
                    canonical_points: snapshot.canonical_points.clone(),
                    segments: snapshot.segments.clone(),
                    snapshot,
                });
            }
            Ok(TravelV2ListWeekResponse { items })
        })
    })
}

pub fn list_items(_data_dir: &str, req: TravelV2ListItemsRequest) -> DomainResult<TravelV2ListItemsResponse> {
    let limit = req.limit.unwrap_or(50).min(100) as i64;
    super::super::coordinator::with_strict_read(&req.expected_data_dir, |conn| {
        let Some(conn) = conn else {
            return Ok(TravelV2ListItemsResponse {
                items: vec![],
                next_cursor: None,
            });
        };
        super::super::coordinator::in_transaction(conn, |tx| {
            let list_filter = match req.scope.kind.as_str() {
                "unlisted" => " AND i.list_id IS NULL",
                "list" => " AND i.list_id = ?1",
                _ => "",
            };
            let status_filter = match req.status.as_str() {
                "active" => " AND p.cancelled_at_utc IS NULL AND i.status != '完成'",
                "completed" => " AND i.status = '完成' AND p.cancelled_at_utc IS NULL",
                "cancelled" => " AND p.cancelled_at_utc IS NOT NULL",
                _ => "",
            };
            let list_id = if req.scope.kind == "list" {
                Some(
                    req.scope
                        .list_id
                        .clone()
                        .ok_or_else(|| DomainError::invalid_patch("list scope requires listId"))?,
                )
            } else {
                None
            };
            let limit_clause = if list_id.is_some() { " LIMIT ?2" } else { " LIMIT ?1" };
            let sql = format!(
                "SELECT i.id, i.revision FROM productivity_item i
                 JOIN productivity_item_travel_profile p ON p.item_id = i.id AND p.deleted_at_utc IS NULL
                 WHERE i.deleted_at_utc IS NULL{}{} ORDER BY i.updated_at_utc DESC{}",
                list_filter,
                status_filter,
                limit_clause
            );
            let mut stmt = tx
                .prepare(&sql)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let rows = if let Some(lid) = list_id {
                stmt.query_map(params![lid, limit], map_list_row)
            } else {
                stmt.query_map(params![limit], map_list_row)
            }
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let mut items = Vec::new();
            for row in rows {
                items.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
            }
            Ok(TravelV2ListItemsResponse {
                items,
                next_cursor: None,
            })
        })
    })
}

fn map_list_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TravelV2WeekItemRef> {
    let id: String = row.get(0)?;
    Ok(TravelV2WeekItemRef {
        item_id: id.clone(),
        item_ref: RevisionRef {
            id,
            expected_revision: row.get(1)?,
        },
    })
}
