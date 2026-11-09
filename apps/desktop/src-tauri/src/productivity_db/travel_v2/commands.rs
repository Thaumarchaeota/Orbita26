use chrono::Utc;
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::Value;

use super::actual::apply_set_actual;
use super::membership::{
    ensure_adjacent_join_pair, ensure_live_action_of_item, ensure_live_checkpoint_of_item,
    ensure_live_point_of_item, ensure_live_transportation_of_item,
};
use super::flight_candidates::extract_flight_candidates;
use super::model::*;
use super::plan_edit::persist_split_action;
use super::read::{load_trip_snapshot, load_trip_write_result_snapshot};
use super::receipt::{ensure_receipt, hash_command, store_receipt};
use super::restore_batch::{apply_restore, build_trip_delete_manifest, load_membership_for_restore};
use super::stage_delete::{apply_stage_delete, effects_to_manifest_json};
use super::source_mapping::{adopt_flight_fields, restore_adoption_patch, verify_adoption_token_for_restore};
use super::validation::{parse_minute, validate_finish_actuals, validate_trip_plan};
use super::super::coordinator::{in_transaction, with_write_expected};
use super::super::error::{DomainError, DomainResult};
use super::super::classification::create_item_classification;
use super::super::repository::{
    append_item_to_order, bump_action, bump_checkpoint, bump_item, check_members, check_revision, insert_action,
    insert_item,
};

type MutationOutcome = (Option<String>, bool);
use super::super::types::RevisionRef;
use super::super::util::{new_uuid, utc_now};
use super::super::validation::{ensure_list_writable, validate_item_status};

