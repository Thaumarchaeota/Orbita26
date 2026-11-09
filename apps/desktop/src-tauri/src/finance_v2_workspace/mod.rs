//! Isolated Finance v2 import workspace. This module is intentionally not
//! registered from the production Tauri crate root.

pub mod candidates;
pub mod draft;
pub mod refinement;

pub use candidates::{find_candidates, CandidateInput, CandidatePolicy, CandidateResult};
pub use draft::{
    DraftListEntry, DraftListState, DraftRepository, DraftSnapshot, FinalizedWorkspaceReceipt, FixedParseSnapshot,
    IsolatedWorkspaceRoot, LedgerIdentity, MaterializationReadyProof, WorkspaceError,
};
pub use refinement::{build_refinement_intent, prepare_commit_plan, prospective_amend_plan, stage_refinement_from_input,
    DraftCommitPlan, ProspectiveAmendPlan, RefinementInput, RefinementIntent};

use serde::{Deserialize, Serialize};

use crate::finance_v2_domain::{Account, FactStatus, Id, L0Fact, MemberRevision, Quantity, Treatment};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AccountBinding {
    pub account_id: Option<Id>,
    pub via_id: Option<Id>,
    pub account_revision: Option<u64>,
    pub via_revision: Option<u64>,
}

/// Frozen copy of the E1 account-to-Via mapping used during classification.
/// This is a workspace snapshot dependency, not a competing domain entity.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CapturedAccountViaBinding {
    pub account_id: Id,
    pub via_id: Id,
    pub revision: u64,
    pub active: bool,
}

