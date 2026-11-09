use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::finance_v2_domain::{Account, FactStatus, Id, LedgerSnapshot, L0Fact, MemberRevision, Provenance, Via};

use super::{candidates::{Candidate, Coverage}, refinement::RefinementIntent, ParsedObservation};

const FORMAT_VERSION: u32 = 4;
const MARKER_FILE: &str = "finance-v2-workspace.json";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LedgerIdentity(pub String);

impl LedgerIdentity {
    pub fn new(value: impl Into<String>) -> Result<Self, WorkspaceError> {
        let value = value.into();
        if value.trim().is_empty() || value.len() > 200 {
            return Err(WorkspaceError::InvalidIdentity);
        }
        Ok(Self(value))
    }
}

#[derive(Clone, Debug)]
pub struct IsolatedWorkspaceRoot {
    path: PathBuf,
    workspace_id: Id,
    ledger_identity: LedgerIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
struct WorkspaceMarker {
    format_version: u32,
    purpose: String,
    workspace_id: Id,
    ledger_identity: LedgerIdentity,
}

impl IsolatedWorkspaceRoot {
    pub const MARKER_VERSION: u32 = FORMAT_VERSION;
    pub fn path(&self) -> &Path { &self.path }
    pub fn workspace_id(&self) -> &Id { &self.workspace_id }
    pub fn ledger_identity(&self) -> &LedgerIdentity { &self.ledger_identity }

    /// Create only in a caller-selected directory; refuses a pre-existing marker.
    pub fn create(
        path: impl AsRef<Path>,
        workspace_id: Id,
        ledger_identity: LedgerIdentity,
    ) -> Result<Self, WorkspaceError> {
        let path = path.as_ref();
        fs::create_dir(path).map_err(|source| WorkspaceError::CreateStageIo { stage: "create isolated root directory", source })?;
        let canonical = fs::canonicalize(path).map_err(|source| WorkspaceError::CreateStageIo { stage: "canonicalize isolated root", source })?;
        let root = Self { path: canonical, workspace_id, ledger_identity };
        let marker = WorkspaceMarker {
            format_version: FORMAT_VERSION,
            purpose: "orbita-finance-v2-isolated-workspace".into(),
            workspace_id: root.workspace_id.clone(),
            ledger_identity: root.ledger_identity.clone(),
        };
        let bytes = serde_json::to_vec(&marker).map_err(WorkspaceError::Serialization)?;
        let marker_path = root.path.join(MARKER_FILE);
        let mut file = OpenOptions::new().write(true).create_new(true).open(marker_path)
            .map_err(|source| WorkspaceError::CreateStageIo { stage: "create marker file", source })?;
        file.write_all(&bytes).map_err(|source| WorkspaceError::CreateStageIo { stage: "write marker file", source })?;
        // Keep the file flush as a hard gate; some selected/network filesystems
        // reject FlushFileBuffers, so surface that precise stage instead of
        // misreporting a generic isolated-environment creation failure.
        file.sync_all().map_err(|source| WorkspaceError::CreateStageIo { stage: "sync marker file", source })?;
        sync_parent_if_supported(&root.path).map_err(|error| create_stage_error("sync marker directory", error))?;
        fs::create_dir(root.path.join("drafts"))
            .map_err(|source| WorkspaceError::CreateStageIo { stage: "create drafts directory", source })?;
        sync_parent_if_supported(&root.path).map_err(|error| create_stage_error("sync drafts directory entry", error))?;
        Ok(root)
    }

    pub fn open(
        path: impl AsRef<Path>,
        workspace_id: &Id,
        ledger_identity: &LedgerIdentity,
    ) -> Result<Self, WorkspaceError> {
        let raw = path.as_ref();
        let metadata = fs::symlink_metadata(raw)?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_dir() {
            return Err(WorkspaceError::IsolationViolation);
        }
        let canonical = fs::canonicalize(raw)?;
        let marker_path = canonical.join(MARKER_FILE);
        let metadata = fs::symlink_metadata(&marker_path)?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_file() {
            return Err(WorkspaceError::IsolationViolation);
        }
        let marker: WorkspaceMarker = read_json(&marker_path)?;
        if marker.format_version != FORMAT_VERSION
            || marker.purpose != "orbita-finance-v2-isolated-workspace"
            || marker.workspace_id != *workspace_id
            || marker.ledger_identity != *ledger_identity
        {
            return Err(WorkspaceError::IdentityMismatch);
        }
        let drafts = canonical.join("drafts");
        let draft_metadata = fs::symlink_metadata(&drafts)?;
        if draft_metadata.file_type().is_symlink() || is_reparse_point(&draft_metadata) || !draft_metadata.is_dir() {
            return Err(WorkspaceError::IsolationViolation);
        }
        Ok(Self { path: canonical, workspace_id: workspace_id.clone(), ledger_identity: ledger_identity.clone() })
    }

