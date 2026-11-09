use serde::{Deserialize, Serialize};

use super::point::ProductivityPoint;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RevisionRef {
    pub id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    #[serde(default)]
    pub item_type_id: Option<String>,
    pub id: String,
    pub project_id: String,
    pub parent_task_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    #[serde(default)]
    pub sibling_position: i64,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
    pub deletion_batch_id: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub id: String,
    pub revision: i64,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
    pub tasks: Vec<TaskSnapshot>,
    #[serde(default)]
    pub task_sequence_edges: Vec<TaskSequenceEdgeSnapshot>,
    #[serde(default)]
    pub task_card_positions: Vec<TaskCardPositionSnapshot>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSequenceEdgeSnapshot {
    pub id: String,
    pub project_id: String,
    pub source_task_id: String,
    pub target_task_id: String,
    #[serde(default)]
    pub source_anchor: Option<TaskSequenceAnchor>,
    #[serde(default)]
    pub target_anchor: Option<TaskSequenceAnchor>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
    pub deletion_batch_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaskSequenceAnchor {
    pub side: String,
    pub offset: f64,
}

impl TaskSequenceAnchor {
    pub(crate) fn is_valid(&self) -> bool {
        matches!(self.side.as_str(), "top" | "right" | "bottom" | "left")
            && self.offset.is_finite() && (0.0..=1.0).contains(&self.offset)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetTaskSequenceAnchorRequest {
    pub expected_data_dir: String,
    pub project: RevisionRef,
    pub edge_id: String,
    pub expected_source_task_id: String,
    pub expected_target_task_id: String,
    pub expected_parent_task_id: String,
    pub endpoint: String,
    pub anchor: Option<TaskSequenceAnchor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCardPositionSnapshot {
    pub task_id: String,
    pub project_id: String,
    pub parent_task_id: String,
    pub x: f64,
    pub y: f64,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaskInitialSequence {
    pub anchor_task_id: String,
    pub placement: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaskPositionInput { pub x: f64, pub y: f64 }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateTaskInProjectRequest {
    pub item_type_id: Option<String>,
    pub classification_expected: Option<ClassificationExpected>,
    pub expected_data_dir: String,
    pub project: RevisionRef,
    pub title: String,
    pub status: String,
    pub parent_task_id: Option<String>,
    pub description: Option<String>,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
    pub initial_position: Option<TaskPositionInput>,
    pub new_initial_sequence: Option<TaskInitialSequence>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaskSequenceRequest {
    pub expected_data_dir: String,
    pub project: RevisionRef,
    pub source_task_id: String,
    pub target_task_id: String,
    #[serde(default)] pub source_anchor: Option<TaskSequenceAnchor>,
    #[serde(default)] pub target_anchor: Option<TaskSequenceAnchor>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemoveTaskSequenceRequest { pub expected_data_dir: String, pub project: RevisionRef, pub edge_id: String }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetTaskCardPositionRequest { pub expected_data_dir: String, pub project: RevisionRef, pub task_id: String, pub expected_parent_task_id: String, pub x: f64, pub y: f64 }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaskCardPositionInput { pub task_id: String, pub x: f64, pub y: f64 }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetTaskCardPositionsRequest {
    pub expected_data_dir: String,
    pub project: RevisionRef,
    pub expected_parent_task_id: Option<String>,
    pub positions: Vec<TaskCardPositionInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReorderTaskSiblingsRequest { pub expected_data_dir: String, pub project: RevisionRef, pub parent_task_id: Option<String>, pub expected_sibling_ids: Vec<String>, pub ordered_sibling_ids: Vec<String> }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MoveTaskSameLevelRequest { pub expected_data_dir: String, pub project: RevisionRef, pub task_id: String, pub target_parent_task_id: String, pub expected_source_sibling_ids: Vec<String>, pub expected_target_sibling_ids: Vec<String>, pub target_ordered_sibling_ids: Vec<String>, pub position: TaskPositionInput }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetTaskStatusGuardedRequest { pub expected_data_dir: String, pub project: RevisionRef, pub task_id: String, pub status: String }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListDeletedTaskBatchesRequest { pub expected_data_dir: String, pub project_id: String }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedTaskBatchSnapshot { pub deletion_batch_id: String, pub root_task_id: String, pub root_title: String, pub task_ids: Vec<String>, #[serde(default)] pub edge_ids: Vec<String>, pub deleted_at_utc: String }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedTaskBatchesResponse { pub project_id: String, pub project_revision: i64, pub batches: Vec<DeletedTaskBatchSnapshot> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedTaskSequenceEdge {
    pub edge_id: String,
    pub reason_code: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRestoreSummary {
    pub restored_task_ids: Vec<String>,
    pub restored_edge_ids: Vec<String>,
    pub skipped_edges: Vec<SkippedTaskSequenceEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSnapshot {
    pub id: String,
    pub revision: i64,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSnapshot {
    pub id: String,
    pub revision: i64,
    pub list_id: Option<String>,
    pub item_type_id: Option<String>,
    pub tag_ids: Vec<String>,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
    pub deletion_batch_id: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub travel_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelDetailSnapshot {
    pub item_id: String,
    pub schema_version: i64,
    pub kind: String,
    pub service_number: Option<String>,
    pub aircraft_type: Option<String>,
    pub operator_code: Option<String>,
    pub operator_name: Option<String>,
    pub carriage: Option<String>,
    pub seat_number: Option<String>,
    pub source_snapshot: serde_json::Value,
    pub deletion_batch_id: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelLegSnapshot {
    pub id: String,
    pub item_id: String,
    pub action_id: String,
    pub position: i64,
    pub departure_code: Option<String>,
    pub departure_name: Option<String>,
    pub arrival_code: Option<String>,
    pub arrival_name: Option<String>,
    pub departure_terminal: Option<String>,
    pub arrival_terminal: Option<String>,
    pub departure_gate: Option<String>,
    pub arrival_gate: Option<String>,
    pub source_snapshot: serde_json::Value,
    pub deletion_batch_id: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelSnapshot {
    pub item: ItemSnapshot,
    pub detail: Option<TravelDetailSnapshot>,
    pub legs: Vec<TravelLegSnapshot>,
    pub actions: Vec<ActionSnapshot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct TravelRangeInput {
    pub planned_start_at: Option<String>,
    pub planned_end_at: Option<String>,
    pub departure_code: Option<String>,
    pub departure_name: Option<String>,
    pub arrival_code: Option<String>,
    pub arrival_name: Option<String>,
    pub departure_terminal: Option<String>,
    pub arrival_terminal: Option<String>,
    pub departure_gate: Option<String>,
    pub arrival_gate: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CreateTravelRequest {
    pub expected_data_dir: String,
    pub title: String,
    pub kind: String,
    pub root_color: Option<String>,
    pub ranges: Vec<TravelRangeInput>,
    pub list_id: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct GetTravelRequest { pub item_id: String, pub include_deleted: bool }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTravelRequest {
    pub expected_data_dir: String,
    pub item: RevisionRef,
    pub kind: Option<String>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub service_number: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub aircraft_type: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub operator_code: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub operator_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub carriage: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub seat_number: Option<Option<String>>,
    pub action_revisions: Vec<RevisionRef>,
    pub ranges: Option<Vec<TravelRangeInput>>,
    pub source_snapshot: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct TravelSourceQueryRequest {
    pub fnum: String,
    pub date: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AdoptTravelFlightRequest {
    pub expected_data_dir: String,
    pub item: RevisionRef,
    pub expected_actions: Vec<RevisionRef>,
    pub request: TravelSourceQueryRequest,
    pub fetched_at_utc: String,
    pub chosen_record: serde_json::Value,
    pub matched_segments: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTravelRequest { pub expected_data_dir: String, pub item: RevisionRef, pub expected_actions: Vec<RevisionRef> }
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RestoreTravelRequest { pub expected_data_dir: String, pub item: RevisionRef, pub expected_actions: Vec<RevisionRef> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemOrderSnapshot {
    pub id: String,
    pub revision: i64,
    pub ordered_item_ids: Vec<String>,
    pub updated_at_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionActualRange {
    pub actual_start_at: Option<String>,
    pub actual_end_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub id: String,
    pub revision: i64,
    pub title: String,
    pub description: Option<String>,
    pub planned_start_at: String,
    pub planned_end_at: String,
    pub track_lane: i32,
    pub track_span: i32,
    pub actual_range: SessionActualRange,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntervalSnapshot {
    pub id: String,
    pub action_id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionSnapshot {
    pub id: String,
    pub revision: i64,
    pub title: String,
    pub name_link_mode: String,
    pub summary: Option<String>,
    pub session_id: Option<String>,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub planned_start_at: Option<String>,
    pub planned_end_at: Option<String>,
    pub planned_duration: Option<i64>,
    pub ended: bool,
    pub execution_state: String,
    pub intervals: Vec<IntervalSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transportation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance: Option<ActionAppearance>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointSnapshot {
    pub id: String,
    pub name_link_mode: String,
    pub schema_version: i64,
    pub revision: i64,
    pub title: String,
    pub description: Option<String>,
    pub appearance: Option<ActionAppearance>,
    pub planned_at_utc: Option<String>,
    pub actual_at_utc: Option<String>,
    pub completed: bool,
    pub session_id: Option<String>,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateCheckpointRequest {
    pub expected_data_dir: String,
    pub title: String,
    pub description: Option<String>,
    pub appearance: Option<ActionAppearance>,
    pub planned_at_utc: Option<String>,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub owning_root: Option<RevisionRef>,
    #[serde(default)]
    pub name_link_mode: Option<String>,
    #[serde(default)]
    pub session: Option<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetCheckpointRequest { pub id: String, pub include_deleted: bool }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListCheckpointsRequest { pub include_deleted: bool, #[serde(default)] pub expected_data_dir: Option<String> }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UpdateCheckpointRequest {
    pub expected_data_dir: String,
    pub checkpoint: RevisionRef,
    #[serde(default, deserialize_with = "present_nullable")]
    pub title: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub description: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub appearance: Option<Option<ActionAppearance>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub planned_at_utc: Option<Option<String>>,
    #[serde(default)]
    pub name_link_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CompleteCheckpointRequest {
    pub expected_data_dir: String,
    pub checkpoint: RevisionRef,
    #[serde(default, deserialize_with = "present_nullable")]
    pub actual_at_utc: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CorrectCheckpointActualRequest {
    pub expected_data_dir: String,
    pub checkpoint: RevisionRef,
    #[serde(default, deserialize_with = "present_nullable")]
    pub actual_at_utc: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CheckpointRequest { pub expected_data_dir: String, pub checkpoint: RevisionRef, pub session: Option<RevisionRef>, #[serde(default)] pub detach_session: bool }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetCheckpointTargetRequest {
    pub expected_data_dir: String,
    pub checkpoint: RevisionRef,
    pub target_kind: String,
    pub target_id: String,
    pub owning_root: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssignCheckpointSessionRequest { pub expected_data_dir: String, pub checkpoint: RevisionRef, pub session: RevisionRef }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointResponse { pub checkpoint: CheckpointSnapshot }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointsListResponse { pub checkpoints: Vec<CheckpointSnapshot> }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ActionAppearance {
    pub color: String,
    pub opacity: f64,
    pub stroke: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThingPointPatch {
    pub planned_point: Option<Option<ProductivityPoint>>,
    pub due_point: Option<Option<ProductivityPoint>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPatch {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub planned_point: Option<Option<ProductivityPoint>>,
    pub due_point: Option<Option<ProductivityPoint>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    #[serde(default, deserialize_with = "present_nullable")]
    pub item_type_id: Option<Option<String>>,
    pub classification_expected: Option<ClassificationExpected>,
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    // Explicit null clears the point; an omitted field leaves it unchanged (local command contract).
    #[serde(default, deserialize_with = "present_nullable")]
    pub planned_point: Option<Option<ProductivityPoint>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub due_point: Option<Option<ProductivityPoint>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ListPatch {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub planned_point: Option<Option<ProductivityPoint>>,
    pub due_point: Option<Option<ProductivityPoint>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ItemPatch {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub status: Option<String>,
    pub priority: Option<String>,
    // Preserve null versus absent so the arrangement rail can clear either point independently.
    #[serde(default, deserialize_with = "present_nullable")]
    pub planned_point: Option<Option<ProductivityPoint>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub due_point: Option<Option<ProductivityPoint>>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub item_type_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_nonnull_array")]
    pub tag_ids: Option<Vec<String>>,
    pub classification_expected: Option<ClassificationExpected>,
}

fn present_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where D: serde::Deserializer<'de>, T: Deserialize<'de> {
    Option::<T>::deserialize(deserializer).map(Some)
}

fn present_nonnull_array<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where D: serde::Deserializer<'de> {
    Vec::<String>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClassificationExpected {
    pub item_type_catalog: Option<RevisionRef>,
    #[serde(default)]
    pub tags: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTypeSnapshot {
    pub id: String,
    pub name: String,
    pub parent_item_type_id: Option<String>,
    pub color_override: Option<String>,
    pub effective_color: String,
    pub inactive: bool,
    pub effective_inactive: bool,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub reference_count: i64,
    pub child_count: i64,
    pub can_delete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_role: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTypeCatalogSnapshot {
    pub id: String,
    pub revision: i64,
    pub item_types: Vec<ItemTypeSnapshot>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTypeCatalogResponse { pub catalog: Option<ItemTypeCatalogSnapshot> }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SaveItemTypeCatalogNode {
    pub id: String,
    pub name: String,
    pub parent_item_type_id: Option<String>,
    pub color_override: Option<String>,
    pub inactive: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SaveItemTypeCatalogRequest {
    pub expected_data_dir: String,
    pub catalog: Option<RevisionRef>,
    pub nodes: Vec<SaveItemTypeCatalogNode>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeleteItemTypeRequest {
    pub expected_data_dir: String,
    pub catalog: RevisionRef,
    pub item_type_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagSnapshot {
    pub id: String,
    pub revision: i64,
    pub name: String,
    pub inactive: bool,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagResponse { pub tag: TagSnapshot }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagsListResponse { pub tags: Vec<TagSnapshot> }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateItemTypeRequest {
    pub catalog: Option<RevisionRef>,
    pub name: String,
    pub parent_item_type_id: Option<String>,
    pub color_override: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UpdateItemTypeRequest {
    pub catalog: RevisionRef,
    pub item_type_id: String,
    pub name: Option<String>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub color_override: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MoveItemTypeRequest {
    pub catalog: RevisionRef,
    pub item_type_id: String,
    pub parent_item_type_id: Option<String>,
    #[serde(default, deserialize_with = "present_nullable")]
    pub color_override: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetItemTypeInactiveRequest {
    pub catalog: RevisionRef, pub item_type_id: String, pub inactive: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateTagRequest { pub name: String }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UpdateTagRequest { pub tag: RevisionRef, pub name: String }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetTagInactiveRequest { pub tag: RevisionRef, pub inactive: bool }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeleteTagAndDetachItemsRequest { pub tag: RevisionRef, pub expected_members: Vec<RevisionRef> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTagAndDetachItemsResponse { pub tag: TagSnapshot, pub items: Vec<ItemSnapshot> }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub planned_start_at: Option<String>,
    pub planned_end_at: Option<String>,
    pub track_lane: Option<i32>,
    pub track_span: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ActionPatch {
    pub title: Option<String>,
    pub name_link_mode: Option<String>,
    pub summary: Option<Option<String>>,
    pub planned_start_at: Option<Option<String>>,
    pub planned_end_at: Option<Option<String>>,
    pub planned_duration: Option<Option<i64>>,
    pub appearance: Option<Option<ActionAppearance>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateProjectWireRequest {
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub item_type_id: Option<String>,
    pub classification_expected: Option<ClassificationExpected>,
    pub project: RevisionRef,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub parent_task_id: Option<String>,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectRequest {
    pub project: RevisionRef,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub patch: ProjectPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    pub project: RevisionRef,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub task_id: String,
    pub patch: TaskPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct MoveTaskRequest {
    pub project: RevisionRef,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub task_id: String,
    pub parent_task_id: Option<String>,
    pub insert_index: Option<i32>,
    pub expected_siblings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct SetProjectStatusRequest {
    pub project: RevisionRef,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetProjectStatusWireRequest { pub project: RevisionRef, pub status: String, #[serde(default)] pub expected_data_dir: Option<String> }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct SetTaskStatusRequest {
    pub project: RevisionRef,
    pub task_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectRequest {
    pub project: RevisionRef,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RestoreProjectRequest {
    pub project: RevisionRef,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTaskSubtreeRequest {
    pub project: RevisionRef,
    pub task_id: String,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    #[serde(default)]
    pub expected_subtree_task_ids: Option<Vec<String>>,
    #[serde(default)]
    pub expected_edge_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RestoreTaskSubtreeRequest {
    pub project: RevisionRef,
    pub task_id: String,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    #[serde(default)]
    pub expected_edge_ids: Option<Vec<String>>,
    #[serde(default)]
    pub expected_deletion_batch_id: Option<String>,
    #[serde(default)]
    pub expected_subtree_task_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RestoreTaskSubtreeBatchRequest {
    pub project: RevisionRef,
    pub task_id: String,
    pub expected_data_dir: String,
    pub expected_deletion_batch_id: String,
    pub expected_subtree_task_ids: Vec<String>,
    pub expected_edge_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CreateListRequest {
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct UpdateListRequest {
    pub list: RevisionRef,
    pub patch: ListPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct SetListStatusRequest {
    pub list: RevisionRef,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct DeleteListRequest {
    pub list: RevisionRef,
    pub expected_members: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeleteListAndMoveItemsToInboxRequest {
    pub expected_data_dir: String,
    pub list: RevisionRef,
    pub expected_members: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetListItemMembersRequest {
    pub expected_data_dir: String,
    pub list_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListItemMembersResponse {
    pub data_dir: String,
    pub list: ListSnapshot,
    pub members: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RestoreListRequest {
    pub list: RevisionRef,
    pub expected_members: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CreateItemRequest {
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub list_id: Option<String>,
    #[serde(default = "default_item_priority")]
    pub priority: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
    pub item_type_id: Option<String>,
    #[serde(default, deserialize_with = "nonnull_array")]
    pub tag_ids: Vec<String>,
    pub classification_expected: Option<ClassificationExpected>,
}

fn nonnull_array<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where D: serde::Deserializer<'de> {
    Vec::<String>::deserialize(deserializer)
}

fn default_item_priority() -> String {
    "none".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CreateItemAfterRequest {
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub list_id: Option<String>,
    #[serde(default = "default_item_priority")]
    pub priority: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
    pub item_type_id: Option<String>,
    #[serde(default, deserialize_with = "nonnull_array")]
    pub tag_ids: Vec<String>,
    pub classification_expected: Option<ClassificationExpected>,
    pub insert_after_item_id: String,
    pub item_order: RevisionRef,
    pub expected_members: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct UpdateItemRequest {
    pub item: RevisionRef,
    pub patch: ItemPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct SetItemStatusRequest {
    pub item: RevisionRef,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct DeleteItemRequest {
    pub item: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RestoreItemRequest {
    pub item: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AssignItemToListRequest {
    pub item: RevisionRef,
    pub list: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct MoveItemToListRequest {
    pub item: RevisionRef,
    pub list: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RemoveItemFromListRequest {
    pub item: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub title: String,
    pub description: Option<String>,
    pub planned_start_at: String,
    pub planned_end_at: String,
    pub track_lane: Option<i32>,
    pub track_span: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub session: RevisionRef,
    pub patch: SessionPatch,
    #[serde(default)]
    pub expected_checkpoints: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CommitSessionBoundaryRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub session: RevisionRef,
    pub expected_members: Vec<RevisionRef>,
    #[serde(default)]
    pub expected_checkpoints: Vec<RevisionRef>,
    pub planned_start_at: String,
    pub planned_end_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionOnlyRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub session: RevisionRef,
    pub expected_members: Vec<RevisionRef>,
    #[serde(default)]
    pub expected_checkpoints: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSessionRequest {
    pub session: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionWithActionsRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub session: RevisionRef,
    pub expected_members: Vec<RevisionRef>,
    #[serde(default)]
    pub expected_checkpoints: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSessionWithActionsRequest {
    pub session: RevisionRef,
    pub expected_members: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CreateActionRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub title: String,
    pub name_link_mode: Option<String>,
    pub summary: Option<String>,
    pub session_id: Option<String>,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub planned_start_at: Option<String>,
    pub planned_end_at: Option<String>,
    pub planned_duration: Option<i64>,
    pub appearance: Option<ActionAppearance>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct UpdateActionRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub action: RevisionRef,
    pub patch: ActionPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommitCheckpointArrangementRequest {
    pub expected_data_dir: String,
    pub checkpoint: RevisionRef,
    #[serde(deserialize_with = "present_nullable")] pub planned_at_utc: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_nullable")] pub current_session: Option<Option<RevisionRef>>,
    #[serde(default, deserialize_with = "present_nullable")] pub next_session: Option<Option<RevisionRef>>,
    pub expected_current_checkpoints: Vec<RevisionRef>,
    pub expected_next_checkpoints: Vec<RevisionRef>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommitItemWithCheckpointRequest {
    pub expected_data_dir: String,
    pub item_title: String,
    pub checkpoint_title: String,
    #[serde(default, deserialize_with = "present_nullable")] pub planned_at_utc: Option<Option<String>>,
    #[serde(default)] pub session: Option<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CommitActionArrangementRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub action: RevisionRef,
    pub target_owning_root: Option<RevisionRef>,
    pub current_session: Option<RevisionRef>,
    pub current_session_members: Vec<RevisionRef>,
    pub next_session: Option<RevisionRef>,
    pub next_session_members: Vec<RevisionRef>,
    pub planned_start_at: String,
    pub planned_end_at: String,
}

// SPEC-0015 §6.1: these are complete projections, not optional patch fields.
fn arrangement_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where D: serde::Deserializer<'de>, T: Deserialize<'de> {
    Option::<T>::deserialize(deserializer)
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ActionArrangementState {
    #[serde(deserialize_with = "arrangement_nullable")]
    pub planned_start_at: Option<String>,
    #[serde(deserialize_with = "arrangement_nullable")]
    pub planned_end_at: Option<String>,
    #[serde(deserialize_with = "arrangement_nullable")]
    pub planned_duration: Option<i64>,
    #[serde(deserialize_with = "arrangement_nullable")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RestoreActionArrangementStateRequest {
    pub expected_data_dir: String,
    pub action: RevisionRef,
    pub target_owning_root: Option<RevisionRef>,
    pub expected_state: ActionArrangementState,
    pub target_state: ActionArrangementState,
    pub current_session: Option<RevisionRef>,
    pub current_session_members: Vec<RevisionRef>,
    pub next_session: Option<RevisionRef>,
    pub next_session_members: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SessionBoundaryState {
    pub planned_start_at: String,
    pub planned_end_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SessionBoundaryMembershipChange {
    pub action: RevisionRef,
    pub target_owning_root: Option<RevisionRef>,
    #[serde(deserialize_with = "arrangement_nullable")]
    pub expected_session_id: Option<String>,
    #[serde(deserialize_with = "arrangement_nullable")]
    pub target_session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RestoreSessionBoundaryStateRequest {
    pub expected_data_dir: String,
    pub session: RevisionRef,
    pub expected_state: SessionBoundaryState,
    pub target_state: SessionBoundaryState,
    pub expected_members: Vec<RevisionRef>,
    pub expected_checkpoints: Vec<RevisionRef>,
    pub target_member_ids: Vec<String>,
    pub target_checkpoint_ids: Vec<String>,
    pub membership_changes: Vec<SessionBoundaryMembershipChange>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EditActionIntervalRequest {
    pub expected_data_dir: String,
    pub action: RevisionRef,
    pub target_owning_root: Option<RevisionRef>,
    pub operation: String,
    pub interval_id: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct StartActionRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub action: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PauseActionRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub action: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ResumeActionRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub action: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct EndActionRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub action: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReopenActionRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub action: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct DeleteActionRequest {
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    pub action: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RestoreActionRequest {
    pub action: RevisionRef,
    pub session: Option<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AssignActionToSessionRequest {
    pub action: RevisionRef,
    pub session: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct MoveActionToSessionRequest {
    pub action: RevisionRef,
    pub session: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RemoveActionFromSessionRequest {
    pub action: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct SetActionTargetRequest {
    pub action: RevisionRef,
    pub target_kind: String,
    pub target_id: String,
    pub owning_root: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ClearActionTargetRequest {
    pub action: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CompleteThingRequest {
    pub thing_kind: String,
    pub owning_root: RevisionRef,
    pub task_id: Option<String>,
    pub expected_members: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CommitThingLifecycleRequest {
    pub thing_kind: String,
    pub owning_root: RevisionRef,
    pub task_id: Option<String>,
    pub outcome: String,
    pub expected_members: Vec<RevisionRef>,
    pub confirm_active_intervals: bool,
    #[serde(default)] pub expected_data_dir: Option<String>,
    #[serde(default)] pub expected_checkpoints: Vec<RevisionRef>,
    #[serde(default)] pub complete_checkpoints_without_actual: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommitThingLifecycleMvpRequest {
    pub thing_kind: String,
    pub owning_root: RevisionRef,
    pub task_id: Option<String>,
    pub outcome: String,
    pub expected_members: Vec<RevisionRef>,
    pub confirm_active_intervals: bool,
    pub expected_data_dir: String,
    #[serde(default)]
    pub expected_checkpoints: Vec<RevisionRef>,
    #[serde(default)]
    pub complete_checkpoints_without_actual: bool,
    pub action_disposition: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommitThingLifecycleWireRequest {
    pub thing_kind: String,
    pub owning_root: RevisionRef,
    pub task_id: Option<String>,
    pub outcome: String,
    pub expected_members: Vec<RevisionRef>,
    pub confirm_active_intervals: bool,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
    #[serde(default)]
    pub expected_checkpoints: Vec<RevisionRef>,
    #[serde(default)]
    pub complete_checkpoints_without_actual: bool,
    #[serde(default)]
    pub action_disposition: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectResponse {
    pub project: ProjectSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restore_summary: Option<TaskRestoreSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    pub list: ListSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemResponse {
    pub item: ItemSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemWithCheckpointResponse {
    pub item: ItemSnapshot,
    pub checkpoint: CheckpointSnapshot,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BatchMoveItemsToListRequest {
    pub expected_data_dir: String,
    pub items: Vec<RevisionRef>,
    pub list: Option<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BatchDeleteItem {
    pub item: RevisionRef,
    #[serde(default)]
    pub expected_actions: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BatchDeleteItemsRequest {
    pub expected_data_dir: String,
    pub items: Vec<BatchDeleteItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemsBatchResponse {
    pub items: Vec<ItemSnapshot>,
    pub item_order: Option<ItemOrderSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAndItemsResponse {
    pub list: ListSnapshot,
    pub items: Vec<ItemSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub session: SessionSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAndActionsResponse {
    pub session: SessionSnapshot,
    pub actions: Vec<ActionSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResponse {
    pub action: ActionSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessTimeZoneReplacement {
    pub start_utc: String,
    pub end_utc: String,
    pub offset: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessTimeZoneResponse {
    pub base_offset: String,
    pub replacements: Vec<BusinessTimeZoneReplacement>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteThingResponse {
    pub project: Option<ProjectSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoints: Option<Vec<CheckpointSnapshot>>,
    pub list: Option<ListSnapshot>,
    pub item: Option<ItemSnapshot>,
    pub actions: Vec<ActionSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsListResponse {
    pub projects: Vec<ProjectSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListsListResponse {
    pub lists: Vec<ListSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemsListResponse {
    pub items: Vec<ItemSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_order: Option<ItemOrderSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsListResponse {
    pub sessions: Vec<SessionSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionsListResponse {
    pub actions: Vec<ActionSnapshot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct GetByIdRequest {
    pub id: String,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ListItemsQuery {
    pub list_id: Option<String>,
    pub unassigned_only: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CommitActionCreateDraft {
    pub title: String,
    pub name_link_mode: Option<String>,
    pub summary: Option<String>,
    pub session_id: Option<String>,
    pub planned_start_at: Option<String>,
    pub planned_end_at: Option<String>,
    pub planned_duration: Option<i64>,
    pub appearance: Option<ActionAppearance>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CommitActionUpdateDraft {
    pub action: RevisionRef,
    pub patch: ActionPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct CommitItemWithActionsRequest {
    pub item_id: Option<String>,
    pub item_expected_revision: Option<i64>,
    pub item_create: Option<CreateItemRequest>,
    pub item_patch: Option<ItemPatch>,
    pub expected_associated_actions: Vec<RevisionRef>,
    pub action_creates: Vec<CommitActionCreateDraft>,
    pub action_updates: Vec<CommitActionUpdateDraft>,
    pub action_deletes: Vec<RevisionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ReorderItemsRequest {
    pub item_order: RevisionRef,
    pub expected_members: Vec<RevisionRef>,
    pub ordered_item_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct MoveItemToListAndPlaceRequest {
    pub item: RevisionRef,
    pub list: Option<RevisionRef>,
    pub item_order: RevisionRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchCreateProject {
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchUpdateProject {
    pub project: RevisionRef,
    pub patch: ProjectPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchCreateTask {
    pub project: RevisionRef,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub parent_task_id: Option<String>,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
    pub item_type_id: Option<String>,
    pub classification_expected: Option<ClassificationExpected>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchUpdateTask {
    pub project: RevisionRef,
    pub task_id: String,
    pub patch: TaskPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchCreateList {
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchUpdateList {
    pub list: RevisionRef,
    pub patch: ListPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchCreateItem {
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub list_id: Option<String>,
    #[serde(default = "default_item_priority")]
    pub priority: String,
    pub planned_point: Option<ProductivityPoint>,
    pub due_point: Option<ProductivityPoint>,
    pub item_type_id: Option<String>,
    #[serde(default, deserialize_with = "nonnull_array")]
    pub tag_ids: Vec<String>,
    pub classification_expected: Option<ClassificationExpected>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchUpdateItem {
    pub item: RevisionRef,
    pub patch: ItemPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchCreateSession {
    pub title: String,
    pub description: Option<String>,
    pub planned_start_at: String,
    pub planned_end_at: String,
    pub track_lane: Option<i32>,
    pub track_span: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchUpdateSession {
    pub session: RevisionRef,
    pub patch: SessionPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchCreateAction {
    pub title: String,
    pub name_link_mode: Option<String>,
    pub summary: Option<String>,
    pub session_id: Option<String>,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub planned_start_at: Option<String>,
    pub planned_end_at: Option<String>,
    pub planned_duration: Option<i64>,
    pub appearance: Option<ActionAppearance>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchUpdateAction {
    pub action: RevisionRef,
    pub patch: ActionPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityAiBatchOp {
    pub create_project: Option<ProductivityAiBatchCreateProject>,
    pub update_project: Option<ProductivityAiBatchUpdateProject>,
    pub create_task: Option<ProductivityAiBatchCreateTask>,
    pub update_task: Option<ProductivityAiBatchUpdateTask>,
    pub create_list: Option<ProductivityAiBatchCreateList>,
    pub update_list: Option<ProductivityAiBatchUpdateList>,
    pub create_item: Option<ProductivityAiBatchCreateItem>,
    pub update_item: Option<ProductivityAiBatchUpdateItem>,
    pub create_session: Option<ProductivityAiBatchCreateSession>,
    pub update_session: Option<ProductivityAiBatchUpdateSession>,
    pub create_action: Option<ProductivityAiBatchCreateAction>,
    pub update_action: Option<ProductivityAiBatchUpdateAction>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ApplyProductivityAiBatchRequest {
    pub ops: Vec<ProductivityAiBatchOp>,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitItemWithActionsResponse {
    pub item: ItemSnapshot,
    pub actions: Vec<ActionSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateItemAfterResponse {
    pub item: ItemSnapshot,
    pub item_order: ItemOrderSnapshot,
    pub items: Vec<ItemSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderItemsResponse {
    pub item_order: ItemOrderSnapshot,
    pub items: Vec<ItemSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveItemToListAndPlaceResponse {
    pub item: ItemSnapshot,
    pub item_order: ItemOrderSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyProductivityAiBatchResponse {
    pub projects: Vec<ProjectSnapshot>,
    pub lists: Vec<ListSnapshot>,
    pub items: Vec<ItemSnapshot>,
    pub sessions: Vec<SessionSnapshot>,
    pub actions: Vec<ActionSnapshot>,
    pub item_order: Option<ItemOrderSnapshot>,
}

pub const PROJECT_STATUSES: &[&str] = &["规划中", "进行中", "已归档", "已完成", "已取消"];
pub const TASK_STATUSES: &[&str] = &["未做", "进行中", "完成", "搁置", "取消"];
pub const LIST_STATUSES: &[&str] = &["进行中", "完成", "已归档"];
pub const ITEM_STATUSES: &[&str] = &["进行中", "完成", "取消"];
pub const ITEM_PRIORITIES: &[&str] = &["none", "low", "medium", "high"];
pub const ITEM_ORDER_ROOT_ID: &str = "item-order";
pub const TARGET_KINDS: &[&str] = &["project", "task", "item"];
pub const APPEARANCE_STROKES: &[&str] = &[
    "none",
    "solid",
    "dashed",
    "dotted",
    "double",
    "dash-dot",
    "dash-dot-dot",
];
pub const EXECUTION_STATES: &[&str] = &["未开始", "进行中", "暂停", "已结束"];
