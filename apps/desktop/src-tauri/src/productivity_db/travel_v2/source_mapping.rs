use chrono::TimeZone;
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::{json, Map, Value};

use super::actual::ActualSideWrite;
use super::model::*;
use super::read::{load_action_actual, load_trip_snapshot};
use super::validation::{
    action_frozen, parse_minute, validate_cross_action_actual_order, validate_finish_actuals,
    validate_trip_plan,
};
use super::super::error::{DomainError, DomainResult};
use super::super::util::utc_now;

pub fn verify_restore_baseline_generation(
    restore_baseline_generation: Option<u64>,
    query_generation: u64,
) -> DomainResult<()> {
    if let Some(baseline) = restore_baseline_generation {
        if baseline != query_generation {
            return Err(DomainError::query_context_expired("restore baseline generation mismatch"));
        }
    }
    Ok(())
}

pub fn adopt_flight_fields(
    tx: &Transaction<'_>,
    transportation_id: &str,
    item_id: &str,
    item_revision: i64,
    expected_data_dir: &str,
    candidate: &Value,
    raw: Option<&Value>,
    adoption_token: &str,
    query_generation: u64,
    restore_baseline_generation: Option<u64>,
    selected_fields: Option<&[String]>,
    snapshot: &TripSnapshot,
) -> DomainResult<Value> {
    verify_restore_baseline_generation(restore_baseline_generation, query_generation)?;
    verify_adoption_token(
        adoption_token,
        item_id,
        transportation_id,
        expected_data_dir,
        query_generation,
        item_revision,
    )?;
    // Selected confirm is an allowlist in this same transaction (ADR 0042 / handoff §14).
    if let Some(fields) = selected_fields {
        for field in fields {
            if !known_adoption_field(field) {
                return Err(DomainError::invalid_patch(format!("unsupported adoption field: {field}")));
            }
        }
    }
    let mode = AdoptionMode { selected: selected_fields };
    let raw_record = raw.unwrap_or(candidate);
    let linked_actions: Vec<&TripActionView> = snapshot
        .actions
        .iter()
        .filter(|a| a.transportation_id.as_deref() == Some(transportation_id))
        .collect();
    let mut adopted: Vec<Value> = Vec::new();
    let mut skipped: Vec<Value> = Vec::new();
    let mut conflicting: Vec<Value> = Vec::new();
    let mut before_values = Map::new();
    let mut adopted_values = Map::new();
    let previous_point_adopted_values = snapshot
        .transportations
        .iter()
        .find(|t| t.id == transportation_id)
        .and_then(|t| t.source_snapshot.as_ref())
        .and_then(|s| s.get("adoptionReport"))
        .and_then(|r| r.get("pointAdoptedValues"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let previous_point_before_values = snapshot
        .transportations
        .iter()
        .find(|t| t.id == transportation_id)
        .and_then(|t| t.source_snapshot.as_ref())
        .and_then(|s| s.get("adoptionReport"))
        .and_then(|r| r.get("pointBeforeValues"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    // Carry forward prior ownership baselines even when a user edits or clears a
    // field; otherwise the next adoption could mistake that edit for an empty
    // field that is safe to fill.
    let mut point_adopted_values = previous_point_adopted_values.clone();
    let mut point_before_values = previous_point_before_values.clone();
    let now = utc_now();

    let patches = flight_metadata_patches(candidate);
    for (wire, value) in patches {
        if !mode.allows(&wire) {
            continue;
        }
        let before = read_transportation_field(tx, transportation_id, &wire)?;
        before_values.insert(wire.clone(), before.clone());
        if value.is_null() {
            push_skip(&mut skipped, &wire, "empty source value");
            continue;
        }
        if let Err(e) = apply_transportation_field(tx, transportation_id, item_id, &wire, &value, &now) {
            if mode.strict() {
                return Err(e);
            }
            push_conflict(&mut conflicting, &wire, &e.to_string());
            continue;
        }
        adopted_values.insert(wire.clone(), value.clone());
        push_adopted(&mut adopted, &wire);
    }

    if linked_actions.len() == 1 {
        let action = linked_actions[0];
        let plan_written = adopt_plan_pair(
            tx,
            action,
            candidate,
            &mode,
            snapshot.item.completed,
            snapshot.item.cancelled,
            &mut adopted,
            &mut skipped,
            &mut conflicting,
        )?;
        if plan_written {
            write_flight_endpoint_points(
                tx,
                &action.id,
                candidate,
                &now,
                &mode,
                &previous_point_adopted_values,
                &previous_point_before_values,
                &mut point_adopted_values,
                &mut point_before_values,
            )?;
            if mode.strict() {
                let latest = load_trip_snapshot(tx, item_id)?;
                validate_trip_plan(&latest.actions, &latest.checkpoints)?;
            }
        } else if mode.strict()
            && (mode.allows("start.location")
                || mode.allows("end.location")
                || mode.allows("start.actionLabel")
                || mode.allows("end.actionLabel"))
        {
            write_flight_endpoint_points(
                tx,
                &action.id,
                candidate,
                &now,
                &mode,
                &previous_point_adopted_values,
                &previous_point_before_values,
                &mut point_adopted_values,
                &mut point_before_values,
            )?;
        }
        let arrived = adopt_actual_sides(
            tx,
            action,
            candidate,
            snapshot,
            &mode,
            &mut adopted,
            &mut skipped,
            &mut conflicting,
        )?;
        if mode.strict() && (mode.allows("actualStart") || mode.allows("actualEnd")) {
            // Validate the complete after-state in this transaction: selected sides may
            // replace a full interval, so validating an intermediate boundary can reject
            // a valid refresh, while omitting this check can overlap a later segment.
            let latest = load_trip_snapshot(tx, item_id)?;
            validate_cross_action_actual_order(&latest.actions, &action.id, None)?;
        }
        if arrived {
            mark_flight_arrived(tx, &action.id, item_id, &now)?;
        }
    } else if linked_actions.len() > 1 {
        for field in ["plannedStartAt", "plannedEndAt", "actualStart", "actualEnd"] {
            if mode.allows(field) && mode.strict() {
                return Err(DomainError::invalid_patch(
                    "shared transportation: plan/actual mapping skipped",
                ));
            }
            push_skip(&mut skipped, field, "shared transportation: plan/actual mapping skipped");
        }
    }

    let previous_raw = snapshot
        .transportations
        .iter()
        .find(|t| t.id == transportation_id)
        .and_then(|t| t.source_snapshot.as_ref())
        .and_then(|s| s.get("raw"))
        .cloned();
    let merged_raw = merge_raw_unknown(previous_raw.as_ref(), raw_record);
    let adoption_token_out = build_adoption_token(
        item_id,
        transportation_id,
        expected_data_dir,
        query_generation,
        item_revision,
    );
    let adoption_report = json!({
        "adopted": adopted,
        "skipped": skipped,
        "conflicting": conflicting,
        "adoptionToken": adoption_token_out,
        "beforeValues": before_values,
        "adoptedValues": adopted_values,
        // Keep endpoint ownership separate from the transportation field list: the
        // existing restore UI only operates on transportation columns.
        "pointBeforeValues": point_before_values,
        "pointAdoptedValues": point_adopted_values,
    });
    let fetched_at = candidate
        .get("fetchedAtUtc")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&now);
    let source_record_key = adoption_source_record_key(candidate);
    let snapshot_json = json!({
        "provider": "variflight",
        "queriedAt": fetched_at,
        "fetchedAtUtc": fetched_at,
        "sourceRecordKey": source_record_key,
        "queryGeneration": query_generation,
        "raw": merged_raw,
        "mappingVersion": 1,
        "adoptionReport": adoption_report,
        "adoptionToken": adoption_token_out,
    });
    tx.execute(
        "UPDATE productivity_transportation SET source_snapshot_json = ?1, updated_at_utc = ?2 WHERE id = ?3 AND item_id = ?4",
        params![snapshot_json.to_string(), now, transportation_id, item_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(adoption_report)
}

pub fn restore_adoption_patch(
    tx: &Transaction<'_>,
    transportation_id: &str,
    fields: &[String],
    expected: &Value,
    before_values: Option<&Value>,
) -> DomainResult<()> {
    let now = utc_now();
    for field in fields {
        let current = read_transportation_field(tx, transportation_id, field)?;
        let expected_value = expected
            .get(field)
            .ok_or_else(|| DomainError::invalid_patch("missing expected value"))?;
        if current != *expected_value {
            return Err(DomainError::restore_conflict("field value changed since adoption baseline"));
        }
        let restore_to = match before_values {
            Some(bv) => bv
                .get(field)
                .cloned()
                .ok_or_else(|| DomainError::invalid_patch("missing before value for field"))?,
            None => Value::Null,
        };
        apply_transportation_field(tx, transportation_id, "", field, &restore_to, &now)?;
    }
    Ok(())
}

/// Restore path: bind token to item, transportation, and data dir; require `queryGeneration` in token.
/// Does not compare `itemRevision` to the live item (adopt bumps revision after minting the token).
pub fn verify_adoption_token_for_restore(
    token: &str,
    item_id: &str,
    transportation_id: &str,
    expected_data_dir: &str,
) -> DomainResult<()> {
    if token.trim().is_empty() {
        return Err(DomainError::invalid_patch("adoption token required"));
    }
    let parsed: Value = serde_json::from_str(token)
        .map_err(|_| DomainError::invalid_patch("adoption token must be json"))?;
    if parsed.get("queryGeneration").and_then(Value::as_u64).is_none() {
        return Err(DomainError::invalid_patch("adoption token missing queryGeneration"));
    }
    let identity_ok = parsed.get("itemId").and_then(Value::as_str) == Some(item_id)
        && parsed.get("transportationId").and_then(Value::as_str) == Some(transportation_id)
        && parsed.get("expectedDataDir").and_then(Value::as_str) == Some(expected_data_dir);
    if !identity_ok {
        return Err(DomainError::query_context_expired("adoption token mismatch"));
    }
    Ok(())
}

fn verify_adoption_token(
    token: &str,
    item_id: &str,
    transportation_id: &str,
    expected_data_dir: &str,
    query_generation: u64,
    item_revision: i64,
) -> DomainResult<()> {
    if token.trim().is_empty() {
        return Err(DomainError::invalid_patch("adoption token required"));
    }
    let parsed: Value = serde_json::from_str(token)
        .map_err(|_| DomainError::invalid_patch("adoption token must be json"))?;
    let ok = parsed.get("itemId").and_then(Value::as_str) == Some(item_id)
        && parsed.get("transportationId").and_then(Value::as_str) == Some(transportation_id)
        && parsed.get("expectedDataDir").and_then(Value::as_str) == Some(expected_data_dir)
        && parsed.get("queryGeneration").and_then(Value::as_u64) == Some(query_generation)
        && parsed.get("itemRevision").and_then(Value::as_i64) == Some(item_revision);
    if !ok {
        return Err(DomainError::query_context_expired("adoption token mismatch"));
    }
    Ok(())
}

pub fn build_adoption_token(
    item_id: &str,
    transportation_id: &str,
    expected_data_dir: &str,
    query_generation: u64,
    item_revision: i64,
) -> String {
    json!({
        "itemId": item_id,
        "transportationId": transportation_id,
        "expectedDataDir": expected_data_dir,
        "queryGeneration": query_generation,
        "itemRevision": item_revision,
    })
    .to_string()
}

fn merge_raw_unknown(previous: Option<&Value>, incoming: &Value) -> Value {
    let mut out = match previous {
        Some(Value::Object(map)) => map.clone(),
        _ => Map::new(),
    };
    if let Value::Object(incoming_map) = incoming {
        for (k, v) in incoming_map {
            out.insert(k.clone(), v.clone());
        }
    } else {
        out.insert("_incoming".into(), incoming.clone());
    }
    Value::Object(out)
}

fn flight_metadata_patches(candidate: &Value) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    if let Some(v) = source_text(candidate, "FlightNo") {
        out.push(("serviceNumber".into(), Value::String(v)));
    }
    if let Some(v) = source_text(candidate, "FlightCompany") {
        out.push(("operator".into(), Value::String(v)));
    }
    if let Some(v) = source_text(candidate, "generic").or_else(|| source_text(candidate, "ftype")) {
        out.push(("vehicleModel".into(), Value::String(v)));
    }
    if let Some(v) = source_text(candidate, "AircraftNumber") {
        out.push(("aircraftRegistration".into(), Value::String(v)));
    }
    if let Some(v) = source_text(candidate, "FlightDepAirport") {
        out.push(("departureName".into(), Value::String(v)));
    }
    if let Some(v) = source_text(candidate, "FlightArrAirport") {
        out.push(("arrivalName".into(), Value::String(v)));
    }
    if let Some(v) = normalize_iata(source_text(candidate, "FlightDepcode")) {
        out.push(("departureCode".into(), Value::String(v)));
    }
    if let Some(v) = normalize_iata(source_text(candidate, "FlightArrcode")) {
        out.push(("arrivalCode".into(), Value::String(v)));
    }
    if let Some(v) = source_text(candidate, "FlightHTerminal") {
        out.push(("departureTerminal".into(), Value::String(v)));
    }
    if let Some(v) = source_text(candidate, "FlightTerminal") {
        out.push(("arrivalTerminal".into(), Value::String(v)));
    }
    if let Some(v) = source_text(candidate, "BoardGate") {
        out.push(("departureGate".into(), Value::String(v)));
    }
    if let Some(v) = source_text(candidate, "ArrStandGate") {
        out.push(("arrivalGate".into(), Value::String(v)));
    }
    out.push(("transportationType".into(), Value::String("flight".into())));
    out
}

fn adopt_plan_pair(
    tx: &Transaction<'_>,
    action: &TripActionView,
    candidate: &Value,
    mode: &AdoptionMode<'_>,
    item_completed: bool,
    item_cancelled: bool,
    adopted: &mut Vec<Value>,
    skipped: &mut Vec<Value>,
    conflicting: &mut Vec<Value>,
) -> DomainResult<bool> {
    let want_start = mode.allows("plannedStartAt");
    let want_end = mode.allows("plannedEndAt");
    if !want_start && !want_end {
        return Ok(false);
    }
    if !mode.strict() && action_frozen(action, item_completed, item_cancelled) {
        push_skip(skipped, "plannedStartAt", "action frozen");
        push_skip(skipped, "plannedEndAt", "action frozen");
        return Ok(false);
    }
    let mut next_start = action.planned_start_at.clone();
    let mut next_end = action.planned_end_at.clone();
    let mut wrote_start = false;
    let mut wrote_end = false;
    if want_start {
        match source_plan_instant(candidate, "FlightDeptimePlanDate", "org_timezone") {
            Ok(Some(value)) => {
                next_start = value;
                wrote_start = true;
            }
            Ok(None) => push_skip(skipped, "plannedStartAt", "empty source value"),
            Err(reason) => {
                if mode.strict() {
                    return Err(DomainError::invalid_plan(reason));
                }
                push_skip(skipped, "plannedStartAt", reason);
            }
        }
    }
    if want_end {
        match source_plan_instant(candidate, "FlightArrtimePlanDate", "dst_timezone") {
            Ok(Some(value)) => {
                next_end = value;
                wrote_end = true;
            }
            Ok(None) => push_skip(skipped, "plannedEndAt", "empty source value"),
            Err(reason) => {
                if mode.strict() {
                    return Err(DomainError::invalid_plan(reason));
                }
                push_skip(skipped, "plannedEndAt", reason);
            }
        }
    }
    if !wrote_start && !wrote_end {
        return Ok(false);
    }
    if parse_minute(&next_start).map_err(|_| DomainError::invalid_plan("invalid adopted plan"))?
        >= parse_minute(&next_end).map_err(|_| DomainError::invalid_plan("invalid adopted plan"))?
    {
        if mode.strict() {
            return Err(DomainError::invalid_plan("plan interval not positive"));
        }
        push_conflict(conflicting, "plannedStartAt", "plan interval not positive");
        return Ok(false);
    }
    let now = utc_now();
    tx.execute(
        "UPDATE productivity_action SET planned_start_at = ?1, planned_end_at = ?2, updated_at_utc = ?3, revision = revision + 1 WHERE id = ?4",
        params![next_start, next_end, now, action.id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if wrote_start {
        push_adopted(adopted, "plannedStartAt");
    }
    if wrote_end {
        push_adopted(adopted, "plannedEndAt");
    }
    Ok(true)
}

fn source_plan_instant(candidate: &Value, key: &str, offset_key: &str) -> Result<Option<String>, &'static str> {
    let Some(raw) = source_text(candidate, key) else {
        return Ok(None);
    };
    Ok(Some(minute_from_source(&raw, source_offset_seconds(candidate, offset_key))?))
}

fn adopt_actual_sides(
    tx: &Transaction<'_>,
    action: &TripActionView,
    candidate: &Value,
    snapshot: &TripSnapshot,
    mode: &AdoptionMode<'_>,
    adopted: &mut Vec<Value>,
    skipped: &mut Vec<Value>,
    conflicting: &mut Vec<Value>,
) -> DomainResult<bool> {
    let detail = load_action_actual(tx, &action.id)?;
    let (block_start, block_end) = load_auto_fill_blocks(tx, &action.id)?;
    let source_ref = adoption_source_record_key(candidate);
    let source_provenance = ActualSideWrite {
        origin: Some("source".into()),
        source_ref: Some(source_ref),
    };
    let mut arrived = false;
    let start_value = if mode.allows("actualStart") {
        source_text(candidate, "FlightDeptimeDate")
            .map(|raw| actual_from_source(&raw, source_offset_seconds(candidate, "org_timezone")))
            .transpose()
    } else {
        Ok(None)
    };
    let end_value = if mode.allows("actualEnd") {
        source_text(candidate, "FlightArrtimeDate")
            .map(|raw| actual_from_source(&raw, source_offset_seconds(candidate, "dst_timezone")))
            .transpose()
    } else {
        Ok(None)
    };
    let start_value = match start_value {
        Ok(value) => value,
        Err(_) if mode.strict() => return Err(DomainError::invalid_time("invalid source actual")),
        Err(_) => {
            push_skip(skipped, "actualStart", "invalid source actual");
            None
        }
    };
    let end_value = match end_value {
        Ok(value) => value,
        Err(_) if mode.strict() => return Err(DomainError::invalid_time("invalid source actual")),
        Err(_) => {
            push_skip(skipped, "actualEnd", "invalid source actual");
            None
        }
    };
    if let (Some(start), Some(end)) = (&start_value, &end_value) {
        let start_dt = chrono::DateTime::parse_from_rfc3339(start)
            .map_err(|_| DomainError::invalid_time("invalid source actual"))?;
        let end_dt = chrono::DateTime::parse_from_rfc3339(end)
            .map_err(|_| DomainError::invalid_time("invalid source actual"))?;
        if start_dt >= end_dt {
            if mode.strict() {
                return Err(DomainError::actual_invalid("actual start must be before end"));
            }
            push_conflict(conflicting, "actualStart", "actual interval is not positive");
            push_conflict(conflicting, "actualEnd", "actual interval is not positive");
            return Ok(false);
        }
    }
    // When both sides are selected, write the boundary that keeps the existing
    // counterpart valid first. The transaction still rolls back as a unit on any error.
    let start_first = match (&start_value, &end_value) {
        (Some(start), Some(_)) => {
            let old_end = detail.end_at_utc.as_deref().or(detail.pending_end_at_utc.as_deref());
            old_end.map_or(true, |old| {
                chrono::DateTime::parse_from_rfc3339(start).ok()
                    < chrono::DateTime::parse_from_rfc3339(old).ok()
            })
        }
        _ => true,
    };
    let sides = if start_first {
        [("actualStart", "start", start_value), ("actualEnd", "end", end_value)]
    } else {
        [("actualEnd", "end", end_value), ("actualStart", "start", start_value)]
    };
    for (field, side, source_value) in sides {
        if !mode.allows(field) {
            continue;
        }
        let Some(at) = source_value else {
            push_skip(skipped, field, "empty source value");
            continue;
        };
        let blocked = if side == "start" { block_start } else { block_end };
        let existing = if side == "start" {
            detail.start_at_utc.is_some() || detail.pending_start_at_utc.is_some()
        } else {
            detail.end_at_utc.is_some() || detail.pending_end_at_utc.is_some()
        };
        if !mode.strict() && blocked {
            push_skip(skipped, field, "manual block");
            continue;
        }
        if !mode.strict() && existing {
            push_skip(skipped, field, "existing manual/source value");
            continue;
        }
        let write_mode = if mode.strict() && existing { "correct" } else { "record" };
        let result = super::actual::apply_set_actual(
            tx,
            &SetActualPayload {
                target: SetActualTarget::ActionBoundary {
                    action_id: action.id.clone(),
                    side: side.into(),
                },
                value: Some(at),
                mode: write_mode.into(),
            },
            snapshot.profile.cancelled_at_utc.as_deref(),
            Some(source_provenance.clone()),
        );
        match result {
            Ok(true) => {
                push_adopted(adopted, field);
                if field == "actualEnd" { arrived = true; }
            }
            Ok(false) => push_skip(skipped, field, "no change"),
            Err(e) if mode.strict() => return Err(e),
            Err(_) => push_conflict(conflicting, field, "actual constraint rejected adoption"),
        }
    }
    Ok(arrived)
}

fn write_flight_endpoint_points(
    tx: &Transaction<'_>,
    action_id: &str,
    candidate: &Value,
    now: &str,
    mode: &AdoptionMode<'_>,
    previous_adopted: &Map<String, Value>,
    previous_before: &Map<String, Value>,
    adopted: &mut Map<String, Value>,
    before: &mut Map<String, Value>,
) -> DomainResult<()> {
    let departure = source_text(candidate, "FlightDepAirport");
    let arrival = source_text(candidate, "FlightArrAirport");
    if mode.allows("start.actionLabel") {
        update_flight_point_field(tx, action_id, "start", "actionLabel", Some("起飞"), now, mode.strict(), previous_adopted, previous_before, adopted, before)?;
    }
    if mode.allows("start.location") {
        update_flight_point_field(tx, action_id, "start", "location", departure.as_deref(), now, mode.strict(), previous_adopted, previous_before, adopted, before)?;
    }
    if mode.allows("end.actionLabel") {
        update_flight_point_field(tx, action_id, "end", "actionLabel", Some("降落"), now, mode.strict(), previous_adopted, previous_before, adopted, before)?;
    }
    if mode.allows("end.location") {
        update_flight_point_field(tx, action_id, "end", "location", arrival.as_deref(), now, mode.strict(), previous_adopted, previous_before, adopted, before)?;
    }
    Ok(())
}

fn update_flight_point_field(
    tx: &Transaction<'_>,
    action_id: &str,
    role: &str,
    field: &str,
    source_value: Option<&str>,
    now: &str,
    force: bool,
    previous_adopted: &Map<String, Value>,
    previous_before: &Map<String, Value>,
    adopted: &mut Map<String, Value>,
    before: &mut Map<String, Value>,
) -> DomainResult<()> {
    let Some(source_value) = source_value else { return Ok(()); };
    let key = format!("{role}.{field}");
    let column = match field {
        "actionLabel" => "action_label",
        "location" => "location",
        _ => return Err(DomainError::invalid_patch("unsupported flight point field")),
    };
    let current_row: Option<Option<String>> = tx
        .query_row(
            &format!("SELECT {column} FROM productivity_item_travel_point WHERE action_id = ?1 AND role = ?2 AND deleted_at_utc IS NULL"),
            params![action_id, role],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let Some(current) = current_row else { return Ok(()); };
    let current_value = current.map(Value::String).unwrap_or(Value::Null);
    let was_previously_source_managed = previous_adopted.contains_key(&key);
    let was_source_managed = previous_adopted.get(&key) == Some(&current_value);
    // A pre-existing non-empty value without a matching prior adoption baseline
    // belongs to the user. Empty fields may be filled on first adoption, while
    // a cleared source-managed value remains protected as a deliberate edit.
    // Selected-field confirm (force) may overwrite that handwritten value.
    if !force
        && ((was_previously_source_managed && !was_source_managed)
            || (!was_previously_source_managed && current_value.as_str().is_some_and(|value| !value.trim().is_empty())))
    {
        return Ok(());
    }
    if current_value == Value::String(source_value.to_string()) {
        if was_source_managed {
            adopted.insert(key.clone(), Value::String(source_value.to_string()));
            if let Some(original) = previous_before.get(&key) {
                before.insert(key, original.clone());
            }
        }
        return Ok(());
    }
    tx.execute(
        &format!("UPDATE productivity_item_travel_point SET {column} = ?1, updated_at_utc = ?2 WHERE action_id = ?3 AND role = ?4 AND deleted_at_utc IS NULL"),
        params![source_value, now, action_id, role],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    before.insert(
        key.clone(),
        if was_source_managed {
            previous_before.get(&key).cloned().unwrap_or(current_value)
        } else {
            current_value
        },
    );
    adopted.insert(key, Value::String(source_value.to_string()));
    Ok(())
}

fn mark_flight_arrived(tx: &Transaction<'_>, action_id: &str, item_id: &str, now: &str) -> DomainResult<()> {
    tx.execute(
        "UPDATE productivity_action SET ended = 1, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2",
        params![now, action_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let open: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM productivity_action WHERE target_kind = 'item' AND target_id = ?1 AND deleted_at_utc IS NULL AND ended = 0",
            [item_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if open == 0 {
        let latest = load_trip_snapshot(tx, item_id)?;
        if validate_finish_actuals(&latest).is_ok() {
            tx.execute(
                "UPDATE productivity_item SET status = '完成', updated_at_utc = ?1 WHERE id = ?2",
                params![now, item_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        }
    }
    Ok(())
}

fn adoption_source_record_key(candidate: &Value) -> String {
    candidate
        .get("sourceRecordKey")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| {
            let flight = candidate.get("FlightNo").and_then(Value::as_str).unwrap_or("");
            let date = candidate.get("FlightDate").and_then(Value::as_str).unwrap_or("");
            format!("{flight}:{date}")
        })
}

fn load_auto_fill_blocks(tx: &Transaction<'_>, action_id: &str) -> DomainResult<(bool, bool)> {
    let row: Option<(i64, i64)> = tx
        .query_row(
            "SELECT start_auto_fill_block, end_auto_fill_block FROM productivity_action_travel_actual_v2 WHERE action_id = ?1 AND deleted_at_utc IS NULL",
            [action_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(match row {
        Some((s, e)) => (s != 0, e != 0),
        None => (false, false),
    })
}

fn source_offset_seconds(record: &Value, key: &str) -> i32 {
    // Variflight wall times are local. org_timezone / dst_timezone are seconds
    // east of UTC (China is 28800). A missing offset stays on that domestic
    // default; treating the wall clock as UTC shifted morning flights to the afternoon.
    let Some(raw) = source_text(record, key) else { return 8 * 3600 };
    match raw.parse::<i32>() {
        Ok(seconds) if (-86_400..=86_400).contains(&seconds) => seconds,
        _ => 8 * 3600,
    }
}

fn minute_from_source(value: &str, offset_seconds: i32) -> Result<String, &'static str> {
    source_instant(value, offset_seconds, false)
}

// The travel storage contract keeps source actual seconds while plan timestamps
// remain minute-aligned (docs/specs/travel-item-storage.proposed.md §8).
fn actual_from_source(value: &str, offset_seconds: i32) -> Result<String, &'static str> {
    source_instant(value, offset_seconds, true)
}

fn source_instant(value: &str, offset_seconds: i32, preserve_seconds: bool) -> Result<String, &'static str> {
    if value.trim().is_empty() {
        return Err("empty source time");
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        let utc = dt.with_timezone(&chrono::Utc);
        if !preserve_seconds && (utc.timestamp() % 60 != 0 || utc.timestamp_subsec_nanos() != 0) {
            return Err("source time not minute-aligned");
        }
        return Ok(utc.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true));
    }
    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S"))
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M"))
    {
        let Some(fixed) = chrono::FixedOffset::east_opt(offset_seconds) else {
            return Err("invalid source timezone");
        };
        let Some(local) = fixed.from_local_datetime(&naive).single() else {
            return Err("ambiguous source time");
        };
        let utc = local.with_timezone(&chrono::Utc);
        if !preserve_seconds && (utc.timestamp() % 60 != 0 || utc.timestamp_subsec_nanos() != 0) {
            return Err("source time not minute-aligned");
        }
        return Ok(utc.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true));
    }
    if let Ok(utc) = parse_minute(value) {
        return Ok(utc.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    }
    Err("invalid source time")
}

fn source_text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn normalize_iata(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let upper = v.to_uppercase();
        if upper.len() == 3 && upper.chars().all(|c| c.is_ascii_uppercase()) {
            Some(upper)
        } else {
            None
        }
    })
}

struct AdoptionMode<'a> {
    selected: Option<&'a [String]>,
}

impl AdoptionMode<'_> {
    fn allows(&self, field: &str) -> bool {
        match self.selected {
            None => true,
            Some(fields) => fields.iter().any(|value| value == field),
        }
    }

    fn strict(&self) -> bool {
        self.selected.is_some()
    }
}

fn known_adoption_field(field: &str) -> bool {
    matches!(
        field,
        "serviceNumber"
            | "operator"
            | "vehicleModel"
            | "aircraftRegistration"
            | "departureName"
            | "arrivalName"
            | "departureCode"
            | "arrivalCode"
            | "departureTerminal"
            | "arrivalTerminal"
            | "departureGate"
            | "arrivalGate"
            | "plannedStartAt"
            | "plannedEndAt"
            | "actualStart"
            | "actualEnd"
            | "start.location"
            | "end.location"
            | "start.actionLabel"
            | "end.actionLabel"
    )
}

fn push_adopted(out: &mut Vec<Value>, field: &str) {
    out.push(json!({ "field": field, "status": "adopted" }));
}

fn push_skip(out: &mut Vec<Value>, field: &str, reason: &str) {
    out.push(json!({ "field": field, "status": "skipped", "reason": reason }));
}

fn push_conflict(out: &mut Vec<Value>, field: &str, reason: &str) {
    out.push(json!({ "field": field, "status": "conflicting", "reason": reason }));
}

fn read_transportation_field(tx: &Transaction<'_>, id: &str, field: &str) -> DomainResult<Value> {
    let column = wire_to_column(field)?;
    let raw: Option<String> = tx
        .query_row(
            &format!("SELECT {column} FROM productivity_transportation WHERE id = ?1"),
            [id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(match raw {
        None => Value::Null,
        Some(s) => Value::String(s),
    })
}

fn apply_transportation_field(
    tx: &Transaction<'_>,
    id: &str,
    item_id: &str,
    field: &str,
    value: &Value,
    now: &str,
) -> DomainResult<()> {
    let column = wire_to_column(field)?;
    let param: Option<String> = match value {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        _ => Some(value.to_string()),
    };
    let sql = if item_id.is_empty() {
        format!("UPDATE productivity_transportation SET {column} = ?1, updated_at_utc = ?2 WHERE id = ?3")
    } else {
        format!(
            "UPDATE productivity_transportation SET {column} = ?1, updated_at_utc = ?2 WHERE id = ?3 AND item_id = ?4"
        )
    };
    if item_id.is_empty() {
        tx.execute(&sql, params![param, now, id])
    } else {
        tx.execute(&sql, params![param, now, id, item_id])
    }
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

fn wire_to_column(field: &str) -> DomainResult<&'static str> {
    match field {
        "serviceNumber" => Ok("service_number"),
        "transportationType" => Ok("transportation_type"),
        "name" => Ok("name"),
        "note" => Ok("note"),
        "operator" => Ok("operator"),
        "vehicleModel" => Ok("vehicle_model"),
        "aircraftRegistration" => Ok("aircraft_registration"),
        "departureName" => Ok("departure_name"),
        "arrivalName" => Ok("arrival_name"),
        "departureCode" => Ok("departure_code"),
        "arrivalCode" => Ok("arrival_code"),
        "departureTerminal" => Ok("departure_terminal"),
        "arrivalTerminal" => Ok("arrival_terminal"),
        "departureGate" => Ok("departure_gate"),
        "arrivalGate" => Ok("arrival_gate"),
        _ => Err(DomainError::invalid_patch("unsupported adoption field")),
    }
}
