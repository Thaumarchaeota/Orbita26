use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::super::types::{CheckpointSnapshot, RevisionRef};

pub const SUPPORTED_PROFILE_SCHEMA: i64 = 1;
pub const SUPPORTED_MEMBER_SCHEMA: i64 = 1;
pub const TRAVEL_ACTION_TITLE: &str = "出行安排";
pub const DEFAULT_CP_TITLE: &str = "未命名检查点";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelMutationEnvelope<T> {
    pub request_id: String,
    pub expected_data_dir: String,
    #[serde(default)]
    pub item_ref: Option<RevisionRef>,
    #[serde(default)]
    pub action_refs: Vec<RevisionRef>,
    #[serde(default)]
    pub checkpoint_refs: Vec<RevisionRef>,
    pub payload: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelMutationResult {
    pub changed: bool,
    pub snapshot: TripSnapshot,
    pub affected_root_refs: Vec<RevisionRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batch_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adoption_report: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_history_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_history: Option<PlanHistoryStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripSnapshot {
    pub item: TripItemView,
    pub profile: TravelProfileView,
    pub actions: Vec<TripActionView>,
    pub checkpoints: Vec<CheckpointSnapshot>,
    pub transportations: Vec<TransportationDto>,
    pub points: Vec<TravelPointDto>,
    pub canonical_points: Vec<CanonicalPointDto>,
    pub segments: Vec<TripSegmentDto>,
    pub member_refs: TripMemberRefs,
    pub capabilities: TripCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripItemView {
    pub id: String,
    pub revision: i64,
    pub title: String,
    pub completed: bool,
    pub list_id: Option<String>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelProfileView {
    pub schema_version: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripActionView {
    pub id: String,
    pub revision: i64,
    pub transportation_id: Option<String>,
    pub planned_start_at: String,
    pub planned_end_at: String,
    pub ended: bool,
    pub actual: ActionActualProjection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionActualProjection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_at_utc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_at_utc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_start_at_utc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_end_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportationDto {
    pub id: String,
    pub item_id: String,
    pub schema_version: i64,
    pub transportation_type: Option<String>,
    pub name: Option<String>,
    pub note: Option<String>,
    pub service_number: Option<String>,
    pub operator: Option<String>,
    pub vehicle_model: Option<String>,
    pub aircraft_registration: Option<String>,
    pub license_plate: Option<String>,
    pub carriage: Option<String>,
    pub seat: Option<String>,
    pub departure_name: Option<String>,
    pub arrival_name: Option<String>,
    pub departure_code: Option<String>,
    pub arrival_code: Option<String>,
    pub departure_terminal: Option<String>,
    pub arrival_terminal: Option<String>,
    pub departure_gate: Option<String>,
    pub arrival_gate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_snapshot: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelPointDto {
    pub id: String,
    pub attachment_kind: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_checkpoint_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalPointDto {
    pub point_id: String,
    pub planned_at_utc: String,
    pub owner_kind: String,
    pub owner_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_at_utc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub front_actual_end_utc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rear_actual_start_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripSegmentDto {
    pub action_id: String,
    pub transportation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transportation_type: Option<String>,
    pub planned_start_at: String,
    pub planned_end_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripMemberRefs {
    pub actions: Vec<RevisionRef>,
    pub checkpoints: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripCapabilities {
    pub can_edit_plan: bool,
    pub can_edit_structure: bool,
    pub can_edit_text: bool,
    pub can_record_actual: bool,
    pub can_change_transportation_type: bool,
    pub can_finish: bool,
    pub can_cancel: bool,
    pub can_append: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelV2GetRequest {
    pub expected_data_dir: String,
    pub item_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelV2GetResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<TripSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelV2ListWeekRequest {
    pub expected_data_dir: String,
    pub from_utc: String,
    pub to_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelV2WeekItemRef {
    pub item_id: String,
    pub item_ref: RevisionRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelV2WeekItemEntry {
    pub item_id: String,
    pub item_ref: RevisionRef,
    pub title: String,
    pub canonical_points: Vec<CanonicalPointDto>,
    pub segments: Vec<TripSegmentDto>,
    pub snapshot: TripSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelV2ListWeekResponse {
    pub items: Vec<TravelV2WeekItemEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelV2ListItemsRequest {
    pub expected_data_dir: String,
    pub scope: ListItemsScope,
    pub status: String,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListItemsScope {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelV2ListItemsResponse {
    pub items: Vec<TravelV2WeekItemRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTripPayload {
    pub new_item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_id: Option<String>,
    pub title: String,
    pub first_content: FirstContentPayload,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportationFirstFields {
    pub name: Option<String>,
    pub note: Option<String>,
    pub service_number: Option<String>,
    pub operator: Option<String>,
    pub vehicle_model: Option<String>,
    pub aircraft_registration: Option<String>,
    pub license_plate: Option<String>,
    pub carriage: Option<String>,
    pub seat: Option<String>,
    pub departure_name: Option<String>,
    pub arrival_name: Option<String>,
    pub departure_code: Option<String>,
    pub arrival_code: Option<String>,
    pub departure_terminal: Option<String>,
    pub arrival_terminal: Option<String>,
    pub departure_gate: Option<String>,
    pub arrival_gate: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum FirstContentPayload {
    // Internally tagged enums do not apply enum-level rename_all to variant fields.
    #[serde(rename = "checkpoint", rename_all = "camelCase")]
    Checkpoint { checkpoint_id: String, planned_at_utc: String, title: Option<String>, location: Option<String> },
    #[serde(rename = "action", rename_all = "camelCase")]
    Action {
        action_id: String,
        transportation_id: String,
        start_point_id: String,
        end_point_id: String,
        planned_start_at: String,
        planned_end_at: String,
        transportation_type: Option<String>,
        #[serde(default)]
        start_location: Option<String>,
        #[serde(default)]
        end_location: Option<String>,
        #[serde(default)]
        transportation_fields: TransportationFirstFields,
        #[serde(default)]
        transportation_source_snapshot: Option<serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendTripPayload {
    pub kind: String,
    pub action_id: Option<String>,
    pub checkpoint_id: Option<String>,
    pub transportation_id: Option<String>,
    pub existing_transportation_id: Option<String>,
    pub planned_start_at: Option<String>,
    pub planned_end_at: Option<String>,
    pub planned_at_utc: Option<String>,
    #[serde(default)]
    pub transportation_fields: TransportationFirstFields,
    #[serde(default)]
    pub transportation_source_snapshot: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateItemPayload {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePointPayload {
    pub point_id: String,
    /// Absent fields stay unchanged. A partial editor patch only sends the field just edited.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_label: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTransportationPayload {
    /// The editor sends `{ transportationId, <one column> }`. Flatten keeps that shape.
    /// `transportationId` is the row identity, not a transportation column.
    #[serde(flatten)]
    pub body: Map<String, Value>,
}

impl UpdateTransportationPayload {
    pub fn transportation_id(&self) -> Option<String> {
        self.body.get("transportationId").and_then(Value::as_str).map(str::to_owned)
    }

    pub fn column_fields(&self) -> Value {
        let mut fields = self.body.clone();
        fields.remove("transportationId");
        Value::Object(fields)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPlanPayload {
    pub edit: Value,
    #[serde(default)]
    pub resolutions: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_scope: Option<PlanHistoryScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanHistoryScope { pub owner_id: String, pub host_epoch: u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanHistoryStatus {
    pub owner_id: String, pub host_epoch: u64, pub request_id: String,
    pub sequence: u64, pub phase: String, pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReplayTravelPlanEffectRequest {
    pub expected_data_dir: String, pub history_owner_id: String, pub host_epoch: u64,
    pub request_id: String, pub plan_history_token: String, pub direction: String,
    pub current_trip_refs: PlanHistoryTripRefs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanHistoryTripRefs {
    pub item: RevisionRef, pub actions: Vec<RevisionRef>, pub checkpoints: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReleaseTravelPlanHistoryRequest {
    pub expected_data_dir: String, pub history_owner_id: String, pub host_epoch: u64,
    pub token_ids: Option<Vec<String>>, pub all: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPayload {
    pub action_id: String,
    pub split_at: String,
    pub new_action_id: String,
    pub new_transportation_id: String,
    pub new_point_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetActualPayload {
    pub target: SetActualTarget,
    pub value: Option<String>,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum SetActualTarget {
    #[serde(rename = "actionBoundary", rename_all = "camelCase")]
    ActionBoundary { action_id: String, side: String },
    #[serde(rename = "checkpoint", rename_all = "camelCase")]
    Checkpoint { checkpoint_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCheckpointCompletedPayload {
    pub checkpoint_id: String,
    pub completed: bool,
    pub actual_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetJoinActualPayload {
    pub front_action_id: String,
    pub rear_action_id: String,
    pub actual_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTripPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_current_action_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteStagePayload {
    pub action_id: String,
    pub delete_start_point: bool,
    pub delete_end_point: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCheckpointPayload {
    pub checkpoint_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearPointPayload {
    pub point_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreTripPayload {
    pub batch_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelQueryFlightContext {
    #[serde(default)]
    pub item_id: Option<String>,
    #[serde(default)]
    pub item_revision: Option<i64>,
    #[serde(default)]
    pub transportation_id: Option<String>,
    #[serde(default)]
    pub draft: bool,
    pub expected_data_dir: String,
    pub query_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryFlightPayload {
    pub context: TravelQueryFlightContext,
    pub flight_number: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptFlightPayload {
    pub transportation_id: String,
    pub query_generation: u64,
    pub candidate: Value,
    #[serde(default)]
    pub raw: Option<Value>,
    #[serde(default)]
    pub adoption_token: String,
    /// When set, must match `query_generation` and the adoption token (SPEC §8).
    #[serde(default)]
    pub restore_baseline_generation: Option<u64>,
    /// `None` keeps legacy adopt (skip existing actuals / frozen plan).
    /// `Some` is an allowlist enforced in this transaction; empty writes no business fields.
    #[serde(default)]
    pub selected_fields: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreAdoptionFieldsPayload {
    pub transportation_id: String,
    pub adoption_token: String,
    pub fields: Vec<String>,
    pub expected_current_values: Value,
    #[serde(default)]
    pub before_values: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportationListRequest {
    pub expected_data_dir: String,
    #[serde(default)]
    pub types: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_utc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_utc: Option<String>,
    #[serde(default = "default_time_basis")]
    pub time_basis: String,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

fn default_time_basis() -> String {
    "planned".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportationListEntry {
    pub transportation: TransportationDto,
    pub item_ref: RevisionRef,
    pub actions: Vec<TripActionView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportationListResponse {
    pub entries: Vec<TransportationListEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetReceiptRequest {
    pub expected_data_dir: String,
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetReceiptResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<TravelMutationResult>,
}

#[cfg(test)]
mod camel_case_tagged_enums {
    use super::{CreateTripPayload, FirstContentPayload, SetActualTarget};
    use serde_json::json;

    #[test]
    fn create_first_content_action_accepts_camel_case() {
        let payload: CreateTripPayload = serde_json::from_value(json!({
            "newItemId": "item-1",
            "title": "新出行",
            "firstContent": {
                "kind": "action",
                "actionId": "action-1",
                "transportationId": "tr-1",
                "startPointId": "p-start",
                "endPointId": "p-end",
                "plannedStartAt": "2026-10-25T03:00:00.000Z",
                "plannedEndAt": "2026-10-25T04:00:00.000Z",
                "transportationType": "flight",
                "transportationFields": { "serviceNumber": "CA123", "departureName": "首都机场" },
                "transportationSourceSnapshot": { "provider": "variflight", "raw": { "FlightNo": "CA123" } }
            }
        }))
        .expect("camelCase firstContent.action should deserialize");
        match payload.first_content {
            FirstContentPayload::Action { action_id, transportation_fields, transportation_source_snapshot, .. } => {
                assert_eq!(action_id, "action-1");
                assert_eq!(transportation_fields.service_number.as_deref(), Some("CA123"));
                assert!(transportation_source_snapshot.is_some());
            }
            other => panic!("expected action, got {other:?}"),
        }
    }

    #[test]
    fn draft_flight_query_has_no_persisted_trip_or_transport_references() {
        let payload: super::QueryFlightPayload = serde_json::from_value(json!({
            "context": {
                "draft": true,
                "expectedDataDir": "data-root",
                "queryGeneration": 4
            },
            "flightNumber": "CA123",
            "date": "2026-10-25"
        }))
        .expect("draft query should deserialize without a persisted item or transport");
        assert!(payload.context.draft);
        assert!(payload.context.item_id.is_none());
        assert!(payload.context.transportation_id.is_none());
    }

    #[test]
    fn set_actual_target_accepts_camel_case() {
        let target: SetActualTarget = serde_json::from_value(json!({
            "kind": "actionBoundary",
            "actionId": "action-1",
            "side": "start"
        }))
        .expect("camelCase setActual target should deserialize");
        match target {
            SetActualTarget::ActionBoundary { action_id, side } => {
                assert_eq!(action_id, "action-1");
                assert_eq!(side, "start");
            }
            other => panic!("expected actionBoundary, got {other:?}"),
        }
    }
}
