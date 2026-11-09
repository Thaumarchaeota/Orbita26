use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::finance_v2_domain::{
    AccountKind, Amount, FactStatus, Id, L0Fact, LedgerSnapshot, MemberRevision, Provenance, Quantity, Treatment,
};

use super::{
    candidates::Candidate,
    draft::{DraftCommitState, DraftOperation, DraftSnapshot, LedgerIdentity, WorkspaceError},
    ObservationValue, ParsedObservation,
};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
pub enum EndpointSign { Positive, Negative }

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
pub struct VectorKey {
    pub account_id: Id,
    pub sign: EndpointSign,
    pub commodity: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RefinementSource {
    pub artifact_id: Id,
    pub locator: String,
    pub occurrence_discriminator: String,
    pub account_id: Id,
    pub signed_quantity: Quantity,
    pub sign: EndpointSign,
    pub role: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EvidencePiece {
    pub child_id: Id,
    pub child_revision: u64,
    pub sign: EndpointSign,
    pub allocated: Quantity,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EvidenceAllocation {
    pub source: RefinementSource,
    pub pieces: Vec<EvidencePiece>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum TreatmentResolution {
    Replace { old_treatment_id: Id, old_revision: u64, replacement: Treatment },
    Dissolve { old_treatment_id: Id, old_revision: u64, resulting_treatments: Vec<Treatment> },
}

impl TreatmentResolution {
    fn old_ref(&self) -> (&Id, u64) {
        match self { Self::Replace { old_treatment_id, old_revision, .. } | Self::Dissolve { old_treatment_id, old_revision, .. } => (old_treatment_id, *old_revision) }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RefinementInput {
    pub parent_id: Id,
    pub parent_revision: u64,
    pub children: Vec<L0Fact>,
    pub evidence_allocations: Vec<EvidenceAllocation>,
    pub treatment_resolutions: Vec<TreatmentResolution>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RefinementIntent {
    pub intent_id: Id,
    pub base_generation: u64,
    pub parent: MemberRevision,
    pub children: Vec<L0Fact>,
    pub evidence_allocations: Vec<EvidenceAllocation>,
    pub treatment_resolutions: Vec<TreatmentResolution>,
    pub dependency_accounts: Vec<(Id, u64)>,
    pub dependency_vias: Vec<(Id, u64)>,
}

impl RefinementIntent {
    pub fn validate_against(&self, base: &LedgerSnapshot) -> Result<(), WorkspaceError> {
        if base.generation != self.base_generation { return Err(WorkspaceError::InvalidRefinement("ledger generation changed".into())); }
        let parent = base.active_leaf_facts.iter().find(|f| f.id == self.parent.l0_id && f.revision == self.parent.revision && f.status == FactStatus::Active)
            .ok_or_else(|| WorkspaceError::InvalidRefinement("parent is missing, stale, or not an active leaf".into()))?;
        if self.children.is_empty() { return Err(WorkspaceError::InvalidRefinement("refinement needs at least one child".into())); }
        let mut child_ids = BTreeSet::new();
        for child in &self.children {
            child.validate().map_err(|_| WorkspaceError::InvalidRefinement("child violates E0 L0 invariants".into()))?;
            if matches!(&child.provenance, Provenance::Imported { evidence_ids } if !evidence_ids.is_empty()) {
                return Err(WorkspaceError::InvalidRefinement("E3 must not fabricate Imported evidence IDs; E5 resolves occurrence links during commit".into()));
            }
            if child.revision != 1 || child.status != FactStatus::Active || child.id == parent.id || !child_ids.insert(child.id.clone())
                || base.active_leaf_facts.iter().any(|f| f.id == child.id)
            { return Err(WorkspaceError::InvalidRefinement("child identity/revision/status is invalid or already used".into())); }
        }
        validate_vector_closure(parent, &self.children)?;
        validate_evidence_allocations(&self.evidence_allocations, &self.children)?;
        validate_treatments(parent, &self.children, &self.treatment_resolutions, base)?;
        let proposed = proposed_refinement_snapshot(self, base)?;
        crate::finance_v2_projection::project_ledger(&proposed)
            .map_err(|error| WorkspaceError::InvalidRefinement(format!("proposed owner/refund graph rejected: {error:?}")))?;
        let mut accounts = BTreeMap::new();
        let mut vias = BTreeMap::new();
        for child in &self.children {
            for id in [&child.positive_account_id, &child.negative_account_id] {
                let account = base.accounts.iter().find(|a| a.id == *id && a.active)
                    .ok_or_else(|| WorkspaceError::InvalidRefinement("child references inactive or absent Account".into()))?;
                accounts.insert(account.id.clone(), account.revision);
            }
            if let Some(via_id) = &child.via_id {
                let via = base.vias.iter().find(|v| v.id == *via_id && v.active)
                    .ok_or_else(|| WorkspaceError::InvalidRefinement("child references inactive or absent Via".into()))?;
                vias.insert(via.id.clone(), via.revision);
            }
        }
        if accounts.into_iter().collect::<Vec<_>>() != self.dependency_accounts {
            return Err(WorkspaceError::InvalidRefinement("dependency revision list is incomplete or stale".into()));
        }
        if vias.into_iter().collect::<Vec<_>>() != self.dependency_vias {
            return Err(WorkspaceError::InvalidRefinement("Via dependency revision list is incomplete or stale".into()));
        }
        Ok(())
    }
}

fn proposed_refinement_snapshot(intent: &RefinementIntent, base: &LedgerSnapshot) -> Result<LedgerSnapshot, WorkspaceError> {
    let mut proposed = base.clone();
    proposed.active_leaf_facts.retain(|fact| fact.id != intent.parent.l0_id);
    proposed.active_leaf_facts.extend(intent.children.iter().cloned());
    for resolution in &intent.treatment_resolutions {
        let (old_id, old_revision) = resolution.old_ref();
        let old_index = proposed.current_treatments.iter().position(|treatment| treatment.id == *old_id && treatment.revision == old_revision)
            .ok_or_else(|| WorkspaceError::UnresolvedTreatment(old_id.clone()))?;
        proposed.current_treatments.remove(old_index);
        match resolution {
            TreatmentResolution::Replace { replacement, .. } => proposed.current_treatments.push(replacement.clone()),
            TreatmentResolution::Dissolve { resulting_treatments, .. } => proposed.current_treatments.extend(resulting_treatments.iter().cloned()),
        }
    }
    Ok(proposed)
}

pub fn build_refinement_intent(input: RefinementInput, base: &LedgerSnapshot) -> Result<RefinementIntent, WorkspaceError> {
    let parent = base.active_leaf_facts.iter().find(|f| f.id == input.parent_id && f.revision == input.parent_revision && f.status == FactStatus::Active)
        .ok_or_else(|| WorkspaceError::InvalidRefinement("parent is missing, stale, or not an active leaf".into()))?;
    let mut dependencies = BTreeMap::new();
    let mut via_dependencies = BTreeMap::new();
    for child in &input.children {
        for id in [&child.positive_account_id, &child.negative_account_id] {
            let account = base.accounts.iter().find(|a| a.id == *id && a.active)
                .ok_or_else(|| WorkspaceError::InvalidRefinement("child references inactive or absent Account".into()))?;
            dependencies.insert(account.id.clone(), account.revision);
        }
        if let Some(via_id) = &child.via_id {
            let via = base.vias.iter().find(|v| v.id == *via_id && v.active)
                .ok_or_else(|| WorkspaceError::InvalidRefinement("child references inactive or absent Via".into()))?;
            via_dependencies.insert(via.id.clone(), via.revision);
        }
    }
    let intent = RefinementIntent {
        intent_id: Id::new(), base_generation: base.generation,
        parent: MemberRevision { l0_id: parent.id.clone(), revision: parent.revision },
        children: input.children, evidence_allocations: input.evidence_allocations,
        treatment_resolutions: input.treatment_resolutions,
        dependency_accounts: dependencies.into_iter().collect(),
        dependency_vias: via_dependencies.into_iter().collect(),
    };
    intent.validate_against(base)?;
    Ok(intent)
}

pub fn add_refinement_to_draft(draft: &mut DraftSnapshot, intent: RefinementIntent, base: &LedgerSnapshot) -> Result<Id, WorkspaceError> {
    if draft.abandoned || !matches!(draft.commit_state, DraftCommitState::Unprepared) { return Err(WorkspaceError::DraftNotEditable); }
    intent.validate_against(base)?;
    let mut source_item_ids = BTreeSet::new();
    for allocation in &intent.evidence_allocations {
        let observation = draft.fixed_parse.observations.iter().find(|o| {
            o.artifact_id == allocation.source.artifact_id
                && o.locator == allocation.source.locator
                && o.occurrence_discriminator == allocation.source.occurrence_discriminator
        }).ok_or_else(|| WorkspaceError::InvalidRefinement("evidence allocation does not refer to frozen source observation".into()))?;
        if let Some(item) = draft.items.iter().find(|item| item.observation_index < draft.fixed_parse.observations.len()
            && draft.fixed_parse.observations[item.observation_index] == *observation) { source_item_ids.insert(item.item_id.clone()); }
        else { return Err(WorkspaceError::InvalidRefinement("source occurrence has no workspace item".into())); }
        let matches_frozen_value = observation.fields.iter().any(|field| {
            field.role == allocation.source.role
                && field.binding.as_ref().and_then(|b| b.account_id.as_ref()) == Some(&allocation.source.account_id)
                && matches!(&field.value, ObservationValue::SignedQuantity(q)
                    if q.commodity == allocation.source.signed_quantity.commodity
                        && q.amount.exact_cmp(allocation.source.signed_quantity.amount).ok() == Some(std::cmp::Ordering::Equal))
        });
        if !matches_frozen_value { return Err(WorkspaceError::InvalidRefinement("evidence allocation differs from frozen observed Account/quantity/role".into())); }
        if draft.intents.iter().filter_map(|existing| match &existing.payload {
            super::WorkspaceIntentPayload::Refinement(old) => Some(old), _ => None,
        }).flat_map(|existing| &existing.evidence_allocations).any(|old| {
            old.source.artifact_id == allocation.source.artifact_id && old.source.locator == allocation.source.locator
                && old.source.occurrence_discriminator == allocation.source.occurrence_discriminator
                && old.source.account_id == allocation.source.account_id && old.source.role == allocation.source.role
        }) {
            return Err(WorkspaceError::InvalidRefinement("source occurrence/account/role already allocated by another intent".into()));
        }
    }
    draft.stage_intent(super::WorkspaceIntentPayload::Refinement(intent), source_item_ids.into_iter().collect(), base)
}

/// UI/backend entry point: accepts E0 child facts plus source-occurrence
/// allocations, derives dependency revisions, validates the full graph, and
/// stages the resulting intent atomically in the draft.
pub fn stage_refinement_from_input(draft: &mut DraftSnapshot, input: RefinementInput, base: &LedgerSnapshot) -> Result<Id, WorkspaceError> {
    let intent = build_refinement_intent(input, base)?;
    add_refinement_to_draft(draft, intent, base)
}

fn validate_vector_closure(parent: &L0Fact, children: &[L0Fact]) -> Result<(), WorkspaceError> {
    let expected = fact_vector(parent);
    let mut actual = BTreeMap::new();
    for child in children {
        for (key, amount) in fact_vector(child) {
            let old = actual.get(&key).copied().unwrap_or(Amount::new(0, 0).map_err(|_| WorkspaceError::InvalidRefinement("zero construction failed".into()))?);
            actual.insert(key, old.checked_add(amount).map_err(|_| WorkspaceError::InvalidRefinement("refinement vector overflow".into()))?);
        }
    }
    if expected != actual { return Err(WorkspaceError::InvalidRefinement("child Account/sign/commodity vector does not exactly close parent".into())); }
    Ok(())
}

fn fact_vector(fact: &L0Fact) -> BTreeMap<VectorKey, Amount> {
    BTreeMap::from([
        (VectorKey { account_id: fact.positive_account_id.clone(), sign: EndpointSign::Positive, commodity: fact.positive.commodity.as_str().to_owned() }, fact.positive.amount),
        (VectorKey { account_id: fact.negative_account_id.clone(), sign: EndpointSign::Negative, commodity: fact.negative.commodity.as_str().to_owned() }, fact.negative.amount),
    ])
}

fn validate_evidence_allocations(allocations: &[EvidenceAllocation], children: &[L0Fact]) -> Result<(), WorkspaceError> {
    let mut grouped: BTreeMap<(Id, String, String, Id, EndpointSign, String), (Amount, Amount)> = BTreeMap::new();
    let mut allocated_totals: BTreeMap<(Id, Id, EndpointSign, String), Amount> = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for allocation in allocations {
        if allocation.source.locator.trim().is_empty()
            || allocation.source.occurrence_discriminator.trim().is_empty() || allocation.source.role.trim().is_empty()
            || allocation.source.signed_quantity.amount.is_zero() || allocation.pieces.is_empty()
        { return Err(WorkspaceError::InvalidRefinement("invalid evidence allocation group".into())); }
        let is_negative = allocation.source.signed_quantity.amount.is_negative();
        let sign = if is_negative { EndpointSign::Negative } else { EndpointSign::Positive };
        if allocation.source.sign != sign { return Err(WorkspaceError::InvalidRefinement("evidence source sign disagrees with signed quantity".into())); }
        let magnitude = if is_negative { allocation.source.signed_quantity.amount.checked_neg() } else { Ok(allocation.source.signed_quantity.amount) }
            .map_err(|_| WorkspaceError::InvalidRefinement("source allocation amount overflow".into()))?;
        let key = (allocation.source.artifact_id.clone(), allocation.source.locator.clone(), allocation.source.occurrence_discriminator.clone(), allocation.source.account_id.clone(), sign, allocation.source.signed_quantity.commodity.as_str().to_owned());
        let mut sum = Amount::new(0, 0).map_err(|_| WorkspaceError::InvalidRefinement("zero construction failed".into()))?;
        for piece in &allocation.pieces {
            if piece.allocated.commodity != allocation.source.signed_quantity.commodity || !piece.allocated.amount.is_positive()
                || piece.sign != sign
                || !seen.insert((key.clone(), piece.child_id.clone()))
            { return Err(WorkspaceError::InvalidRefinement("evidence allocation has wrong commodity, sign, or duplicate child".into())); }
            let child = children.iter().find(|c| c.id == piece.child_id && c.revision == piece.child_revision)
                .ok_or_else(|| WorkspaceError::InvalidRefinement("allocation points outside this child spectrum".into()))?;
            let child_side = match sign {
                EndpointSign::Positive if child.positive_account_id == allocation.source.account_id => Some(&child.positive),
                EndpointSign::Negative if child.negative_account_id == allocation.source.account_id => Some(&child.negative),
                _ => None,
            }.ok_or_else(|| WorkspaceError::InvalidRefinement("allocation Account/sign does not match child".into()))?;
            let allocation_cmp = child_side.amount.exact_cmp(piece.allocated.amount)
                .map_err(|_| WorkspaceError::InvalidRefinement("cannot exactly compare allocation to child endpoint".into()))?;
            if child_side.commodity != piece.allocated.commodity || allocation_cmp == std::cmp::Ordering::Less {
                return Err(WorkspaceError::InvalidRefinement("allocation exceeds or differs from child endpoint commodity".into()));
            }
            sum = sum.checked_add(piece.allocated.amount).map_err(|_| WorkspaceError::InvalidRefinement("allocation sum overflow".into()))?;
            let alloc_key = (piece.child_id.clone(), allocation.source.account_id.clone(), sign, piece.allocated.commodity.as_str().to_owned());
            let previous = allocated_totals.get(&alloc_key).copied().unwrap_or(Amount::new(0, 0).map_err(|_| WorkspaceError::InvalidRefinement("zero construction failed".into()))?);
            allocated_totals.insert(alloc_key, previous.checked_add(piece.allocated.amount).map_err(|_| WorkspaceError::InvalidRefinement("aggregate evidence allocation overflow".into()))?);
        }
        if grouped.insert(key, (magnitude, sum)).is_some() {
            return Err(WorkspaceError::InvalidRefinement("same occurrence/account/sign/commodity allocation is split across groups".into()));
        }
    }
    if grouped.values().any(|(expected, actual)| expected.exact_cmp(*actual).ok() != Some(std::cmp::Ordering::Equal)) {
        return Err(WorkspaceError::InvalidRefinement("evidence allocation pieces do not exactly close source quantity".into()));
    }
    for ((child_id, account_id, sign, commodity), allocated) in allocated_totals {
        let child = children.iter().find(|c| c.id == child_id).ok_or_else(|| WorkspaceError::InvalidRefinement("allocation child missing".into()))?;
        let actual = match sign {
            EndpointSign::Positive if child.positive_account_id == account_id && child.positive.commodity.as_str() == commodity => child.positive.amount,
            EndpointSign::Negative if child.negative_account_id == account_id && child.negative.commodity.as_str() == commodity => child.negative.amount,
            _ => return Err(WorkspaceError::InvalidRefinement("aggregated evidence vector does not match child endpoint".into())),
        };
        let allocation_cmp = allocated.exact_cmp(actual)
            .map_err(|_| WorkspaceError::InvalidRefinement("cannot exactly compare aggregate allocation to child endpoint".into()))?;
        if allocation_cmp == std::cmp::Ordering::Greater {
            return Err(WorkspaceError::InvalidRefinement("evidence over-allocates child endpoint".into()));
        }
    }
    Ok(())
}

fn validate_treatments(parent: &L0Fact, children: &[L0Fact], resolutions: &[TreatmentResolution], base: &LedgerSnapshot) -> Result<(), WorkspaceError> {
    let affected = base.current_treatments.iter().filter(|t| t.members.iter().any(|m| m.l0_id == parent.id && m.revision == parent.revision)).collect::<Vec<_>>();
    let mut resolved = BTreeSet::new();
    let child_refs = children.iter().map(|c| MemberRevision { l0_id: c.id.clone(), revision: c.revision }).collect::<Vec<_>>();
    for resolution in resolutions {
        let (old_id, old_revision) = resolution.old_ref();
        let old = affected.iter().find(|t| t.id == *old_id && t.revision == old_revision)
            .ok_or_else(|| WorkspaceError::UnresolvedTreatment(old_id.clone()))?;
        if !resolved.insert(old.id.clone()) { return Err(WorkspaceError::UnresolvedTreatment(old.id.clone())); }
        let (replacements, replacing_old): (&[Treatment], bool) = match resolution {
            TreatmentResolution::Replace { replacement, .. } => (std::slice::from_ref(replacement), true),
            TreatmentResolution::Dissolve { resulting_treatments, .. } => (resulting_treatments, false),
        };
        for treatment in replacements {
            let id_revision_valid = if replacing_old {
                old.revision.checked_add(1) == Some(treatment.revision) && treatment.id == old.id
            } else {
                treatment.revision == 1 && treatment.id != old.id
                    && !base.current_treatments.iter().any(|existing| existing.id == treatment.id)
            };
            if !id_revision_valid || treatment.members.is_empty()
                || treatment.members.iter().any(|m| m.l0_id == parent.id)
            { return Err(WorkspaceError::UnresolvedTreatment(old.id.clone())); }
            let mut members = BTreeSet::new();
            for member in &treatment.members {
                if !members.insert((member.l0_id.clone(), member.revision)) { return Err(WorkspaceError::UnresolvedTreatment(old.id.clone())); }
                let exists = child_refs.iter().any(|r| r == member)
                    || base.active_leaf_facts.iter().any(|f| f.id == member.l0_id && f.revision == member.revision && f.id != parent.id);
                if !exists { return Err(WorkspaceError::UnresolvedTreatment(old.id.clone())); }
            }
            if !treatment.members.iter().any(|m| m.l0_id == treatment.owner_l0_id) { return Err(WorkspaceError::UnresolvedTreatment(old.id.clone())); }
            for group in &treatment.merge_groups {
                if group.members.len() < 2 || group.members.iter().any(|m| !members.contains(&(m.l0_id.clone(), m.revision))) {
                    return Err(WorkspaceError::UnresolvedTreatment(old.id.clone()));
                }
            }
            for edge in &treatment.refund_edges {
                if edge.refund == edge.payment || !members.contains(&(edge.refund.l0_id.clone(), edge.refund.revision))
                    || !members.contains(&(edge.payment.l0_id.clone(), edge.payment.revision)) || !edge.amount.amount.is_positive()
                { return Err(WorkspaceError::UnresolvedTreatment(old.id.clone())); }
            }
        }
    }
    if resolved.len() != affected.len() { return Err(WorkspaceError::UnresolvedTreatment(affected.iter().find(|t| !resolved.contains(&t.id)).map(|t| t.id.clone()).unwrap_or_else(Id::new))); }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DraftCommitPlan {
    pub ledger_identity: LedgerIdentity,
    pub ledger_generation: u64,
    pub source_context_id: Option<Id>,
    pub source_context_revision: Option<u64>,
    pub source_context_provider: Option<String>,
    pub account_via_mapping_revision: u64,
    pub dependency_account_via_bindings: Vec<super::CapturedAccountViaBinding>,
    pub draft_id: Id,
    pub draft_revision: u64,
    pub durable_revision: u64,
    pub required_durable_revision: u64,
    pub operation_id: Id,
    pub payload_sha256: String,
    pub confirmed_candidate_keys: Vec<String>,
    pub confirmed_intents: Vec<super::WorkspaceIntent>,
    pub prospective_amend_plan: ProspectiveAmendPlan,
    pub fixed_parse: Vec<ParsedObservation>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProspectiveRefundVersion {
    pub expected: MemberRevision,
    pub fact: L0Fact,
    pub manual_change: super::ManualChange,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProspectiveTreatmentVersion {
    pub treatment_id: Id,
    pub expected_revision: u64,
    pub treatment: Treatment,
    pub manual_changes: Vec<super::ManualChange>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProspectiveAmendPlan {
    pub ledger_generation: u64,
    pub fact_dependencies: Vec<MemberRevision>,
    pub treatment_dependencies: Vec<(Id, u64)>,
    pub refund_versions: Vec<ProspectiveRefundVersion>,
    pub treatment_versions: Vec<ProspectiveTreatmentVersion>,
}

/// Expands a staged payment Expense-account amendment into one atomic cascade
/// for every current refund edge. E5 persists all returned versions with CAS.
pub fn prospective_amend_plan(draft: &DraftSnapshot, base: &LedgerSnapshot) -> Result<ProspectiveAmendPlan, WorkspaceError> {
    if draft.base_ledger_generation != base.generation { return Err(WorkspaceError::StaleCandidate); }
    let mut amended_payments = BTreeMap::<(Id, u64), (L0Fact, super::ManualChange)>::new();
    for intent in draft.intents.iter().filter(|intent| intent.explicitly_staged && !intent.undone) {
        if let super::WorkspaceIntentPayload::Fact(super::FactMutation::Amend { expected, fact, manual_change }) = &intent.payload {
            if manual_change.reason.trim().is_empty() || fact.validate().is_err() || expected.l0_id != fact.id
                || expected.revision.checked_add(1) != Some(fact.revision) {
                return Err(WorkspaceError::InvalidRefinement("invalid payment amendment or missing manual change reason".into()));
            }
            let old = base.active_leaf_facts.iter().find(|old| old.id == expected.l0_id && old.revision == expected.revision)
                .ok_or(WorkspaceError::StaleCandidate)?;
            if old.provenance != fact.provenance { return Err(WorkspaceError::InvalidRefinement("amendment must preserve original provenance".into())); }
            let old_is_expense = base.accounts.iter().any(|account| account.id == old.positive_account_id && account.kind == AccountKind::Expenses);
            let new_is_expense = base.accounts.iter().any(|account| account.id == fact.positive_account_id && account.kind == AccountKind::Expenses && account.active);
            if old_is_expense && old.positive_account_id != fact.positive_account_id {
                if !new_is_expense { return Err(WorkspaceError::InvalidRefinement("amended payment endpoint must be an active Expenses account".into())); }
                if amended_payments.insert((expected.l0_id.clone(), expected.revision), (fact.clone(), manual_change.clone())).is_some() {
                    return Err(WorkspaceError::InvalidRefinement("payment has multiple staged amendments".into()));
                }
            }
        }
    }
    // An empty cascade has no prospective graph to validate. In particular, a
    // fresh schema's generation-zero snapshot is valid input to the first
    // staged Create, while E4 correctly refuses to project generation zero.
    if amended_payments.is_empty() {
        return Ok(ProspectiveAmendPlan {
            ledger_generation: base.generation,
            fact_dependencies: Vec::new(),
            treatment_dependencies: Vec::new(),
            refund_versions: Vec::new(),
            treatment_versions: Vec::new(),
        });
    }
    let mut plan = ProspectiveAmendPlan { ledger_generation: base.generation, fact_dependencies: Vec::new(),
        treatment_dependencies: Vec::new(), refund_versions: Vec::new(), treatment_versions: Vec::new() };
    let mut revision_map = BTreeMap::<(Id, u64), u64>::new();
    let mut refund_targets = BTreeMap::<(Id, u64), Id>::new();
    let mut affected_treatment_ids = BTreeSet::new();
    let mut treatment_manual_changes = BTreeMap::<Id, Vec<super::ManualChange>>::new();
    for treatment in &base.current_treatments {
        for edge in &treatment.refund_edges {
            let Some((payment, manual_change)) = amended_payments.get(&(edge.payment.l0_id.clone(), edge.payment.revision)) else { continue; };
            let old_refund = base.active_leaf_facts.iter().find(|fact| fact.id == edge.refund.l0_id && fact.revision == edge.refund.revision)
                .ok_or(WorkspaceError::StaleCandidate)?;
            if old_refund.status != FactStatus::Active || old_refund.negative_account_id != amended_payments_payment_expense(base, &edge.payment)? {
                return Err(WorkspaceError::InvalidRefinement("refund edge does not resolve to the payment Expense endpoint".into()));
            }
            let refund_key = (old_refund.id.clone(), old_refund.revision);
            if let Some(target) = refund_targets.get(&refund_key) {
                if target != &payment.positive_account_id {
                    return Err(WorkspaceError::InvalidRefinement("one refund is linked to payments with conflicting amended Expenses accounts".into()));
                }
            } else { refund_targets.insert(refund_key.clone(), payment.positive_account_id.clone()); }
            if let Some(previous) = revision_map.get(&(old_refund.id.clone(), old_refund.revision)) {
                if *previous != old_refund.revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)? {
                    return Err(WorkspaceError::InvalidRefinement("refund is linked to conflicting payment amendments".into()));
                }
            } else {
                if draft.intents.iter().any(|intent| intent.explicitly_staged && !intent.undone && matches!(
                    &intent.payload, super::WorkspaceIntentPayload::Fact(super::FactMutation::Amend { expected, .. })
                    if expected.l0_id == old_refund.id && expected.revision == old_refund.revision)) {
                    return Err(WorkspaceError::InvalidRefinement("refund is also explicitly amended; stage one coherent cascade".into()));
                }
                let mut fact = old_refund.clone();
                fact.revision = fact.revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
                fact.negative_account_id = payment.positive_account_id.clone();
                fact.validate().map_err(|error| WorkspaceError::InvalidRefinement(format!("cascaded refund is invalid: {error:?}")))?;
                plan.fact_dependencies.push(MemberRevision { l0_id: old_refund.id.clone(), revision: old_refund.revision });
                revision_map.insert((old_refund.id.clone(), old_refund.revision), fact.revision);
                plan.refund_versions.push(ProspectiveRefundVersion { expected: MemberRevision { l0_id: old_refund.id.clone(), revision: old_refund.revision }, fact, manual_change: manual_change.clone() });
            }
            plan.fact_dependencies.push(edge.payment.clone());
            affected_treatment_ids.insert(treatment.id.clone());
            let audit = treatment_manual_changes.entry(treatment.id.clone()).or_default();
            if !audit.contains(manual_change) { audit.push(manual_change.clone()); }
        }
    }
    for treatment in &base.current_treatments {
        if !affected_treatment_ids.contains(&treatment.id) { continue; }
        let mut amended = treatment.clone();
        amended.revision = amended.revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
        for member in &mut amended.members {
            if let Some(revision) = revision_map.get(&(member.l0_id.clone(), member.revision)) { member.revision = *revision; }
            else if amended_payments.contains_key(&(member.l0_id.clone(), member.revision)) {
                member.revision = member.revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
            }
        }
        for group in &mut amended.merge_groups { for member in &mut group.members {
            if let Some(revision) = revision_map.get(&(member.l0_id.clone(), member.revision)) { member.revision = *revision; }
            else if amended_payments.contains_key(&(member.l0_id.clone(), member.revision)) { member.revision = member.revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?; }
        }}
        for edge in &mut amended.refund_edges {
            if let Some(revision) = revision_map.get(&(edge.refund.l0_id.clone(), edge.refund.revision)) { edge.refund.revision = *revision; }
            if amended_payments.contains_key(&(edge.payment.l0_id.clone(), edge.payment.revision)) { edge.payment.revision = edge.payment.revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?; }
        }
        plan.treatment_dependencies.push((treatment.id.clone(), treatment.revision));
        plan.treatment_versions.push(ProspectiveTreatmentVersion { treatment_id: treatment.id.clone(), expected_revision: treatment.revision,
            treatment: amended, manual_changes: treatment_manual_changes.remove(&treatment.id).unwrap_or_default() });
    }
    plan.fact_dependencies.sort_by(|a,b| a.l0_id.cmp(&b.l0_id).then(a.revision.cmp(&b.revision)));
    plan.fact_dependencies.dedup_by(|a,b| a.l0_id == b.l0_id && a.revision == b.revision);
    plan.treatment_dependencies.sort();
    let mut proposed = base.clone();
    for (expected, (fact, _)) in &amended_payments {
        if let Some(existing) = proposed.active_leaf_facts.iter_mut().find(|current| current.id == expected.0 && current.revision == expected.1) { *existing = fact.clone(); }
    }
    for version in &plan.refund_versions {
        if let Some(existing) = proposed.active_leaf_facts.iter_mut().find(|current| current.id == version.expected.l0_id && current.revision == version.expected.revision) { *existing = version.fact.clone(); }
    }
    for version in &plan.treatment_versions {
        if let Some(existing) = proposed.current_treatments.iter_mut().find(|current| current.id == version.treatment_id && current.revision == version.expected_revision) { *existing = version.treatment.clone(); }
    }
    crate::finance_v2_projection::project_ledger(&proposed)
        .map_err(|error| WorkspaceError::InvalidRefinement(format!("prospective payment/refund graph is invalid: {error:?}")))?;
    Ok(plan)
}

fn amended_payments_payment_expense(base: &LedgerSnapshot, payment: &MemberRevision) -> Result<Id, WorkspaceError> {
    base.active_leaf_facts.iter().find(|fact| fact.id == payment.l0_id && fact.revision == payment.revision)
        .map(|fact| fact.positive_account_id.clone()).ok_or(WorkspaceError::StaleCandidate)
}

pub fn prepare_commit_plan(draft: &mut DraftSnapshot, base: &LedgerSnapshot) -> Result<DraftCommitPlan, WorkspaceError> {
    draft.validate()?;
    if draft.abandoned || draft.durable_revision != draft.draft_revision { return Err(WorkspaceError::DraftNotEditable); }
    if draft.import_cancelled { return Err(WorkspaceError::ImportCancelled); }
    if draft.base_ledger_generation != base.generation { return Err(WorkspaceError::InvalidRefinement("ledger generation changed".into())); }
    if matches!(draft.commit_state, DraftCommitState::Committed { .. }) { return Err(WorkspaceError::DraftNotEditable); }
    let mut confirmed = Vec::new();
    for candidate in &draft.candidates {
        if candidate.confirmed {
            if candidate.stale || candidate.dependency.ledger_generation != base.generation || !candidate_matches(candidate, base) {
                return Err(WorkspaceError::StaleCandidate);
            }
            confirmed.push(candidate.key.clone());
        }
    }
    confirmed.sort();
    let read_model = super::draft::read_workspace(draft, base);
    if let Some(blocked) = read_model.right_preview.iter().find(|row| row.confirmed && !row.blocking_reasons.is_empty()) {
        return Err(WorkspaceError::InvalidRefinement(format!("intent {} blocked: {}", blocked.intent_id, blocked.blocking_reasons.join("; "))));
    }
    let confirmed_intents = draft.intents.iter().filter(|intent| intent.explicitly_staged && !intent.undone).cloned().collect::<Vec<_>>();
    for observation in &draft.fixed_parse.observations { observation.validate()?; }
    let mut used_pairs = BTreeSet::new();
    for observation in &draft.fixed_parse.observations {
        for field in &observation.fields {
            if let Some(binding) = &field.binding {
                if let (Some(account_id), Some(via_id)) = (&binding.account_id, &binding.via_id) {
                    used_pairs.insert((account_id.clone(), via_id.clone()));
                }
            }
        }
    }
    for item in &draft.items {
        if let Some(binding) = &item.category {
            if let (Some(account_id), Some(via_id)) = (&binding.account_id, &binding.via_id) {
                used_pairs.insert((account_id.clone(), via_id.clone()));
            }
        }
    }
    let dependency_account_via_bindings = draft.fixed_parse.captured_account_via_bindings.iter()
        .filter(|binding| used_pairs.contains(&(binding.account_id.clone(), binding.via_id.clone())))
        .cloned().collect::<Vec<_>>();
    let source_draft_revision = draft.draft_revision;
    let prospective_amend_plan = prospective_amend_plan(draft, base)?;
    let payload = serde_json::to_vec(&(draft.draft_id.clone(), base.generation, confirmed.clone(), confirmed_intents.clone(),
        prospective_amend_plan.clone(), draft.fixed_parse.clone(), draft.items.clone(), draft.unresolved_candidate_observations.clone()))
        .map_err(WorkspaceError::Serialization)?;
    let hash = format!("{:x}", Sha256::digest(payload));
    let operation_id = match &draft.commit_state {
        DraftCommitState::Prepared { operation_id, payload_sha256 } if payload_sha256 == &hash => operation_id.clone(),
        DraftCommitState::Prepared { .. } => return Err(WorkspaceError::InvalidRefinement("prepared payload changed; create a new operation".into())),
        _ => Id::new(),
    };
    if matches!(draft.commit_state, DraftCommitState::Unprepared) {
        draft.append(DraftOperation::CommitPrepared { operation_id: operation_id.clone(), payload_sha256: hash.clone() })?;
        draft.commit_state = DraftCommitState::Prepared { operation_id: operation_id.clone(), payload_sha256: hash.clone() };
    }
    let prepared_revision = draft.draft_revision;
    Ok(DraftCommitPlan { ledger_identity: draft.ledger_identity.clone(), ledger_generation: base.generation,
        source_context_id: draft.fixed_parse.source_context_id.clone(),
        source_context_revision: draft.fixed_parse.source_context_revision,
        source_context_provider: draft.fixed_parse.source_context_provider.clone(),
        account_via_mapping_revision: draft.fixed_parse.account_via_mapping_revision,
        dependency_account_via_bindings,
        draft_id: draft.draft_id.clone(), draft_revision: source_draft_revision, durable_revision: draft.durable_revision,
        required_durable_revision: prepared_revision,
        operation_id, payload_sha256: hash, confirmed_candidate_keys: confirmed,
        confirmed_intents, prospective_amend_plan, fixed_parse: draft.fixed_parse.observations.clone() })
}

pub fn record_commit_receipt(draft: &mut DraftSnapshot, operation_id: &Id, receipt_id: String) -> Result<(), WorkspaceError> {
    match &draft.commit_state {
        DraftCommitState::Prepared { operation_id: expected, .. } if expected == operation_id => {}
        DraftCommitState::Committed { operation_id: existing, receipt_id: existing_receipt } if existing == operation_id && existing_receipt == &receipt_id => return Ok(()),
        _ => return Err(WorkspaceError::ReceiptExistsOrUnknown),
    }
    if receipt_id.trim().is_empty() { return Err(WorkspaceError::ReceiptExistsOrUnknown); }
    draft.append(DraftOperation::CommitReceipt { operation_id: operation_id.clone(), receipt_id: receipt_id.clone() })?;
    draft.commit_state = DraftCommitState::Committed { operation_id: operation_id.clone(), receipt_id };
    Ok(())
}

fn candidate_matches(candidate: &Candidate, base: &LedgerSnapshot) -> bool {
    candidate.dependency.members.iter().all(|m| base.active_leaf_facts.iter().any(|f| f.id == m.l0_id && f.revision == m.revision))
        && base.accounts.iter().any(|a| a.id == candidate.dependency.account_id && a.revision == candidate.dependency.account_revision && a.active)
        && candidate.dependency.treatment_revisions.iter().all(|(id, rev)| base.current_treatments.iter().any(|t| t.id == *id && t.revision == *rev))
}