pub fn create(data_dir: &str, envelope: TravelMutationEnvelope<CreateTripPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = envelope.payload.new_item_id.clone();
    run_mutation(data_dir, "productivity_travel_v2_create", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_list_writable(tx, envelope.payload.list_id.as_deref())?;
        let now = utc_now();
        validate_item_status("进行中")?;
        insert_item(
            tx,
            &item_id,
            envelope.payload.list_id.as_deref(),
            &envelope.payload.title,
            None,
            "进行中",
            "none",
            None,
            None,
            &now,
        )?;
        let travel_type_id = travel_root_type_id(tx)?;
        // Bind the system classification write to the catalog revision observed
        // in this transaction, including any revision advanced while seeding
        // travel presets above. This keeps the normal classification guard in
        // force for both new and existing catalogs.
        let catalog = super::super::classification::catalog_snapshot(tx)?
            .ok_or_else(|| DomainError::root_not_found("ItemType catalog not found"))?;
        create_item_classification(
            tx,
            item_id,
            Some(&travel_type_id),
            &[],
            Some(&super::super::types::ClassificationExpected {
                item_type_catalog: Some(RevisionRef { id: catalog.id, expected_revision: catalog.revision }),
                tags: Vec::new(),
            }),
        )?;
        tx.execute(
            "INSERT INTO productivity_item_travel_profile (item_id, schema_version, created_at_utc, updated_at_utc)
             VALUES (?1, 1, ?2, ?2)",
            params![item_id, now],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        match &envelope.payload.first_content {
            FirstContentPayload::Checkpoint {
                checkpoint_id,
                planned_at_utc,
                title,
                location,
            } => {
                parse_minute(planned_at_utc)?;
                let title = title.clone().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| DEFAULT_CP_TITLE.to_string());
                // SPEC wire `custom` nameLinkMode maps to DB `unlinked` (CHECK constraint).
                tx.execute(
                    "INSERT INTO productivity_checkpoint (id, schema_version, revision, title, name_link_mode, planned_at_utc, completed, target_kind, target_id, created_at_utc, updated_at_utc)
                     VALUES (?1, 1, 1, ?2, 'unlinked', ?3, 0, 'item', ?4, ?5, ?5)",
                    params![checkpoint_id, title, planned_at_utc, item_id, now],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                let point_id = new_uuid();
                tx.execute(
                    "INSERT INTO productivity_item_travel_point (id, item_id, schema_version, attachment_kind, checkpoint_id, role, location, created_at_utc, updated_at_utc)
                     VALUES (?1, ?2, 1, 'checkpoint', ?3, 'single', ?4, ?5, ?5)",
                    params![point_id, item_id, checkpoint_id, location, now],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
            FirstContentPayload::Action {
                action_id,
                transportation_id,
                start_point_id,
                end_point_id,
                planned_start_at,
                planned_end_at,
                transportation_type,
                start_location,
                end_location,
                transportation_fields,
                transportation_source_snapshot,
            } => {
                parse_minute(planned_start_at)?;
                parse_minute(planned_end_at)?;
                insert_action(
                    tx,
                    action_id,
                    TRAVEL_ACTION_TITLE,
                    None,
                    None,
                    Some("item"),
                    Some(item_id),
                    Some(planned_start_at),
                    Some(planned_end_at),
                    None,
                    false,
                    None,
                    &now,
                )?;
                tx.execute(
                    "INSERT INTO productivity_transportation (id, item_id, schema_version, transportation_type, created_at_utc, updated_at_utc)
                     VALUES (?1, ?2, 1, ?3, ?4, ?4)",
                    params![transportation_id, item_id, transportation_type, now],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                tx.execute(
                    "UPDATE productivity_transportation SET name=?1,note=?2,service_number=?3,operator=?4,vehicle_model=?5,aircraft_registration=?6,license_plate=?7,carriage=?8,seat=?9,departure_name=?10,arrival_name=?11,departure_code=?12,arrival_code=?13,departure_terminal=?14,arrival_terminal=?15,departure_gate=?16,arrival_gate=?17,source_snapshot_json=?18 WHERE id=?19 AND item_id=?20",
                    params![transportation_fields.name, transportation_fields.note, transportation_fields.service_number, transportation_fields.operator, transportation_fields.vehicle_model, transportation_fields.aircraft_registration, transportation_fields.license_plate, transportation_fields.carriage, transportation_fields.seat, transportation_fields.departure_name, transportation_fields.arrival_name, transportation_fields.departure_code, transportation_fields.arrival_code, transportation_fields.departure_terminal, transportation_fields.arrival_terminal, transportation_fields.departure_gate, transportation_fields.arrival_gate, transportation_source_snapshot.as_ref().map(|v| v.to_string()), transportation_id, item_id],
                ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                tx.execute(
                    "UPDATE productivity_action SET transportation_id = ?1, name_link_mode = 'unlinked' WHERE id = ?2",
                    params![transportation_id, action_id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                for (point_id, role) in [(start_point_id, "start"), (end_point_id, "end")] {
                    tx.execute(
                    "INSERT INTO productivity_item_travel_point (id, item_id, schema_version, attachment_kind, action_id, role, location, created_at_utc, updated_at_utc)
                     VALUES (?1, ?2, 1, 'action', ?3, ?4, ?5, ?6, ?6)",
                    params![point_id, item_id, action_id, role, if role == "start" { start_location.as_deref() } else { end_location.as_deref() }, now],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                }
            }
        }
        append_item_to_order(tx, &item_id, &now)?;
        bump_item(tx, &item_id, &now)?;
        Ok((None, true))
    })
}

pub fn update_item(data_dir: &str, envelope: TravelMutationEnvelope<UpdateItemPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_update_item", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        let current_title: String = tx
            .query_row(
                "SELECT title FROM productivity_item WHERE id = ?1 AND deleted_at_utc IS NULL",
                [item_id],
                |row| row.get(0),
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if current_title == envelope.payload.title {
            return Ok((None, false));
        }
        let now = utc_now();
        tx.execute(
            "UPDATE productivity_item SET title = ?1, updated_at_utc = ?2 WHERE id = ?3",
            params![envelope.payload.title, now, item_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn finish(data_dir: &str, envelope: TravelMutationEnvelope<Value>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_finish", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        let snapshot = load_trip_snapshot(tx, item_id)?;
        validate_finish_actuals(&snapshot)?;
        let now = utc_now();
        tx.execute(
            "UPDATE productivity_item SET status = '完成', updated_at_utc = ?1 WHERE id = ?2",
            params![now, item_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let mut stmt = tx
            .prepare(
                "SELECT id FROM productivity_action
                 WHERE target_kind = 'item' AND target_id = ?1 AND deleted_at_utc IS NULL AND ended = 0",
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let to_end = stmt
            .query_map([item_id], |row| row.get::<_, String>(0))
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        for action_id in to_end {
            tx.execute(
                "UPDATE productivity_action SET ended = 1, updated_at_utc = ?1 WHERE id = ?2",
                params![now, action_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_action(tx, &action_id, &now)?;
        }
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn reopen(data_dir: &str, envelope: TravelMutationEnvelope<Value>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_reopen", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        let snapshot = load_trip_snapshot(tx, item_id)?;
        if snapshot.profile.cancelled_at_utc.is_some() {
            return Err(DomainError::invalid_patch("cancelled trip cannot be reopened"));
        }
        if !snapshot.item.completed { return Ok((None, false)); }
        let now = utc_now();
        // Reopening the trip does not reopen actions or alter recorded intervals (SPEC-0007 §3.3).
        tx.execute("UPDATE productivity_item SET status = '进行中', updated_at_utc = ?1 WHERE id = ?2", params![now, item_id])
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn cancel(data_dir: &str, envelope: TravelMutationEnvelope<CancelTripPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_cancel", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        let now = utc_now();
        let cancelled_at = now.clone();
        let snapshot = load_trip_snapshot(tx, item_id)?;
        if let Some(action_id) = &envelope.payload.end_current_action_id {
            super::validation::validate_cancel_with_end_action(&snapshot, action_id, &cancelled_at)?;
            ensure_live_action_of_item(tx, item_id, action_id)?;
            if apply_set_actual(
                tx,
                &SetActualPayload {
                    target: SetActualTarget::ActionBoundary {
                        action_id: action_id.clone(),
                        side: "end".into(),
                    },
                    value: Some(cancelled_at.clone()),
                    mode: "record".into(),
                },
                None,
                None,
            )? {
                bump_action(tx, action_id, &now)?;
            }
        }
        tx.execute(
            "UPDATE productivity_item_travel_profile SET cancelled_at_utc = ?1, updated_at_utc = ?1 WHERE item_id = ?2",
            params![cancelled_at, item_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn set_actual(data_dir: &str, envelope: TravelMutationEnvelope<SetActualPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_set_actual", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        match &envelope.payload.target {
            SetActualTarget::ActionBoundary { action_id, .. } => {
                ensure_live_action_of_item(tx, item_id, action_id)?;
            }
            SetActualTarget::Checkpoint { checkpoint_id } => {
                ensure_live_checkpoint_of_item(tx, item_id, checkpoint_id)?;
            }
        }
        let cancelled = cancelled_at(tx, item_id)?;
        let changed = apply_set_actual(tx, &envelope.payload, cancelled.as_deref(), None)?;
        if !changed {
            return Ok((None, false));
        }
        let now = utc_now();
        if let SetActualTarget::ActionBoundary { action_id, .. } = &envelope.payload.target {
            bump_action(tx, action_id, &now)?;
        }
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn set_checkpoint_completed(
    data_dir: &str,
    envelope: TravelMutationEnvelope<SetCheckpointCompletedPayload>,
) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_set_checkpoint_completed", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        let cp = &envelope.payload;
        ensure_live_checkpoint_of_item(tx, item_id, &cp.checkpoint_id)?;
        let cancelled = cancelled_at(tx, item_id)?;
        let (cur_completed, cur_actual): (i64, Option<String>) = tx
            .query_row(
                "SELECT completed, actual_at_utc FROM productivity_checkpoint WHERE id = ?1",
                [&cp.checkpoint_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let cur_completed = cur_completed != 0;
        if cp.completed {
            if let Some(actual) = &cp.actual_at_utc {
                super::validation::ensure_actual_not_future(actual, &Utc::now(), cancelled.as_deref())?;
            }
            if cur_completed && cur_actual == cp.actual_at_utc {
                return Ok((None, false));
            }
        } else if !cur_completed && cur_actual.is_none() {
            return Ok((None, false));
        }
        let now = utc_now();
        let n = if cp.completed {
            tx.execute(
                "UPDATE productivity_checkpoint SET completed = 1, actual_at_utc = ?1, revision = revision + 1, updated_at_utc = ?2
                 WHERE id = ?3 AND target_kind = 'item' AND target_id = ?4 AND deleted_at_utc IS NULL",
                params![cp.actual_at_utc, now, cp.checkpoint_id, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
        } else {
            tx.execute(
                "UPDATE productivity_checkpoint SET completed = 0, actual_at_utc = NULL, revision = revision + 1, updated_at_utc = ?1
                 WHERE id = ?2 AND target_kind = 'item' AND target_id = ?3 AND deleted_at_utc IS NULL",
                params![now, cp.checkpoint_id, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
        };
        if n != 1 {
            return Err(DomainError::cross_item_reference("checkpoint is not a live member of this item"));
        }
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn update_point(data_dir: &str, envelope: TravelMutationEnvelope<UpdatePointPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_update_point", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        let point = envelope.payload.point_id.clone();
        ensure_live_point_of_item(tx, item_id, &point)?;
        let row: (String, Option<String>, Option<String>) = tx
            .query_row(
                "SELECT attachment_kind, checkpoint_id, action_id FROM productivity_item_travel_point WHERE id = ?1 AND item_id = ?2 AND deleted_at_utc IS NULL",
                params![point, item_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| DomainError::root_not_found("point not found"))?;
        let now = utc_now();
        let mut changed = false;
        let mut cp_changed = false;
        if row.0 == "checkpoint" {
            let cp_id = row.1.as_deref().ok_or_else(|| DomainError::root_not_found("checkpoint missing"))?;
            let (cur_title, cur_desc): (String, Option<String>) = tx
                .query_row(
                    "SELECT title, description FROM productivity_checkpoint WHERE id = ?1",
                    [cp_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let cur_location: Option<String> = tx
                .query_row(
                    "SELECT location FROM productivity_item_travel_point WHERE id = ?1",
                    [&point],
                    |row| row.get(0),
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            if let Some(patch) = &envelope.payload.action_label {
                let title = patch.clone().unwrap_or_else(|| DEFAULT_CP_TITLE.to_string());
                if title != cur_title {
                    tx.execute(
                        "UPDATE productivity_checkpoint SET title = ?1, updated_at_utc = ?2 WHERE id = ?3",
                        params![title, now, cp_id],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    cp_changed = true;
                    changed = true;
                }
            }
            if let Some(patch) = &envelope.payload.note {
                if cur_desc.as_deref() != patch.as_deref() {
                    tx.execute(
                        "UPDATE productivity_checkpoint SET description = ?1, updated_at_utc = ?2 WHERE id = ?3",
                        params![patch, now, cp_id],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    cp_changed = true;
                    changed = true;
                }
            }
            if let Some(patch) = &envelope.payload.location {
                if cur_location.as_deref() != patch.as_deref() {
                    tx.execute(
                        "UPDATE productivity_item_travel_point SET location = ?1, updated_at_utc = ?2 WHERE id = ?3",
                        params![patch, now, point],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    changed = true;
                }
            }
            if cp_changed {
                bump_checkpoint(tx, cp_id, &now)?;
            }
        } else {
            let (cur_label, cur_location, cur_note): (Option<String>, Option<String>, Option<String>) = tx
                .query_row(
                    "SELECT action_label, location, note FROM productivity_item_travel_point WHERE id = ?1",
                    [&point],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            if let Some(patch) = &envelope.payload.action_label {
                if cur_label.as_deref() != patch.as_deref() {
                    tx.execute(
                        "UPDATE productivity_item_travel_point SET action_label = ?1, updated_at_utc = ?2 WHERE id = ?3",
                        params![patch, now, point],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    changed = true;
                }
            }
            if let Some(patch) = &envelope.payload.location {
                if cur_location.as_deref() != patch.as_deref() {
                    tx.execute(
                        "UPDATE productivity_item_travel_point SET location = ?1, updated_at_utc = ?2 WHERE id = ?3",
                        params![patch, now, point],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    changed = true;
                }
            }
            if let Some(patch) = &envelope.payload.note {
                if cur_note.as_deref() != patch.as_deref() {
                    tx.execute(
                        "UPDATE productivity_item_travel_point SET note = ?1, updated_at_utc = ?2 WHERE id = ?3",
                        params![patch, now, point],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                    changed = true;
                }
            }
        }
        if !changed {
            return Ok((None, false));
        }
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn update_transportation(
    data_dir: &str,
    envelope: TravelMutationEnvelope<UpdateTransportationPayload>,
) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_update_transportation", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        let tid = envelope.payload.transportation_id().ok_or_else(|| DomainError::invalid_patch("transportationId required"))?;
        ensure_live_transportation_of_item(tx, item_id, &tid)?;
        let changed = apply_transportation_patch(tx, &tid, item_id, &envelope.payload.column_fields())?;
        if !changed {
            return Ok((None, false));
        }
        bump_item(tx, item_id, &utc_now())?;
        Ok((None, true))
    })
}

pub fn adopt_flight(data_dir: &str, envelope: TravelMutationEnvelope<AdoptFlightPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    let transportation_id = envelope.payload.transportation_id.clone();
    let mut newly_created_report = None;
    let mut result = run_mutation(data_dir, "productivity_travel_v2_adopt_flight", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        ensure_live_transportation_of_item(tx, item_id, &envelope.payload.transportation_id)?;
        let snapshot = load_trip_snapshot(tx, item_id)?;
        newly_created_report = Some(adopt_flight_fields(
            tx,
            &envelope.payload.transportation_id,
            item_id,
            snapshot.item.revision,
            &envelope.expected_data_dir,
            &envelope.payload.candidate,
            envelope.payload.raw.as_ref(),
            &envelope.payload.adoption_token,
            envelope.payload.query_generation,
            envelope.payload.restore_baseline_generation,
            envelope.payload.selected_fields.as_deref(),
            &snapshot,
        )?);
        bump_item(tx, item_id, &utc_now())?;
        Ok((None, true))
    })?;
    // Keep the report in sourceSnapshot for recovery, and expose it at the
    // response root because the typed client consumes this result after commit.
    result.adoption_report = newly_created_report.or_else(|| result
        .snapshot
        .transportations
        .iter()
        .find(|transport| transport.id == transportation_id)
        .and_then(|transport| transport.source_snapshot.as_ref())
        .and_then(|source| source.get("adoptionReport"))
        .cloned());
    Ok(result)
}

pub fn restore_adoption_fields(
    data_dir: &str,
    envelope: TravelMutationEnvelope<RestoreAdoptionFieldsPayload>,
) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_restore_adoption_fields", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        ensure_live_transportation_of_item(tx, item_id, &envelope.payload.transportation_id)?;
        let _snapshot = load_trip_snapshot(tx, item_id)?;
        verify_adoption_token_for_restore(
            &envelope.payload.adoption_token,
            item_id,
            &envelope.payload.transportation_id,
            &envelope.expected_data_dir,
        )?;
        restore_adoption_patch(
            tx,
            &envelope.payload.transportation_id,
            &envelope.payload.fields,
            &envelope.payload.expected_current_values,
            envelope.payload.before_values.as_ref(),
        )?;
        bump_item(tx, item_id, &utc_now())?;
        Ok((None, true))
    })
}

pub fn delete_trip(data_dir: &str, envelope: TravelMutationEnvelope<Value>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_delete_trip", &envelope, Some(item_id.clone()), |tx, item_id| {
        let snapshot = load_trip_snapshot(tx, item_id)?;
        let batch_id = new_uuid();
        let now = utc_now();
        soft_delete_trip_members(tx, item_id, &now, Some(&batch_id))?;
        bump_item(tx, item_id, &now)?;
        let after_revision: i64 = tx
            .query_row(
                "SELECT revision FROM productivity_item WHERE id = ?1",
                [item_id],
                |row| row.get(0),
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let manifest = build_trip_delete_manifest(&snapshot, after_revision);
        store_batch(tx, &batch_id, item_id, "trip_delete", &manifest)?;
        Ok((Some(batch_id), true))
    })
}

pub fn append(data_dir: &str, envelope: TravelMutationEnvelope<AppendTripPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_append", &envelope, Some(item_id.clone()), |tx, item_id| {
        let snapshot = load_trip_snapshot(tx, item_id)?;
        if snapshot.profile.cancelled_at_utc.is_some() {
            return Err(DomainError::invalid_plan("cannot append to cancelled trip"));
        }
        if snapshot.item.completed {
            tx.execute(
                "UPDATE productivity_item SET status = '进行中', updated_at_utc = ?1 WHERE id = ?2",
                params![utc_now(), item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        }
        let now = utc_now();
        let payload = &envelope.payload;
        if payload.kind == "CP" || payload.kind == "checkpoint" {
            let cp_id = payload.checkpoint_id.clone().unwrap_or_else(new_uuid);
            let at = payload
                .planned_at_utc
                .clone()
                .ok_or_else(|| DomainError::invalid_plan("checkpoint planned time required"))?;
            parse_minute(&at)?;
            tx.execute(
                "INSERT INTO productivity_checkpoint (id, schema_version, revision, title, name_link_mode, planned_at_utc, completed, target_kind, target_id, created_at_utc, updated_at_utc)
                 VALUES (?1, 1, 1, ?2, 'unlinked', ?3, 0, 'item', ?4, ?5, ?5)",
                params![cp_id, DEFAULT_CP_TITLE, at, item_id, now],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let point_id = new_uuid();
            tx.execute(
                "INSERT INTO productivity_item_travel_point (id, item_id, schema_version, attachment_kind, checkpoint_id, role, created_at_utc, updated_at_utc)
                 VALUES (?1, ?2, 1, 'checkpoint', ?3, 'single', ?4, ?4)",
                params![point_id, item_id, cp_id, now],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        } else {
            let action_id = payload.action_id.clone().unwrap_or_else(new_uuid);
            let start = payload.planned_start_at.clone().ok_or_else(|| DomainError::invalid_plan("planned start required"))?;
            let end = payload.planned_end_at.clone().ok_or_else(|| DomainError::invalid_plan("planned end required"))?;
            parse_minute(&start)?;
            parse_minute(&end)?;
            insert_action(tx, &action_id, TRAVEL_ACTION_TITLE, None, None, Some("item"), Some(item_id), Some(&start), Some(&end), None, false, None, &now)?;
            let transportation_id = payload
                .existing_transportation_id
                .clone()
                .or_else(|| payload.transportation_id.clone())
                .unwrap_or_else(new_uuid);
            if let Some(existing) = &payload.existing_transportation_id {
                ensure_live_transportation_of_item(tx, item_id, existing)?;
            } else {
                tx.execute(
                    "INSERT INTO productivity_transportation (id, item_id, schema_version, transportation_type, name, note, service_number, operator, vehicle_model, aircraft_registration, license_plate, carriage, seat, departure_name, arrival_name, departure_code, arrival_code, departure_terminal, arrival_terminal, departure_gate, arrival_gate, source_snapshot_json, created_at_utc, updated_at_utc) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?22)",
                    params![transportation_id, item_id, if payload.kind == "flight" { Some("flight") } else if payload.kind == "train" { Some("train") } else { None }, payload.transportation_fields.name, payload.transportation_fields.note, payload.transportation_fields.service_number, payload.transportation_fields.operator, payload.transportation_fields.vehicle_model, payload.transportation_fields.aircraft_registration, payload.transportation_fields.license_plate, payload.transportation_fields.carriage, payload.transportation_fields.seat, payload.transportation_fields.departure_name, payload.transportation_fields.arrival_name, payload.transportation_fields.departure_code, payload.transportation_fields.arrival_code, payload.transportation_fields.departure_terminal, payload.transportation_fields.arrival_terminal, payload.transportation_fields.departure_gate, payload.transportation_fields.arrival_gate, payload.transportation_source_snapshot.as_ref().map(|v| v.to_string()), now],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
            tx.execute(
                "UPDATE productivity_action SET transportation_id = ?1, name_link_mode = 'unlinked' WHERE id = ?2",
                params![transportation_id, action_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            for role in ["start", "end"] {
                tx.execute(
                    "INSERT INTO productivity_item_travel_point (id, item_id, schema_version, attachment_kind, action_id, role, created_at_utc, updated_at_utc)
                     VALUES (?1, ?2, 1, 'action', ?3, ?4, ?5, ?5)",
                    params![new_uuid(), item_id, action_id, role, now],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
        }
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn edit_plan(data_dir: &str, envelope: TravelMutationEnvelope<EditPlanPayload>) -> DomainResult<TravelMutationResult> {
    super::plan_history::edit_plan(data_dir, envelope)
}

pub fn split(data_dir: &str, envelope: TravelMutationEnvelope<SplitPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_split", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        ensure_live_action_of_item(tx, item_id, &envelope.payload.action_id)?;
        let snapshot = load_trip_snapshot(tx, item_id)?;
        persist_split_action(tx, item_id, &envelope.payload, &snapshot)?;
        bump_item(tx, item_id, &utc_now())?;
        Ok((None, true))
    })
}

pub fn set_join_actual(data_dir: &str, envelope: TravelMutationEnvelope<SetJoinActualPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_set_join_actual", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        let p = &envelope.payload;
        ensure_adjacent_join_pair(tx, item_id, &p.front_action_id, &p.rear_action_id)?;
        let cancelled_at_utc = cancelled_at(tx, item_id)?;
        let cancelled = cancelled_at_utc.as_deref();
        let front_changed = apply_set_actual(
            tx,
            &SetActualPayload {
                target: SetActualTarget::ActionBoundary {
                    action_id: p.front_action_id.clone(),
                    side: "end".into(),
                },
                value: Some(p.actual_at.clone()),
                mode: "record".into(),
            },
            cancelled,
            None,
        )?;
        let rear_changed = apply_set_actual(
            tx,
            &SetActualPayload {
                target: SetActualTarget::ActionBoundary {
                    action_id: p.rear_action_id.clone(),
                    side: "start".into(),
                },
                value: Some(p.actual_at.clone()),
                mode: "record".into(),
            },
            cancelled,
            None,
        )?;
        if !front_changed && !rear_changed {
            return Ok((None, false));
        }
        let now = utc_now();
        if front_changed {
            bump_action(tx, &p.front_action_id, &now)?;
        }
        if rear_changed {
            bump_action(tx, &p.rear_action_id, &now)?;
        }
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn delete_stage(data_dir: &str, envelope: TravelMutationEnvelope<DeleteStagePayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_delete_stage", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        ensure_live_action_of_item(tx, item_id, &envelope.payload.action_id)?;
        let batch_id = new_uuid();
        let snapshot = load_trip_snapshot(tx, item_id)?;
        let effects = apply_stage_delete(tx, item_id, &envelope.payload, &snapshot)?;
        bump_item(tx, item_id, &utc_now())?;
        let after = load_trip_snapshot(tx, item_id)?;
        let manifest = effects_to_manifest_json(
            &envelope.payload.action_id,
            after.item.revision,
            &after.member_refs.actions,
            &after.member_refs.checkpoints,
            &effects,
        );
        store_batch(tx, &batch_id, item_id, "stage_delete", &manifest)?;
        Ok((Some(batch_id), true))
    })
}

pub fn delete_checkpoint(data_dir: &str, envelope: TravelMutationEnvelope<DeleteCheckpointPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_delete_checkpoint", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        ensure_live_checkpoint_of_item(tx, item_id, &envelope.payload.checkpoint_id)?;
        let now = utc_now();
        let n = tx
            .execute(
                "UPDATE productivity_checkpoint SET deleted_at_utc = ?1, updated_at_utc = ?1, revision = revision + 1
                 WHERE id = ?2 AND target_kind = 'item' AND target_id = ?3 AND deleted_at_utc IS NULL",
                params![now, envelope.payload.checkpoint_id, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if n != 1 {
            return Err(DomainError::cross_item_reference("checkpoint is not a live member of this item"));
        }
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn clear_point(data_dir: &str, envelope: TravelMutationEnvelope<ClearPointPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_mutation(data_dir, "productivity_travel_v2_clear_point", &envelope, Some(item_id.clone()), |tx, item_id| {
        ensure_trip_writable(tx, item_id)?;
        let now = utc_now();
        let point = envelope.payload.point_id.clone();
        ensure_live_point_of_item(tx, item_id, &point)?;
        let n = tx
            .execute(
                "UPDATE productivity_item_travel_point SET action_label = NULL, location = NULL, note = NULL, updated_at_utc = ?1 WHERE id = ?2 AND item_id = ?3",
                params![now, point, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if n == 0 {
            return Err(DomainError::root_not_found("point not found"));
        }
        bump_item(tx, item_id, &now)?;
        Ok((None, true))
    })
}

pub fn restore(data_dir: &str, envelope: TravelMutationEnvelope<RestoreTripPayload>) -> DomainResult<TravelMutationResult> {
    let item_id = require_item_ref(&envelope)?;
    run_restore_mutation(data_dir, "productivity_travel_v2_restore", &envelope, &item_id)
}

pub fn transportation_list(data_dir: &str, req: TransportationListRequest) -> DomainResult<TransportationListResponse> {
    let _ = data_dir;
    super::super::coordinator::with_strict_read(&req.expected_data_dir, |conn| {
        let Some(conn) = conn else {
            return Ok(TransportationListResponse {
                entries: vec![],
                next_cursor: None,
            });
        };
        super::super::coordinator::in_transaction(conn, |tx| {
            let limit = req.limit.unwrap_or(50).min(100) as i64;
            let mut stmt = tx
                .prepare(
                    "SELECT t.id, t.item_id, i.revision FROM productivity_transportation t
                     JOIN productivity_item i ON i.id = t.item_id
                     WHERE t.deleted_at_utc IS NULL AND i.deleted_at_utc IS NULL
                     ORDER BY t.updated_at_utc DESC LIMIT ?1",
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let rows = stmt
                .query_map([limit], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
                })
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let mut entries = Vec::new();
            for row in rows {
                let (tid, item_id, revision) = row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                let snapshot = load_trip_snapshot(tx, &item_id)?;
                let transportation = snapshot
                    .transportations
                    .into_iter()
                    .find(|t| t.id == tid)
                    .ok_or_else(|| DomainError::root_not_found("transportation missing"))?;
                let actions = snapshot
                    .actions
                    .into_iter()
                    .filter(|a| a.transportation_id.as_deref() == Some(tid.as_str()))
                    .collect();
                entries.push(TransportationListEntry {
                    transportation,
                    item_ref: RevisionRef {
                        id: item_id,
                        expected_revision: revision,
                    },
                    actions,
                });
            }
            Ok(TransportationListResponse {
                entries,
                next_cursor: None,
            })
        })
    })
}

pub async fn query_flight(app: &tauri::AppHandle, req: TravelMutationEnvelope<QueryFlightPayload>) -> DomainResult<Value> {
    let ctx = &req.payload.context;
    let generation = ctx.query_generation;
    if crate::data::get_data_dir(app).map_err(|e| DomainError::archive_lifecycle(e.to_string()))? != ctx.expected_data_dir {
        return Err(DomainError::query_context_expired("data directory changed"));
    }
    let context_ok = if ctx.draft {
        ctx.item_id.is_none() && ctx.item_revision.is_none() && ctx.transportation_id.is_none()
    } else { super::super::coordinator::with_strict_read(&ctx.expected_data_dir, |conn| {
        let Some(conn) = conn else {
            return Ok(false);
        };
        super::super::coordinator::in_transaction(conn, |tx| {
            let revision: Option<i64> = tx
                .query_row(
                    "SELECT revision FROM productivity_item WHERE id = ?1 AND deleted_at_utc IS NULL",
                    [ctx.item_id.as_deref().unwrap_or("")],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            if revision != ctx.item_revision {
                return Ok(false);
            }
            let linked: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM productivity_transportation WHERE id = ?1 AND item_id = ?2 AND deleted_at_utc IS NULL)",
                    params![ctx.transportation_id.as_deref().unwrap_or(""), ctx.item_id.as_deref().unwrap_or("")],
                    |row| row.get(0),
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            Ok(linked)
        })
    })? };
    if !context_ok {
        return Err(DomainError::query_context_expired("query context expired"));
    }
    let settings = crate::data::read_settings(app).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let api_key = settings.integrations.credentials.variflight.api_key.trim();
    if api_key.is_empty() {
        return Ok(serde_json::json!({
            "status": "skipped",
            "reason": "no_api_key",
            "queryGeneration": generation,
            "candidates": [],
            "fetchedAtUtc": null
        }));
    }
    let flight_number = req.payload.flight_number.trim();
    let date = req.payload.date.trim();
    let network = crate::commands::variflight_search_by_number(api_key, flight_number, date).await;
    if crate::data::get_data_dir(app).map_err(|e| DomainError::archive_lifecycle(e.to_string()))? != ctx.expected_data_dir {
        return Err(DomainError::query_context_expired("data directory changed"));
    }
    let context_ok_after = if ctx.draft {
        true
    } else { super::super::coordinator::with_strict_read(&ctx.expected_data_dir, |conn| {
        let Some(conn) = conn else {
            return Ok(false);
        };
        super::super::coordinator::in_transaction(conn, |tx| {
            let revision: Option<i64> = tx
                .query_row(
                    "SELECT revision FROM productivity_item WHERE id = ?1 AND deleted_at_utc IS NULL",
                    [ctx.item_id.as_deref().unwrap_or("")],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            Ok(revision == ctx.item_revision)
        })
    })? };
    if !context_ok_after {
        return Err(DomainError::query_context_expired("query context expired"));
    }
    match network {
        Ok((result, fetched_at)) => {
            let candidates = extract_flight_candidates(&result);
            Ok(serde_json::json!({
                "candidates": candidates,
                "fetchedAtUtc": fetched_at,
                "provider": "variflight",
                "queryGeneration": generation
            }))
        }
        Err(reason) => Ok(serde_json::json!({
            "status": "error",
            "reason": reason,
            "queryGeneration": generation,
            "candidates": [],
            "fetchedAtUtc": null
        })),
    }
}

fn run_mutation<T: serde::Serialize>(
    data_dir: &str,
    command_name: &str,
    envelope: &TravelMutationEnvelope<T>,
    item_id: Option<String>,
    apply: impl FnOnce(&Transaction<'_>, &str) -> DomainResult<MutationOutcome>,
) -> DomainResult<TravelMutationResult> {
    let _ = data_dir;
    let envelope_json = serde_json::to_string(envelope).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let request_hash = hash_command(command_name, &envelope_json);
    with_write_expected(&envelope.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            if let Some(existing) = ensure_receipt(
                tx,
                &envelope.request_id,
                &request_hash,
                item_id.as_deref(),
            )? {
                return Ok(existing);
            }
            let item_id = item_id
                .or_else(|| envelope.item_ref.as_ref().map(|r| r.id.clone()))
                .ok_or_else(|| DomainError::invalid_patch("item id required"))?;
            if let Some(item_ref) = &envelope.item_ref {
                let snapshot = load_trip_snapshot(tx, &item_ref.id)?;
                check_revision(item_ref.expected_revision, snapshot.item.revision)?;
                verify_members(&snapshot, &envelope.action_refs, &envelope.checkpoint_refs)?;
            }
            let (batch_id, changed) = apply(tx, &item_id)?;
            let snapshot = load_trip_write_result_snapshot(tx, &item_id)?;
            if !snapshot.actions.is_empty() || !snapshot.checkpoints.is_empty() {
                validate_trip_plan(&snapshot.actions, &snapshot.checkpoints)?;
            }
            let item_revision = snapshot.item.revision;
            let result = TravelMutationResult {
                changed,
                snapshot,
                affected_root_refs: vec![RevisionRef {
                    id: item_id.clone(),
                    expected_revision: item_revision,
                }],
                batch_id,
                adoption_report: None,
                plan_history_token: None,
                plan_history: None,
            };
            store_receipt(tx, &envelope.request_id, &request_hash, Some(&item_id), &result)?;
            Ok(result)
        })
    })
}

fn run_restore_mutation(
    data_dir: &str,
    command_name: &str,
    envelope: &TravelMutationEnvelope<RestoreTripPayload>,
    item_id: &str,
) -> DomainResult<TravelMutationResult> {
    let _ = data_dir;
    let envelope_json = serde_json::to_string(envelope).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let request_hash = hash_command(command_name, &envelope_json);
    with_write_expected(&envelope.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            if let Some(existing) = ensure_receipt(
                tx,
                &envelope.request_id,
                &request_hash,
                Some(item_id),
            )? {
                return Ok(existing);
            }
            let item_ref = envelope
                .item_ref
                .as_ref()
                .ok_or_else(|| DomainError::invalid_patch("itemRef required"))?;
            let (revision, actions, checkpoints) = load_membership_for_restore(tx, item_id)?;
            check_revision(item_ref.expected_revision, revision)?;
            super::super::repository::check_members(&actions, &envelope.action_refs)?;
            super::super::repository::check_members(&checkpoints, &envelope.checkpoint_refs)?;
            apply_restore(
                tx,
                item_id,
                &envelope.payload.batch_id,
                &envelope.action_refs,
                &envelope.checkpoint_refs,
                item_ref,
            )?;
            let snapshot = load_trip_write_result_snapshot(tx, item_id)?;
            if !snapshot.actions.is_empty() || !snapshot.checkpoints.is_empty() {
                validate_trip_plan(&snapshot.actions, &snapshot.checkpoints)?;
            }
            let item_revision = snapshot.item.revision;
            let result = TravelMutationResult {
                changed: true,
                snapshot,
                affected_root_refs: vec![RevisionRef {
                    id: item_id.to_string(),
                    expected_revision: item_revision,
                }],
                batch_id: None,
                adoption_report: None,
                plan_history_token: None,
                plan_history: None,
            };
            store_receipt(tx, &envelope.request_id, &request_hash, Some(item_id), &result)?;
            Ok(result)
        })
    })
}

fn require_item_ref<T>(envelope: &TravelMutationEnvelope<T>) -> DomainResult<String> {
    envelope
        .item_ref
        .as_ref()
        .map(|r| r.id.clone())
        .ok_or_else(|| DomainError::invalid_patch("itemRef required"))
}

fn verify_members(snapshot: &TripSnapshot, actions: &[RevisionRef], checkpoints: &[RevisionRef]) -> DomainResult<()> {
    check_members(&snapshot.member_refs.actions, actions)?;
    check_members(&snapshot.member_refs.checkpoints, checkpoints)?;
    Ok(())
}

fn ensure_trip_writable(tx: &Transaction<'_>, item_id: &str) -> DomainResult<()> {
    // This is the specialized travel-v2 path. Validate the same live root/list
    // ownership as a generic Item write, but do not call ensure_item_writable:
    // its generic ownership guard intentionally rejects travel-v2 roots.
    let list_id: Option<Option<String>> = tx
        .query_row(
            "SELECT list_id FROM productivity_item WHERE id = ?1 AND deleted_at_utc IS NULL",
            [item_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let Some(list_id) = list_id else {
        return Err(DomainError::root_not_found("item not found"));
    };
    ensure_list_writable(tx, list_id.as_deref())?;
    if !super::guards::item_has_v2_profile(tx, item_id)? {
        return Err(DomainError::root_not_found("travel v2 profile not found"));
    }
    Ok(())
}

fn cancelled_at(tx: &Transaction<'_>, item_id: &str) -> DomainResult<Option<String>> {
    tx.query_row(
        "SELECT cancelled_at_utc FROM productivity_item_travel_profile WHERE item_id = ?1",
        [item_id],
        |row| row.get(0),
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))
}

fn travel_root_type_id(tx: &Transaction<'_>) -> DomainResult<String> {
    let existing = tx.query_row(
        "SELECT id FROM productivity_item_type WHERE system_role = 'travel' AND inactive = 0 LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if let Some(id) = existing {
        return Ok(id);
    }

    // V2 owns one ItemType only. Flight/train are Transportation values, not
    // ItemType children; never adopt a same-named user classification.
    let catalog = super::super::classification::catalog_snapshot(tx)?
        .map(|catalog| catalog.id)
        .unwrap_or_else(super::super::util::new_uuid);
    let now = utc_now();
    tx.execute(
        "INSERT OR IGNORE INTO productivity_item_type_catalog(id, revision, created_at_utc, updated_at_utc) VALUES (?1, 0, ?2, ?2)",
        params![catalog, now],
    ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let has_name: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM productivity_item_type WHERE name_key IN ('travel', '出行'))",
        [], |row| row.get(0),
    ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if has_name {
        return Err(DomainError::invalid_patch("travel v2 ItemType name conflicts with an existing classification"));
    }
    let type_id = new_uuid();
    tx.execute(
        "INSERT INTO productivity_item_type(id, catalog_id, name, name_key, color_override, inactive, created_at_utc, updated_at_utc, system_role) VALUES (?1, ?2, '出行', 'travel', '#4879ED', 0, ?3, ?3, 'travel')",
        params![type_id, catalog, now],
    ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    super::super::classification::bump_catalog(tx, &catalog, &now)?;
    tx.query_row(
        "SELECT id FROM productivity_item_type WHERE system_role = 'travel' AND inactive = 0 LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
    .ok_or_else(|| DomainError::root_not_found("travel item type preset could not be initialized"))
}

fn transportation_wire_column(key: &str) -> Option<&'static str> {
    match key {
        "transportationType" => Some("transportation_type"),
        "name" => Some("name"),
        "note" => Some("note"),
        "serviceNumber" => Some("service_number"),
        "operator" => Some("operator"),
        "vehicleModel" => Some("vehicle_model"),
        "aircraftRegistration" => Some("aircraft_registration"),
        "licensePlate" => Some("license_plate"),
        "carriage" => Some("carriage"),
        "seat" => Some("seat"),
        "departureName" => Some("departure_name"),
        "arrivalName" => Some("arrival_name"),
        "departureCode" => Some("departure_code"),
        "arrivalCode" => Some("arrival_code"),
        "departureTerminal" => Some("departure_terminal"),
        "arrivalTerminal" => Some("arrival_terminal"),
        "departureGate" => Some("departure_gate"),
        "arrivalGate" => Some("arrival_gate"),
        "sourceSnapshot" => Some("source_snapshot_json"),
        _ => None,
    }
}

fn apply_transportation_patch(tx: &Transaction<'_>, tid: &str, item_id: &str, fields: &Value) -> DomainResult<bool> {
    let obj = fields.as_object().ok_or_else(|| DomainError::invalid_patch("fields object required"))?;
    for key in obj.keys() {
        if transportation_wire_column(key).is_none() {
            return Err(DomainError::invalid_patch(format!("unknown transportation field: {key}")));
        }
    }
    let snapshot = load_trip_snapshot(tx, item_id)?;
    if snapshot.profile.cancelled_at_utc.is_some() {
        return Err(DomainError::invalid_plan("cannot update transportation on cancelled trip"));
    }
    let current_type: Option<String> = tx
        .query_row(
            "SELECT transportation_type FROM productivity_transportation WHERE id = ?1 AND item_id = ?2 AND deleted_at_utc IS NULL",
            params![tid, item_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if !super::validation::transportation_type_writable(current_type.as_deref()) {
        return Err(DomainError::unknown_format_readonly("transportation type is readonly"));
    }
    if let Some(new_type) = obj.get("transportationType") {
        let new_type_str = match new_type {
            Value::Null => None,
            Value::String(s) => Some(s.as_str()),
            _ => Some(new_type.as_str().unwrap_or("")),
        };
        if !super::validation::transportation_type_writable(new_type_str) {
            return Err(DomainError::unknown_format_readonly("transportation type is readonly"));
        }
        let changing = new_type_str != current_type.as_deref();
        if changing {
            let linked: Vec<String> = snapshot
                .actions
                .iter()
                .filter(|a| a.transportation_id.as_deref() == Some(tid))
                .map(|a| a.id.clone())
                .collect();
            for action in snapshot.actions.iter().filter(|a| linked.contains(&a.id)) {
                if super::validation::action_frozen(action, snapshot.item.completed, snapshot.item.cancelled) {
                    return Err(DomainError::protected_structure(
                        "cannot change transportation type while a linked action is frozen",
                    ));
                }
            }
        }
    }
    let mut changed = false;
    let now = utc_now();
    for (key, value) in obj {
        let column = transportation_wire_column(key).unwrap();
        let param: Option<String> = match value {
            Value::Null => None,
            Value::String(s) => Some(s.clone()),
            _ if *key == "sourceSnapshot" => Some(value.to_string()),
            _ => Some(value.to_string()),
        };
        let current: Option<String> = tx
            .query_row(
                &format!("SELECT {column} FROM productivity_transportation WHERE id = ?1 AND item_id = ?2"),
                params![tid, item_id],
                |row| row.get(0),
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if current == param {
            continue;
        }
        let sql = format!(
            "UPDATE productivity_transportation SET {column} = ?1, updated_at_utc = ?2 WHERE id = ?3 AND item_id = ?4 AND deleted_at_utc IS NULL"
        );
        let n = tx
            .execute(&sql, params![param, now, tid, item_id])
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if n != 1 {
            return Err(DomainError::cross_item_reference("transportation is not a live member of this item"));
        }
        changed = true;
    }
    Ok(changed)
}

fn soft_delete_trip_members(tx: &Transaction<'_>, item_id: &str, now: &str, batch_id: Option<&str>) -> DomainResult<()> {
    tx.execute(
        "UPDATE productivity_action SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE target_kind = 'item' AND target_id = ?2",
        params![now, item_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "UPDATE productivity_checkpoint SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE target_kind = 'item' AND target_id = ?2",
        params![now, item_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "UPDATE productivity_transportation SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE item_id = ?2",
        params![now, item_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "UPDATE productivity_item_travel_point SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE item_id = ?2",
        params![now, item_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if let Some(batch) = batch_id {
        tx.execute(
            "UPDATE productivity_item SET deletion_batch_id = ?1, deleted_at_utc = ?2, updated_at_utc = ?2 WHERE id = ?3",
            params![batch, now, item_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    Ok(())
}

fn store_batch(tx: &Transaction<'_>, batch_id: &str, item_id: &str, kind: &str, manifest: &Value) -> DomainResult<()> {
    let now = utc_now();
    tx.execute(
        "INSERT INTO productivity_item_travel_mutation_batch (id, item_id, schema_version, kind, manifest_version, manifest_json, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, 1, ?3, 1, ?4, ?5, ?5)",
        params![batch_id, item_id, kind, manifest.to_string(), now],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}
