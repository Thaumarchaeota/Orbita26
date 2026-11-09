use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::{json, Value};

use super::model::*;
use super::point_transfer::{pick_canonical_user, remaining_users_at_minute, MinuteUser};
use super::validation::{action_frozen, checkpoint_frozen};
use super::super::error::{DomainError, DomainResult};
use super::super::repository::bump_action;
use super::super::types::CheckpointSnapshot;
use super::super::util::{new_uuid, utc_now};

#[derive(Debug, Clone, Default)]
pub struct StageDeleteEffects {
    pub tombstoned_point_ids: Vec<String>,
    pub tombstoned_transportation_ids: Vec<String>,
    pub created_checkpoint_ids: Vec<String>,
    pub restored_checkpoint_ids: Vec<String>,
    pub reversed_endpoints: Vec<ReversedEndpointRecord>,
    pub point_transfers: Vec<PointTransferRecord>,
}

#[derive(Debug, Clone)]
pub struct ReversedEndpointRecord {
    pub point_id: String,
    pub checkpoint_id: String,
    pub created_checkpoint: bool,
    pub before_attachment_kind: String,
    pub before_action_id: String,
    pub before_role: String,
    pub before_action_label: Option<String>,
    pub before_location: Option<String>,
    pub before_note: Option<String>,
    pub before_origin_checkpoint_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PointTransferRecord {
    pub target_point_id: String,
    pub tombstoned_point_id: Option<String>,
    pub before_target_action_id: Option<String>,
    pub before_target_role: Option<String>,
    pub before_target_checkpoint_id: Option<String>,
    pub before_target_attachment_kind: String,
    pub before_target_action_label: Option<String>,
    pub before_target_location: Option<String>,
    pub before_target_note: Option<String>,
    pub checkpoint_id: Option<String>,
    pub before_checkpoint_title: Option<String>,
    pub before_checkpoint_description: Option<String>,
}

pub fn apply_stage_delete(
    tx: &Transaction<'_>,
    item_id: &str,
    payload: &DeleteStagePayload,
    snapshot: &TripSnapshot,
) -> DomainResult<StageDeleteEffects> {
    if !snapshot.capabilities.can_edit_structure {
        return Err(DomainError::protected_structure("structure is frozen"));
    }
    let action = snapshot
        .actions
        .iter()
        .find(|a| a.id == payload.action_id)
        .ok_or_else(|| DomainError::root_not_found("action not found"))?;
    if action_frozen(action, snapshot.item.completed, snapshot.item.cancelled) {
        return Err(DomainError::protected_structure("action is frozen"));
    }

    let now = utc_now();
    let mut effects = StageDeleteEffects::default();
    let transportation_id = action.transportation_id.clone();

    handle_endpoint(
        tx,
        item_id,
        snapshot,
        &payload.action_id,
        "start",
        &action.planned_start_at,
        payload.delete_start_point,
        &now,
        &mut effects,
    )?;
    handle_endpoint(
        tx,
        item_id,
        snapshot,
        &payload.action_id,
        "end",
        &action.planned_end_at,
        payload.delete_end_point,
        &now,
        &mut effects,
    )?;

    tx.execute(
        "UPDATE productivity_item_travel_point SET deleted_at_utc = ?1, updated_at_utc = ?1
         WHERE item_id = ?2 AND action_id = ?3 AND deleted_at_utc IS NULL",
        params![now, item_id, payload.action_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;

    tx.execute(
        "UPDATE productivity_action SET deleted_at_utc = ?1, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2",
        params![now, payload.action_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    bump_action(tx, &payload.action_id, &now)?;

    if let Some(tid) = transportation_id {
        let remaining: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM productivity_action
                 WHERE transportation_id = ?1 AND deleted_at_utc IS NULL AND id != ?2",
                params![tid, payload.action_id],
                |row| row.get(0),
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if remaining == 0 {
            tx.execute(
                "UPDATE productivity_transportation SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE id = ?2 AND item_id = ?3",
                params![now, tid, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            effects.tombstoned_transportation_ids.push(tid);
        }
    }

    Ok(effects)
}

fn handle_endpoint(
    tx: &Transaction<'_>,
    item_id: &str,
    snapshot: &TripSnapshot,
    action_id: &str,
    role: &str,
    minute: &str,
    delete_point_flag: bool,
    now: &str,
    effects: &mut StageDeleteEffects,
) -> DomainResult<()> {
    let endpoint_point = snapshot
        .points
        .iter()
        .find(|p| p.action_id.as_deref() == Some(action_id) && p.role == role);
    let Some(endpoint_point) = endpoint_point else {
        return Ok(());
    };

    let remaining = remaining_users_at_minute(minute, action_id, &snapshot.actions, &snapshot.checkpoints);
    if !remaining.is_empty() {
        let owner = pick_canonical_user(&remaining)
            .ok_or_else(|| DomainError::invalid_plan("canonical owner missing for shared minute"))?;
        transfer_to_canonical_owner(
            tx,
            item_id,
            snapshot,
            endpoint_point,
            &owner,
            now,
            effects,
        )?;
        return Ok(());
    }

    if delete_point_flag {
        tombstone_point(tx, &endpoint_point.id, now)?;
        effects.tombstoned_point_ids.push(endpoint_point.id.clone());
        return Ok(());
    }

    reverse_endpoint_to_checkpoint(tx, item_id, snapshot, endpoint_point, minute, now, effects)?;
    Ok(())
}

fn transfer_to_canonical_owner(
    tx: &Transaction<'_>,
    item_id: &str,
    snapshot: &TripSnapshot,
    source: &TravelPointDto,
    owner: &MinuteUser,
    now: &str,
    effects: &mut StageDeleteEffects,
) -> DomainResult<()> {
    match owner {
        MinuteUser::Checkpoint(cp_id) => {
            let cp = snapshot
                .checkpoints
                .iter()
                .find(|c| c.id == *cp_id)
                .ok_or_else(|| DomainError::root_not_found("checkpoint not found"))?;
            if checkpoint_frozen(cp, snapshot.item.completed, snapshot.item.cancelled) {
                return Err(DomainError::protected_structure("checkpoint is frozen"));
            }
            let before_cp_title = cp.title.clone();
            let before_cp_description = cp.description.clone();
            let title = source
                .action_label
                .clone()
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| cp.title.clone());
            let description = source.note.clone().or(cp.description.clone());
            tx.execute(
                "UPDATE productivity_checkpoint SET title = ?1, description = ?2, updated_at_utc = ?3, revision = revision + 1 WHERE id = ?4",
                params![title, description, now, cp_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let cp_point = snapshot
                .points
                .iter()
                .find(|p| p.checkpoint_id.as_deref() == Some(cp_id.as_str()));
            if let Some(cp_point) = cp_point {
                let record = PointTransferRecord {
                    target_point_id: cp_point.id.clone(),
                    tombstoned_point_id: if cp_point.id != source.id {
                        Some(source.id.clone())
                    } else {
                        None
                    },
                    before_target_action_id: cp_point.action_id.clone(),
                    before_target_role: Some(cp_point.role.clone()),
                    before_target_checkpoint_id: cp_point.checkpoint_id.clone(),
                    before_target_attachment_kind: cp_point.attachment_kind.clone(),
                    before_target_action_label: cp_point.action_label.clone(),
                    before_target_location: cp_point.location.clone(),
                    before_target_note: cp_point.note.clone(),
                    checkpoint_id: Some(cp_id.clone()),
                    before_checkpoint_title: Some(before_cp_title),
                    before_checkpoint_description: before_cp_description.clone(),
                };
                merge_point_fields(tx, &cp_point.id, source, now)?;
                if cp_point.id != source.id {
                    tombstone_point(tx, &source.id, now)?;
                    effects.tombstoned_point_ids.push(source.id.clone());
                }
                effects.point_transfers.push(record);
            } else {
                tombstone_point(tx, &source.id, now)?;
                effects.tombstoned_point_ids.push(source.id.clone());
            }
        }
        MinuteUser::ActionStart(target_action_id) | MinuteUser::ActionEnd(target_action_id) => {
            let target_action = snapshot
                .actions
                .iter()
                .find(|a| a.id == *target_action_id)
                .ok_or_else(|| DomainError::root_not_found("target action not found"))?;
            if action_frozen(target_action, snapshot.item.completed, snapshot.item.cancelled) {
                return Err(DomainError::protected_structure("target action is frozen"));
            }
            let target_role = if matches!(owner, MinuteUser::ActionStart(_)) {
                "start"
            } else {
                "end"
            };
            let target_point = snapshot
                .points
                .iter()
                .find(|p| p.action_id.as_deref() == Some(target_action_id.as_str()) && p.role == target_role);
            if let Some(target_point) = target_point {
                let record = PointTransferRecord {
                    target_point_id: target_point.id.clone(),
                    tombstoned_point_id: if target_point.id != source.id {
                        Some(source.id.clone())
                    } else {
                        None
                    },
                    before_target_action_id: target_point.action_id.clone(),
                    before_target_role: Some(target_point.role.clone()),
                    before_target_checkpoint_id: target_point.checkpoint_id.clone(),
                    before_target_attachment_kind: target_point.attachment_kind.clone(),
                    before_target_action_label: target_point.action_label.clone(),
                    before_target_location: target_point.location.clone(),
                    before_target_note: target_point.note.clone(),
                    checkpoint_id: None,
                    before_checkpoint_title: None,
                    before_checkpoint_description: None,
                };
                merge_point_fields(tx, &target_point.id, source, now)?;
                if target_point.id != source.id {
                    tombstone_point(tx, &source.id, now)?;
                    effects.tombstoned_point_ids.push(source.id.clone());
                } else {
                    tx.execute(
                        "UPDATE productivity_item_travel_point SET action_id = ?1, role = ?2, attachment_kind = 'action',
                         checkpoint_id = NULL, updated_at_utc = ?3 WHERE id = ?4 AND item_id = ?5",
                        params![target_action_id, target_role, now, source.id, item_id],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                }
                effects.point_transfers.push(record);
            } else {
                let record = PointTransferRecord {
                    target_point_id: source.id.clone(),
                    tombstoned_point_id: None,
                    before_target_action_id: source.action_id.clone(),
                    before_target_role: Some(source.role.clone()),
                    before_target_checkpoint_id: source.checkpoint_id.clone(),
                    before_target_attachment_kind: source.attachment_kind.clone(),
                    before_target_action_label: source.action_label.clone(),
                    before_target_location: source.location.clone(),
                    before_target_note: source.note.clone(),
                    checkpoint_id: None,
                    before_checkpoint_title: None,
                    before_checkpoint_description: None,
                };
                tx.execute(
                    "UPDATE productivity_item_travel_point SET action_id = ?1, role = ?2, attachment_kind = 'action',
                     checkpoint_id = NULL, updated_at_utc = ?3 WHERE id = ?4 AND item_id = ?5",
                    params![target_action_id, target_role, now, source.id, item_id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                effects.point_transfers.push(record);
            }
        }
    }
    Ok(())
}

fn merge_point_fields(tx: &Transaction<'_>, target_id: &str, source: &TravelPointDto, now: &str) -> DomainResult<()> {
    let (label, location, note): (Option<String>, Option<String>, Option<String>) = tx
        .query_row(
            "SELECT action_label, location, note FROM productivity_item_travel_point WHERE id = ?1",
            [target_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let action_label = label.or(source.action_label.clone());
    let location = location.or(source.location.clone());
    let note = note.or(source.note.clone());
    tx.execute(
        "UPDATE productivity_item_travel_point SET action_label = ?1, location = ?2, note = ?3, updated_at_utc = ?4 WHERE id = ?5",
        params![action_label, location, note, now, target_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

fn reverse_endpoint_to_checkpoint(
    tx: &Transaction<'_>,
    item_id: &str,
    snapshot: &TripSnapshot,
    point: &TravelPointDto,
    minute: &str,
    now: &str,
    effects: &mut StageDeleteEffects,
) -> DomainResult<()> {
    let (checkpoint_id, created) = if let Some(origin_id) = &point.origin_checkpoint_id {
        let deleted: Option<String> = tx
            .query_row(
                "SELECT deleted_at_utc FROM productivity_checkpoint WHERE id = ?1 AND target_id = ?2",
                params![origin_id, item_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
            .flatten();
        if deleted.is_some() {
            let cp = snapshot.checkpoints.iter().find(|c| c.id == *origin_id);
            if let Some(cp) = cp {
                if checkpoint_frozen(cp, snapshot.item.completed, snapshot.item.cancelled) {
                    return Err(DomainError::protected_structure("origin checkpoint is frozen"));
                }
            }
            let title = point
                .action_label
                .clone()
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_CP_TITLE.to_string());
            tx.execute(
                "UPDATE productivity_checkpoint SET deleted_at_utc = NULL, title = ?1, description = ?2, planned_at_utc = ?3,
                 updated_at_utc = ?4, revision = revision + 1 WHERE id = ?5",
                params![title, point.note, minute, now, origin_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            effects.restored_checkpoint_ids.push(origin_id.clone());
            (origin_id.clone(), false)
        } else {
            create_checkpoint_from_point(tx, item_id, point, minute, now, effects)?
        }
    } else {
        create_checkpoint_from_point(tx, item_id, point, minute, now, effects)?
    };

    effects.reversed_endpoints.push(ReversedEndpointRecord {
        point_id: point.id.clone(),
        checkpoint_id: checkpoint_id.clone(),
        created_checkpoint: created,
        before_attachment_kind: point.attachment_kind.clone(),
        before_action_id: point.action_id.clone().unwrap_or_default(),
        before_role: point.role.clone(),
        before_action_label: point.action_label.clone(),
        before_location: point.location.clone(),
        before_note: point.note.clone(),
        before_origin_checkpoint_id: point.origin_checkpoint_id.clone(),
    });

    tx.execute(
        "UPDATE productivity_item_travel_point SET attachment_kind = 'checkpoint', checkpoint_id = ?1, role = 'single',
         action_id = NULL, action_label = NULL, note = NULL, updated_at_utc = ?2 WHERE id = ?3 AND item_id = ?4",
        params![checkpoint_id, now, point.id, item_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

fn create_checkpoint_from_point(
    tx: &Transaction<'_>,
    item_id: &str,
    point: &TravelPointDto,
    minute: &str,
    now: &str,
    effects: &mut StageDeleteEffects,
) -> DomainResult<(String, bool)> {
    let cp_id = new_uuid();
    let title = point
        .action_label
        .clone()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CP_TITLE.to_string());
    tx.execute(
        "INSERT INTO productivity_checkpoint (id, schema_version, revision, title, name_link_mode, planned_at_utc, completed, target_kind, target_id, created_at_utc, updated_at_utc)
         VALUES (?1, 1, 1, ?2, 'unlinked', ?3, 0, 'item', ?4, ?5, ?5)",
        params![cp_id, title, minute, item_id, now],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "UPDATE productivity_checkpoint SET description = ?1 WHERE id = ?2",
        params![point.note, cp_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    effects.created_checkpoint_ids.push(cp_id.clone());
    Ok((cp_id, true))
}

fn tombstone_point(tx: &Transaction<'_>, point_id: &str, now: &str) -> DomainResult<()> {
    tx.execute(
        "UPDATE productivity_item_travel_point SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE id = ?2",
        params![now, point_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn effects_to_manifest_json(
    action_id: &str,
    after_item_revision: i64,
    after_action_refs: &[super::super::types::RevisionRef],
    after_checkpoint_refs: &[super::super::types::RevisionRef],
    effects: &StageDeleteEffects,
) -> Value {
    json!({
        "manifestVersion": 1,
        "kind": "stage_delete",
        "actionId": action_id,
        "afterItemRevision": after_item_revision,
        "afterActionRefs": after_action_refs,
        "afterCheckpointRefs": after_checkpoint_refs,
        "tombstonedPointIds": effects.tombstoned_point_ids,
        "tombstonedTransportationIds": effects.tombstoned_transportation_ids,
        "createdCheckpointIds": effects.created_checkpoint_ids,
        "restoredCheckpointIds": effects.restored_checkpoint_ids,
        "reversedEndpoints": effects.reversed_endpoints.iter().map(|r| json!({
            "pointId": r.point_id,
            "checkpointId": r.checkpoint_id,
            "createdCheckpoint": r.created_checkpoint,
            "beforeAttachmentKind": r.before_attachment_kind,
            "beforeActionId": r.before_action_id,
            "beforeRole": r.before_role,
            "beforeActionLabel": r.before_action_label,
            "beforeLocation": r.before_location,
            "beforeNote": r.before_note,
            "beforeOriginCheckpointId": r.before_origin_checkpoint_id,
        })).collect::<Vec<_>>(),
        "pointTransfers": effects.point_transfers.iter().map(|t| json!({
            "targetPointId": t.target_point_id,
            "tombstonedPointId": t.tombstoned_point_id,
            "beforeTargetActionId": t.before_target_action_id,
            "beforeTargetRole": t.before_target_role,
            "beforeTargetCheckpointId": t.before_target_checkpoint_id,
            "beforeTargetAttachmentKind": t.before_target_attachment_kind,
            "beforeTargetActionLabel": t.before_target_action_label,
            "beforeTargetLocation": t.before_target_location,
            "beforeTargetNote": t.before_target_note,
            "checkpointId": t.checkpoint_id,
            "beforeCheckpointTitle": t.before_checkpoint_title,
            "beforeCheckpointDescription": t.before_checkpoint_description,
        })).collect::<Vec<_>>(),
    })
}
