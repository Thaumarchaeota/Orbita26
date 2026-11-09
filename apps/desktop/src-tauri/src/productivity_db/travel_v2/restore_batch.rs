use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::Value;

use super::model::*;
use super::read::load_trip_snapshot;
use super::super::error::{DomainError, DomainResult};
use super::super::repository::{bump_action, bump_item, check_members, check_revision};
use super::super::types::RevisionRef;
use super::super::util::utc_now;


pub fn build_trip_delete_manifest(snapshot: &TripSnapshot, after_item_revision: i64) -> Value {
    serde_json::json!({
        "manifestVersion": 1,
        "kind": "trip_delete",
        "afterItemRevision": after_item_revision,
        "afterActionRefs": [],
        "afterCheckpointRefs": [],
        "memberIds": {
            "actions": snapshot.actions.iter().map(|a| a.id.clone()).collect::<Vec<_>>(),
            "checkpoints": snapshot.checkpoints.iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
            "points": snapshot.points.iter().map(|p| p.id.clone()).collect::<Vec<_>>(),
            "transportations": snapshot.transportations.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
        }
    })
}

pub fn apply_restore(
    tx: &Transaction<'_>,
    item_id: &str,
    batch_id: &str,
    envelope_actions: &[RevisionRef],
    envelope_checkpoints: &[RevisionRef],
    item_ref: &RevisionRef,
) -> DomainResult<()> {
    let (kind, manifest_json, restored_at): (String, String, Option<String>) = tx
        .query_row(
            "SELECT kind, manifest_json, restored_at_utc FROM productivity_item_travel_mutation_batch WHERE id = ?1 AND item_id = ?2",
            params![batch_id, item_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| DomainError::restore_conflict("batch not found"))?;
    if restored_at.is_some() {
        return Err(DomainError::restore_conflict("batch already restored"));
    }
    let manifest: Value = serde_json::from_str(&manifest_json)
        .map_err(|_| DomainError::restore_conflict("manifest is not valid json"))?;
    let version = manifest.get("manifestVersion").and_then(Value::as_i64).unwrap_or(0);
    if version != 1 {
        return Err(DomainError::restore_conflict("unsupported manifest version"));
    }
    let after_item_revision = manifest
        .get("afterItemRevision")
        .and_then(Value::as_i64)
        .ok_or_else(|| DomainError::restore_conflict("manifest missing afterItemRevision"))?;
    check_revision(item_ref.expected_revision, after_item_revision)?;

    let after_actions = refs_from_manifest(&manifest, "afterActionRefs");
    let after_checkpoints = refs_from_manifest(&manifest, "afterCheckpointRefs");
    check_members(&after_actions, envelope_actions)?;
    check_members(&after_checkpoints, envelope_checkpoints)?;

    let now = utc_now();
    match kind.as_str() {
        "stage_delete" => restore_stage_delete(tx, item_id, &manifest, &now)?,
        "trip_delete" => restore_trip_delete(tx, item_id, &manifest, &now)?,
        _ => return Err(DomainError::restore_conflict("unsupported batch kind")),
    }
    tx.execute(
        "UPDATE productivity_item_travel_mutation_batch SET restored_at_utc = ?1, updated_at_utc = ?1 WHERE id = ?2",
        params![now, batch_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    bump_item(tx, item_id, &now)?;
    Ok(())
}

fn refs_from_manifest(manifest: &Value, key: &str) -> Vec<RevisionRef> {
    manifest
        .get(key)
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| {
                    let id = entry.get("id").and_then(Value::as_str)?;
                    let revision = entry.get("expectedRevision").and_then(Value::as_i64)?;
                    Some(RevisionRef {
                        id: id.to_string(),
                        expected_revision: revision,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn restore_stage_delete(tx: &Transaction<'_>, item_id: &str, manifest: &Value, now: &str) -> DomainResult<()> {
    let action_id = manifest
        .get("actionId")
        .and_then(Value::as_str)
        .ok_or_else(|| DomainError::restore_conflict("manifest missing actionId"))?;
    let deleted: Option<String> = tx
        .query_row(
            "SELECT deleted_at_utc FROM productivity_action WHERE id = ?1 AND target_id = ?2",
            params![action_id, item_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
        .flatten();
    if deleted.is_none() {
        return Err(DomainError::restore_conflict("action is not deleted"));
    }

    undo_stage_delete_point_transfers(tx, item_id, manifest, now)?;
    undo_stage_delete_reversed_endpoints(tx, item_id, manifest, now)?;

    for id in string_array_field(manifest, "tombstonedPointIds") {
        tx.execute(
            "UPDATE productivity_item_travel_point SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2 AND item_id = ?3",
            params![now, id, item_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    for id in string_array_field(manifest, "tombstonedTransportationIds") {
        tx.execute(
            "UPDATE productivity_transportation SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2 AND item_id = ?3",
            params![now, id, item_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }

    tx.execute(
        "UPDATE productivity_action SET deleted_at_utc = NULL, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2",
        params![now, action_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    bump_action(tx, action_id, now)?;
    restore_points_for_action(tx, action_id, now)?;

    for id in string_array_field(manifest, "createdCheckpointIds") {
        tx.execute(
            "UPDATE productivity_checkpoint SET deleted_at_utc = ?1, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2 AND target_id = ?3",
            params![now, id, item_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    for id in string_array_field(manifest, "restoredCheckpointIds") {
        tx.execute(
            "UPDATE productivity_checkpoint SET deleted_at_utc = ?1, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2 AND target_id = ?3",
            params![now, id, item_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    Ok(())
}

fn string_array_field(manifest: &Value, key: &str) -> Vec<String> {
    manifest
        .get(key)
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

fn undo_stage_delete_point_transfers(tx: &Transaction<'_>, item_id: &str, manifest: &Value, now: &str) -> DomainResult<()> {
    let entries = manifest.get("pointTransfers").and_then(Value::as_array);
    for entry in entries.into_iter().flatten() {
        let target_id = entry
            .get("targetPointId")
            .and_then(Value::as_str)
            .ok_or_else(|| DomainError::restore_conflict("point transfer missing targetPointId"))?;
        tx.execute(
            "UPDATE productivity_item_travel_point SET attachment_kind = ?1, action_id = ?2, role = ?3, checkpoint_id = ?4,
             action_label = ?5, location = ?6, note = ?7, updated_at_utc = ?8 WHERE id = ?9 AND item_id = ?10",
            params![
                entry.get("beforeTargetAttachmentKind").and_then(Value::as_str).unwrap_or("action"),
                entry.get("beforeTargetActionId").and_then(Value::as_str),
                entry.get("beforeTargetRole").and_then(Value::as_str),
                entry.get("beforeTargetCheckpointId").and_then(Value::as_str),
                entry.get("beforeTargetActionLabel").and_then(Value::as_str),
                entry.get("beforeTargetLocation").and_then(Value::as_str),
                entry.get("beforeTargetNote").and_then(Value::as_str),
                now,
                target_id,
                item_id,
            ],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if let Some(source_id) = entry.get("tombstonedPointId").and_then(Value::as_str) {
            tx.execute(
                "UPDATE productivity_item_travel_point SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2 AND item_id = ?3",
                params![now, source_id, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        }
        if let Some(cp_id) = entry.get("checkpointId").and_then(Value::as_str) {
            let title = entry.get("beforeCheckpointTitle").and_then(Value::as_str);
            let description = entry.get("beforeCheckpointDescription").and_then(Value::as_str);
            if title.is_some() || description.is_some() {
                tx.execute(
                    "UPDATE productivity_checkpoint SET title = COALESCE(?1, title), description = ?2, updated_at_utc = ?3, revision = revision + 1
                     WHERE id = ?4 AND target_id = ?5",
                    params![title, description, now, cp_id, item_id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
        }
    }
    Ok(())
}

fn undo_stage_delete_reversed_endpoints(tx: &Transaction<'_>, item_id: &str, manifest: &Value, now: &str) -> DomainResult<()> {
    let entries = manifest.get("reversedEndpoints").and_then(Value::as_array);
    for entry in entries.into_iter().flatten() {
        let point_id = entry
            .get("pointId")
            .and_then(Value::as_str)
            .ok_or_else(|| DomainError::restore_conflict("reversed endpoint missing pointId"))?;
        tx.execute(
            "UPDATE productivity_item_travel_point SET attachment_kind = ?1, action_id = ?2, role = ?3, checkpoint_id = NULL,
             action_label = ?4, location = ?5, note = ?6, origin_checkpoint_id = ?7, updated_at_utc = ?8
             WHERE id = ?9 AND item_id = ?10",
            params![
                entry.get("beforeAttachmentKind").and_then(Value::as_str).unwrap_or("action"),
                entry.get("beforeActionId").and_then(Value::as_str),
                entry.get("beforeRole").and_then(Value::as_str),
                entry.get("beforeActionLabel").and_then(Value::as_str),
                entry.get("beforeLocation").and_then(Value::as_str),
                entry.get("beforeNote").and_then(Value::as_str),
                entry.get("beforeOriginCheckpointId").and_then(Value::as_str),
                now,
                point_id,
                item_id,
            ],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    Ok(())
}

fn restore_points_for_action(tx: &Transaction<'_>, action_id: &str, now: &str) -> DomainResult<()> {
    tx.execute(
        "UPDATE productivity_item_travel_point SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE action_id = ?2",
        params![now, action_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

fn restore_trip_delete(tx: &Transaction<'_>, item_id: &str, manifest: &Value, now: &str) -> DomainResult<()> {
    let item_deleted: Option<String> = tx
        .query_row(
            "SELECT deleted_at_utc FROM productivity_item WHERE id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
        .flatten();
    if item_deleted.is_none() {
        return Err(DomainError::restore_conflict("trip is not deleted"));
    }
    let member_ids = manifest
        .get("memberIds")
        .ok_or_else(|| DomainError::restore_conflict("manifest missing memberIds"))?;
    for key in ["actions", "checkpoints", "points", "transportations"] {
        let ids = member_ids
            .get(key)
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect::<Vec<_>>())
            .unwrap_or_default();
        for id in ids {
            restore_member(tx, key, &id, item_id, now)?;
        }
    }
    tx.execute(
        "UPDATE productivity_item SET deleted_at_utc = NULL, deletion_batch_id = NULL, updated_at_utc = ?1 WHERE id = ?2",
        params![now, item_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

fn restore_member(tx: &Transaction<'_>, kind: &str, id: &str, item_id: &str, now: &str) -> DomainResult<()> {
    match kind {
        "actions" => {
            tx.execute(
                "UPDATE productivity_action SET deleted_at_utc = NULL, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2 AND target_id = ?3",
                params![now, id, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        }
        "checkpoints" => {
            tx.execute(
                "UPDATE productivity_checkpoint SET deleted_at_utc = NULL, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2 AND target_id = ?3",
                params![now, id, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        }
        "points" => {
            tx.execute(
                "UPDATE productivity_item_travel_point SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2 AND item_id = ?3",
                params![now, id, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        }
        "transportations" => {
            tx.execute(
                "UPDATE productivity_transportation SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2 AND item_id = ?3",
                params![now, id, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        }
        _ => {}
    }
    Ok(())
}

pub fn load_membership_for_restore(tx: &Transaction<'_>, item_id: &str) -> DomainResult<(i64, Vec<RevisionRef>, Vec<RevisionRef>)> {
    let revision: i64 = tx
        .query_row(
            "SELECT revision FROM productivity_item WHERE id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .map_err(|_| DomainError::root_not_found("item not found"))?;
    let deleted: Option<String> = tx
        .query_row(
            "SELECT deleted_at_utc FROM productivity_item WHERE id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if deleted.is_none() {
        let snapshot = load_trip_snapshot(tx, item_id)?;
        return Ok((revision, snapshot.member_refs.actions, snapshot.member_refs.checkpoints));
    }
    Ok((revision, vec![], vec![]))
}
