//! Transactional local travel aggregate commands.
//! The UI intentionally has no travel editor yet; these commands are the
//! narrow persistence boundary for the later surface (SPEC-0007 C01/C16).

use rusqlite::{params, OptionalExtension, Transaction};
use chrono::{DateTime, FixedOffset, NaiveDateTime, SecondsFormat, TimeZone};

use super::coordinator::{in_transaction, with_write_expected};
use super::error::{DomainError, DomainResult};
use super::repository::{append_item_to_order, remove_item_from_order, finished_action_snapshot, action_snapshot, insert_action, insert_item, item_snapshot, load_item_row, guard_unknown, load_action_row, load_intervals, check_revision, bump_item, bump_action};
use super::execution::{apply_execution_state, has_any_interval};
use super::types::*;
use super::util::{new_uuid, utc_now};
use super::validation::{ensure_action_deletable, ensure_item_writable, ensure_list_writable, validate_action_plan, validate_item_priority, validate_item_status, ensure_action_fits_session};

fn validate_kind(kind: &str) -> DomainResult<()> {
    if matches!(kind, "flight" | "train") { Ok(()) } else { Err(DomainError::invalid_patch("travel kind must be flight or train")) }
}

fn require_role(tx: &Transaction<'_>, type_id: &str, kind: &str) -> DomainResult<()> {
    let expected = format!("travel.{kind}");
    let role: Option<String> = tx.query_row(
        "SELECT system_role FROM productivity_item_type WHERE id = ?1 AND inactive = 0",
        [type_id], |r| r.get(0),
    ).optional().map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if role.as_deref() != Some(expected.as_str()) {
        return Err(DomainError::invalid_patch("item type is not the matching travel preset"));
    }
    Ok(())
}