impl AccountBinding {
    pub fn validate(&self) -> Result<(), WorkspaceError> {
        if self.account_id.is_none() && self.via_id.is_none() {
            return Err(WorkspaceError::InvalidParseObservation("binding has neither Account nor Via".into()));
        }
        if self.via_id.is_some() && self.account_id.is_none() {
            return Err(WorkspaceError::InvalidParseObservation("Via binding requires its mapped Account".into()));
        }
        if self.account_id.is_some() != self.account_revision.is_some()
            || self.via_id.is_some() != self.via_revision.is_some()
        {
            return Err(WorkspaceError::InvalidParseObservation("binding revisions do not match IDs".into()));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ObservationValue {
    SignedQuantity(Quantity),
    Date(crate::finance_v2_domain::BusinessDate),
    Text(String),
    Missing,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ParseObservation {
    pub role: String,
    pub raw_text: Option<String>,
    pub value: ObservationValue,
    pub binding: Option<AccountBinding>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ObservationQuality {
    Confirmed,
    Unresolved(String),
    Failed(String),
}

/// A normalized E2 row; this is source evidence, never an E0 ledger fact.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ParsedObservation {
    pub artifact_id: Id,
    pub source_context_id: Id,
    pub source_context_revision: u64,
    pub source_context_provider: String,
    pub artifact_sha256: String,
    pub artifact_byte_length: u64,
    pub contract_id: String,
    pub contract_revision: String,
    pub profile_id: String,
    pub profile_revision: String,
    pub binding_revision: u64,
    pub locator: String,
    pub occurrence_discriminator: String,
    pub source_row: SourceRowEvidence,
    pub fields: Vec<ParseObservation>,
    pub quality: ObservationQuality,
}

impl ParsedObservation {
    pub fn validate(&self) -> Result<(), WorkspaceError> {
        if self.source_context_revision == 0 || self.source_context_provider.trim().is_empty() {
            return Err(WorkspaceError::InvalidParseObservation("source context identity/provider provenance is invalid".into()));
        }
        for (field, label) in [
            (&self.artifact_sha256, "artifact hash"),
            (&self.contract_id, "contract id"),
            (&self.contract_revision, "contract revision"),
            (&self.profile_id, "profile id"),
            (&self.profile_revision, "profile revision"),
            (&self.locator, "locator"),
            (&self.occurrence_discriminator, "occurrence discriminator"),
        ] {
            if field.trim().is_empty() {
                return Err(WorkspaceError::InvalidParseObservation(format!("{label} is blank")));
            }
        }
        if self.artifact_sha256.len() != 64 || !self.artifact_sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            return Err(WorkspaceError::InvalidParseObservation("artifact hash must be canonical lowercase SHA-256".into()));
        }
        if self.source_row.artifact_id != self.artifact_id.as_str()
            || self.source_row.locator != self.locator
            || self.source_row.occurrence_discriminator != self.occurrence_discriminator
            || self.source_row.profile_id != self.profile_id
            || self.source_row.profile_revision != self.profile_revision
            || self.source_row.raw_text_version != 1
        {
            return Err(WorkspaceError::InvalidParseObservation("source row identity disagrees with parse metadata".into()));
        }
        for field in &self.fields {
            if field.role.trim().is_empty() {
                return Err(WorkspaceError::InvalidParseObservation("observation role is blank".into()));
            }
            if let Some(binding) = &field.binding {
                binding.validate()?;
            }
        }
        Ok(())
    }
}

/// Serializable value copy of S1 raw text. It carries no account or L0 meaning.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SourceRowEvidence {
    pub artifact_id: String,
    pub locator: String,
    pub occurrence_discriminator: String,
    pub profile_id: String,
    pub profile_revision: String,
    pub raw_text_version: u32,
    pub raw_text: String,
}

impl From<&crate::finance_v2_source::SourceRowSnapshot> for SourceRowEvidence {
    fn from(value: &crate::finance_v2_source::SourceRowSnapshot) -> Self {
        Self {
            artifact_id: value.source_ref().artifact_id().to_owned(),
            locator: value.source_ref().locator().to_owned(),
            occurrence_discriminator: value.source_ref().occurrence_discriminator().to_owned(),
            profile_id: value.profile_id().to_owned(),
            profile_revision: value.profile_revision().to_owned(),
            raw_text_version: value.raw_text_version(),
            raw_text: value.raw_text().to_owned(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ParsedAccount {
    pub account: Account,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum LeftDisposition { Open, Staged, Rejected, Cancelled }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ClassificationOrigin { SourceBinding, Human, Ai { model: String, request_revision: u64 } }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceItem {
    pub item_id: Id,
    pub observation_index: usize,
    pub item_revision: u64,
    pub manual_category_revision: u64,
    pub disposition: LeftDisposition,
    pub category: Option<AccountBinding>,
    pub category_origin: Option<ClassificationOrigin>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AiCategorySuggestion {
    pub item_id: Id,
    pub expected_item_revision: u64,
    pub expected_manual_category_revision: u64,
    pub account_id: Id,
    pub account_revision: u64,
    pub model: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AiApplyResult {
    pub item_id: Id,
    pub applied: bool,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum FactMutation {
    Create { fact: L0Fact },
    Amend { expected: MemberRevision, fact: L0Fact, manual_change: ManualChange },
    Delete { expected: MemberRevision, deleted_version: L0Fact, manual_change: ManualChange },
    Restore { expected_revision: u64, restored_version: L0Fact, manual_change: ManualChange },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ManualChange {
    pub changed_at_utc_micros: i64,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EvidenceMember {
    pub member: MemberRevision,
    pub sign: refinement::EndpointSign,
    pub allocation: Option<Quantity>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum EvidenceIntentRole { Ordinary, Refinement, Refund }

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum EvidenceGroupingKind { Ordinary, Refinement }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EvidenceMatchIntent {
    pub artifact_id: Id,
    pub locator: String,
    pub occurrence_discriminator: String,
    pub observed_account_id: Id,
    pub source_role: String,
    pub grouping_kind: EvidenceGroupingKind,
    pub requires_refund_treatment: bool,
    pub signed_quantity: Quantity,
    pub sign: refinement::EndpointSign,
    pub members: Vec<EvidenceMember>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum TreatmentMutation {
    Apply { treatment: Treatment },
    Amend { expected_revision: u64, treatment: Treatment, manual_change: ManualChange },
    Release { expected_revision: u64, tombstone: Treatment, manual_change: ManualChange },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum WorkspaceIntentPayload {
    Fact(FactMutation),
    EvidenceMatch(EvidenceMatchIntent),
    Treatment(TreatmentMutation),
    Refinement(crate::finance_v2_workspace::refinement::RefinementIntent),
    CandidateConfirmation { candidate_key: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceIntent {
    pub intent_id: Id,
    pub base_generation: u64,
    pub source_item_ids: Vec<Id>,
    pub payload: WorkspaceIntentPayload,
    pub explicitly_staged: bool,
    pub undone: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum PreviewIntentKind { CreateFact, AmendFact, DeleteFact, RestoreFact, EvidenceMatch, Treatment, Refinement, CandidateConfirmation }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LeftRow {
    pub item_id: Id,
    pub item_revision: u64,
    pub manual_category_revision: u64,
    pub still_in_left: bool,
    pub disposition: LeftDisposition,
    pub quality: ObservationQuality,
    pub category: Option<AccountBinding>,
    pub category_origin: Option<ClassificationOrigin>,
    pub observation: ParsedObservation,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RightPreview {
    pub intent_id: Id,
    pub kind: PreviewIntentKind,
    pub source_item_ids: Vec<Id>,
    pub member_ids: Vec<MemberRevision>,
    pub base_generation: u64,
    pub confirmed: bool,
    pub blocking_reasons: Vec<String>,
    pub projected_facts: Vec<L0Fact>,
    pub projected_treatments: Vec<Treatment>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceReadModel {
    pub ledger_generation: u64,
    pub draft_revision: u64,
    pub durable_revision: u64,
    pub status: WorkspaceStatus,
    pub undo_operation_id: Option<Id>,
    pub dirty: bool,
    pub stale: bool,
    pub left_rows: Vec<LeftRow>,
    pub right_preview: Vec<RightPreview>,
    pub candidates: Vec<candidates::Candidate>,
    pub candidate_coverage: Option<candidates::Coverage>,
    pub unresolved_candidate_observations: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum WorkspaceStatus {
    Editing,
    ImportCancelled,
    Prepared { operation_id: Id },
    Committed { operation_id: Id, receipt_id: String },
    Abandoned,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum WorkspaceKind { Imported, ManualOnly }

pub fn freeze_parse_snapshot(
    observations: Vec<ParsedObservation>,
    confirmation: bool,
    source_context_id: &Id,
    source_context_revision: u64,
    base: &crate::finance_v2_domain::LedgerSnapshot,
    account_via_mapping_revision: u64,
    captured_account_via_bindings: Vec<CapturedAccountViaBinding>,
) -> Result<draft::FixedParseSnapshot, WorkspaceError> {
    draft::FixedParseSnapshot::freeze(observations, confirmation, source_context_id, source_context_revision, base,
        account_via_mapping_revision, captured_account_via_bindings)
}

pub fn read_workspace(draft: &draft::DraftSnapshot, base: &crate::finance_v2_domain::LedgerSnapshot) -> WorkspaceReadModel {
    draft::read_workspace(draft, base)
}


