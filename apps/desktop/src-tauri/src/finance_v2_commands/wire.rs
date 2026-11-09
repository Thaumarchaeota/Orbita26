use serde::{Deserialize, Serialize};

use crate::{
    finance_v2_domain::{Id, LedgerSnapshot},
    finance_v2_projection::{LedgerProjection, ReportProjection},
    finance_v2_store::{accounts::AccountViaBinding, sources::SourceContext},
    finance_v2_workspace::{AiApplyResult, AiCategorySuggestion, CapturedAccountViaBinding, ParsedObservation, RefinementInput, WorkspaceIntentPayload, WorkspaceReadModel},
};

use super::session::FinanceV2Session;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSnapshotResponse {
    pub snapshot: LedgerSnapshot,
    pub restorable_facts: Vec<crate::finance_v2_domain::L0Fact>,
    pub account_via_mapping_revision: u64,
    pub account_via_bindings: Vec<AccountViaBinding>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResponse {
    pub workspace_kind: WorkspaceKind,
    pub draft_id: Id,
    pub draft_revision: u64,
    pub durable_revision: u64,
    pub read_model: WorkspaceReadModel,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMutationResponse {
    pub workspace_kind: WorkspaceKind,
    pub draft_revision: u64,
    pub durable_revision: u64,
    pub read_model: WorkspaceReadModel,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionsResponse {
    pub workspace_kind: WorkspaceKind,
    pub results: Vec<AiApplyResult>,
    pub draft_revision: u64,
    pub durable_revision: u64,
    pub read_model: WorkspaceReadModel,
}

#[derive(Clone,Copy,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub enum WorkspaceKind{Imported,ManualOnly}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportsResponse {
    pub ledger_projection: LedgerProjection,
    pub report_projection: ReportProjection,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceCreateRequest {
    pub session: FinanceV2Session,
    pub confirmation: bool,
    pub source_context_id: Id,
    pub source_context_revision: u64,
    pub expected_ledger_generation: u64,
    pub observations: Vec<ParsedObservation>,
    pub account_via_mapping_revision: u64,
    pub captured_account_via_bindings: Vec<CapturedAccountViaBinding>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ManualWorkspaceCreateRequest{
    pub session:FinanceV2Session,
    pub expected_ledger_generation:u64,
    pub account_via_mapping_revision:u64,
    pub captured_account_via_bindings:Vec<CapturedAccountViaBinding>,
}

#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct WorkspaceListRequest{pub session:FinanceV2Session}
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct WorkspaceListResponse{pub drafts:Vec<crate::finance_v2_workspace::draft::DraftListEntry>}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceStageRequest {
    pub session: FinanceV2Session,
    pub draft_id: Id,
    pub expected_draft_revision: u64,
    pub payload: WorkspaceIntentPayload,
    pub source_item_ids: Vec<Id>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceStageRefinementRequest {
    pub session: FinanceV2Session,
    pub draft_id: Id,
    pub expected_draft_revision: u64,
    pub input: RefinementInput,
    pub source_item_ids: Vec<Id>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceUndoRequest {
    pub session: FinanceV2Session,
    pub draft_id: Id,
    pub expected_draft_revision: u64,
    pub operation_id: Id,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyAiSuggestionsRequest {
    pub session: FinanceV2Session,
    pub draft_id: Id,
    pub expected_draft_revision: u64,
    pub suggestions: Vec<AiCategorySuggestion>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftReadRequest { pub session: FinanceV2Session, pub draft_id: Id }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceRowUpdateRequest {
    pub session: FinanceV2Session,
    pub draft_id: Id,
    pub expected_draft_revision: u64,
    pub item_id: Id,
    pub expected_item_revision: u64,
    pub action: WorkspaceRowAction,
    pub changed_at_utc_micros: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceRowAction { SetCategory { category: Option<crate::finance_v2_workspace::AccountBinding> }, Reject, Cancel }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceCancelImportRequest { pub session: FinanceV2Session, pub draft_id: Id, pub expected_draft_revision: u64 }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionResponse { pub generation: u64, pub ledger_projection: LedgerProjection, pub report_projection: ReportProjection }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRequest { pub session: FinanceV2Session }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReceiptRequest { pub session: FinanceV2Session, pub operation_id: Id }

#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PrepareCommitRequest{pub session:FinanceV2Session,pub draft_id:Id,pub expected_draft_revision:u64}
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct PreparedCommitResponse{pub plan:crate::finance_v2_workspace::refinement::DraftCommitPlan,pub prepare_token:String,pub durable_revision:u64,pub recorded_at_utc_us:i64}
#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct CommitBatchRequest{pub session:FinanceV2Session,pub draft_id:Id,pub expected_draft_revision:u64,pub operation_id:Id,pub payload_sha256:String,pub prepare_token:String,pub recorded_at_utc_us:i64}
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct CommitBatchResponse{pub receipt:crate::finance_v2_store::commit::CommitReceipt,pub materialization_job:crate::finance_v2_store::commit::MaterializationJob,pub already_committed:bool,pub materialization_error:Option<String>}
#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AbandonDraftRequest{pub session:FinanceV2Session,pub draft_id:Id}
#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct RecoverMaterializationRequest{pub session:FinanceV2Session,pub operation_id:Id,pub recorded_at_utc_us:i64}
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct RecoverMaterializationResponse{pub receipt:crate::finance_v2_store::commit::CommitReceipt,pub materialization_job:crate::finance_v2_store::commit::MaterializationJob,pub active_generation:u64,pub manifest_sha256:String,pub finalized:bool}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ManagementMutation {
    Account { value: crate::finance_v2_domain::Account, expected_revision: Option<u64> },
    Via { value: crate::finance_v2_domain::Via, expected_revision: Option<u64> },
    SourceBinding { value: crate::finance_v2_store::sources::SourceBinding, expected_revision: Option<u64> },
    SourceContext { value: SourceContext, expected_revision: Option<u64> },
    AccountVia { account_id: Id, via_id: Id, revision: u64, active: bool, expected_mapping_revision: u64 },
    Calibration { action: CalibrationAction, expected_revision: Option<u64> },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase",rename_all_fields="camelCase")]
pub enum CalibrationAction {
    Save { point: crate::finance_v2_domain::CalibrationPoint },
    Delete { id: Id },
    Restore { id: Id, source_revision: u64 },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagementSaveRequest { pub session: FinanceV2Session, pub expected_generation: u64, pub operation_id: Id, pub mutation: ManagementMutation, pub recorded_at_utc_us: i64 }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementSaveResponse { pub entity: serde_json::Value, pub generation: u64, pub receipt: crate::finance_v2_store::commit::CommitReceipt, pub materialization_job: crate::finance_v2_store::commit::MaterializationJob, pub materialization_error: Option<String> }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceBindingListRequest { pub session: FinanceV2Session, pub context_id: Id, pub context_revision: u64, pub profile_id: String, pub profile_revision: String }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBindingListResponse { pub global_revision: u64, pub bindings: Vec<crate::finance_v2_store::sources::SourceBinding> }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SourceContextsRequest { pub session: FinanceV2Session }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct SourceContextsResponse { pub global_revision:u64, pub contexts:Vec<SourceContext> }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ParseArtifactRequest { pub session:FinanceV2Session, pub selected_path:String, pub context_id:Id, pub expected_context_revision:u64, pub profile_id:String, pub profile_revision:String }

#[allow(dead_code)]
fn _wire_checks(_: ReadSnapshotResponse, _: WorkspaceResponse, _: WorkspaceMutationResponse, _: AiSuggestionsResponse, _: ReportsResponse, _: ProjectionResponse, _: SessionRequest, _: ReceiptRequest, _: LedgerSnapshot) {}
