//! Stable local persistence for a free-trip Item's services and ordered Action stages.
//!
//! This module is intentionally separate from the legacy `travel` profile. The
//! V16 migration installs these tables without converting or claiming legacy rows.

use std::collections::HashSet;

use chrono::{DateTime, FixedOffset};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::error::{DomainError, DomainResult};
use super::types::RevisionRef;
use super::{repository, util::utc_now};
use super::coordinator::{in_transaction, with_strict_read, with_write_expected};

/// Called by the shared archive migration. Kept separate so the checkpoint and
/// travel foundations can share one schema-version transaction without editing
/// each other's DDL.
pub const TRAVEL_FOUNDATION_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS productivity_item_travel_service (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES productivity_item(id),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  kind TEXT NOT NULL CHECK(kind IN ('flight','train')),
  service_number TEXT,
  operator_code TEXT,
  operator_name TEXT,
  carriage TEXT,
  seat_number TEXT,
  aircraft_type TEXT,
  source_snapshot_json TEXT NOT NULL DEFAULT '{}',
  is_cancelled INTEGER NOT NULL DEFAULT 0 CHECK(is_cancelled IN (0,1)),
  deleted_at_utc TEXT,
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_travel_service_item
  ON productivity_item_travel_service(item_id, id);

CREATE TABLE IF NOT EXISTS productivity_action_travel_stage (
  action_id TEXT PRIMARY KEY REFERENCES productivity_action(id),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  position INTEGER NOT NULL CHECK(position >= 0),
  start_info_json TEXT,
  end_info_json TEXT,
  icon_key TEXT,
  transport_mode TEXT,
  service_id TEXT REFERENCES productivity_item_travel_service(id),
  start_terminal TEXT,
  end_terminal TEXT,
  start_gate TEXT,
  end_gate TEXT,
  source_segment_ref TEXT,
  deleted_at_utc TEXT,
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_travel_stage_position
  ON productivity_action_travel_stage(position, action_id);
CREATE INDEX IF NOT EXISTS idx_travel_stage_service
  ON productivity_action_travel_stage(service_id);

CREATE TABLE IF NOT EXISTS productivity_action_travel_actual_detail (
  action_id TEXT PRIMARY KEY REFERENCES productivity_action(id),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  interval_id TEXT UNIQUE REFERENCES productivity_interval(id),
  pending_start_at_utc TEXT,
  pending_end_at_utc TEXT,
  start_origin TEXT,
  end_origin TEXT,
  start_source_ref TEXT,
  end_source_ref TEXT,
  start_auto_fill_block TEXT,
  end_auto_fill_block TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  deleted_at_utc TEXT,
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}',
  CHECK(pending_start_at_utc IS NULL OR pending_end_at_utc IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_travel_actual_interval
  ON productivity_action_travel_actual_detail(interval_id);
"#;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TravelService {
    pub id: String,
    pub item_id: String,
    pub schema_version: i64,
    pub kind: String,
    pub service_number: Option<String>,
    pub operator_code: Option<String>,
    pub operator_name: Option<String>,
    pub carriage: Option<String>,
    pub seat_number: Option<String>,
    pub aircraft_type: Option<String>,
    pub source_snapshot: Value,
    pub is_cancelled: bool,
    pub deleted_at_utc: Option<String>,
    pub deletion_batch_id: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub extra_fields: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TravelStage {
    pub action_id: String,
    pub schema_version: i64,
    pub position: i64,
    pub start_info: Option<TravelEndpointInfo>,
    pub end_info: Option<TravelEndpointInfo>,
    pub icon_key: Option<String>,
    pub transport_mode: Option<String>,
    pub service_id: Option<String>,
    pub start_terminal: Option<String>,
    pub end_terminal: Option<String>,
    pub start_gate: Option<String>,
    pub end_gate: Option<String>,
    pub source_segment_ref: Option<String>,
    pub deleted_at_utc: Option<String>,
    pub deletion_batch_id: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub extra_fields: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelFoundationSnapshot {
    pub item_id: String,
    pub item_revision: i64,
    pub services: Vec<TravelService>,
    pub stages: Vec<TravelStage>,
    pub action_revisions: Vec<RevisionRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelEndpointInfo {
    pub display_name: Option<String>,
    pub location: Option<String>,
    #[serde(flatten)]
    pub extra_fields: std::collections::BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TravelServiceInput {
    pub id: String,
    pub kind: String,
    pub service_number: Option<String>,
    pub operator_code: Option<String>,
    pub operator_name: Option<String>,
    pub carriage: Option<String>,
    pub seat_number: Option<String>,
    pub aircraft_type: Option<String>,
    pub source_snapshot: Value,
    pub is_cancelled: bool,
    pub extra_fields: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TravelStageInput {
    pub action_id: String,
    pub position: i64,
    pub start_info: Option<TravelEndpointInfo>,
    pub end_info: Option<TravelEndpointInfo>,
    pub icon_key: Option<String>,
    pub transport_mode: Option<String>,
    pub service_id: Option<String>,
    pub start_terminal: Option<String>,
    pub end_terminal: Option<String>,
    pub start_gate: Option<String>,
    pub end_gate: Option<String>,
    pub source_segment_ref: Option<String>,
    pub extra_fields: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveTravelFoundationRequest {
    pub expected_data_dir: String,
    pub item: RevisionRef,
    pub expected_actions: Vec<RevisionRef>,
    pub services: Vec<TravelServiceInput>,
    pub stages: Vec<TravelStageInput>,
}

/// Reads only the new foundation tables. Legacy TravelDetail/TravelLeg rows are
/// deliberately never treated as equivalent records.
pub(crate) fn read_foundation(tx: &Transaction<'_>, item_id: &str) -> DomainResult<Option<TravelFoundationSnapshot>> {
    let root: Option<(i64, String)> = tx.query_row(
        "SELECT revision, extra_json FROM productivity_item WHERE id=?1 AND deleted_at_utc IS NULL",
        [item_id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional().map_err(sql_error)?;
    let Some((item_revision, _item_extra)) = root else { return Ok(None); };
    let mut services = Vec::new();
    {
        let mut stmt = tx.prepare("SELECT id,item_id,schema_version,kind,service_number,operator_code,operator_name,carriage,seat_number,aircraft_type,source_snapshot_json,is_cancelled,deleted_at_utc,deletion_batch_id,created_at_utc,updated_at_utc,extra_json FROM productivity_item_travel_service WHERE item_id=?1 ORDER BY id").map_err(sql_error)?;
        let rows = stmt.query_map([item_id], |r| Ok((
            r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,String>(3)?,
            r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?,
            r.get::<_,Option<String>>(7)?,r.get::<_,Option<String>>(8)?,r.get::<_,Option<String>>(9)?,
            r.get::<_,String>(10)?,r.get::<_,bool>(11)?,r.get::<_,Option<String>>(12)?,r.get::<_,Option<String>>(13)?,
            r.get::<_,String>(14)?,r.get::<_,String>(15)?,r.get::<_,String>(16)?,
        ))).map_err(sql_error)?;
        for row in rows {
            let (id, item_id, schema_version, kind, service_number, operator_code, operator_name,
                carriage, seat_number, aircraft_type, source, is_cancelled, deleted_at_utc,
                deletion_batch_id, created_at_utc, updated_at_utc, extra) = row.map_err(sql_error)?;
            if schema_version != 1 { return Err(DomainError::unknown_field_blocked()); }
            services.push(TravelService { id, item_id, schema_version, kind, service_number,
                operator_code, operator_name, carriage, seat_number, aircraft_type,
                source_snapshot: parse_json(&source)?, is_cancelled, deleted_at_utc,
                deletion_batch_id, created_at_utc, updated_at_utc, extra_fields: parse_json(&extra)? });
        }
    }
    let mut stages = Vec::new();
    let mut action_revisions = Vec::new();
    {
        let mut stmt = tx.prepare("SELECT s.action_id,a.revision,s.schema_version,s.position,s.start_info_json,s.end_info_json,s.icon_key,s.transport_mode,s.service_id,s.start_terminal,s.end_terminal,s.start_gate,s.end_gate,s.source_segment_ref,s.deleted_at_utc,s.deletion_batch_id,s.created_at_utc,s.updated_at_utc,s.extra_json,CASE WHEN s.service_id IS NOT NULL AND (svc.id IS NULL OR svc.item_id != ?1 OR svc.deleted_at_utc IS NOT NULL) THEN 1 ELSE 0 END FROM productivity_action_travel_stage s JOIN productivity_action a ON a.id=s.action_id LEFT JOIN productivity_item_travel_service svc ON svc.id=s.service_id WHERE a.target_kind='item' AND a.target_id=?1 AND a.deleted_at_utc IS NULL ORDER BY s.position,s.action_id").map_err(sql_error)?;
        let rows = stmt.query_map([item_id], |r| Ok((
            r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,r.get::<_,i64>(3)?,
            r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?,
            r.get::<_,Option<String>>(7)?,r.get::<_,Option<String>>(8)?,r.get::<_,Option<String>>(9)?,
            r.get::<_,Option<String>>(10)?,r.get::<_,Option<String>>(11)?,r.get::<_,Option<String>>(12)?,
            r.get::<_,Option<String>>(13)?,r.get::<_,Option<String>>(14)?,r.get::<_,Option<String>>(15)?,
            r.get::<_,String>(16)?,r.get::<_,String>(17)?,r.get::<_,String>(18)?,r.get::<_,bool>(19)?,
        ))).map_err(sql_error)?;
        for row in rows {
            let (action_id, revision, schema_version, position, start_info, end_info, icon_key,
                transport_mode, service_id, start_terminal, end_terminal, start_gate, end_gate,
                source_segment_ref, deleted_at_utc, deletion_batch_id, created_at_utc,
                updated_at_utc, extra, invalid_service_owner) = row.map_err(sql_error)?;
            if schema_version != 1 { return Err(DomainError::unknown_field_blocked()); }
            if invalid_service_owner { return Err(DomainError::invalid_patch("travel stage references a missing or differently owned service")); }
            action_revisions.push(RevisionRef { id: action_id.clone(), expected_revision: revision });
            stages.push(TravelStage { action_id, schema_version, position, start_info: parse_endpoint(start_info)?, end_info: parse_endpoint(end_info)?,
                icon_key, transport_mode, service_id, start_terminal, end_terminal, start_gate,
                end_gate, source_segment_ref, deleted_at_utc, deletion_batch_id, created_at_utc,
                updated_at_utc, extra_fields: parse_json(&extra)? });
        }
    }
    if services.is_empty() && stages.is_empty() { return Ok(None); }
    let action_count: i64 = tx.query_row("SELECT COUNT(*) FROM productivity_action WHERE target_kind='item' AND target_id=?1 AND deleted_at_utc IS NULL", [item_id], |r| r.get(0)).map_err(sql_error)?;
    if stages.is_empty() || action_count != stages.len() as i64 { return Err(DomainError::revision_conflict("travel foundation Action membership is incomplete")); }
    for (position, stage) in stages.iter().enumerate() {
        if stage.position != position as i64 { return Err(DomainError::invalid_patch("stored travel stage positions are not unique and contiguous")); }
    }
    Ok(Some(TravelFoundationSnapshot { item_id: item_id.to_owned(), item_revision, services, stages, action_revisions }))
}

/// Controlled local Rust API; intentionally not registered as a Tauri command.
/// expectedDataDir and the complete request are checked before one transaction.
pub(crate) fn save_foundation(data_dir: &str, req: SaveTravelFoundationRequest) -> DomainResult<TravelFoundationSnapshot> {
    let _ = data_dir;
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        save_foundation_in_transaction(tx, &req.item, &req.expected_actions, &req.services, &req.stages)
    }))
}

pub(crate) fn get_foundation(data_dir: &str, item_id: &str) -> DomainResult<Option<TravelFoundationSnapshot>> {
    // Strict read avoids creating/upgrading an Archive just to inspect this
    // foundation; older schema versions fail through the coordinator's explicit
    // upgrade-required error path before any table query runs.
    with_strict_read(data_dir, |conn| {
        let Some(conn) = conn else { return Ok(None); };
        in_transaction(conn, |tx| read_foundation(tx, item_id))
    })
}

/// Saves a full Item service collection and a full, position-ordered Action
/// stage set inside the caller's Archive transaction. The caller must enter
/// through `with_write_expected`, so dataDir and activation-epoch checks happen
/// before this function. Item and each changed Action revision advance once.
fn save_foundation_in_transaction(
    tx: &Transaction<'_>, item: &RevisionRef, expected_actions: &[RevisionRef],
    services: &[TravelServiceInput], stages: &[TravelStageInput],
) -> DomainResult<TravelFoundationSnapshot> {
    let (item_row, item_extra) = repository::load_item_row(tx, &item.id, true)?;
    repository::check_revision(item.expected_revision, item_row.revision)?;
    repository::guard_unknown(&item_extra)?;
    super::validation::ensure_list_writable(tx, item_row.list_id.as_deref())?;

    // A legacy profile is never adopted into the new free-trip model.
    let legacy: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM productivity_item_travel_detail WHERE item_id=?1 UNION ALL SELECT 1 FROM productivity_item_travel_leg WHERE item_id=?1)",
        [&item.id], |r| r.get(0),
    ).map_err(sql_error)?;
    if legacy { return Err(DomainError::invalid_patch("legacy travel profile is isolated from travel foundation")); }

    let stage_values: Vec<TravelStage> = stages.iter().map(|s| TravelStage {
        action_id: s.action_id.clone(), schema_version: 1, position: s.position,
        start_info: s.start_info.clone(), end_info: s.end_info.clone(), icon_key: s.icon_key.clone(),
        transport_mode: s.transport_mode.clone(), service_id: s.service_id.clone(),
        start_terminal: s.start_terminal.clone(), end_terminal: s.end_terminal.clone(),
        start_gate: s.start_gate.clone(), end_gate: s.end_gate.clone(),
        source_segment_ref: s.source_segment_ref.clone(), deleted_at_utc: None,
        deletion_batch_id: None, created_at_utc: String::new(), updated_at_utc: String::new(),
        extra_fields: s.extra_fields.clone(),
    }).collect();
    validate_stage_membership(tx, &item.id, expected_actions, &stage_values)?;
    if stages.is_empty() { return Err(DomainError::invalid_patch("travel foundation requires at least one Action stage")); }

    let mut service_ids = HashSet::new();
    for service in services {
        if !service_ids.insert(service.id.as_str()) { return Err(DomainError::invalid_patch("duplicate travel service id")); }
        if !matches!(service.kind.as_str(), "flight" | "train") { return Err(DomainError::invalid_patch("travel service kind must be flight or train")); }
        if !service.source_snapshot.is_object() || !service.extra_fields.as_object().is_some_and(|o| o.is_empty()) {
            return Err(DomainError::invalid_patch("travel service snapshot must be an object and unknown extension fields cannot be written"));
        }
        if serde_json::to_vec(&service.source_snapshot).map_err(|e| DomainError::invalid_patch(e.to_string()))?.len() > 256 * 1024 {
            return Err(DomainError::invalid_patch("travel service source snapshot exceeds size limit"));
        }
    }
    for stage in stages {
        if let Some(service_id) = stage.service_id.as_deref() {
            if !service_ids.contains(service_id) { return Err(DomainError::invalid_patch("stage service must be included in the same Item write")); }
        }
        if !stage.extra_fields.as_object().is_some_and(|o| o.is_empty()) { return Err(DomainError::invalid_patch("unknown travel stage fields cannot be written by this schema version")); }
        if stage.start_info.as_ref().is_some_and(endpoint_has_unknown) || stage.end_info.as_ref().is_some_and(endpoint_has_unknown) {
            return Err(DomainError::unknown_field_blocked());
        }
        let (_, extra) = repository::load_action_row(tx, &stage.action_id, true)?;
        repository::guard_unknown(&extra)?;
    }

    // Ensure an ID cannot silently move an Item-owned service across roots.
    for service in services {
        let owner: Option<String> = tx.query_row("SELECT item_id FROM productivity_item_travel_service WHERE id=?1", [&service.id], |r| r.get(0)).optional().map_err(sql_error)?;
        if owner.as_deref().is_some_and(|owner| owner != item.id.as_str()) {
            return Err(DomainError::invalid_patch("travel service cannot move between Items"));
        }
    }

    let previous = read_foundation(tx, &item.id)?;
    let previous_services: std::collections::HashMap<String, TravelService> = previous.as_ref()
        .map(|s| s.services.iter().cloned().map(|v| (v.id.clone(), v)).collect()).unwrap_or_default();
    let previous_stages: std::collections::HashMap<String, TravelStage> = previous.as_ref()
        .map(|s| s.stages.iter().cloned().map(|v| (v.action_id.clone(), v)).collect()).unwrap_or_default();
    validate_actual_order(tx, stages)?;
    for stage in stages {
        let has_actual_record = has_actual_record(tx, &stage.action_id)?;
        let prior_stage = previous_stages.get(&stage.action_id);
        if previous.is_none() && has_actual_record {
            return Err(DomainError::invalid_patch("an Action with existing Interval or actual-detail history cannot enter travel foundation"));
        }
        if previous.is_some() && has_actual_record
            && prior_stage.is_some_and(|old| !same_stage(old, stage))
        {
            return Err(DomainError::invalid_patch("travel stage structure is frozen while actual history exists"));
        }
        if previous.is_some() && has_actual_record && prior_stage.is_none() {
            return Err(DomainError::invalid_patch("an Action with actual history cannot be added to an existing travel foundation"));
        }
    }
    if previous_services.values().any(|s| !s.extra_fields.as_object().is_some_and(|v| v.is_empty())) {
        return Err(DomainError::unknown_field_blocked());
    }
    if previous_services.values().any(|s| s.deleted_at_utc.is_some()) {
        return Err(DomainError::invalid_patch("travel service tombstones require the Item lifecycle command"));
    }
    if previous_services.values().any(|s| !service_ids.contains(s.id.as_str())) {
        return Err(DomainError::invalid_patch("travel service membership must be complete; removal requires the Item lifecycle command"));
    }
    if previous_stages.values().any(|s| !s.extra_fields.as_object().is_some_and(|v| v.is_empty()) || s.start_info.as_ref().is_some_and(endpoint_has_unknown) || s.end_info.as_ref().is_some_and(endpoint_has_unknown)) {
        return Err(DomainError::unknown_field_blocked());
    }
    let now = utc_now();
    let mut item_changed = false;
    for service in services {
        let old = previous_services.get(&service.id);
        if old.is_some_and(|o| !o.extra_fields.as_object().is_some_and(|v| v.is_empty()) || o.extra_fields != service.extra_fields) {
            return Err(DomainError::unknown_field_blocked());
        }
        let changed = old.map(|o| !same_service(o, service)).unwrap_or(true);
        if !changed { continue; }
        item_changed = true;
        let source = json_text(&service.source_snapshot)?;
        let extra = json_text(&service.extra_fields)?;
        tx.execute("INSERT INTO productivity_item_travel_service(id,item_id,schema_version,kind,service_number,operator_code,operator_name,carriage,seat_number,aircraft_type,source_snapshot_json,is_cancelled,created_at_utc,updated_at_utc,extra_json) VALUES(?1,?2,1,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12,?13) ON CONFLICT(id) DO UPDATE SET schema_version=1,kind=excluded.kind,service_number=excluded.service_number,operator_code=excluded.operator_code,operator_name=excluded.operator_name,carriage=excluded.carriage,seat_number=excluded.seat_number,aircraft_type=excluded.aircraft_type,source_snapshot_json=excluded.source_snapshot_json,is_cancelled=excluded.is_cancelled,deleted_at_utc=NULL,deletion_batch_id=NULL,updated_at_utc=excluded.updated_at_utc,extra_json=excluded.extra_json", params![service.id,item.id,service.kind,service.service_number,service.operator_code,service.operator_name,service.carriage,service.seat_number,service.aircraft_type,source,service.is_cancelled,now,extra]).map_err(sql_error)?;
    }
    let mut changed_actions = HashSet::new();
    for stage in stages {
        if previous_stages.get(&stage.action_id).is_some_and(|o| !o.extra_fields.as_object().is_some_and(|v| v.is_empty()) || o.extra_fields != stage.extra_fields) {
            return Err(DomainError::unknown_field_blocked());
        }
        let changed = previous_stages.get(&stage.action_id).map(|o| !same_stage(o, stage)).unwrap_or(true);
        if !changed { continue; }
        changed_actions.insert(stage.action_id.as_str());
        let extra = json_text(&stage.extra_fields)?;
        let start_info = stage.start_info.as_ref().map(json_text_endpoint).transpose()?;
        let end_info = stage.end_info.as_ref().map(json_text_endpoint).transpose()?;
        tx.execute("INSERT INTO productivity_action_travel_stage(action_id,schema_version,position,start_info_json,end_info_json,icon_key,transport_mode,service_id,start_terminal,end_terminal,start_gate,end_gate,source_segment_ref,created_at_utc,updated_at_utc,extra_json) VALUES(?1,1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13,?14) ON CONFLICT(action_id) DO UPDATE SET schema_version=1,position=excluded.position,start_info_json=excluded.start_info_json,end_info_json=excluded.end_info_json,icon_key=excluded.icon_key,transport_mode=excluded.transport_mode,service_id=excluded.service_id,start_terminal=excluded.start_terminal,end_terminal=excluded.end_terminal,start_gate=excluded.start_gate,end_gate=excluded.end_gate,source_segment_ref=excluded.source_segment_ref,deleted_at_utc=NULL,deletion_batch_id=NULL,updated_at_utc=excluded.updated_at_utc,extra_json=excluded.extra_json", params![stage.action_id,stage.position,start_info,end_info,stage.icon_key,stage.transport_mode,stage.service_id,stage.start_terminal,stage.end_terminal,stage.start_gate,stage.end_gate,stage.source_segment_ref,now,extra]).map_err(sql_error)?;
    }

    if item_changed { tx.execute("UPDATE productivity_item SET revision=revision+1,updated_at_utc=?1 WHERE id=?2 AND deleted_at_utc IS NULL", params![now,item.id]).map_err(sql_error)?; }
    for action_id in changed_actions {
        tx.execute("UPDATE productivity_action SET revision=revision+1,updated_at_utc=?1 WHERE id=?2 AND deleted_at_utc IS NULL AND target_kind='item' AND target_id=?3", params![now,action_id,item.id]).map_err(sql_error)?;
    }
    read_foundation(tx, &item.id)?.ok_or_else(|| DomainError::root_not_found("travel foundation not found after save"))
}

fn same_service(old: &TravelService, new: &TravelServiceInput) -> bool {
    old.kind == new.kind && old.service_number == new.service_number && old.operator_code == new.operator_code
        && old.operator_name == new.operator_name && old.carriage == new.carriage && old.seat_number == new.seat_number
        && old.aircraft_type == new.aircraft_type && old.source_snapshot == new.source_snapshot
        && old.is_cancelled == new.is_cancelled && old.extra_fields == new.extra_fields
        && old.deleted_at_utc.is_none()
}

fn same_stage(old: &TravelStage, new: &TravelStageInput) -> bool {
    old.position == new.position && old.start_info == new.start_info && old.end_info == new.end_info
        && old.icon_key == new.icon_key && old.transport_mode == new.transport_mode && old.service_id == new.service_id
        && old.start_terminal == new.start_terminal && old.end_terminal == new.end_terminal
        && old.start_gate == new.start_gate && old.end_gate == new.end_gate
        && old.source_segment_ref == new.source_segment_ref && old.extra_fields == new.extra_fields
        && old.deleted_at_utc.is_none()
}

fn endpoint_has_unknown(value: &TravelEndpointInfo) -> bool { !value.extra_fields.is_empty() }

#[derive(Default)]
struct ActualFacts { start: Option<DateTime<FixedOffset>>, end: Option<DateTime<FixedOffset>> }

fn has_actual_record(tx: &Transaction<'_>, action_id: &str) -> DomainResult<bool> {
    tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM productivity_interval WHERE action_id=?1 UNION ALL SELECT 1 FROM productivity_action_travel_actual_detail WHERE action_id=?1)",
        [action_id], |r| r.get(0),
    ).map_err(sql_error)
}

fn validate_actual_order(tx: &Transaction<'_>, stages: &[TravelStageInput]) -> DomainResult<()> {
    let mut all = std::collections::HashMap::new();
    for stage in stages {
        let mut facts = ActualFacts::default();
        let mut stmt = tx.prepare("SELECT id,started_at,ended_at FROM productivity_interval WHERE action_id=?1 AND deleted_at_utc IS NULL ORDER BY started_at,id").map_err(sql_error)?;
        let intervals = stmt.query_map([&stage.action_id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?))).map_err(sql_error)?;
        let mut interval_rows = Vec::new();
        for row in intervals { interval_rows.push(row.map_err(sql_error)?); }
        if interval_rows.len() > 1 { return Err(DomainError::invalid_patch("travel Action supports at most one live Interval")); }
        let detail: Option<(i64,Option<String>,Option<String>,Option<String>)> = tx.query_row(
            "SELECT schema_version,interval_id,pending_start_at_utc,pending_end_at_utc FROM productivity_action_travel_actual_detail WHERE action_id=?1 AND deleted_at_utc IS NULL",
            [&stage.action_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
        ).optional().map_err(sql_error)?;
        if let Some((schema_version,interval_id,pending_start,pending_end)) = detail {
            if schema_version != 1 { return Err(DomainError::unknown_field_blocked()); }
            if pending_start.is_some() && pending_end.is_some() { return Err(DomainError::invalid_patch("travel actual detail has two pending edges")); }
            facts.start = pending_start.as_deref().map(parse_instant).transpose()?;
            facts.end = pending_end.as_deref().map(parse_instant).transpose()?;
            if let Some(interval_id) = interval_id {
                let Some((live_id,start,end)) = interval_rows.first() else { return Err(DomainError::invalid_patch("travel actual detail references a missing live Interval")); };
                if live_id != &interval_id || pending_start.is_some() || pending_end.is_some() { return Err(DomainError::invalid_patch("materialized travel actual detail is inconsistent")); }
                facts.start = Some(parse_instant(start)?);
                let Some(end) = end.as_deref() else { return Err(DomainError::invalid_patch("travel actual Interval must be closed")); };
                facts.end = Some(parse_instant(end)?);
            } else if !interval_rows.is_empty() {
                return Err(DomainError::invalid_patch("travel actual detail does not identify its live Interval"));
            }
        } else if let Some((_,start,end)) = interval_rows.first() {
            facts.start = Some(parse_instant(start)?);
            let Some(end) = end.as_deref() else { return Err(DomainError::invalid_patch("travel actual Interval must be closed")); };
            facts.end = Some(parse_instant(end)?);
        }
        if facts.start.as_ref().zip(facts.end.as_ref()).is_some_and(|(start,end)| start >= end) {
            return Err(DomainError::invalid_time("travel actual Interval must have positive duration"));
        }
        all.insert(stage.action_id.clone(), facts);
    }
    // A's known end may not pass C's known start even if B has no actual time.
    for left in 0..stages.len() { for right in left+1..stages.len() {
        if let (Some(left_end), Some(right_start)) = (
            all.get(&stages[left].action_id).and_then(|f| f.end.as_ref()),
            all.get(&stages[right].action_id).and_then(|f| f.start.as_ref()),
        ) {
            if left_end > right_start { return Err(DomainError::invalid_time("travel actual Action boundaries overlap or reverse stage position")); }
        }
    }}
    Ok(())
}

fn json_text(value: &Value) -> DomainResult<String> { serde_json::to_string(value).map_err(|e| DomainError::invalid_patch(e.to_string())) }

/// A safe stop for ordinary Item mutations. Call from generic create/update,
/// delete/restore, list-membership and bulk paths before changing the root.
pub(crate) fn guard_generic_item_write(tx: &Transaction<'_>, item_id: &str) -> DomainResult<()> {
    if super::travel_v2::guards::item_has_v2_profile(tx, item_id)? {
        return Err(DomainError::travel_command_required(
            "travel v2 items require productivity_travel_v2_* commands",
        ));
    }
    let protected = exists(tx, "SELECT EXISTS(SELECT 1 FROM productivity_item_travel_service WHERE item_id=?1 UNION ALL SELECT 1 FROM productivity_action_travel_stage s JOIN productivity_action a ON a.id=s.action_id WHERE a.target_kind='item' AND a.target_id=?1 UNION ALL SELECT 1 FROM productivity_action_travel_actual_detail d JOIN productivity_action a ON a.id=d.action_id WHERE a.target_kind='item' AND a.target_id=?1)", item_id)?;
    if protected { Err(DomainError::travel_command_required("travel Item requires its aggregate command")) } else { Ok(()) }
}

/// A safe stop for ordinary Action mutations that can remove or reassign a
/// staged Action. Cosmetic Action edits can use a narrower guard in a later slice.
pub(crate) fn guard_generic_action_write(tx: &Transaction<'_>, action_id: &str) -> DomainResult<()> {
    if super::travel_v2::guards::action_requires_travel_command(tx, action_id)? {
        return Err(DomainError::travel_command_required(
            "travel v2 actions require productivity_travel_v2_* commands",
        ));
    }
    let protected = exists(tx, "SELECT EXISTS(SELECT 1 FROM productivity_action_travel_stage WHERE action_id=?1 UNION ALL SELECT 1 FROM productivity_action_travel_actual_detail WHERE action_id=?1)", action_id)?;
    if protected { Err(DomainError::travel_command_required("travel stage requires its aggregate command")) } else { Ok(()) }
}

/// Validates a complete ordered Action membership and all currently known
/// planned ranges. The pairwise check still catches overlap across untimed gaps.
pub(crate) fn validate_stage_membership(
    tx: &Transaction<'_>, item_id: &str, expected_actions: &[RevisionRef], stages: &[TravelStage],
) -> DomainResult<()> {
    let mut stmt = tx.prepare("SELECT id,revision,planned_start_at,planned_end_at FROM productivity_action WHERE target_kind='item' AND target_id=?1 AND deleted_at_utc IS NULL ORDER BY id").map_err(sql_error)?;
    let rows = stmt.query_map([item_id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?))).map_err(sql_error)?;
    let mut actual = Vec::new();
    let mut ranges = std::collections::HashMap::new();
    for row in rows { let (id, revision, start, end) = row.map_err(sql_error)?; actual.push(RevisionRef { id: id.clone(), expected_revision: revision }); match (start,end) { (None,None) => {}, (Some(s),Some(e)) => { let start_at = parse_instant(&s)?; let end_at = parse_instant(&e)?; if start_at >= end_at { return Err(DomainError::invalid_time("travel Action plan must have positive duration")); } ranges.insert(id, (start_at,end_at)); }, _ => return Err(DomainError::invalid_time("travel Action plan must be absent or a complete interval")) } }
    repository::check_members(expected_actions, &actual)?;
    if stages.len() != actual.len() { return Err(DomainError::revision_conflict("travel stage membership must include every live Item Action")); }
    let action_ids: HashSet<&str> = actual.iter().map(|r| r.id.as_str()).collect();
    let mut stage_ids = HashSet::new();
    for (position, stage) in stages.iter().enumerate() {
        if stage.position != position as i64 || !action_ids.contains(stage.action_id.as_str()) || !stage_ids.insert(stage.action_id.as_str()) {
            return Err(DomainError::invalid_patch("travel stages must have unique contiguous positions for exact Action membership"));
        }
    }
    // Position, rather than timestamp sorting, defines the journey order. Check
    // every pair of known ranges so an untimed stage cannot hide an overlap.
    for left in 0..stages.len() { for right in left+1..stages.len() {
        if let (Some((_, left_end)), Some((right_start, _))) = (ranges.get(&stages[left].action_id), ranges.get(&stages[right].action_id)) {
            if left_end > right_start { return Err(DomainError::invalid_time("travel planned Action ranges overlap or are reversed by stage position")); }
        }
    }}
    Ok(())
}

fn exists(tx: &Transaction<'_>, sql: &str, id: &str) -> DomainResult<bool> {
    // V16 wiring is independent; during migration staging these helpers remain
    // inert until the relevant table exists.
    let installed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='productivity_action_travel_stage')", [], |r| r.get(0)).map_err(sql_error)?;
    if !installed { return Ok(false); }
    tx.query_row(sql, [id], |r| r.get(0)).map_err(sql_error)
}

fn parse_json(raw: &str) -> DomainResult<Value> { serde_json::from_str(raw).map_err(|e| DomainError::archive_lifecycle(e.to_string())) }
fn parse_instant(raw: &str) -> DomainResult<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(raw).map_err(|e| DomainError::invalid_time(format!("invalid UTC instant: {e}")))
}
fn parse_endpoint(raw: Option<String>) -> DomainResult<Option<TravelEndpointInfo>> {
    raw.map(|v| serde_json::from_str(&v).map_err(|e| DomainError::archive_lifecycle(e.to_string()))).transpose()
}
fn json_text_endpoint(value: &TravelEndpointInfo) -> DomainResult<String> {
    serde_json::to_string(value).map_err(|e| DomainError::invalid_patch(e.to_string()))
}
fn sql_error(error: rusqlite::Error) -> DomainError { DomainError::archive_lifecycle(error.to_string()) }