pub(crate) fn ensure_travel_presets(tx: &Transaction<'_>, kind: &str, root_color: Option<&str>) -> DomainResult<String> {
    let role = format!("travel.{kind}");
    let existing: Option<String> = tx.query_row("SELECT id FROM productivity_item_type WHERE system_role=?1", [&role], |r| r.get(0)).optional().map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if let Some(id) = existing { return Ok(id); }
    let color = root_color.ok_or_else(|| DomainError::invalid_patch("rootColor required when travel presets are absent"))?;
    if !color.starts_with('#') || color.len() != 7 { return Err(DomainError::invalid_patch("rootColor must be #RRGGBB")); }
    let collision: Option<String> = tx.query_row("SELECT id FROM productivity_item_type WHERE name_key IN ('travel','出行','flight','飞机','航班','train','火车') LIMIT 1", [], |r| r.get(0)).optional().map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if collision.is_some() { return Err(DomainError::invalid_patch("travel preset name conflicts with existing classification")); }
    let catalog: String = match tx.query_row("SELECT id FROM productivity_item_type_catalog LIMIT 1", [], |r| r.get(0)).optional().map_err(|e| DomainError::archive_lifecycle(e.to_string()))? {
        Some(id) => id,
        None => {
            let catalog = new_uuid();
            let now = utc_now();
            tx.execute("INSERT INTO productivity_item_type_catalog(id,revision,created_at_utc,updated_at_utc) VALUES (?1,0,?2,?2)", params![catalog, now]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            catalog
        }
    };
    let now = utc_now(); let root = new_uuid(); let flight = new_uuid(); let train = new_uuid();
    tx.execute("INSERT INTO productivity_item_type(id,catalog_id,name,name_key,color_override,inactive,created_at_utc,updated_at_utc,system_role) VALUES (?1,?2,'出行','travel',?3,0,?4,?4,'travel')", params![root, catalog, color, now]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute("INSERT INTO productivity_item_type(id,catalog_id,parent_item_type_id,name,name_key,color_override,inactive,created_at_utc,updated_at_utc,system_role) VALUES (?1,?2,?3,'航班','flight',?4,0,?5,?5,'travel.flight'),(?6,?2,?3,'火车','train',?4,0,?5,?5,'travel.train')", params![flight, catalog, root, color, now, train]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    super::classification::bump_catalog(tx, &catalog, &now)?;
    Ok(if kind == "flight" { flight } else { train })
}

fn insert_detail(tx: &Transaction<'_>, item_id: &str, kind: &str, now: &str) -> DomainResult<()> {
    tx.execute(
        "INSERT INTO productivity_item_travel_detail (item_id, schema_version, kind, created_at_utc, updated_at_utc) VALUES (?1, 1, ?2, ?3, ?3)",
        params![item_id, kind, now],
    ).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn create_travel(data_dir: &str, req: CreateTravelRequest) -> DomainResult<TravelSnapshot> {
    validate_kind(&req.kind)?;
    if req.title.trim().is_empty() || req.ranges.is_empty() { return Err(DomainError::invalid_patch("travel title and at least one range required")); }
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        let preset = ensure_travel_presets(tx, &req.kind, req.root_color.as_deref())?;
        ensure_list_writable(tx, req.list_id.as_deref())?;
        let item_id = new_uuid();
        let now = utc_now();
        validate_item_status("进行中")?;
        validate_item_priority("none")?;
        insert_item(tx, &item_id, req.list_id.as_deref(), &req.title, req.description.as_deref(), "进行中", "none", None, None, &now)?;
        // The travel preset may be seeded in this transaction or have been recolored
        // beforehand; bind the new Item to the catalog revision actually observed here.
        let catalog = super::classification::catalog_snapshot(tx)?
            .ok_or_else(|| DomainError::root_not_found("ItemType catalog not found"))?;
        super::classification::create_item_classification(
            tx,
            &item_id,
            Some(&preset),
            &[],
            Some(&ClassificationExpected {
                item_type_catalog: Some(RevisionRef { id: catalog.id, expected_revision: catalog.revision }),
                tags: Vec::new(),
            }),
        )?;
        insert_detail(tx, &item_id, &req.kind, &now)?;
        for (position, range) in req.ranges.iter().enumerate() {
            validate_action_plan(range.planned_start_at.as_deref(), range.planned_end_at.as_deref(), None)?;
            let action_id = new_uuid();
            insert_action(tx, &action_id, &format!("{} · {}", req.title, position + 1), None, None, Some("item"), Some(&item_id), range.planned_start_at.as_deref(), range.planned_end_at.as_deref(), None, false, None, &now)?;
            let leg_id = new_uuid();
            tx.execute("INSERT INTO productivity_item_travel_leg (id,item_id,action_id,position,departure_code,departure_name,arrival_code,arrival_name,departure_terminal,arrival_terminal,created_at_utc,updated_at_utc) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)", params![leg_id,item_id,action_id,position as i64,range.departure_code,range.departure_name,range.arrival_code,range.arrival_name,range.departure_terminal,range.arrival_terminal,now]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        }
        append_item_to_order(tx, &item_id, &now)?;
        load_travel(tx, &item_id, false)
    }))
}

pub fn get_travel(data_dir: &str, req: GetTravelRequest) -> DomainResult<TravelSnapshot> {
    super::coordinator::with_read(data_dir, |conn| {
        let conn = conn.ok_or_else(|| DomainError::root_not_found("archive not initialized"))?;
        in_transaction(conn, |tx| load_travel(tx, &req.item_id, !req.include_deleted))
    })
}

pub fn update_travel(data_dir: &str, req: UpdateTravelRequest) -> DomainResult<TravelSnapshot> {
    let _ = data_dir;
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        let current = load_travel(tx, &req.item.id, true)?;
        check_revision(req.item.expected_revision, current.item.revision)?;
        ensure_item_writable(tx, &req.item.id)?;
        ensure_travel_item(tx, &req.item.id)?;
        let detail = current.detail.ok_or_else(|| DomainError::root_not_found("travel detail not found"))?;
        if let Some(kind) = &req.kind { validate_kind(kind)?; if kind != &detail.kind { return Err(DomainError::invalid_patch("travel kind conversion is not supported")); } }
        let now = utc_now();
        let old = detail;
        let service_number = req.service_number.clone().unwrap_or(old.service_number.clone());
        let aircraft_type = req.aircraft_type.clone().unwrap_or(old.aircraft_type.clone());
        let operator_code = req.operator_code.clone().unwrap_or(old.operator_code.clone());
        let operator_name = req.operator_name.clone().unwrap_or(old.operator_name.clone());
        let carriage = req.carriage.clone().unwrap_or(old.carriage.clone());
        let seat_number = req.seat_number.clone().unwrap_or(old.seat_number.clone());
        let snapshot = match req.source_snapshot.clone() { Some(value) => { validate_snapshot(&value)?; value }, None => old.source_snapshot.clone() };
        tx.execute("UPDATE productivity_item_travel_detail SET service_number=?1, aircraft_type=?2, operator_code=?3, operator_name=?4, carriage=?5, seat_number=?6, source_snapshot_json=?7, updated_at_utc=?8 WHERE item_id=?9", params![service_number, aircraft_type, operator_code, operator_name, carriage, seat_number, snapshot.to_string(), now, req.item.id]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if let Some(ranges) = &req.ranges {
            if ranges.len() != current.legs.len() { return Err(DomainError::invalid_patch("travel leg membership must be exact")); }
            ensure_exact_action_revisions(&current.actions, &req.action_revisions)?;
            for (leg, range) in current.legs.iter().zip(ranges) {
                let expected = req.action_revisions.iter().find(|r| r.id == leg.action_id).ok_or_else(|| DomainError::invalid_patch("missing action revision"))?;
                let action = finished_action_snapshot(tx, &leg.action_id)?;
                check_revision(expected.expected_revision, action.revision)?;
                let (_, extra) = load_action_row(tx, &leg.action_id, true)?; guard_unknown(&extra)?;
                let intervals = load_intervals(tx, &leg.action_id, true)?;
                if has_any_interval(&intervals) && (range.planned_start_at.is_some() || range.planned_end_at.is_some()) { return Err(DomainError::action_execution_invalid("cannot change planned time after intervals exist")); }
                validate_action_plan(range.planned_start_at.as_deref(), range.planned_end_at.as_deref(), None)?;
                if let Some(session_id) = &action.session_id { if let (Some(s),Some(e)) = (&range.planned_start_at,&range.planned_end_at) { ensure_action_fits_session(tx,s,e,session_id)?; } }
                tx.execute("UPDATE productivity_action SET planned_start_at=?1, planned_end_at=?2, revision=revision+1, updated_at_utc=?3 WHERE id=?4", params![range.planned_start_at,range.planned_end_at,now,leg.action_id]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                tx.execute("UPDATE productivity_item_travel_leg SET departure_code=?1,departure_name=?2,arrival_code=?3,arrival_name=?4,departure_terminal=?5,arrival_terminal=?6,departure_gate=?7,arrival_gate=?8,updated_at_utc=?9 WHERE id=?10", params![range.departure_code,range.departure_name,range.arrival_code,range.arrival_name,range.departure_terminal,range.arrival_terminal,range.departure_gate,range.arrival_gate,now,leg.id]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
        } else if !req.action_revisions.is_empty() { return Err(DomainError::invalid_patch("action revisions require ranges")); }
        bump_item(tx, &req.item.id, &now)?;
        load_travel(tx, &req.item.id, false)
    }))
}

pub fn delete_travel(data_dir: &str, req: DeleteTravelRequest) -> DomainResult<TravelSnapshot> {
    let _ = data_dir;
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        delete_travel_in_transaction(tx, &req, None)
    }))
}

