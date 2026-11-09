use std::collections::{HashMap, HashSet};

use rusqlite::{params, Transaction};
use serde_json::Value;

use super::model::*;
use super::validation::{
    action_frozen, checkpoint_frozen, parse_minute, shift_minute, validate_trip_plan,
};
use super::super::error::{DomainError, DomainResult};
use super::super::repository::{bump_action, bump_checkpoint};
use super::super::util::{new_uuid, utc_now};

pub fn apply_edit_plan(
    tx: &Transaction<'_>,
    item_id: &str,
    edit: &Value,
    resolutions: Option<&Value>,
    snapshot: &TripSnapshot,
) -> DomainResult<bool> {
    if snapshot.item.completed || snapshot.item.cancelled {
        return Err(DomainError::protected_structure("plan is frozen"));
    }
    let kind = edit
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| DomainError::invalid_plan("edit kind required"))?;
    let mut action_times: HashMap<String, (String, String)> = snapshot
        .actions
        .iter()
        .map(|a| (a.id.clone(), (a.planned_start_at.clone(), a.planned_end_at.clone())))
        .collect();
    let mut cp_times: HashMap<String, String> = snapshot
        .checkpoints
        .iter()
        .filter_map(|c| c.planned_at_utc.as_ref().map(|t| (c.id.clone(), t.clone())))
        .collect();
    let item_completed = snapshot.item.completed;
    let item_cancelled = snapshot.item.cancelled;

    match kind {
        "moveGroup" => {
            let ids = string_array(edit.get("actionIds"))?;
            let delta = edit
                .get("deltaMinutes")
                .and_then(Value::as_i64)
                .ok_or_else(|| DomainError::invalid_plan("deltaMinutes required"))?;
            let group = connected_group(&snapshot.actions, &ids)?;
            for id in group {
                let action = snapshot.actions.iter().find(|a| a.id == id).unwrap();
                if action_frozen(action, item_completed, item_cancelled) {
                    return Err(DomainError::protected_structure("group member is frozen"));
                }
                let (start, end) = action_times.get(&id).unwrap().clone();
                action_times.insert(
                    id,
                    (shift_minute(&start, delta)?, shift_minute(&end, delta)?),
                );
            }
        }
        "moveDetached" => {
            let id = edit
                .get("actionId")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("actionId required"))?;
            let delta = edit
                .get("deltaMinutes")
                .and_then(Value::as_i64)
                .ok_or_else(|| DomainError::invalid_plan("deltaMinutes required"))?;
            let action = snapshot
                .actions
                .iter()
                .find(|a| a.id == id)
                .ok_or_else(|| DomainError::root_not_found("action not found"))?;
            if action_frozen(action, item_completed, item_cancelled) {
                return Err(DomainError::protected_structure("action is frozen"));
            }
            let policies = split_policies(edit.get("splitPolicies"));
            let (start, end) = action_times.get(id).unwrap().clone();
            let new_start = shift_minute(&start, delta)?;
            let new_end = shift_minute(&end, delta)?;
            apply_detach_point_splits(tx, item_id, snapshot, id, &start, &end, &new_start, &new_end, &policies)?;
            action_times.insert(id.to_string(), (new_start, new_end));
        }
        "setBoundary" => {
            let id = edit
                .get("actionId")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("actionId required"))?;
            let side = edit
                .get("side")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("side required"))?;
            let at = edit
                .get("plannedAtUtc")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("plannedAtUtc required"))?;
            parse_minute(at)?;
            let action = snapshot
                .actions
                .iter()
                .find(|a| a.id == id)
                .ok_or_else(|| DomainError::root_not_found("action not found"))?;
            if action_frozen(action, item_completed, item_cancelled) {
                return Err(DomainError::protected_structure("action is frozen"));
            }
            let (start, end) = action_times.get(id).unwrap().clone();
            let (new_start, new_end) = match side {
                "start" => (at.to_string(), end),
                "end" => (start, at.to_string()),
                _ => return Err(DomainError::invalid_plan("side must be start or end")),
            };
            if parse_minute(&new_start)? >= parse_minute(&new_end)? {
                return Err(DomainError::invalid_plan("action interval must be positive"));
            }
            action_times.insert(id.to_string(), (new_start, new_end));
        }
        "setSharedBoundary" => {
            let front_id = edit
                .get("frontActionId")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("frontActionId required"))?;
            let rear_id = edit
                .get("rearActionId")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("rearActionId required"))?;
            let zone = edit
                .get("zone")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("zone required"))?;
            let at = edit
                .get("plannedAtUtc")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("plannedAtUtc required"))?;
            parse_minute(at)?;
            let front = snapshot
                .actions
                .iter()
                .find(|a| a.id == front_id)
                .ok_or_else(|| DomainError::root_not_found("front action not found"))?;
            let rear = snapshot
                .actions
                .iter()
                .find(|a| a.id == rear_id)
                .ok_or_else(|| DomainError::root_not_found("rear action not found"))?;
            if action_frozen(front, item_completed, item_cancelled) || action_frozen(rear, item_completed, item_cancelled) {
                return Err(DomainError::protected_structure("shared boundary action is frozen"));
            }
            let (f_start, f_end) = action_times.get(front_id).unwrap().clone();
            let (r_start, r_end) = action_times.get(rear_id).unwrap().clone();
            if parse_minute(&f_end)? == parse_minute(at)? && parse_minute(&r_start)? == parse_minute(at)? {
                return Ok(false);
            }
            let requested_minute = parse_minute(at)?;
            let (new_f_end, new_r_start) = match zone {
                "both" => (at.to_string(), at.to_string()),
                "frontEnd" => (
                    if requested_minute == parse_minute(&f_end)? { f_end.clone() } else { at.to_string() },
                    r_start.clone(),
                ),
                "rearStart" => (
                    f_end.clone(),
                    if requested_minute == parse_minute(&r_start)? { r_start.clone() } else { at.to_string() },
                ),
                _ => return Err(DomainError::invalid_plan("invalid shared boundary zone")),
            };
            if parse_minute(&f_start)? >= parse_minute(&new_f_end)? || parse_minute(&new_r_start)? >= parse_minute(&r_end)? {
                return Err(DomainError::invalid_plan("action interval must be positive"));
            }
            // A one-sided edit detaches the shared point; keep text allocation atomic
            // with the plan update per docs/specs/travel-item-storage.proposed.md §7, §9.
            if parse_minute(&f_end)? == parse_minute(&r_start)? && requested_minute != parse_minute(&f_end)? {
                let policies = split_policies(edit.get("splitPolicies"));
                match zone {
                    "frontEnd" => split_shared_endpoint(
                        tx, item_id, snapshot, front_id, rear_id, "end", "start",
                        &policies.moving_front_end, &utc_now(),
                    )?,
                    "rearStart" => split_shared_endpoint(
                        tx, item_id, snapshot, front_id, rear_id, "end", "start",
                        &policies.moving_rear_start, &utc_now(),
                    )?,
                    _ => {}
                }
            }
            action_times.insert(front_id.to_string(), (f_start, new_f_end));
            action_times.insert(rear_id.to_string(), (new_r_start, r_end));
        }
        "moveCheckpoint" => {
            let cp_id = edit
                .get("checkpointId")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("checkpointId required"))?;
            let at = edit
                .get("plannedAtUtc")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("plannedAtUtc required"))?;
            parse_minute(at)?;
            let cp = snapshot
                .checkpoints
                .iter()
                .find(|c| c.id == cp_id)
                .ok_or_else(|| DomainError::root_not_found("checkpoint not found"))?;
            if checkpoint_frozen(cp, item_completed, item_cancelled) {
                return Err(DomainError::protected_structure("checkpoint is frozen"));
            }
            cp_times.insert(cp_id.to_string(), at.to_string());
        }
        "setRange" => {
            let id = edit
                .get("actionId")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("actionId required"))?;
            let start = edit
                .get("plannedStartAt")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("plannedStartAt required"))?;
            let end = edit
                .get("plannedEndAt")
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::invalid_plan("plannedEndAt required"))?;
            parse_minute(start)?;
            parse_minute(end)?;
            if parse_minute(start)? >= parse_minute(end)? {
                return Err(DomainError::invalid_plan("action interval must be positive"));
            }
            let action = snapshot
                .actions
                .iter()
                .find(|a| a.id == id)
                .ok_or_else(|| DomainError::root_not_found("action not found"))?;
            if action_frozen(action, item_completed, item_cancelled) {
                return Err(DomainError::protected_structure("action is frozen"));
            }
            action_times.insert(id.to_string(), (start.to_string(), end.to_string()));
        }
        _ => return Err(DomainError::invalid_plan("unsupported edit kind")),
    }

    let planned_actions: Vec<TripActionView> = snapshot
        .actions
        .iter()
        .map(|a| {
            let (start, end) = action_times.get(&a.id).unwrap().clone();
            TripActionView {
                planned_start_at: start,
                planned_end_at: end,
                ..a.clone()
            }
        })
        .collect();
    let planned_checkpoints: Vec<super::super::types::CheckpointSnapshot> = snapshot
        .checkpoints
        .iter()
        .map(|c| {
            let mut cp = c.clone();
            if let Some(at) = cp_times.get(&c.id) {
                cp.planned_at_utc = Some(at.clone());
            }
            cp
        })
        .collect();
    validate_trip_plan(&planned_actions, &planned_checkpoints)?;
    detect_point_merge_conflicts(snapshot, &planned_actions, &planned_checkpoints, resolutions)?;

    let now = utc_now();
    let mut any_changed = false;
    if let Some(list) = resolutions.and_then(Value::as_array) {
        if !list.is_empty() {
            apply_point_merge_resolutions(
                tx,
                item_id,
                snapshot,
                &planned_actions,
                &planned_checkpoints,
                list,
                &now,
            )?;
            any_changed = true;
        }
    }
    for action in &planned_actions {
        let prev = snapshot.actions.iter().find(|a| a.id == action.id);
        let changed = prev.map(|p| p.planned_start_at != action.planned_start_at || p.planned_end_at != action.planned_end_at).unwrap_or(true);
        if !changed {
            continue;
        }
        any_changed = true;
        tx.execute(
            "UPDATE productivity_action SET planned_start_at = ?1, planned_end_at = ?2, updated_at_utc = ?3 WHERE id = ?4",
            params![action.planned_start_at, action.planned_end_at, now, action.id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        bump_action(tx, &action.id, &now)?;
    }
    for cp in &planned_checkpoints {
        if let Some(at) = &cp.planned_at_utc {
            let prev = snapshot.checkpoints.iter().find(|c| c.id == cp.id);
            let prev_at = prev.and_then(|c| c.planned_at_utc.as_deref());
            if prev_at == Some(at.as_str()) {
                continue;
            }
            any_changed = true;
            tx.execute(
                "UPDATE productivity_checkpoint SET planned_at_utc = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![at, now, cp.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_checkpoint(tx, &cp.id, &now)?;
        }
    }
    Ok(any_changed)
}

fn string_array(value: Option<&Value>) -> DomainResult<Vec<String>> {
    let arr = value
        .and_then(Value::as_array)
        .ok_or_else(|| DomainError::invalid_plan("actionIds array required"))?;
    Ok(arr.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
}

fn connected_group(actions: &[TripActionView], requested: &[String]) -> DomainResult<Vec<String>> {
    if requested.is_empty() {
        return Err(DomainError::invalid_plan("actionIds must not be empty"));
    }
    let mut sorted = actions.to_vec();
    sorted.sort_by(|a, b| a.planned_start_at.cmp(&b.planned_start_at).then(a.id.cmp(&b.id)));
    let mut components: Vec<Vec<String>> = Vec::new();
    let mut current = vec![sorted[0].id.clone()];
    for pair in sorted.windows(2) {
        if pair[0].planned_end_at == pair[1].planned_start_at {
            current.push(pair[1].id.clone());
        } else {
            components.push(current);
            current = vec![pair[1].id.clone()];
        }
    }
    components.push(current);
    let set: HashSet<_> = requested.iter().cloned().collect();
    for component in &components {
        let comp_set: HashSet<_> = component.iter().cloned().collect();
        if set.is_subset(&comp_set) {
            let mut ordered = Vec::new();
            for id in component {
                if set.contains(id) {
                    ordered.push(id.clone());
                }
            }
            if ordered.len() == requested.len() {
                return Ok(ordered);
            }
        }
    }
    Err(DomainError::invalid_plan("actionIds must form one contiguous connected group"))
}

struct SplitPolicies {
    moving_front_end: String,
    moving_rear_start: String,
}

fn split_policies(value: Option<&Value>) -> SplitPolicies {
    let default = "copy".to_string();
    let obj = value.and_then(Value::as_object);
    SplitPolicies {
        moving_front_end: obj
            .and_then(|o| o.get("movingFrontEnd"))
            .and_then(Value::as_str)
            .unwrap_or("copy")
            .to_string(),
        moving_rear_start: obj
            .and_then(|o| o.get("movingRearStart"))
            .and_then(Value::as_str)
            .unwrap_or("copy")
            .to_string(),
    }
}

fn apply_detach_point_splits(
    tx: &Transaction<'_>,
    item_id: &str,
    snapshot: &TripSnapshot,
    action_id: &str,
    old_start: &str,
    old_end: &str,
    new_start: &str,
    new_end: &str,
    policies: &SplitPolicies,
) -> DomainResult<()> {
    let now = utc_now();
    if old_start != new_start {
        let front = snapshot.actions.iter().find(|a| a.planned_end_at == old_start);
        if let Some(front) = front {
            split_shared_endpoint(tx, item_id, snapshot, &front.id, action_id, "end", "start", &policies.moving_rear_start, &now)?;
        }
    }
    if old_end != new_end {
        let rear = snapshot.actions.iter().find(|a| a.planned_start_at == old_end);
        if let Some(rear) = rear {
            split_shared_endpoint(tx, item_id, snapshot, action_id, &rear.id, "end", "start", &policies.moving_front_end, &now)?;
        }
    }
    Ok(())
}

fn split_shared_endpoint(
    tx: &Transaction<'_>,
    item_id: &str,
    snapshot: &TripSnapshot,
    front_action_id: &str,
    rear_action_id: &str,
    front_role: &str,
    rear_role: &str,
    policy: &str,
    now: &str,
) -> DomainResult<()> {
    let shared = snapshot.points.iter().find(|p| {
        p.action_id.as_deref() == Some(rear_action_id) && p.role == rear_role
    });
    if shared.is_none() {
        return Ok(());
    }
    let shared = shared.unwrap();
    let front = snapshot.points.iter().find(|p| {
        p.action_id.as_deref() == Some(front_action_id) && p.role == front_role
    });
    // A joined point is normally stored on the rear start; append also leaves an
    // empty row on the front end. Merge compatible fields without discarding either.
    let action_label = merge_shared_field(front.and_then(|p| p.action_label.as_ref()), shared.action_label.as_ref())?;
    let location = merge_shared_field(front.and_then(|p| p.location.as_ref()), shared.location.as_ref())?;
    let note = merge_shared_field(front.and_then(|p| p.note.as_ref()), shared.note.as_ref())?;
    match policy {
        "copy" => {
            update_point_text(tx, shared, action_label.as_deref(), location.as_deref(), note.as_deref(), now)?;
            if let Some(front) = front {
                update_point_text(tx, front, action_label.as_deref(), location.as_deref(), note.as_deref(), now)?;
            } else {
                insert_point(tx, item_id, front_action_id, front_role, action_label.as_deref(), location.as_deref(), note.as_deref(), now)?;
            }
        }
        "front" => {
            if let Some(front) = front {
                tx.execute(
                    "UPDATE productivity_item_travel_point SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE id = ?2",
                    params![now, front.id],
                ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
            tx.execute(
                "UPDATE productivity_item_travel_point SET action_id = ?1, role = ?2, action_label = ?3, location = ?4, note = ?5, updated_at_utc = ?6 WHERE id = ?7",
                params![front_action_id, front_role, action_label, location, note, now, shared.id],
            ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            insert_point(tx, item_id, rear_action_id, rear_role, None, None, None, now)?;
        }
        "rear" => {
            update_point_text(tx, shared, action_label.as_deref(), location.as_deref(), note.as_deref(), now)?;
            if let Some(front) = front {
                update_point_text(tx, front, None, None, None, now)?;
            } else {
                insert_point(tx, item_id, front_action_id, front_role, None, None, None, now)?;
            }
        }
        _ => return Err(DomainError::invalid_plan("invalid split policy")),
    }
    Ok(())
}

fn merge_shared_field(front: Option<&String>, rear: Option<&String>) -> DomainResult<Option<String>> {
    let front = front.filter(|value| !value.trim().is_empty());
    let rear = rear.filter(|value| !value.trim().is_empty());
    match (front, rear) {
        (Some(a), Some(b)) if a != b => Err(DomainError::point_merge_required(
            "shared point contains conflicting endpoint fields",
        )),
        (Some(value), _) | (_, Some(value)) => Ok(Some(value.clone())),
        (None, None) => Ok(None),
    }
}

fn update_point_text(
    tx: &Transaction<'_>,
    point: &TravelPointDto,
    action_label: Option<&str>,
    location: Option<&str>,
    note: Option<&str>,
    now: &str,
) -> DomainResult<()> {
    tx.execute(
        "UPDATE productivity_item_travel_point SET action_label = ?1, location = ?2, note = ?3, updated_at_utc = ?4 WHERE id = ?5",
        params![action_label, location, note, now, point.id],
    ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

fn insert_point(
    tx: &Transaction<'_>,
    item_id: &str,
    action_id: &str,
    role: &str,
    action_label: Option<&str>,
    location: Option<&str>,
    note: Option<&str>,
    now: &str,
) -> DomainResult<()> {
    tx.execute(
        "INSERT INTO productivity_item_travel_point (id, item_id, schema_version, attachment_kind, action_id, role, action_label, location, note, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, 1, 'action', ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![new_uuid(), item_id, action_id, role, action_label, location, note, now],
    ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

fn detect_point_merge_conflicts(
    snapshot: &TripSnapshot,
    actions: &[TripActionView],
    checkpoints: &[super::super::types::CheckpointSnapshot],
    resolutions: Option<&Value>,
) -> DomainResult<()> {
    let mut minute_owners: HashMap<String, Vec<String>> = HashMap::new();
    for action in actions {
        minute_owners
            .entry(action.planned_start_at.clone())
            .or_default()
            .push(format!("action:{}:start", action.id));
        minute_owners
            .entry(action.planned_end_at.clone())
            .or_default()
            .push(format!("action:{}:end", action.id));
    }
    for cp in checkpoints {
        if let Some(at) = &cp.planned_at_utc {
            minute_owners.entry(at.clone()).or_default().push(format!("cp:{}", cp.id));
        }
    }
    let resolution_list = resolutions.and_then(Value::as_array);
    for (minute, owners) in minute_owners {
        if owners.len() <= 1 {
            continue;
        }
        if owners.iter().any(|owner| flight_endpoint_owner(snapshot, owner)) {
            return Err(DomainError::invalid_plan(
                "flight endpoints cannot be shared with other points",
            ));
        }
        let point_rows: Vec<&TravelPointDto> = snapshot
            .points
            .iter()
            .filter(|p| point_planned_minute(p, actions, checkpoints) == Some(minute.clone()))
            .collect();
        if point_rows.len() <= 1 {
            continue;
        }
        if fields_compatible(&point_rows) {
            continue;
        }
        if !resolution_list.is_some_and(|list| !list.is_empty()) {
            return Err(DomainError::point_merge_required(
                "conflicting point fields at the same planned minute require resolutions",
            ));
        }
    }
    Ok(())
}

fn flight_endpoint_owner(snapshot: &TripSnapshot, owner: &str) -> bool {
    let Some(action_id) = owner.strip_prefix("action:").and_then(|rest| rest.rsplit_once(':').map(|(id, _)| id)) else {
        return false;
    };
    let Some(action) = snapshot.actions.iter().find(|a| a.id == action_id) else {
        return false;
    };
    let Some(transport_id) = action.transportation_id.as_deref() else {
        return false;
    };
    snapshot
        .transportations
        .iter()
        .any(|t| t.id == transport_id && t.transportation_type.as_deref() == Some("flight"))
}

fn point_planned_minute(
    point: &TravelPointDto,
    actions: &[TripActionView],
    checkpoints: &[super::super::types::CheckpointSnapshot],
) -> Option<String> {
    if let Some(cp_id) = &point.checkpoint_id {
        return checkpoints
            .iter()
            .find(|c| c.id == *cp_id)
            .and_then(|c| c.planned_at_utc.clone());
    }
    let action_id = point.action_id.as_deref()?;
    let action = actions.iter().find(|a| a.id == action_id)?;
    Some(if point.role == "start" {
        action.planned_start_at.clone()
    } else {
        action.planned_end_at.clone()
    })
}

fn fields_compatible(points: &[&TravelPointDto]) -> bool {
    conflicting_point_fields(points).is_empty()
}

fn apply_point_merge_resolutions(
    tx: &Transaction<'_>,
    item_id: &str,
    snapshot: &TripSnapshot,
    actions: &[TripActionView],
    checkpoints: &[super::super::types::CheckpointSnapshot],
    resolutions: &[Value],
    now: &str,
) -> DomainResult<()> {
    let mut minute_owners: HashMap<String, Vec<String>> = HashMap::new();
    for action in actions {
        minute_owners
            .entry(action.planned_start_at.clone())
            .or_default()
            .push(format!("action:{}:start", action.id));
        minute_owners
            .entry(action.planned_end_at.clone())
            .or_default()
            .push(format!("action:{}:end", action.id));
    }
    for cp in checkpoints {
        if let Some(at) = &cp.planned_at_utc {
            minute_owners.entry(at.clone()).or_default().push(format!("cp:{}", cp.id));
        }
    }

    for (minute, owners) in minute_owners {
        if owners.len() <= 1 {
            continue;
        }
        let point_rows: Vec<&TravelPointDto> = snapshot
            .points
            .iter()
            .filter(|p| point_planned_minute(p, actions, checkpoints) == Some(minute.clone()))
            .collect();
        if point_rows.len() <= 1 || fields_compatible(&point_rows) {
            continue;
        }
        let canonical_id = canonical_point_id_for_minute(&minute, actions, checkpoints, snapshot)?;
        let point_ids: HashSet<String> = point_rows.iter().map(|p| p.id.clone()).collect();
        let conflicting = conflicting_point_fields(&point_rows);
        if conflicting.is_empty() {
            continue;
        }
        let covered = resolved_fields_for_minute(resolutions, &point_ids);
        if !conflicting.is_subset(&covered) {
            return Err(DomainError::point_merge_required(
                "conflicting point fields at the same planned minute require resolutions for every field",
            ));
        }
        for field in &conflicting {
            let entry = resolutions
                .iter()
                .find(|e| {
                    let sources: HashSet<String> = e
                        .get("sourcePointIds")
                        .and_then(Value::as_array)
                        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
                        .unwrap_or_default();
                    !sources.is_disjoint(&point_ids)
                        && e.get("field").and_then(Value::as_str) == Some(field.as_str())
                })
                .ok_or_else(|| DomainError::point_merge_required("missing merge resolution for field"))?;
            let column = match field.as_str() {
                "actionLabel" => "action_label",
                "location" => "location",
                "note" => "note",
                _ => return Err(DomainError::invalid_plan("unsupported merge resolution field")),
            };
            let chosen: Option<String> = match entry.get("chosenValue") {
                Some(Value::Null) => None,
                Some(Value::String(s)) => Some(s.clone()),
                _ => None,
            };
            let sql = format!(
                "UPDATE productivity_item_travel_point SET {column} = ?1, updated_at_utc = ?2 WHERE id = ?3 AND item_id = ?4"
            );
            tx.execute(&sql, params![chosen, now, canonical_id, item_id])
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        }
        for point in point_rows {
            if point.id != canonical_id {
                tx.execute(
                    "UPDATE productivity_item_travel_point SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE id = ?2 AND item_id = ?3",
                    params![now, point.id, item_id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
        }
    }
    Ok(())
}

fn conflicting_point_fields(points: &[&TravelPointDto]) -> HashSet<String> {
    let mut out = HashSet::new();
    if points.len() <= 1 {
        return out;
    }
    let labels: HashSet<_> = points.iter().filter_map(|p| p.action_label.as_ref()).filter(|v| !v.trim().is_empty()).collect();
    if labels.len() > 1 {
        out.insert("actionLabel".to_string());
    }
    let locations: HashSet<_> = points.iter().filter_map(|p| p.location.as_ref()).filter(|v| !v.trim().is_empty()).collect();
    if locations.len() > 1 {
        out.insert("location".to_string());
    }
    let notes: HashSet<_> = points.iter().filter_map(|p| p.note.as_ref()).filter(|v| !v.trim().is_empty()).collect();
    if notes.len() > 1 {
        out.insert("note".to_string());
    }
    out
}

fn resolved_fields_for_minute(resolutions: &[Value], point_ids: &HashSet<String>) -> HashSet<String> {
    let mut out = HashSet::new();
    for entry in resolutions {
        let sources: HashSet<String> = entry
            .get("sourcePointIds")
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
            .unwrap_or_default();
        if sources.is_disjoint(point_ids) {
            continue;
        }
        if let Some(field) = entry.get("field").and_then(Value::as_str) {
            out.insert(field.to_string());
        }
    }
    out
}

fn canonical_point_id_for_minute(
    minute: &str,
    actions: &[TripActionView],
    checkpoints: &[super::super::types::CheckpointSnapshot],
    snapshot: &TripSnapshot,
) -> DomainResult<String> {
    let users = super::point_transfer::remaining_users_at_minute(minute, "", actions, checkpoints);
    let owner = super::point_transfer::pick_canonical_user(&users)
        .ok_or_else(|| DomainError::invalid_plan("canonical owner missing for merge"))?;
    let point_id = match &owner {
        super::point_transfer::MinuteUser::ActionStart(id) => snapshot
            .points
            .iter()
            .find(|p| p.action_id.as_deref() == Some(id.as_str()) && p.role == "start")
            .map(|p| p.id.clone())
            .unwrap_or_else(|| id.clone()),
        super::point_transfer::MinuteUser::ActionEnd(id) => snapshot
            .points
            .iter()
            .find(|p| p.action_id.as_deref() == Some(id.as_str()) && p.role == "end")
            .map(|p| p.id.clone())
            .unwrap_or_else(|| id.clone()),
        super::point_transfer::MinuteUser::Checkpoint(id) => snapshot
            .points
            .iter()
            .find(|p| p.checkpoint_id.as_deref() == Some(id.as_str()))
            .map(|p| p.id.clone())
            .unwrap_or_else(|| id.clone()),
    };
    Ok(point_id)
}

pub fn persist_split_action(
    tx: &Transaction<'_>,
    item_id: &str,
    payload: &SplitPayload,
    snapshot: &TripSnapshot,
) -> DomainResult<()> {
    if !snapshot.capabilities.can_edit_structure {
        return Err(DomainError::protected_structure("structure is frozen"));
    }
    parse_minute(&payload.split_at)?;
    let action = snapshot
        .actions
        .iter()
        .find(|a| a.id == payload.action_id)
        .ok_or_else(|| DomainError::root_not_found("action not found"))?;
    if action_frozen(action, snapshot.item.completed, snapshot.item.cancelled) {
        return Err(DomainError::protected_structure("action is frozen"));
    }
    let start_at = parse_minute(&action.planned_start_at)?;
    let end_at = parse_minute(&action.planned_end_at)?;
    let split = parse_minute(&payload.split_at)?;
    if split <= start_at || split >= end_at {
        return Err(DomainError::invalid_plan("split must be strictly inside action interval"));
    }
    let end_point = snapshot
        .points
        .iter()
        .find(|p| p.action_id.as_deref() == Some(payload.action_id.as_str()) && p.role == "end")
        .ok_or_else(|| DomainError::root_not_found("action end point not found"))?;
    let now = utc_now();
    tx.execute(
        "UPDATE productivity_action SET planned_end_at = ?1, revision = revision + 1, updated_at_utc = ?2 WHERE id = ?3",
        params![payload.split_at, now, payload.action_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    super::super::repository::insert_action(
        tx,
        &payload.new_action_id,
        TRAVEL_ACTION_TITLE,
        None,
        None,
        Some("item"),
        Some(item_id),
        Some(&payload.split_at),
        Some(&action.planned_end_at),
        None,
        false,
        None,
        &now,
    )?;
    tx.execute(
        "INSERT INTO productivity_transportation (id, item_id, schema_version, transportation_type, name, note, service_number, operator, vehicle_model,
         aircraft_registration, license_plate, carriage, seat, departure_name, arrival_name, departure_code, arrival_code,
         departure_terminal, arrival_terminal, departure_gate, arrival_gate, created_at_utc, updated_at_utc)
         SELECT ?1, item_id, schema_version, transportation_type, name, note, service_number, operator, vehicle_model,
         aircraft_registration, license_plate, carriage, seat, departure_name, arrival_name, departure_code, arrival_code,
         departure_terminal, arrival_terminal, departure_gate, arrival_gate, ?2, ?2
         FROM productivity_transportation WHERE id = (SELECT transportation_id FROM productivity_action WHERE id = ?3)",
        params![payload.new_transportation_id, now, payload.action_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "UPDATE productivity_action SET transportation_id = ?1, name_link_mode = 'unlinked' WHERE id = ?2",
        params![payload.new_transportation_id, payload.new_action_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    // Old end point stays on the front (remaining) segment; new start point on the rear segment (new identity).
    tx.execute(
        "INSERT INTO productivity_item_travel_point (id, item_id, schema_version, attachment_kind, action_id, role, action_label, location, note, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, 1, 'action', ?3, 'start', ?4, ?5, ?6, ?7, ?7)",
        params![
            payload.new_point_id,
            item_id,
            payload.new_action_id,
            end_point.action_label,
            end_point.location,
            end_point.note,
            now
        ],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rear_end_id = new_uuid();
    tx.execute(
        "INSERT INTO productivity_item_travel_point (id, item_id, schema_version, attachment_kind, action_id, role, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, 1, 'action', ?3, 'end', ?4, ?4)",
        params![rear_end_id, item_id, payload.new_action_id, now],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    bump_action(tx, &payload.action_id, &now)?;
    bump_action(tx, &payload.new_action_id, &now)?;
    Ok(())
}