    /// Explicit user-selected reopen: read and validate the marker, then bind
    /// the returned identity to the canonical directory for this app session.
    pub fn open_existing(path: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let raw = path.as_ref();
        let metadata = fs::symlink_metadata(raw)?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_dir() {
            return Err(WorkspaceError::IsolationViolation);
        }
        let canonical = fs::canonicalize(raw)?;
        let marker_path = canonical.join(MARKER_FILE);
        let metadata = fs::symlink_metadata(&marker_path)?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_file() {
            return Err(WorkspaceError::IsolationViolation);
        }
        let marker: WorkspaceMarker = read_json(&marker_path)?;
        Self::open(canonical, &marker.workspace_id, &marker.ledger_identity)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FixedParseSnapshot {
    pub observations: Vec<ParsedObservation>,
    pub source_context_id: Option<Id>,
    pub source_context_revision: Option<u64>,
    pub source_context_provider: Option<String>,
    pub base_ledger_generation: u64,
    pub binding_revision: u64,
    pub account_via_mapping_revision: u64,
    pub captured_account_via_bindings: Vec<super::CapturedAccountViaBinding>,
    pub captured_accounts: Vec<Account>,
    pub captured_vias: Vec<Via>,
}

impl FixedParseSnapshot {
    pub fn freeze(
        observations: Vec<ParsedObservation>,
        confirmation: bool,
        expected_source_context_id: &Id,
        expected_source_context_revision: u64,
        base: &LedgerSnapshot,
        account_via_mapping_revision: u64,
        captured_account_via_bindings: Vec<super::CapturedAccountViaBinding>,
    ) -> Result<Self, WorkspaceError> {
        if !confirmation || observations.is_empty() {
            return Err(WorkspaceError::ExplicitConfirmationRequired);
        }
        for observation in &observations {
            observation.validate()?;
        }
        let first_context = observations.first().ok_or(WorkspaceError::ExplicitConfirmationRequired)?;
        let source_context_id = first_context.source_context_id.clone();
        let source_context_revision = first_context.source_context_revision;
        let source_context_provider = first_context.source_context_provider.clone();
        if &source_context_id != expected_source_context_id || source_context_revision != expected_source_context_revision {
            return Err(WorkspaceError::InvalidParseObservation("observations do not match the explicit SourceContext request".into()));
        }
        if observations.iter().any(|observation| observation.source_context_id != source_context_id
            || observation.source_context_revision != source_context_revision
            || observation.source_context_provider != source_context_provider) {
            return Err(WorkspaceError::InvalidParseObservation("all observations in a frozen batch must use the explicitly selected SourceContext revision".into()));
        }
        let binding_revision = observations.first().map(|o| o.binding_revision).unwrap_or(0);
        if observations.iter().any(|o| o.binding_revision != binding_revision) {
            return Err(WorkspaceError::MixedBindingRevision);
        }
        if captured_account_via_bindings.iter().any(|binding| binding.revision == 0) {
            return Err(WorkspaceError::InvalidParseObservation("invalid Account/Via mapping snapshot revision".into()));
        }
        let mut mapping_keys = std::collections::BTreeSet::new();
        if captured_account_via_bindings.iter().any(|binding| !mapping_keys.insert((binding.account_id.clone(), binding.via_id.clone()))) {
            return Err(WorkspaceError::InvalidParseObservation("duplicate Account/Via mapping pair".into()));
        }
        if captured_account_via_bindings.iter().filter(|binding| binding.active).any(|binding| {
            !base.accounts.iter().any(|account| account.id == binding.account_id && account.active)
                || !base.vias.iter().any(|via| via.id == binding.via_id && via.active)
        }) {
            return Err(WorkspaceError::InactiveOrMissingBinding);
        }
        let mut occurrence_keys = std::collections::BTreeSet::new();
        let mut account_ids = std::collections::BTreeSet::new();
        let mut via_ids = std::collections::BTreeSet::new();
        for observation in &observations {
            if !occurrence_keys.insert((observation.artifact_id.clone(), observation.locator.clone(), observation.occurrence_discriminator.clone())) {
                return Err(WorkspaceError::InvalidParseObservation("duplicate source occurrence in fixed parse batch".into()));
            }
            for field in &observation.fields {
                if let Some(binding) = &field.binding {
                    if let Some(id) = &binding.account_id { account_ids.insert(id.clone()); }
                    if let Some(id) = &binding.via_id { via_ids.insert(id.clone()); }
                    if let (Some(account_id), Some(via_id)) = (&binding.account_id, &binding.via_id) {
                        if !captured_account_via_bindings.iter().any(|mapping| mapping.account_id == *account_id && mapping.via_id == *via_id && mapping.active) {
                            return Err(WorkspaceError::InactiveOrMissingBinding);
                        }
                    }
                }
            }
        }
        let captured_accounts = base.accounts.iter().filter(|a| account_ids.contains(&a.id)).cloned().collect::<Vec<_>>();
        let captured_vias = base.vias.iter().filter(|v| via_ids.contains(&v.id)).cloned().collect::<Vec<_>>();
        if captured_accounts.len() != account_ids.len()
            || captured_vias.len() != via_ids.len()
            || captured_accounts.iter().any(|a| !a.active)
            || captured_vias.iter().any(|v| !v.active)
        {
            return Err(WorkspaceError::InactiveOrMissingBinding);
        }
        for observation in &observations {
            for field in &observation.fields {
                if let Some(binding) = &field.binding {
                    if let Some(id) = &binding.account_id {
                        let actual = captured_accounts.iter().find(|a| a.id == *id).ok_or(WorkspaceError::InactiveOrMissingBinding)?;
                        if Some(actual.revision) != binding.account_revision { return Err(WorkspaceError::StaleBinding); }
                    }
                    if let Some(id) = &binding.via_id {
                        let actual = captured_vias.iter().find(|v| v.id == *id).ok_or(WorkspaceError::InactiveOrMissingBinding)?;
                        if Some(actual.revision) != binding.via_revision { return Err(WorkspaceError::StaleBinding); }
                    }
                }
            }
        }
        Ok(Self { observations, source_context_id: Some(source_context_id), source_context_revision: Some(source_context_revision), source_context_provider: Some(source_context_provider),
            base_ledger_generation: base.generation, binding_revision,
            account_via_mapping_revision, captured_account_via_bindings, captured_accounts, captured_vias })
    }

    /// Explicit source-free constructor; source-backed drafts must use `freeze`.
    pub fn manual_only(base: &LedgerSnapshot, account_via_mapping_revision: u64,
        captured_account_via_bindings: Vec<super::CapturedAccountViaBinding>) -> Result<Self, WorkspaceError> {
        let mut mapping_pairs = std::collections::BTreeSet::new();
        if captured_account_via_bindings.iter().any(|binding| binding.revision == 0
            || !mapping_pairs.insert((binding.account_id.clone(), binding.via_id.clone()))) {
            return Err(WorkspaceError::InvalidParseObservation("captured Account-Via mapping snapshot has an invalid revision or duplicate pair".into()));
        }
        if captured_account_via_bindings.iter().filter(|binding| binding.active).any(|binding|
            !base.accounts.iter().any(|account| account.id == binding.account_id && account.active)
                || !base.vias.iter().any(|via| via.id == binding.via_id && via.active)) {
            return Err(WorkspaceError::InactiveOrMissingBinding);
        }
        Ok(Self { observations: Vec::new(), source_context_id: None, source_context_revision: None,
            source_context_provider: None, base_ledger_generation: base.generation, binding_revision: 0,
            account_via_mapping_revision, captured_account_via_bindings,
            captured_accounts: base.accounts.clone(), captured_vias: base.vias.clone() })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DraftOperation {
    CategoryChanged { operation_id: Id, item_id: Id, item_revision: u64, category_revision: u64, origin: super::ClassificationOrigin },
    RowDispositionChanged { operation_id: Id, item_id: Id, item_revision: u64, disposition: super::LeftDisposition },
    IntentStaged { operation_id: Id, intent_id: Id },
    CandidateConfirmed { candidate_key: String },
    CandidateInvalidated { candidate_key: String, reason: String },
    IntentUndone { intent_id: Id },
    WorkspaceUndo { target_operation_id: Id },
    ImportCancelled,
    CommitPrepared { operation_id: Id, payload_sha256: String },
    CommitReceipt { operation_id: Id, receipt_id: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DraftCommitState {
    Unprepared,
    Prepared { operation_id: Id, payload_sha256: String },
    Committed { operation_id: Id, receipt_id: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceUndoFrame {
    pub operation_id: Id,
    pub items: Vec<super::WorkspaceItem>,
    pub intents: Vec<super::WorkspaceIntent>,
    pub import_cancelled: bool,
    pub candidates: Vec<Candidate>,
    pub candidate_coverage: Option<Coverage>,
    pub unresolved_candidate_observations: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DraftSnapshot {
    pub format_version: u32,
    pub draft_id: Id,
    pub workspace_id: Id,
    pub ledger_identity: LedgerIdentity,
    pub base_ledger_generation: u64,
    pub fixed_parse: FixedParseSnapshot,
    pub draft_revision: u64,
    pub durable_revision: u64,
    pub operations: Vec<DraftOperation>,
    pub items: Vec<super::WorkspaceItem>,
    pub intents: Vec<super::WorkspaceIntent>,
    pub undo_stack: Vec<WorkspaceUndoFrame>,
    pub import_cancelled: bool,
    pub candidates: Vec<Candidate>,
    pub candidate_coverage: Option<Coverage>,
    pub unresolved_candidate_observations: Vec<String>,
    pub commit_state: DraftCommitState,
    pub abandoned: bool,
}

impl DraftSnapshot {
    pub fn new(root: &IsolatedWorkspaceRoot, fixed_parse: FixedParseSnapshot) -> Self {
        let items = fixed_parse.observations.iter().enumerate().map(|(index, observation)| {
            let source_category = observation.fields.iter().filter_map(|field| field.binding.as_ref())
                .find(|binding| binding.via_id.is_some())
                .or_else(|| observation.fields.iter().filter_map(|field| field.binding.as_ref()).next())
                .cloned();
            super::WorkspaceItem {
            item_id: Id::new(), observation_index: index, item_revision: 1, manual_category_revision: 0,
            disposition: super::LeftDisposition::Open, category: source_category.clone(),
            category_origin: source_category.map(|_| super::ClassificationOrigin::SourceBinding),
        }}).collect();
        Self {
            format_version: FORMAT_VERSION,
            draft_id: Id::new(),
            workspace_id: root.workspace_id.clone(),
            ledger_identity: root.ledger_identity.clone(),
            base_ledger_generation: fixed_parse.base_ledger_generation,
            fixed_parse,
            draft_revision: 1,
            durable_revision: 0,
            operations: Vec::new(),
            items,
            intents: Vec::new(),
            undo_stack: Vec::new(),
            import_cancelled: false,
            candidates: Vec::new(),
            candidate_coverage: None,
            unresolved_candidate_observations: Vec::new(),
            commit_state: DraftCommitState::Unprepared,
            abandoned: false,
        }
    }

    pub fn new_manual(root: &IsolatedWorkspaceRoot, fixed_parse: FixedParseSnapshot) -> Result<Self, WorkspaceError> {
        if !fixed_parse.observations.is_empty() || fixed_parse.source_context_id.is_some()
            || fixed_parse.source_context_revision.is_some() || fixed_parse.source_context_provider.is_some() {
            return Err(WorkspaceError::InvalidParseObservation("manual-only draft cannot carry source observations or context".into()));
        }
        let snapshot = Self::new(root, fixed_parse);
        snapshot.validate()?;
        Ok(snapshot)
    }

    pub fn append(&mut self, operation: DraftOperation) -> Result<(), WorkspaceError> {
        if self.abandoned || matches!(self.commit_state, DraftCommitState::Committed { .. }) {
            return Err(WorkspaceError::DraftNotEditable);
        }
        if matches!(self.commit_state, DraftCommitState::Prepared { .. })
            && !matches!(operation, DraftOperation::CommitReceipt { .. })
        { return Err(WorkspaceError::DraftNotEditable); }
        self.draft_revision = self.draft_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
        self.operations.push(operation);
        Ok(())
    }

    pub fn validate(&self) -> Result<(), WorkspaceError> {
        if self.format_version != FORMAT_VERSION || self.draft_revision == 0 || self.durable_revision > self.draft_revision {
            return Err(WorkspaceError::CorruptDraft("invalid draft version or revision watermarks".into()));
        }
        if self.base_ledger_generation != self.fixed_parse.base_ledger_generation
            || self.fixed_parse.observations.is_empty() != self.fixed_parse.source_context_id.is_none()
            || self.fixed_parse.source_context_id.is_some() != self.fixed_parse.source_context_revision.is_some()
            || self.fixed_parse.source_context_id.is_some() != self.fixed_parse.source_context_provider.is_some()
            || self.fixed_parse.source_context_revision.is_some_and(|revision| revision == 0)
            || self.fixed_parse.source_context_provider.as_ref().is_some_and(|provider| provider.trim().is_empty())
            || self.fixed_parse.observations.iter().any(|observation| {
                Some(&observation.source_context_id) != self.fixed_parse.source_context_id.as_ref()
                    || Some(observation.source_context_revision) != self.fixed_parse.source_context_revision
                    || Some(&observation.source_context_provider) != self.fixed_parse.source_context_provider.as_ref()
            })
        { return Err(WorkspaceError::CorruptDraft("fixed parse SourceContext provenance is inconsistent".into())); }
        for observation in &self.fixed_parse.observations { observation.validate()?; }
        if self.items.len() != self.fixed_parse.observations.len() { return Err(WorkspaceError::CorruptDraft("workspace item set does not cover fixed observations".into())); }
        let mut item_ids = std::collections::BTreeSet::new();
        let mut indexes = std::collections::BTreeSet::new();
        for item in &self.items {
            if item.item_revision == 0 || !item_ids.insert(item.item_id.clone())
                || !indexes.insert(item.observation_index) || item.observation_index >= self.fixed_parse.observations.len()
            { return Err(WorkspaceError::CorruptDraft("workspace item identity/revision/index is invalid".into())); }
        }
        Ok(())
    }

    pub fn set_manual_category(&mut self, item_id: &Id, expected_item_revision: u64,
        category: Option<super::AccountBinding>, base: &LedgerSnapshot, changed_at_utc_micros: i64) -> Result<(), WorkspaceError> {
        ensure_editable(self)?;
        if self.base_ledger_generation != base.generation { return Err(WorkspaceError::StaleCandidate); }
        let index = self.items.iter().position(|item| item.item_id == *item_id).ok_or(WorkspaceError::InvalidParseObservation("unknown workspace item".into()))?;
        let item = &self.items[index];
        if item.item_revision != expected_item_revision || item.disposition != super::LeftDisposition::Open {
            return Err(WorkspaceError::StaleCandidate);
        }
        let next_item_revision = item.item_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
        let next_category_revision = item.manual_category_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
        validate_category(category.as_ref(), base, &self.fixed_parse.captured_account_via_bindings)?;
        let operation_id = Id::new();
        self.push_undo_frame(operation_id.clone());
        let item = &mut self.items[index];
        item.item_revision = next_item_revision;
        item.manual_category_revision = next_category_revision;
        item.category = category;
        item.category_origin = Some(super::ClassificationOrigin::Human);
        let category_revision = item.manual_category_revision;
        let revision = item.item_revision;
        self.append(DraftOperation::CategoryChanged { operation_id, item_id: item_id.clone(), item_revision: revision, category_revision, origin: super::ClassificationOrigin::Human })?;
        let observation = &self.fixed_parse.observations[self.items[index].observation_index];
        let artifact_id = observation.artifact_id.clone();
        let locator = observation.locator.clone();
        let discriminator = observation.occurrence_discriminator.clone();
        super::candidates::invalidate_for_source_change(self, &artifact_id, &locator, &discriminator, "manual category changed")?;
        Ok(())
    }

    pub fn apply_ai_category_suggestions(&mut self, suggestions: &[super::AiCategorySuggestion], base: &LedgerSnapshot) -> Result<Vec<super::AiApplyResult>, WorkspaceError> {
        ensure_editable(self)?;
        if self.base_ledger_generation != base.generation { return Err(WorkspaceError::StaleCandidate); }
        if self.import_cancelled {
            return Ok(suggestions.iter().map(|suggestion| super::AiApplyResult {
                item_id: suggestion.item_id.clone(), applied: false,
                reason: Some("workspace is not editable or import was cancelled".into()),
            }).collect());
        }
        let mut results = Vec::with_capacity(suggestions.len());
        for suggestion in suggestions {
            let index = self.items.iter().position(|item| item.item_id == suggestion.item_id);
            let Some(index) = index else {
                results.push(super::AiApplyResult { item_id: suggestion.item_id.clone(), applied: false, reason: Some("unknown item".into()) });
                continue;
            };
            let item = &self.items[index];
            if item.item_revision != suggestion.expected_item_revision
                || item.manual_category_revision != suggestion.expected_manual_category_revision
                || item.disposition != super::LeftDisposition::Open
                || self.fixed_parse.observations.get(item.observation_index).map(|observation| &observation.quality) != Some(&super::ObservationQuality::Confirmed)
                || item.category_origin == Some(super::ClassificationOrigin::Human)
                || self.import_cancelled
            {
                results.push(super::AiApplyResult { item_id: suggestion.item_id.clone(), applied: false, reason: Some("item changed, left the left pane, or was manually edited".into()) });
                continue;
            }
            let existing_category = item.category.as_ref();
            let binding = super::AccountBinding {
                account_id: Some(suggestion.account_id.clone()),
                via_id: existing_category.and_then(|category| category.via_id.clone()),
                account_revision: Some(suggestion.account_revision),
                via_revision: existing_category.and_then(|category| category.via_revision),
            };
            if !base.accounts.iter().any(|account| account.id == suggestion.account_id
                && account.revision == suggestion.account_revision && account.active
                && matches!(account.kind, crate::finance_v2_domain::AccountKind::Expenses | crate::finance_v2_domain::AccountKind::Income)) {
                results.push(super::AiApplyResult { item_id: suggestion.item_id.clone(), applied: false, reason: Some("AI classification target must be an active Income or Expenses Account".into()) });
                continue;
            }
            if let Err(error) = validate_category(Some(&binding), base, &self.fixed_parse.captured_account_via_bindings) {
                results.push(super::AiApplyResult { item_id: suggestion.item_id.clone(), applied: false, reason: Some(format!("{error:?}")) });
                continue;
            }
            let next_revision = match self.items[index].item_revision.checked_add(1) {
                Some(value) => value,
                None => { results.push(super::AiApplyResult { item_id: suggestion.item_id.clone(), applied: false, reason: Some("revision overflow".into()) }); continue; }
            };
            let operation_id = Id::new();
            self.push_undo_frame(operation_id.clone());
            let item = &mut self.items[index];
            item.item_revision = next_revision;
            item.category = Some(binding);
            item.category_origin = Some(super::ClassificationOrigin::Ai { model: suggestion.model.clone(), request_revision: suggestion.expected_item_revision });
            let category_origin = item.category_origin.clone().unwrap_or(super::ClassificationOrigin::Human);
            let item_revision = item.item_revision;
            let category_revision = item.manual_category_revision;
            self.append(DraftOperation::CategoryChanged { operation_id, item_id: suggestion.item_id.clone(), item_revision, category_revision, origin: category_origin })?;
            let observation = &self.fixed_parse.observations[self.items[index].observation_index];
            let artifact_id = observation.artifact_id.clone();
            let locator = observation.locator.clone();
            let discriminator = observation.occurrence_discriminator.clone();
            super::candidates::invalidate_for_source_change(self, &artifact_id, &locator, &discriminator, "AI category changed")?;
            results.push(super::AiApplyResult { item_id: suggestion.item_id.clone(), applied: true, reason: None });
        }
        Ok(results)
    }

    pub fn reject_observation(&mut self, item_id: &Id, expected_item_revision: u64) -> Result<(), WorkspaceError> {
        self.set_disposition(item_id, expected_item_revision, super::LeftDisposition::Rejected)
    }

    pub fn cancel_observation(&mut self, item_id: &Id, expected_item_revision: u64) -> Result<(), WorkspaceError> {
        self.set_disposition(item_id, expected_item_revision, super::LeftDisposition::Cancelled)
    }

    pub fn cancel_import(&mut self) -> Result<(), WorkspaceError> {
        ensure_editable(self)?;
        if self.items.iter().any(|item| !matches!(item.disposition, super::LeftDisposition::Rejected | super::LeftDisposition::Cancelled)
            && item.item_revision.checked_add(1).is_none()) {
            return Err(WorkspaceError::RevisionOverflow);
        }
        let operation_id = Id::new();
        self.push_undo_frame(operation_id.clone());
        self.import_cancelled = true;
        for item in &mut self.items {
            if !matches!(item.disposition, super::LeftDisposition::Rejected | super::LeftDisposition::Cancelled) {
                item.disposition = super::LeftDisposition::Cancelled;
                item.item_revision = item.item_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
            }
        }
        for intent in &mut self.intents { intent.undone = true; }
        for candidate in &mut self.candidates { candidate.confirmed = false; }
        self.append(DraftOperation::ImportCancelled)?;
        Ok(())
    }

    pub fn stage_intent(&mut self, payload: super::WorkspaceIntentPayload, source_item_ids: Vec<Id>, base: &LedgerSnapshot) -> Result<Id, WorkspaceError> {
        ensure_editable(self)?;
        if self.import_cancelled { return Err(WorkspaceError::DraftNotEditable); }
        if self.base_ledger_generation != base.generation { return Err(WorkspaceError::StaleCandidate); }
        let mut seen = std::collections::BTreeSet::new();
        for item_id in &source_item_ids {
            if !seen.insert(item_id.clone()) { return Err(WorkspaceError::InvalidParseObservation("duplicate source item".into())); }
            let item = self.items.iter().find(|item| item.item_id == *item_id).ok_or_else(|| WorkspaceError::InvalidParseObservation("unknown source item".into()))?;
            if item.disposition != super::LeftDisposition::Open && item.disposition != super::LeftDisposition::Staged {
                return Err(WorkspaceError::InvalidParseObservation("source item is not available in left pane".into()));
            }
            if item.item_revision.checked_add(1).is_none() { return Err(WorkspaceError::RevisionOverflow); }
        }
        let new_claims = evidence_claims(&payload);
        for existing in self.intents.iter().filter(|intent| !intent.undone && intent.source_item_ids.iter().any(|id| source_item_ids.contains(id))) {
            let old_claims = evidence_claims(&existing.payload);
            if new_claims.is_empty() || old_claims.is_empty() || new_claims.iter().any(|claim| old_claims.contains(claim)) {
                return Err(WorkspaceError::InvalidParseObservation("source occurrence/account/observed role is already occupied by another operation or grouping kind".into()));
            }
        }
        let intent_id = Id::new();
        let operation_id = intent_id.clone();
        self.push_undo_frame(operation_id.clone());
        for item_id in &source_item_ids {
            let item = self.items.iter_mut().find(|item| item.item_id == *item_id).ok_or_else(|| WorkspaceError::InvalidParseObservation("unknown source item".into()))?;
            item.disposition = super::LeftDisposition::Staged;
            item.item_revision = item.item_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
        }
        self.intents.push(super::WorkspaceIntent { intent_id: intent_id.clone(), base_generation: base.generation,
            source_item_ids, payload, explicitly_staged: true, undone: false });
        self.append(DraftOperation::IntentStaged { operation_id, intent_id: intent_id.clone() })?;
        Ok(intent_id)
    }

    pub fn undo_workspace_action(&mut self, operation_id: &Id) -> Result<(), WorkspaceError> {
        ensure_editable(self)?;
        let frame = self.undo_stack.last().cloned().ok_or(WorkspaceError::NothingToUndo)?;
        if frame.operation_id != *operation_id { return Err(WorkspaceError::UndoMustBeLatest); }
        let current = self.items.clone();
        let mut restored = frame.items;
        for item in &mut restored {
            if let Some(now) = current.iter().find(|current| current.item_id == item.item_id) {
                item.item_revision = now.item_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
                if now.category != item.category || now.category_origin != item.category_origin {
                    item.manual_category_revision = now.manual_category_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
                } else { item.manual_category_revision = now.manual_category_revision; }
            }
        }
        self.undo_stack.pop();
        self.items = restored;
        self.intents = frame.intents;
        self.import_cancelled = frame.import_cancelled;
        self.candidates = frame.candidates;
        self.candidate_coverage = frame.candidate_coverage;
        self.unresolved_candidate_observations = frame.unresolved_candidate_observations;
        self.draft_revision = self.draft_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
        self.operations.push(DraftOperation::WorkspaceUndo { target_operation_id: operation_id.clone() });
        Ok(())
    }

    fn set_disposition(&mut self, item_id: &Id, expected_item_revision: u64, disposition: super::LeftDisposition) -> Result<(), WorkspaceError> {
        ensure_editable(self)?;
        let index = self.items.iter().position(|item| item.item_id == *item_id).ok_or_else(|| WorkspaceError::InvalidParseObservation("unknown workspace item".into()))?;
        if self.items[index].item_revision != expected_item_revision || self.items[index].disposition != super::LeftDisposition::Open {
            return Err(WorkspaceError::StaleCandidate);
        }
        if self.items[index].item_revision.checked_add(1).is_none() { return Err(WorkspaceError::RevisionOverflow); }
        let operation_id = Id::new();
        self.push_undo_frame(operation_id.clone());
        let item_revision = {
            let item = &mut self.items[index];
            item.disposition = disposition.clone();
            item.item_revision = item.item_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
            item.item_revision
        };
        self.append(DraftOperation::RowDispositionChanged { operation_id, item_id: item_id.clone(), item_revision, disposition })?;
        Ok(())
    }

    fn push_undo_frame(&mut self, operation_id: Id) {
        self.undo_stack.push(WorkspaceUndoFrame { operation_id, items: self.items.clone(), intents: self.intents.clone(),
            import_cancelled: self.import_cancelled, candidates: self.candidates.clone(),
            candidate_coverage: self.candidate_coverage.clone(), unresolved_candidate_observations: self.unresolved_candidate_observations.clone() });
    }
}

fn ensure_editable(draft: &DraftSnapshot) -> Result<(), WorkspaceError> {
    if draft.abandoned || !matches!(draft.commit_state, DraftCommitState::Unprepared) { Err(WorkspaceError::DraftNotEditable) } else { Ok(()) }
}

fn validate_category(category: Option<&super::AccountBinding>, base: &LedgerSnapshot, mappings: &[super::CapturedAccountViaBinding]) -> Result<(), WorkspaceError> {
    let Some(binding) = category else { return Ok(()); };
    binding.validate()?;
    if let Some(id) = &binding.account_id {
        let account = base.accounts.iter().find(|account| account.id == *id && account.active).ok_or(WorkspaceError::InactiveOrMissingBinding)?;
        if Some(account.revision) != binding.account_revision { return Err(WorkspaceError::StaleBinding); }
    }
    if let Some(id) = &binding.via_id {
        let via = base.vias.iter().find(|via| via.id == *id && via.active).ok_or(WorkspaceError::InactiveOrMissingBinding)?;
        if Some(via.revision) != binding.via_revision { return Err(WorkspaceError::StaleBinding); }
    }
    if let (Some(account_id), Some(via_id)) = (&binding.account_id, &binding.via_id) {
        if !mappings.iter().any(|mapping| mapping.account_id == *account_id && mapping.via_id == *via_id && mapping.active) {
            return Err(WorkspaceError::InactiveOrMissingBinding);
        }
    }
    Ok(())
}

pub fn read_workspace(draft: &DraftSnapshot, base: &LedgerSnapshot) -> super::WorkspaceReadModel {
    let left_rows = draft.items.iter().filter_map(|item| {
        let observation = draft.fixed_parse.observations.get(item.observation_index)?.clone();
        Some(super::LeftRow { item_id: item.item_id.clone(), item_revision: item.item_revision,
            manual_category_revision: item.manual_category_revision, still_in_left: item.disposition == super::LeftDisposition::Open,
            disposition: item.disposition.clone(), quality: observation.quality.clone(), category: item.category.clone(),
            category_origin: item.category_origin.clone(), observation })
    }).collect();
    let right_preview = draft.intents.iter().filter(|intent| !intent.undone).map(|intent| preview_intent(intent, draft, base)).collect();
    let stale = draft.base_ledger_generation != base.generation || draft.candidates.iter().any(|candidate| candidate.stale)
        || draft.intents.iter().any(|intent| intent.base_generation != base.generation);
        let status = if draft.abandoned { super::WorkspaceStatus::Abandoned } else {
        match &draft.commit_state {
            DraftCommitState::Unprepared if draft.import_cancelled => super::WorkspaceStatus::ImportCancelled,
            DraftCommitState::Unprepared => super::WorkspaceStatus::Editing,
            DraftCommitState::Prepared { operation_id, .. } => super::WorkspaceStatus::Prepared { operation_id: operation_id.clone() },
            DraftCommitState::Committed { operation_id, receipt_id } => super::WorkspaceStatus::Committed { operation_id: operation_id.clone(), receipt_id: receipt_id.clone() },
        }
    };
    super::WorkspaceReadModel { ledger_generation: base.generation, draft_revision: draft.draft_revision,
        durable_revision: draft.durable_revision, dirty: draft.draft_revision > draft.durable_revision, stale,
        status,
        undo_operation_id: draft.undo_stack.last().map(|frame| frame.operation_id.clone()),
        left_rows, right_preview, candidates: draft.candidates.clone(), candidate_coverage: draft.candidate_coverage.clone(),
        unresolved_candidate_observations: draft.unresolved_candidate_observations.clone() }
}

fn preview_intent(intent: &super::WorkspaceIntent, draft: &DraftSnapshot, base: &LedgerSnapshot) -> super::RightPreview {
    use super::{FactMutation::*, PreviewIntentKind as K, TreatmentMutation as TM, WorkspaceIntentPayload as P};
    let mut blockers = Vec::new();
    let mut cascade_facts = Vec::new();
    let mut cascade_treatments = Vec::new();
    let mut cascade_members = Vec::new();
    let (kind, member_ids, projected_facts) = match &intent.payload {
        P::Fact(mutation) => match mutation {
            Create { fact } => { validate_fact_value(fact, base, true, &mut blockers); (K::CreateFact, vec![], vec![fact.clone()]) }
            Amend { expected, fact, manual_change } => {
                check_existing_fact(expected, fact, base, false, &mut blockers);
                if let Some(old) = base.active_leaf_facts.iter().find(|old| old.id == expected.l0_id && old.revision == expected.revision) {
                    if old.provenance != fact.provenance { blockers.push("amend must preserve original creation provenance".into()); }
                }
                if manual_change.reason.trim().is_empty() { blockers.push("manual change reason is required".into()); }
                match super::refinement::prospective_amend_plan(draft, base) {
                    Ok(plan) => {
                        cascade_members.extend(plan.fact_dependencies);
                        cascade_facts.extend(plan.refund_versions.into_iter().map(|version| version.fact));
                        cascade_treatments.extend(plan.treatment_versions.into_iter().map(|version| version.treatment));
                    }
                    Err(error) => blockers.push(format!("payment/refund cascade is blocked: {error:?}")),
                }
                (K::AmendFact, vec![expected.clone()], vec![fact.clone()])
            }
            Delete { expected, deleted_version, manual_change } => {
                check_existing_fact(expected, deleted_version, base, true, &mut blockers);
                if let Some(old) = base.active_leaf_facts.iter().find(|old| old.id == expected.l0_id && old.revision == expected.revision) {
                    if old.provenance != deleted_version.provenance { blockers.push("delete must preserve original creation provenance".into()); }
                }
                if manual_change.reason.trim().is_empty() { blockers.push("manual change reason is required".into()); }
                (K::DeleteFact, vec![expected.clone()], vec![deleted_version.clone()])
            }
            Restore { expected_revision, restored_version, manual_change } => {
                validate_fact_value(restored_version, base, true, &mut blockers);
                if expected_revision.checked_add(1) != Some(restored_version.revision) { blockers.push("restore revision must follow expected deleted revision".into()); }
                if base.active_leaf_facts.iter().any(|f| f.id == restored_version.id) { blockers.push("restore target is already active".into()); }
                if manual_change.reason.trim().is_empty() { blockers.push("manual change reason is required".into()); }
                (K::RestoreFact, vec![MemberRevision { l0_id: restored_version.id.clone(), revision: *expected_revision }], vec![restored_version.clone()])
            }
        },
        P::EvidenceMatch(evidence) => {
            if evidence.locator.trim().is_empty() || evidence.occurrence_discriminator.trim().is_empty() || evidence.members.is_empty() {
                blockers.push("evidence identity/member list is incomplete".into());
            }
            let parsed = draft.fixed_parse.observations.iter().find(|o| o.artifact_id == evidence.artifact_id
                && o.locator == evidence.locator && o.occurrence_discriminator == evidence.occurrence_discriminator);
            let expected_item = draft.items.iter().find_map(|item| {
                let observation = draft.fixed_parse.observations.get(item.observation_index)?;
                (observation.artifact_id == evidence.artifact_id && observation.locator == evidence.locator
                    && observation.occurrence_discriminator == evidence.occurrence_discriminator).then(|| item.item_id.clone())
            });
            if !matches!(expected_item.as_ref(), Some(item_id)
                if intent.source_item_ids.len() == 1 && intent.source_item_ids[0] == *item_id) {
                blockers.push("evidence intent source item does not exactly match its frozen occurrence".into());
            }
            let observed = parsed.and_then(|o| o.fields.iter().find(|field| field.role == evidence.source_role
                && field.binding.as_ref().and_then(|b| b.account_id.as_ref()) == Some(&evidence.observed_account_id)
                && matches!(&field.value, super::ObservationValue::SignedQuantity(q)
                    if q.commodity == evidence.signed_quantity.commodity
                        && q.amount.exact_cmp(evidence.signed_quantity.amount).ok() == Some(std::cmp::Ordering::Equal))));
            if observed.is_none() { blockers.push("evidence does not match the fixed source role/account/quantity".into()); }
            let expected_sign = if evidence.signed_quantity.amount.is_negative() { super::refinement::EndpointSign::Negative } else { super::refinement::EndpointSign::Positive };
            if evidence.signed_quantity.amount.is_zero() || evidence.sign != expected_sign { blockers.push("evidence sign is zero or disagrees with signed quantity".into()); }
            let members = evidence.members.iter().map(|m| m.member.clone()).collect::<Vec<_>>();
            let mut unique_members = std::collections::BTreeSet::new();
            if members.iter().any(|member| !unique_members.insert((member.l0_id.clone(), member.revision))) {
                blockers.push("evidence group repeats a target fact revision".into());
            }
            let source_magnitude = if evidence.signed_quantity.amount.is_negative() {
                evidence.signed_quantity.amount.checked_neg()
            } else { Ok(evidence.signed_quantity.amount) };
            let source_magnitude = match source_magnitude {
                Ok(value) => value,
                Err(_) => { blockers.push("evidence source magnitude overflows".into()); evidence.signed_quantity.amount }
            };
            let mut allocation_sum = match crate::finance_v2_domain::Amount::new(0, 0) {
                Ok(zero) => zero,
                Err(_) => {
                    blockers.push("cannot initialize exact allocation sum".into());
                    return super::RightPreview { intent_id: intent.intent_id.clone(), kind: K::EvidenceMatch,
                        source_item_ids: intent.source_item_ids.clone(), member_ids: members.clone(),
                        base_generation: intent.base_generation, confirmed: intent.explicitly_staged,
                        blocking_reasons: blockers, projected_facts: Vec::new(), projected_treatments: Vec::new() };
                }
            };
            for evidence_member in &evidence.members {
                let member = &evidence_member.member;
                if evidence_member.sign != evidence.sign {
                    blockers.push("member allocation sign disagrees with evidence source sign".into());
                }
                let Some(fact) = base.active_leaf_facts.iter().find(|f| f.id == member.l0_id && f.revision == member.revision) else {
                    blockers.push("evidence target is stale or inactive".into());
                    continue;
                };
                let side = match evidence.sign {
                    super::refinement::EndpointSign::Positive if fact.positive_account_id == evidence.observed_account_id => Some(&fact.positive),
                    super::refinement::EndpointSign::Negative if fact.negative_account_id == evidence.observed_account_id => Some(&fact.negative),
                    _ => None,
                };
                let Some(side) = side else { blockers.push("evidence member does not match observed Account/sign".into()); continue; };
            if evidence.grouping_kind == super::EvidenceGroupingKind::Ordinary
                    && (side.commodity != evidence.signed_quantity.commodity
                        || side.amount.exact_cmp(source_magnitude).ok() != Some(std::cmp::Ordering::Equal)) {
                    blockers.push("ordinary evidence must exactly match one member endpoint amount".into());
                }
                if let Some(allocation) = &evidence_member.allocation {
                    if allocation.commodity != side.commodity || allocation.amount.exact_cmp(side.amount).ok() != Some(std::cmp::Ordering::Equal) {
                        blockers.push("evidence allocation differs from exact member endpoint".into());
                    }
                    allocation_sum = match allocation_sum.checked_add(allocation.amount) {
                        Ok(value) => value,
                        Err(_) => { blockers.push("evidence allocation sum overflow".into()); allocation_sum }
                    };
                } else if evidence.grouping_kind != super::EvidenceGroupingKind::Ordinary {
                    blockers.push("refinement/refund evidence requires explicit allocation".into());
                }
            }
            if evidence.grouping_kind == super::EvidenceGroupingKind::Ordinary {
                if evidence.members.len() != 1 || evidence.members.first().is_some_and(|m| m.allocation.is_some()) {
                    blockers.push("ordinary evidence match must target one L0 without allocation".into());
                }
            } else {
                if allocation_sum.exact_cmp(source_magnitude).ok() != Some(std::cmp::Ordering::Equal) { blockers.push("evidence allocation does not close observed quantity".into()); }
            }
            if evidence.requires_refund_treatment {
                let resolved = evidence.members.iter().all(|member| refund_relation_resolved(&member.member, draft, base));
                if !resolved { blockers.push("refund relation is unresolved; entire commit is blocked".into()); }
            }
            (K::EvidenceMatch, members, vec![])
        },
        P::Treatment(treatment) => match treatment {
            TM::Apply { treatment } => {
                validate_treatment(treatment, base, &mut blockers);
                if let Err(reason) = apply_treatment_preview(base, &TM::Apply { treatment: treatment.clone() }) { blockers.push(reason); }
                (K::Treatment, treatment.members.clone(), vec![])
            }
            TM::Amend { expected_revision, treatment, manual_change } => {
                if !base.current_treatments.iter().any(|t| t.id == treatment.id && t.revision == *expected_revision) { blockers.push("treatment revision is stale".into()); }
                validate_treatment(treatment, base, &mut blockers);
                if expected_revision.checked_add(1) != Some(treatment.revision) || manual_change.reason.trim().is_empty() { blockers.push("amend revision or manual change reason is invalid".into()); }
                if let Err(reason) = apply_treatment_preview(base, &TM::Amend { expected_revision: *expected_revision, treatment: treatment.clone(), manual_change: manual_change.clone() }) { blockers.push(reason); }
                (K::Treatment, treatment.members.clone(), vec![])
            }
            TM::Release { expected_revision, tombstone, manual_change } => {
                if !base.current_treatments.iter().any(|t| t.id == tombstone.id && t.revision == *expected_revision) { blockers.push("treatment release revision is stale".into()); }
                if expected_revision.checked_add(1) != Some(tombstone.revision) || manual_change.reason.trim().is_empty() { blockers.push("release revision or manual change reason is invalid".into()); }
                if let Err(reason) = apply_treatment_preview(base, &TM::Release { expected_revision: *expected_revision, tombstone: tombstone.clone(), manual_change: manual_change.clone() }) { blockers.push(reason); }
                (K::Treatment, tombstone.members.clone(), vec![])
            }
        },
        P::Refinement(refinement) => {
            if let Err(error) = refinement.validate_against(base) { blockers.push(format!("{error:?}")); }
            let mut expected_items = std::collections::BTreeSet::new();
            for allocation in &refinement.evidence_allocations {
                let item_id = draft.items.iter().find_map(|item| {
                    let observation = draft.fixed_parse.observations.get(item.observation_index)?;
                    (observation.artifact_id == allocation.source.artifact_id && observation.locator == allocation.source.locator
                        && observation.occurrence_discriminator == allocation.source.occurrence_discriminator).then(|| item.item_id.clone())
                });
                if let Some(item_id) = item_id { expected_items.insert(item_id); }
                else { blockers.push("refinement evidence source has no workspace item".into()); }
            }
            let actual_items = intent.source_item_ids.iter().cloned().collect::<std::collections::BTreeSet<_>>();
            if expected_items != actual_items { blockers.push("refinement source items do not exactly cover evidence allocation occurrences".into()); }
            (K::Refinement, std::iter::once(refinement.parent.clone()).chain(refinement.children.iter().map(|f| MemberRevision { l0_id: f.id.clone(), revision: f.revision })).collect(), refinement.children.clone())
        },
        P::CandidateConfirmation { candidate_key } => {
            if !draft.candidates.iter().any(|c| c.key == *candidate_key && !c.stale) { blockers.push("candidate is missing or stale".into()); }
            (K::CandidateConfirmation, vec![], vec![])
        }
    };
    let mut member_ids = member_ids;
    member_ids.extend(cascade_members);
    member_ids.sort_by(|a, b| a.l0_id.cmp(&b.l0_id).then(a.revision.cmp(&b.revision)));
    member_ids.dedup_by(|a, b| a.l0_id == b.l0_id && a.revision == b.revision);
    super::RightPreview { intent_id: intent.intent_id.clone(), kind, source_item_ids: intent.source_item_ids.clone(),
        member_ids, base_generation: intent.base_generation, confirmed: intent.explicitly_staged,
        blocking_reasons: blockers, projected_facts: projected_facts.into_iter().chain(cascade_facts).collect(),
        projected_treatments: cascade_treatments }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct EvidenceClaim {
    artifact_id: Id,
    locator: String,
    occurrence_discriminator: String,
    account_id: Id,
    observed_role: String,
}

fn evidence_claims(payload: &super::WorkspaceIntentPayload) -> Vec<EvidenceClaim> {
    match payload {
        super::WorkspaceIntentPayload::EvidenceMatch(evidence) => vec![EvidenceClaim {
            artifact_id: evidence.artifact_id.clone(), locator: evidence.locator.clone(),
            occurrence_discriminator: evidence.occurrence_discriminator.clone(),
            account_id: evidence.observed_account_id.clone(), observed_role: evidence.source_role.clone(),
        }],
        super::WorkspaceIntentPayload::Refinement(refinement) => refinement.evidence_allocations.iter().map(|allocation| EvidenceClaim {
            artifact_id: allocation.source.artifact_id.clone(), locator: allocation.source.locator.clone(),
            occurrence_discriminator: allocation.source.occurrence_discriminator.clone(),
            account_id: allocation.source.account_id.clone(), observed_role: allocation.source.role.clone(),
        }).collect(),
        _ => Vec::new(),
    }
}

fn validate_fact_value(fact: &L0Fact, base: &LedgerSnapshot, active: bool, blockers: &mut Vec<String>) {
    if fact.validate().is_err() { blockers.push("fact violates E0 quantity/date invariants".into()); }
    if fact.status != if active { FactStatus::Active } else { FactStatus::Deleted } { blockers.push("fact status does not match operation".into()); }
    for id in [&fact.positive_account_id, &fact.negative_account_id] {
        if !base.accounts.iter().any(|a| a.id == *id && a.active) { blockers.push("fact references inactive or missing Account".into()); }
    }
    if let Some(via) = &fact.via_id { if !base.vias.iter().any(|v| v.id == *via && v.active) { blockers.push("fact references inactive or missing Via".into()); } }
}

fn check_existing_fact(expected: &MemberRevision, fact: &L0Fact, base: &LedgerSnapshot, deleted: bool, blockers: &mut Vec<String>) {
    if !base.active_leaf_facts.iter().any(|old| old.id == expected.l0_id && old.revision == expected.revision) { blockers.push("fact expected revision is stale".into()); }
    if fact.id != expected.l0_id || expected.revision.checked_add(1) != Some(fact.revision) { blockers.push("fact identity/revision must advance by one".into()); }
    validate_fact_value(fact, base, !deleted, blockers);
}

fn validate_treatment(treatment: &crate::finance_v2_domain::Treatment, base: &LedgerSnapshot, blockers: &mut Vec<String>) {
    if treatment.revision == 0 || treatment.members.is_empty() || !treatment.members.iter().any(|m| m.l0_id == treatment.owner_l0_id) { blockers.push("treatment graph lacks owner or members".into()); }
    let mut seen = std::collections::BTreeSet::new();
    for member in &treatment.members {
        if !seen.insert((member.l0_id.clone(), member.revision)) { blockers.push("duplicate treatment member".into()); }
        if !base.active_leaf_facts.iter().any(|f| f.id == member.l0_id && f.revision == member.revision) { blockers.push("treatment member is stale/inactive".into()); }
    }
    if treatment.refund_edges.iter().any(|e| !e.amount.amount.is_positive()) { blockers.push("refund amount must be positive".into()); }
}

fn apply_treatment_preview(base: &LedgerSnapshot, mutation: &super::TreatmentMutation) -> Result<LedgerSnapshot, String> {
    use super::TreatmentMutation as TM;
    let mut proposed = base.clone();
    match mutation {
        TM::Apply { treatment } => {
            if proposed.current_treatments.iter().any(|old| old.id == treatment.id) {
                return Err("treatment id already has a current relation".into());
            }
            proposed.current_treatments.push(treatment.clone());
        }
        TM::Amend { expected_revision, treatment, .. } => {
            let Some(index) = proposed.current_treatments.iter().position(|old| old.id == treatment.id && old.revision == *expected_revision) else {
                return Err("treatment amend does not reference the exact current relation revision".into());
            };
            if expected_revision.checked_add(1) != Some(treatment.revision) {
                return Err("treatment amend revision must advance by one".into());
            }
            proposed.current_treatments.remove(index);
            proposed.current_treatments.push(treatment.clone());
        }
        TM::Release { expected_revision, tombstone, .. } => {
            let Some(index) = proposed.current_treatments.iter().position(|old| old.id == tombstone.id && old.revision == *expected_revision) else {
                return Err("treatment release does not reference the exact current relation revision".into());
            };
            let mut expected_tombstone = proposed.current_treatments[index].clone();
            expected_tombstone.revision = expected_revision.checked_add(1).ok_or_else(|| "treatment revision overflow".to_owned())?;
            if &expected_tombstone != tombstone {
                return Err("release tombstone must preserve the exact relation graph and only advance revision".into());
            }
            proposed.current_treatments.remove(index);
        }
    }
    crate::finance_v2_projection::project_ledger(&proposed)
        .map_err(|error| format!("proposed treatment graph is invalid: {error:?}"))?;
    Ok(proposed)
}

pub(super) fn refund_relation_resolved(member: &MemberRevision, draft: &DraftSnapshot, base: &LedgerSnapshot) -> bool {
    let mut proposed = base.clone();
    for intent in draft.intents.iter().filter(|intent| !intent.undone && intent.explicitly_staged) {
        if let super::WorkspaceIntentPayload::Treatment(mutation) = &intent.payload {
            let Ok(next) = apply_treatment_preview(&proposed, mutation) else { return false; };
            proposed = next;
        }
    }
    crate::finance_v2_projection::project_ledger(&proposed).is_ok()
        && proposed.current_treatments.iter().any(|treatment| {
            treatment.refund_edges.iter().any(|edge| &edge.refund == member || &edge.payment == member)
        })
}

#[derive(Clone, Debug)]
pub struct DraftRepository {
    root: IsolatedWorkspaceRoot,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
struct SnapshotEnvelope {
    format_version: u32,
    payload_sha256: String,
    snapshot: DraftSnapshot,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
struct AbandonedMarker {
    draft_id: Id,
    operation_id: Option<Id>,
    receipt_absence_confirmed: bool,
    workspace_kind: super::WorkspaceKind,
}

/// E5 creates this value only after checking the durable SQL receipt, ready
/// materialization job, and currently published manifest under its write lock.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaterializationReadyProof {
    operation_id: Id,
    receipt_id: Id,
    receipt_generation: u64,
    job_generation: u64,
    published_generation: u64,
    receipt_payload_sha256: String,
    job_output_sha256: String,
    active_manifest_generation: u64,
    active_manifest_sha256: String,
}

impl MaterializationReadyProof {
    /// E5 calls this only after verifying the SQL receipt, Ready job and the
    /// current active manifest under its write coordinator. Repair generations
    /// may advance beyond the original receipt generation.
    pub(crate) fn verified(operation_id: Id, receipt_id: Id, receipt_generation: u64,
        receipt_payload_sha256: String, job_generation: u64, job_output_sha256: String,
        active_manifest_generation: u64, active_manifest_sha256: String) -> Result<Self, WorkspaceError> {
        let proof = Self { operation_id, receipt_id, receipt_generation, job_generation,
            published_generation: active_manifest_generation, receipt_payload_sha256,
            job_output_sha256, active_manifest_generation, active_manifest_sha256 };
        validate_ready_proof(&proof)?;
        Ok(proof)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DraftListState { Open, Prepared, Committed, Finalized, Abandoned }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DraftListEntry {
    pub draft_id: Id,
    pub workspace_kind: super::WorkspaceKind,
    pub durable_revision: u64,
    pub state: DraftListState,
    pub operation_id: Option<Id>,
    pub receipt_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FinalizedWorkspaceReceipt {
    pub draft_id: Id,
    pub operation_id: Id,
    pub receipt_id: Id,
    pub published_generation: u64,
    pub workspace_kind: super::WorkspaceKind,
}

#[derive(Clone, Debug)]
pub struct ReceiptNotFound {
    pub operation_id: Id,
}

impl ReceiptNotFound {
    /// E5 must only construct this after an authoritative receipt lookup.
    pub fn after_lookup(operation_id: Id, receipt_was_absent: bool) -> Result<Self, WorkspaceError> {
        if !receipt_was_absent { return Err(WorkspaceError::ReceiptExistsOrUnknown); }
        Ok(Self { operation_id })
    }
}

impl DraftRepository {
    pub fn open(root: IsolatedWorkspaceRoot) -> Self { Self { root } }

    /// Enumerates recovery-safe metadata only. Any malformed entry or path
    /// escape fails the whole read instead of silently hiding a draft.
    pub fn list_drafts(&self) -> Result<Vec<DraftListEntry>, WorkspaceError> {
        self.validate_repository_dirs()?;
        let drafts_root = self.root.path.join("drafts");
        let mut entries = Vec::new();
        for entry in fs::read_dir(&drafts_root)? {
            let entry = entry?;
            let path = entry.path();
            reject_symlink_dir(&path)?;
            let draft_id = Id::parse(entry.file_name().into_string().map_err(|_| WorkspaceError::IsolationViolation)?)
                .map_err(|_| WorkspaceError::CorruptDraft("draft directory name is not a valid identity".into()))?;
            let abandoned_path = path.join("abandoned.json");
            let finalized_path = path.join("finalized.json");
            if path_exists_nofollow(&abandoned_path)? && path_exists_nofollow(&finalized_path)? {
                return Err(WorkspaceError::IsolationViolation);
            }
            let entry_value = if path_exists_nofollow(&abandoned_path)? {
                let marker: AbandonedMarker = read_json(&abandoned_path)?;
                validate_abandoned_marker(&marker, &draft_id)?;
                validate_terminal_dir_contents(&path, &abandoned_path)?;
                DraftListEntry { draft_id, workspace_kind: marker.workspace_kind, durable_revision: 0, state: DraftListState::Abandoned,
                    operation_id: marker.operation_id, receipt_id: None }
            } else if path_exists_nofollow(&finalized_path)? {
                let marker: FinalizedWorkspaceReceipt = read_json(&finalized_path)?;
                validate_finalized_marker(&marker, &draft_id)?;
                validate_terminal_dir_contents(&path, &finalized_path)?;
                DraftListEntry { draft_id, workspace_kind: marker.workspace_kind, durable_revision: 0, state: DraftListState::Finalized,
                    operation_id: Some(marker.operation_id), receipt_id: Some(marker.receipt_id.as_str().to_owned()) }
            } else {
                let snapshot = self.load(&draft_id)?.ok_or(WorkspaceError::CorruptDraft("draft directory has no published snapshot".into()))?;
                let (state, operation_id, receipt_id) = match &snapshot.commit_state {
                    DraftCommitState::Unprepared => (DraftListState::Open, None, None),
                    DraftCommitState::Prepared { operation_id, .. } => (DraftListState::Prepared, Some(operation_id.clone()), None),
                    DraftCommitState::Committed { operation_id, receipt_id } => (DraftListState::Committed, Some(operation_id.clone()), Some(receipt_id.clone())),
                };
                DraftListEntry { draft_id, workspace_kind: if snapshot.fixed_parse.observations.is_empty() { super::WorkspaceKind::ManualOnly } else { super::WorkspaceKind::Imported },
                    durable_revision: snapshot.durable_revision, state, operation_id, receipt_id }
            };
            entries.push(entry_value);
        }
        entries.sort_by(|a, b| a.draft_id.cmp(&b.draft_id));
        Ok(entries)
    }

    pub fn load(&self, draft_id: &Id) -> Result<Option<DraftSnapshot>, WorkspaceError> {
        self.validate_repository_dirs()?;
        let dir = self.draft_dir(draft_id);
        if !path_exists_nofollow(&dir)? { return Ok(None); }
        reject_symlink_dir(&dir)?;
        let tombstone = dir.join("abandoned.json");
        let finalized = dir.join("finalized.json");
        if path_exists_nofollow(&tombstone)? && path_exists_nofollow(&finalized)? {
            return Err(WorkspaceError::IsolationViolation);
        }
        if path_exists_nofollow(&tombstone)? {
            let marker: AbandonedMarker = read_json(&tombstone)?;
            validate_abandoned_marker(&marker, draft_id)?;
            cleanup_abandoned_files(&dir, &tombstone)?;
            return Err(WorkspaceError::DraftAbandoned);
        }
        if path_exists_nofollow(&finalized)? {
            let marker: FinalizedWorkspaceReceipt = read_json(&finalized)?;
            validate_finalized_marker(&marker, draft_id)?;
            cleanup_abandoned_files(&dir, &finalized)?;
            return Err(WorkspaceError::DraftFinalized { operation_id: marker.operation_id, receipt_id: marker.receipt_id, published_generation: marker.published_generation });
        }
        let prefix = format!("{}-r", draft_id.as_str());
        let mut files = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            validate_regular_file(&entry.path())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(rest) = name.strip_prefix(&prefix).and_then(|s| s.strip_suffix(".json")) {
                let revision = rest.parse::<u64>().map_err(|_| WorkspaceError::CorruptDraft("invalid revision filename".into()))?;
                files.push((revision, entry.path()));
            }
        }
        if files.is_empty() { return Err(WorkspaceError::CorruptDraft("draft has no durable revision".into())); }
        files.sort_by_key(|(revision, _)| *revision);
        let mut latest: Option<DraftSnapshot> = None;
        for (revision, path) in files {
            let envelope: SnapshotEnvelope = read_json(&path).map_err(|_| WorkspaceError::CorruptDraft(format!("unreadable revision {revision}")))?;
            let bytes = serde_json::to_vec(&envelope.snapshot).map_err(WorkspaceError::Serialization)?;
            if envelope.format_version != FORMAT_VERSION || sha256(&bytes) != envelope.payload_sha256
                || envelope.snapshot.durable_revision != revision
                || envelope.snapshot.draft_id != *draft_id
                || envelope.snapshot.workspace_id != self.root.workspace_id
                || envelope.snapshot.ledger_identity != self.root.ledger_identity
            { return Err(WorkspaceError::CorruptDraft(format!("revision {revision} failed identity/hash validation"))); }
            envelope.snapshot.validate()?;
            latest = Some(envelope.snapshot);
        }
        Ok(latest)
    }

    pub fn persist(&self, snapshot: &DraftSnapshot, expected_durable_revision: u64) -> Result<DraftSnapshot, WorkspaceError> {
        self.validate_repository_dirs()?;
        snapshot.validate()?;
        if snapshot.workspace_id != self.root.workspace_id || snapshot.ledger_identity != self.root.ledger_identity {
            return Err(WorkspaceError::IdentityMismatch);
        }
        let dir = self.draft_dir(&snapshot.draft_id);
        let existed = path_exists_nofollow(&dir)?;
        if existed { reject_symlink_dir(&dir)?; ensure_not_tombstoned(&dir, &snapshot.draft_id)?; }
        let current = if existed {
            self.load(&snapshot.draft_id)?.ok_or_else(|| WorkspaceError::CorruptDraft("draft directory has no durable revision".into()))?.durable_revision
        } else { 0 };
        let mut durable = snapshot.clone();
        durable.durable_revision = durable.draft_revision;
        let payload = serde_json::to_vec(&durable).map_err(WorkspaceError::Serialization)?;
        let hash = sha256(&payload);
        if current != expected_durable_revision {
            if current == durable.durable_revision
                && (snapshot.durable_revision == expected_durable_revision || snapshot.durable_revision == current)
            {
                let destination = dir.join(format!("{}-r{}.json", durable.draft_id.as_str(), durable.durable_revision));
                let existing: SnapshotEnvelope = read_json(&destination).map_err(|_| WorkspaceError::CorruptDraft("revision collision file is corrupt".into()))?;
                if existing.payload_sha256 == hash { return Ok(existing.snapshot); }
            }
            return Err(WorkspaceError::StaleDraftRevision { expected: expected_durable_revision, actual: current });
        }
        if snapshot.durable_revision != expected_durable_revision {
            return Err(WorkspaceError::StaleDraftRevision { expected: expected_durable_revision, actual: snapshot.durable_revision });
        }
        if snapshot.draft_revision <= expected_durable_revision {
            return Err(WorkspaceError::StaleDraftRevision { expected: expected_durable_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?, actual: snapshot.draft_revision });
        }
        if !existed { fs::create_dir(&dir)?; sync_parent_if_supported(dir.parent().ok_or(WorkspaceError::IsolationViolation)?)?; }
        reject_symlink_dir(&dir)?;
        ensure_not_tombstoned(&dir, &snapshot.draft_id)?;
        let envelope = SnapshotEnvelope { format_version: FORMAT_VERSION, payload_sha256: hash.clone(), snapshot: durable.clone() };
        let bytes = serde_json::to_vec(&envelope).map_err(WorkspaceError::Serialization)?;
        let destination = dir.join(format!("{}-r{}.json", durable.draft_id.as_str(), durable.durable_revision));
        if path_exists_nofollow(&destination)? {
            let existing: SnapshotEnvelope = read_json(&destination).map_err(|_| WorkspaceError::CorruptDraft("revision collision file is corrupt".into()))?;
            if existing.payload_sha256 == hash { return Ok(existing.snapshot); }
            return Err(WorkspaceError::StaleDraftRevision { expected: durable.durable_revision, actual: durable.durable_revision });
        }
        let temp = dir.join(format!(".{}.{}.tmp", durable.draft_id.as_str(), Id::new().as_str()));
        if path_exists_nofollow(&temp)? { return Err(WorkspaceError::IsolationViolation); }
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(&bytes)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        validate_regular_file(&temp)?;
        // Hard-link publication cannot replace an already-published revision, so
        // stale concurrent writers fail closed instead of rolling the durable head back.
        ensure_not_tombstoned(&dir, &snapshot.draft_id)?;
        if path_exists_nofollow(&destination)? { return Err(WorkspaceError::StaleDraftRevision { expected: durable.durable_revision, actual: current }); }
        let publish = fs::hard_link(&temp, &destination);
        validate_regular_file(&temp)?;
        fs::remove_file(&temp)?;
        if publish.is_ok() {
            if let Err(terminal) = ensure_not_tombstoned(&dir, &snapshot.draft_id) {
                if path_exists_nofollow(&destination)? { validate_regular_file(&destination)?; fs::remove_file(&destination)?; }
                sync_parent_if_supported(&dir)?;
                return Err(terminal);
            }
        }
        match publish {
            Ok(()) => { sync_parent_if_supported(&dir)?; Ok(durable) }
            Err(error) if path_exists_nofollow(&destination)? => {
                let existing: SnapshotEnvelope = read_json(&destination).map_err(|_| WorkspaceError::CorruptDraft("revision collision file is corrupt".into()))?;
                if existing.payload_sha256 == hash { Ok(existing.snapshot) }
                else { Err(WorkspaceError::StaleDraftRevision { expected: durable.durable_revision, actual: durable.durable_revision }) }
            }
            Err(error) => Err(WorkspaceError::Io(error)),
        }
    }

    pub fn abandon(&self, draft_id: &Id, receipt_check: Option<ReceiptNotFound>) -> Result<(), WorkspaceError> {
        self.validate_repository_dirs()?;
        let dir = self.draft_dir(draft_id);
        if path_exists_nofollow(&dir.join("abandoned.json"))? {
            reject_symlink_dir(&dir)?;
            let marker: AbandonedMarker = read_json(&dir.join("abandoned.json"))?;
            validate_abandoned_marker(&marker, draft_id)?;
            cleanup_abandoned_files(&dir, &dir.join("abandoned.json"))?;
            return Ok(());
        }
        let mut draft = self.load(draft_id)?.ok_or(WorkspaceError::DraftNotFound)?;
        let operation_id = match &draft.commit_state {
            DraftCommitState::Unprepared => None,
            DraftCommitState::Prepared { operation_id, .. } => Some(operation_id.clone()),
            DraftCommitState::Committed { .. } => return Err(WorkspaceError::ReceiptExistsOrUnknown),
        };
        if operation_id.is_some() && receipt_check.as_ref().map(|x| &x.operation_id) != operation_id.as_ref() {
            return Err(WorkspaceError::ReceiptExistsOrUnknown);
        }
        if operation_id.is_none() && receipt_check.is_some() {
            return Err(WorkspaceError::InvalidAbandonGuard);
        }
        draft.abandoned = true;
        draft.draft_revision = draft.draft_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
        let marker = AbandonedMarker { draft_id: draft_id.clone(), receipt_absence_confirmed: operation_id.is_some(), operation_id,
            workspace_kind: if draft.fixed_parse.observations.is_empty() { super::WorkspaceKind::ManualOnly } else { super::WorkspaceKind::Imported } };
        let temp = dir.join(format!(".abandoned.{}.tmp", Id::new().as_str()));
        if path_exists_nofollow(&temp)? || path_exists_nofollow(&dir.join("abandoned.json"))? { return Err(WorkspaceError::IsolationViolation); }
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)?;
        serde_json::to_writer(&mut file, &marker).map_err(WorkspaceError::Serialization)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        let target = dir.join("abandoned.json");
        validate_regular_file(&temp)?;
        fs::hard_link(&temp, &target).map_err(WorkspaceError::Io)?;
        validate_regular_file(&temp)?;
        fs::remove_file(temp)?;
        sync_parent_if_supported(&dir)?;
        cleanup_abandoned_files(&dir, &target)?;
        Ok(())
    }

    /// Discard transient workspace data only after E5 has independently
    /// verified the receipt, ready job, and active manifest. The tiny marker
    /// makes cleanup retries idempotent and prevents stale writes from reviving
    /// source rows after successful materialization.
    pub fn finalize_after_materialized(
        &self,
        draft_id: &Id,
        proof: &MaterializationReadyProof,
        expected_durable_revision: u64,
    ) -> Result<(), WorkspaceError> {
        validate_ready_proof(proof)?;
        self.validate_repository_dirs()?;
        let dir = self.draft_dir(draft_id);
        reject_symlink_dir(&dir)?;
        let finalized_path = dir.join("finalized.json");
        if path_exists_nofollow(&finalized_path)? {
            let marker: FinalizedWorkspaceReceipt = read_json(&finalized_path)?;
            validate_finalized_marker(&marker, draft_id)?;
            if marker.operation_id != proof.operation_id || marker.receipt_id != proof.receipt_id
                || marker.published_generation != proof.published_generation {
                return Err(WorkspaceError::ReceiptExistsOrUnknown);
            }
            cleanup_abandoned_files(&dir, &finalized_path)?;
            return Ok(());
        }
        if path_exists_nofollow(&dir.join("abandoned.json"))? { return Err(WorkspaceError::DraftAbandoned); }
        let draft = self.load(draft_id)?.ok_or(WorkspaceError::DraftNotFound)?;
        if draft.durable_revision != expected_durable_revision || draft.draft_revision != expected_durable_revision {
            return Err(WorkspaceError::StaleDraftRevision { expected: expected_durable_revision, actual: draft.durable_revision });
        }
        match &draft.commit_state {
            DraftCommitState::Committed { operation_id, receipt_id }
                if operation_id == &proof.operation_id && receipt_id == proof.receipt_id.as_str() => {}
            _ => return Err(WorkspaceError::ReceiptExistsOrUnknown),
        }
        let prepared_hash = draft.operations.iter().find_map(|operation| match operation {
            DraftOperation::CommitPrepared { operation_id, payload_sha256 } if operation_id == &proof.operation_id => Some(payload_sha256),
            _ => None,
        }).ok_or(WorkspaceError::ReceiptExistsOrUnknown)?;
        if prepared_hash != &proof.receipt_payload_sha256 || proof.published_generation <= draft.base_ledger_generation {
            return Err(WorkspaceError::ReceiptExistsOrUnknown);
        }
        let marker = FinalizedWorkspaceReceipt {
            draft_id: draft_id.clone(), operation_id: proof.operation_id.clone(),
            receipt_id: proof.receipt_id.clone(), published_generation: proof.published_generation,
            workspace_kind: if draft.fixed_parse.observations.is_empty() { super::WorkspaceKind::ManualOnly } else { super::WorkspaceKind::Imported },
        };
        let temp = dir.join(format!(".finalized.{}.tmp", Id::new().as_str()));
        if path_exists_nofollow(&temp)? { return Err(WorkspaceError::IsolationViolation); }
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)?;
        serde_json::to_writer(&mut file, &marker).map_err(WorkspaceError::Serialization)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        validate_regular_file(&temp)?;
        match fs::hard_link(&temp, &finalized_path) {
            Ok(()) => {}
            Err(error) if path_exists_nofollow(&finalized_path)? => {
                let existing: FinalizedWorkspaceReceipt = read_json(&finalized_path)?;
                if existing != marker { return Err(WorkspaceError::ReceiptExistsOrUnknown); }
            }
            Err(error) => return Err(WorkspaceError::Io(error)),
        }
        validate_regular_file(&temp)?;
        fs::remove_file(temp)?;
        sync_parent_if_supported(&dir)?;
        cleanup_abandoned_files(&dir, &finalized_path)
    }

    /// Returns the identity-only finalization marker. E5 must load the full
    /// receipt/job from SQL; no receipt or evidence record is deleted here.
    pub fn finalized_receipt(&self, draft_id: &Id) -> Result<Option<FinalizedWorkspaceReceipt>, WorkspaceError> {
        self.validate_repository_dirs()?;
        let dir = self.draft_dir(draft_id);
        if !path_exists_nofollow(&dir)? { return Ok(None); }
        reject_symlink_dir(&dir)?;
        let path = dir.join("finalized.json");
        if !path_exists_nofollow(&path)? { return Ok(None); }
        let marker: FinalizedWorkspaceReceipt = read_json(&path)?;
        validate_finalized_marker(&marker, draft_id)?;
        cleanup_abandoned_files(&dir, &path)?;
        Ok(Some(marker))
    }

    fn draft_dir(&self, id: &Id) -> PathBuf { self.root.path.join("drafts").join(id.as_str()) }

    fn validate_repository_dirs(&self) -> Result<(), WorkspaceError> {
        reject_symlink_dir(&self.root.path)?;
        reject_symlink_dir(&self.root.path.join("drafts"))
    }
}

#[derive(Debug)]
pub enum WorkspaceError {
    Io(std::io::Error),
    CreateStageIo { stage: &'static str, source: std::io::Error },
    Serialization(serde_json::Error),
    InvalidIdentity,
    IdentityMismatch,
    IsolationViolation,
    ExplicitConfirmationRequired,
    InvalidParseObservation(String),
    MixedBindingRevision,
    InactiveOrMissingBinding,
    StaleBinding,
    CorruptDraft(String),
    DraftNotFound,
    DraftAbandoned,
    DraftFinalized { operation_id: Id, receipt_id: Id, published_generation: u64 },
    DraftNotEditable,
    ImportCancelled,
    RevisionOverflow,
    StaleDraftRevision { expected: u64, actual: u64 },
    ReceiptExistsOrUnknown,
    InvalidAbandonGuard,
    NothingToUndo,
    UndoMustBeLatest,
    InvalidCandidate(String),
    CandidateBudgetExceeded,
    StaleCandidate,
    InvalidRefinement(String),
    UnresolvedTreatment(Id),
}

impl From<std::io::Error> for WorkspaceError { fn from(value: std::io::Error) -> Self { Self::Io(value) } }

fn create_stage_error(stage: &'static str, error: WorkspaceError) -> WorkspaceError {
    match error {
        WorkspaceError::Io(source) => WorkspaceError::CreateStageIo { stage, source },
        other => other,
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, WorkspaceError> {
    let metadata = validate_regular_file(path)?;
    let mut bytes = Vec::new();
    if metadata.len() > 128 * 1024 * 1024 { return Err(WorkspaceError::CorruptDraft("snapshot exceeds the isolated workspace size limit".into())); }
    File::open(path)?.read_to_end(&mut bytes)?;
    serde_json::from_slice(&bytes).map_err(WorkspaceError::Serialization)
}

fn reject_symlink_dir(path: &Path) -> Result<(), WorkspaceError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_dir() { Err(WorkspaceError::IsolationViolation) } else { Ok(()) }
}

fn validate_regular_file(path: &Path) -> Result<fs::Metadata, WorkspaceError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_file() {
        return Err(WorkspaceError::IsolationViolation);
    }
    Ok(metadata)
}

fn path_exists_nofollow(path: &Path) -> Result<bool, WorkspaceError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(WorkspaceError::Io(error)),
    }
}

fn cleanup_abandoned_files(dir: &Path, tombstone: &Path) -> Result<(), WorkspaceError> {
    reject_symlink_dir(dir)?;
    validate_regular_file(tombstone)?;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path == tombstone { continue; }
        validate_regular_file(&path)?;
        fs::remove_file(path)?;
    }
    sync_parent_if_supported(dir)
}

fn validate_terminal_dir_contents(dir: &Path, marker: &Path) -> Result<(), WorkspaceError> {
    reject_symlink_dir(dir)?;
    validate_regular_file(marker)?;
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path != marker { validate_regular_file(&path)?; }
    }
    Ok(())
}

fn validate_abandoned_marker(marker: &AbandonedMarker, expected_draft_id: &Id) -> Result<(), WorkspaceError> {
    if marker.draft_id != *expected_draft_id
        || marker.receipt_absence_confirmed != marker.operation_id.is_some()
    { return Err(WorkspaceError::CorruptDraft("abandon marker identity/receipt guard is invalid".into())); }
    Ok(())
}

fn validate_finalized_marker(marker: &FinalizedWorkspaceReceipt, expected_draft_id: &Id) -> Result<(), WorkspaceError> {
    if marker.draft_id != *expected_draft_id || marker.published_generation == 0 {
        return Err(WorkspaceError::CorruptDraft("finalized marker identity/generation is invalid".into()));
    }
    Ok(())
}

fn ensure_not_tombstoned(dir: &Path, expected_draft_id: &Id) -> Result<(), WorkspaceError> {
    let abandoned = dir.join("abandoned.json");
    let finalized = dir.join("finalized.json");
    let has_abandoned = path_exists_nofollow(&abandoned)?;
    let has_finalized = path_exists_nofollow(&finalized)?;
    if has_abandoned && has_finalized { return Err(WorkspaceError::IsolationViolation); }
    if has_abandoned {
        let marker: AbandonedMarker = read_json(&abandoned)?;
        validate_abandoned_marker(&marker, expected_draft_id)?;
        return Err(WorkspaceError::DraftAbandoned);
    }
    if has_finalized {
        let marker: FinalizedWorkspaceReceipt = read_json(&finalized)?;
        validate_finalized_marker(&marker, expected_draft_id)?;
        return Err(WorkspaceError::DraftFinalized { operation_id: marker.operation_id, receipt_id: marker.receipt_id, published_generation: marker.published_generation });
    }
    Ok(())
}

fn validate_ready_proof(proof: &MaterializationReadyProof) -> Result<(), WorkspaceError> {
    if proof.receipt_generation == 0
        || proof.job_generation == 0
        || proof.published_generation < proof.receipt_generation
        || proof.job_generation != proof.published_generation
        || proof.active_manifest_generation != proof.published_generation
        || proof.job_output_sha256 != proof.active_manifest_sha256
        || !is_sha256(&proof.receipt_payload_sha256)
        || !is_sha256(&proof.job_output_sha256)
    {
        return Err(WorkspaceError::ReceiptExistsOrUnknown);
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool { false }

fn sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(unix)]
fn sync_parent_if_supported(path: &Path) -> Result<(), WorkspaceError> {
    File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(windows)]
fn sync_parent_if_supported(_path: &Path) -> Result<(), WorkspaceError> {
    // std::fs does not expose a portable directory-flush guarantee on Windows.
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn sync_parent_if_supported(_path: &Path) -> Result<(), WorkspaceError> { Ok(()) }