/// Deletes a Travel aggregate inside an already-open transaction. `batch_id`
/// lets a mixed Item/Travel batch share one deletion marker atomically.
pub(crate) fn delete_travel_in_transaction(
    tx: &Transaction<'_>,
    req: &DeleteTravelRequest,
    batch_id: Option<&str>,
) -> DomainResult<TravelSnapshot> {
    let current = validate_travel_delete_in_transaction(tx, req)?;
    let now = utc_now(); let batch = batch_id.map(str::to_owned).unwrap_or_else(new_uuid);
    remove_item_from_order(tx, &req.item.id, &now)?;
    tx.execute("UPDATE productivity_item SET deleted_at_utc=?1, deletion_batch_id=?2, updated_at_utc=?1, revision=revision+1 WHERE id=?3", params![now,batch,req.item.id]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute("UPDATE productivity_item_travel_detail SET deleted_at_utc=?1, deletion_batch_id=?2, updated_at_utc=?1 WHERE item_id=?3 AND deleted_at_utc IS NULL", params![now,batch,req.item.id]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute("UPDATE productivity_item_travel_leg SET deleted_at_utc=?1, deletion_batch_id=?2, updated_at_utc=?1 WHERE item_id=?3 AND deleted_at_utc IS NULL", params![now,batch,req.item.id]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    for action in &current.actions { tx.execute("UPDATE productivity_action SET deleted_at_utc=?1,deletion_batch_id=?2,updated_at_utc=?1,revision=revision+1 WHERE id=?3",params![now,batch,action.id]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?; tx.execute("UPDATE productivity_interval SET deleted_at_utc=?1,deletion_batch_id=?2,updated_at_utc=?1 WHERE action_id=?3 AND deleted_at_utc IS NULL",params![now,batch,action.id]).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?; }
    load_travel(tx, &req.item.id, false)
}

pub(crate) fn validate_travel_delete_in_transaction(
    tx: &Transaction<'_>,
    req: &DeleteTravelRequest,
) -> DomainResult<TravelSnapshot> {
    let current = load_travel(tx, &req.item.id, true)?;
    check_revision(req.item.expected_revision, current.item.revision)?;
    ensure_exact_action_revisions(&current.actions, &req.expected_actions)?;
    let deleted: bool = tx.query_row("SELECT deleted_at_utc IS NOT NULL FROM productivity_item WHERE id=?1",[&req.item.id],|r|r.get(0)).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
    if deleted { return Err(DomainError::delete_batch_mismatch()); }
    ensure_item_writable(tx, &req.item.id)?;
    for action in &current.actions { ensure_action_deletable(tx, &action.id)?; }
    Ok(current)
}

pub fn restore_travel(data_dir: &str, req: RestoreTravelRequest) -> DomainResult<TravelSnapshot> {
    let _ = data_dir;
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        let current = load_travel(tx, &req.item.id, false)?;
        check_revision(req.item.expected_revision, current.item.revision)?;
        ensure_exact_action_revisions(&current.actions, &req.expected_actions)?;
        let batch: String = tx.query_row("SELECT deletion_batch_id FROM productivity_item WHERE id=?1",[&req.item.id],|r|r.get(0)).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        if batch.is_empty() { return Err(DomainError::delete_batch_mismatch()); }
        let deleted: bool = tx.query_row("SELECT deleted_at_utc IS NOT NULL FROM productivity_item WHERE id=?1",[&req.item.id],|r|r.get(0)).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        if !deleted { return Err(DomainError::delete_batch_mismatch()); }
        ensure_item_writable(tx, &req.item.id)?;
        let now=utc_now();
        tx.execute("UPDATE productivity_item SET deleted_at_utc=NULL,deletion_batch_id=NULL,updated_at_utc=?1,revision=revision+1 WHERE id=?2",params![now,req.item.id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        tx.execute("UPDATE productivity_item_travel_detail SET deleted_at_utc=NULL,deletion_batch_id=NULL,updated_at_utc=?1 WHERE item_id=?2 AND deletion_batch_id=?3",params![now,req.item.id,batch]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        tx.execute("UPDATE productivity_item_travel_leg SET deleted_at_utc=NULL,deletion_batch_id=NULL,updated_at_utc=?1 WHERE item_id=?2 AND deletion_batch_id=?3",params![now,req.item.id,batch]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        tx.execute("UPDATE productivity_action SET deleted_at_utc=NULL,deletion_batch_id=NULL,updated_at_utc=?1,revision=revision+1 WHERE target_id=?2 AND deletion_batch_id=?3",params![now,req.item.id,batch]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        tx.execute("UPDATE productivity_interval SET deleted_at_utc=NULL,deletion_batch_id=NULL,updated_at_utc=?1 WHERE action_id IN (SELECT id FROM productivity_action WHERE target_id=?2) AND deletion_batch_id=?3",params![now,req.item.id,batch]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        append_item_to_order(tx, &req.item.id, &now)?;
        load_travel(tx,&req.item.id,true)
    }))
}

fn ensure_exact_action_revisions(actions: &[ActionSnapshot], refs: &[RevisionRef]) -> DomainResult<()> {
    let expected: std::collections::HashMap<&str, i64> = refs.iter().map(|r| (r.id.as_str(), r.expected_revision)).collect();
    if expected.len() != refs.len() || expected.len() != actions.len() || actions.iter().any(|a| expected.get(a.id.as_str()) != Some(&a.revision)) { return Err(DomainError::revision_conflict("travel action member revisions differ")); }
    Ok(())
}

fn ensure_travel_item(tx: &Transaction<'_>, item_id: &str) -> DomainResult<()> {
    let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_travel_detail WHERE item_id=?1)",[item_id],|r|r.get(0)).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
    if exists { Ok(()) } else { Err(DomainError::root_not_found("travel item not found")) }
}

fn validate_snapshot(value: &serde_json::Value) -> DomainResult<()> {
    let Some(object) = value.as_object() else { return Err(DomainError::invalid_patch("source snapshot must be an object")); };
    let version = object.get("schemaVersion").and_then(|v|v.as_u64()).ok_or_else(||DomainError::invalid_patch("source snapshot schemaVersion is required"))?;
    if version != 1 { return Err(DomainError::invalid_patch("unsupported source snapshot version")); }
    for key in ["provider", "request", "rawRecord"] { if !object.contains_key(key) { return Err(DomainError::invalid_patch("source snapshot envelope is incomplete")); } }
    let encoded = value.to_string();
    if encoded.len() > 256 * 1024 { return Err(DomainError::invalid_patch("source snapshot exceeds size limit")); }
    Ok(())
}

fn source_text(record: &serde_json::Value, key: &str) -> Option<String> {
    let value = record.get(key)?;
    let text = value.as_str().map(str::to_owned).or_else(|| value.as_i64().map(|n| n.to_string()))?;
    let text = text.trim();
    if text.is_empty() || matches!(text, "-" | "--" | "未知" | "null" | "N/A") { None } else { Some(text.to_owned()) }
}

fn offset_seconds(record: &serde_json::Value, key: &str) -> Option<i32> {
    let raw = source_text(record, key)?;
    let seconds: i32 = raw.parse().ok()?;
    (-86_400..=86_400).contains(&seconds).then_some(seconds)
}

fn source_utc(record: &serde_json::Value, time_key: &str, offset_key: &str) -> DomainResult<Option<String>> {
    let Some(raw) = source_text(record, time_key) else { return Ok(None); };
    if let Ok(value) = DateTime::parse_from_rfc3339(&raw) {
        return Ok(Some(value.with_timezone(&chrono::Utc).to_rfc3339_opts(SecondsFormat::Secs, true)));
    }
    let Some(naive) = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"]
        .iter()
        .find_map(|format| NaiveDateTime::parse_from_str(&raw, format).ok())
    else { return Ok(None); };
    let offset = offset_seconds(record, offset_key).unwrap_or(8 * 60 * 60);
    let fixed = FixedOffset::east_opt(offset).ok_or_else(|| DomainError::invalid_time("flight source timezone offset is invalid"))?;
    let local = fixed.from_local_datetime(&naive).single().ok_or_else(|| DomainError::invalid_time("flight source local timestamp is ambiguous"))?;
    Ok(Some(local.with_timezone(&chrono::Utc).to_rfc3339_opts(SecondsFormat::Secs, true)))
}

fn route_code(record: &serde_json::Value, key: &str) -> DomainResult<String> {
    source_text(record, key).map(|s| s.to_ascii_uppercase()).ok_or_else(|| DomainError::invalid_patch(format!("flight source is missing {key}")))
}

fn first_source(record: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| source_text(record, key))
}

fn flight_range(record: &serde_json::Value) -> DomainResult<TravelRangeInput> {
    let start = source_utc(record, "FlightDeptimePlanDate", "org_timezone")?;
    let end = source_utc(record, "FlightArrtimePlanDate", "dst_timezone")?;
    if let (Some(s), Some(e)) = (&start, &end) { validate_action_plan(Some(s), Some(e), None)?; }
    Ok(TravelRangeInput {
        planned_start_at: start,
        planned_end_at: end,
        departure_code: Some(route_code(record, "FlightDepcode")?),
        departure_name: first_source(record, &["FlightDepAirport", "FlightDep"]),
        arrival_code: Some(route_code(record, "FlightArrcode")?),
        arrival_name: first_source(record, &["FlightArrAirport", "FlightArr"]),
        departure_terminal: source_text(record, "FlightHTerminal"),
        arrival_terminal: source_text(record, "FlightTerminal"),
        departure_gate: source_text(record, "BoardGate"),
        arrival_gate: source_text(record, "ArrStandGate"),
    })
}

fn same_route(segment: &serde_json::Value, dep: &str, arr: &str) -> DomainResult<bool> {
    Ok(route_code(segment, "FlightDepcode")? == dep && route_code(segment, "FlightArrcode")? == arr)
}

/// Adopt a selected Variflight source record into the existing travel aggregate.
/// All member checks and row changes are one transaction; no interval is synthesized.
pub fn adopt_travel_flight(data_dir: &str, req: AdoptTravelFlightRequest) -> DomainResult<TravelSnapshot> {
    let _ = data_dir;
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        let current = load_travel(tx, &req.item.id, true)?;
        check_revision(req.item.expected_revision, current.item.revision)?;
        ensure_item_writable(tx, &req.item.id)?;
        ensure_travel_item(tx, &req.item.id)?;
        let (item, item_extra) = load_item_row(tx, &req.item.id, true)?;
        let _ = item;
        guard_unknown(&item_extra)?;
        let detail = current.detail.as_ref().ok_or_else(|| DomainError::root_not_found("travel detail not found"))?;
        if detail.kind != "flight" { return Err(DomainError::invalid_patch("flight adoption requires a flight Item")); }
        if req.request.fnum.trim().is_empty() || req.request.fnum.chars().count() > 32
            || NaiveDateTime::parse_from_str(&format!("{} 00:00:00", req.request.date), "%Y-%m-%d %H:%M:%S").is_err()
        {
            return Err(DomainError::invalid_patch("flight query request metadata is invalid"));
        }
        let fetched = DateTime::parse_from_rfc3339(&req.fetched_at_utc)
            .map_err(|_| DomainError::invalid_patch("fetchedAtUtc must be an RFC3339 UTC timestamp"))?;
        if fetched.offset().local_minus_utc() != 0 {
            return Err(DomainError::invalid_patch("fetchedAtUtc must use UTC"));
        }
        validate_snapshot(&serde_json::json!({"schemaVersion":1,"provider":"variflight","request":{},"rawRecord":req.chosen_record}))?;
        let chosen = &req.chosen_record;
        let dep = route_code(chosen, "FlightDepcode")?;
        let arr = route_code(chosen, "FlightArrcode")?;
        let is_stopover = source_text(chosen, "StopFlag").as_deref() == Some("1");
        let mut segments = req.matched_segments.clone();
        if is_stopover {
            let via = route_code(chosen, "StopAirportCode")?;
            if segments.len() != 2 || !same_route(&segments[0], &dep, &via)? || !same_route(&segments[1], &via, &arr)? {
                return Err(DomainError::invalid_patch("stopover adoption requires matched A-B and B-C source records"));
            }
        } else {
            if segments.is_empty() { segments.push(chosen.clone()); }
            if segments.len() != 1 || !same_route(&segments[0], &dep, &arr)? {
                return Err(DomainError::invalid_patch("flight adoption requires one matched source segment"));
            }
        }
        let chosen_no = source_text(chosen, "FlightNo");
        let chosen_date = source_text(chosen, "FlightDeptimePlanDate").and_then(|v| v.get(..10).map(str::to_owned));
        if chosen_no.is_none() || segments.iter().any(|s| {
            source_text(s, "FlightNo") != chosen_no
                || source_text(s, "FlightDeptimePlanDate").and_then(|v| v.get(..10).map(str::to_owned)) != chosen_date
        }) {
            return Err(DomainError::invalid_patch("matched flight records must match the selected flight number and departure date"));
        }
        ensure_exact_action_revisions(&current.actions, &req.expected_actions)?;
        for action in &current.actions {
            let (row, extra) = load_action_row(tx, &action.id, true)?;
            guard_unknown(&extra)?;
            if row.target_kind.as_deref() != Some("item") || row.target_id.as_deref() != Some(req.item.id.as_str()) || row.session_id.is_some() || row.ended || !row.intervals.is_empty() {
                return Err(DomainError::action_execution_invalid("flight adoption cannot change an executed, active, or session-linked Action"));
            }
            let intervals = load_intervals(tx, &action.id, false)?;
            if has_any_interval(&intervals) { return Err(DomainError::action_execution_invalid("flight adoption cannot change an Action with execution intervals")); }
        }
        let now = utc_now();
        let desired_ranges = segments.iter().map(flight_range).collect::<DomainResult<Vec<_>>>()?;
        let flight_no = source_text(chosen, "FlightNo");
        let aircraft = first_source(chosen, &["generic", "ftype"]);
        let operator_name = source_text(chosen, "FlightCompany");
        let operator_code = flight_no.as_deref().map(|n| n.chars().take_while(|c| c.is_ascii_alphabetic()).collect::<String>()).filter(|s| !s.is_empty());
        let snapshot = serde_json::json!({"schemaVersion":1,"provider":"variflight","request":req.request,"fetchedAtUtc":req.fetched_at_utc,"rawRecord":chosen,"matchedSegments":segments.clone()});
        validate_snapshot(&snapshot)?;
        let next_service = flight_no.clone().or_else(|| detail.service_number.clone());
        let next_operator_code = operator_code.or_else(|| detail.operator_code.clone());
        let next_operator_name = operator_name.or_else(|| detail.operator_name.clone());
        let next_aircraft = aircraft.or_else(|| detail.aircraft_type.clone());
        tx.execute("UPDATE productivity_item_travel_detail SET service_number=?1,aircraft_type=?2,operator_code=?3,operator_name=?4,source_snapshot_json=?5,updated_at_utc=?6 WHERE item_id=?7", params![next_service,next_aircraft,next_operator_code,next_operator_name,snapshot.to_string(),now,req.item.id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        for (idx, range) in desired_ranges.iter().enumerate() {
            let raw = &segments[idx];
            if let Some(leg) = current.legs.get(idx) {
                let action = &current.actions[idx];
                let start = range.planned_start_at.as_ref().zip(range.planned_end_at.as_ref()).map(|_| range.planned_start_at.clone()).unwrap_or_else(|| action.planned_start_at.clone());
                let end = range.planned_start_at.as_ref().zip(range.planned_end_at.as_ref()).map(|_| range.planned_end_at.clone()).unwrap_or_else(|| action.planned_end_at.clone());
                validate_action_plan(start.as_deref(), end.as_deref(), None)?;
                tx.execute("UPDATE productivity_action SET title=?1,planned_start_at=?2,planned_end_at=?3,updated_at_utc=?4 WHERE id=?5",params![flight_no.as_deref().unwrap_or(&action.title),start,end,now,action.id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
                bump_action(tx,&action.id,&now)?;
                tx.execute("UPDATE productivity_item_travel_leg SET position=?1,departure_code=?2,departure_name=COALESCE(?3,departure_name),arrival_code=?4,arrival_name=COALESCE(?5,arrival_name),departure_terminal=COALESCE(?6,departure_terminal),arrival_terminal=COALESCE(?7,arrival_terminal),departure_gate=COALESCE(?8,departure_gate),arrival_gate=COALESCE(?9,arrival_gate),source_snapshot_json=?10,updated_at_utc=?11 WHERE id=?12",params![idx as i64,range.departure_code,range.departure_name,range.arrival_code,range.arrival_name,range.departure_terminal,range.arrival_terminal,range.departure_gate,range.arrival_gate,raw.to_string(),now,leg.id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
            } else {
                let action_id = new_uuid();
                let leg_id = new_uuid();
                let title = flight_no.as_deref().unwrap_or("航班");
                insert_action(tx,&action_id,title,None,None,Some("item"),Some(&req.item.id),range.planned_start_at.as_deref(),range.planned_end_at.as_deref(),None,false,None,&now)?;
                tx.execute("INSERT INTO productivity_item_travel_leg (id,item_id,action_id,position,departure_code,departure_name,arrival_code,arrival_name,departure_terminal,arrival_terminal,departure_gate,arrival_gate,source_snapshot_json,created_at_utc,updated_at_utc) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14)",params![leg_id,req.item.id,action_id,idx as i64,range.departure_code,range.departure_name,range.arrival_code,range.arrival_name,range.departure_terminal,range.arrival_terminal,range.departure_gate,range.arrival_gate,raw.to_string(),now]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
            }
        }
        for idx in desired_ranges.len()..current.legs.len() {
            let leg = &current.legs[idx];
            let action = &current.actions[idx];
            tx.execute("UPDATE productivity_item_travel_leg SET deleted_at_utc=?1,updated_at_utc=?1 WHERE id=?2",params![now,leg.id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
            tx.execute("UPDATE productivity_action SET deleted_at_utc=?1,updated_at_utc=?1,revision=revision+1 WHERE id=?2",params![now,action.id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        }
        bump_item(tx,&req.item.id,&now)?;
        load_travel(tx,&req.item.id,true)
    }))
}

fn load_travel(tx: &Transaction<'_>, item_id: &str, live_only: bool) -> DomainResult<TravelSnapshot> {
    let mut item = item_snapshot(tx, item_id, live_only)?;
    let kind: Option<String> = tx.query_row("SELECT kind FROM productivity_item_travel_detail WHERE item_id=?1", [item_id], |r| r.get(0)).optional().map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    item.travel_kind = kind.clone();
    // restore_travel loads tombstones with live_only=false; unknown extra_json
    // must still block writes, not only live reads.
    let detail = tx.query_row("SELECT item_id,schema_version,kind,service_number,aircraft_type,operator_code,operator_name,carriage,seat_number,source_snapshot_json,deletion_batch_id,created_at_utc,updated_at_utc,deleted_at_utc,extra_json FROM productivity_item_travel_detail WHERE item_id=?1", [item_id], |r| { let raw:String=r.get(9)?; let value=serde_json::from_str(&raw).map_err(|_|rusqlite::Error::InvalidQuery)?; let extra:String=r.get(14)?; Ok((TravelDetailSnapshot { item_id:r.get(0)?,schema_version:r.get(1)?,kind:r.get(2)?,service_number:r.get(3)?,aircraft_type:r.get(4)?,operator_code:r.get(5)?,operator_name:r.get(6)?,carriage:r.get(7)?,seat_number:r.get(8)?,source_snapshot:value,deletion_batch_id:r.get(10)?,created_at_utc:r.get(11)?,updated_at_utc:r.get(12)?,deleted_at_utc:r.get(13)?},extra)) }).optional().map_err(|e| DomainError::archive_lifecycle(e.to_string()))?.map(|(d,e)| { if d.schema_version != 1 || !matches!(d.kind.as_str(),"flight"|"train") { return Err(DomainError::invalid_patch("unknown travel detail schema or kind")); } guard_unknown(&e)?; Ok(d) }).transpose()?;
    let mut stmt = tx.prepare("SELECT id,item_id,action_id,position,departure_code,departure_name,arrival_code,arrival_name,departure_terminal,arrival_terminal,departure_gate,arrival_gate,source_snapshot_json,deletion_batch_id,created_at_utc,updated_at_utc,deleted_at_utc,extra_json FROM productivity_item_travel_leg WHERE item_id=?1 AND (?2=0 OR deleted_at_utc IS NULL) ORDER BY position") .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt.query_map(params![item_id, if live_only { 1 } else { 0 }], |r| { let raw=r.get::<_,String>(12)?; let value=serde_json::from_str(&raw).map_err(|_|rusqlite::Error::InvalidQuery)?; let extra:String=r.get(17)?; Ok((TravelLegSnapshot { id:r.get(0)?,item_id:r.get(1)?,action_id:r.get(2)?,position:r.get(3)?,departure_code:r.get(4)?,departure_name:r.get(5)?,arrival_code:r.get(6)?,arrival_name:r.get(7)?,departure_terminal:r.get(8)?,arrival_terminal:r.get(9)?,departure_gate:r.get(10)?,arrival_gate:r.get(11)?,source_snapshot:value,deletion_batch_id:r.get(13)?,created_at_utc:r.get(14)?,updated_at_utc:r.get(15)?,deleted_at_utc:r.get(16)?}, extra)) }).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?.collect::<Result<Vec<_>,_>>().map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut legs = Vec::with_capacity(rows.len());
    for (leg, extra) in rows {
        guard_unknown(&extra)?;
        legs.push(leg);
    }
    let actions = legs.iter().map(|leg| action_snapshot(tx, &leg.action_id, live_only).map(apply_execution_state)).collect::<Result<Vec<_>,_>>()?;
    Ok(TravelSnapshot { item, detail, legs, actions })
}
