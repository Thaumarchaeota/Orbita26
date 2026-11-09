use std::{cmp::Ordering, collections::BTreeSet};

use serde::{Deserialize, Serialize};

use crate::finance_v2_domain::{Account, Id, L0Fact, LedgerSnapshot, Quantity};

use super::draft::{DraftOperation, DraftSnapshot, WorkspaceError};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DateRole { TransactionDate, PostingDate, StatementDate }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MatchObservation {
    pub artifact_id: Id,
    pub locator: String,
    pub occurrence_discriminator: String,
    pub account_id: Id,
    /// Signed source-side quantity. Positive means the L0 positive endpoint;
    /// negative means the negative endpoint.
    pub signed_quantity: Quantity,
    pub business_date: crate::finance_v2_domain::BusinessDate,
    pub date_role: DateRole,
    pub source_role: String,
    pub intent_role: super::EvidenceIntentRole,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ConfirmedOccurrence {
    pub artifact_id: Id,
    pub locator: String,
    pub occurrence_discriminator: String,
    pub account_id: Id,
    pub source_role: String,
}

#[derive(Clone, Debug)]
pub struct CandidateInput<'a> {
    pub observations: &'a [MatchObservation],
    pub ledger: &'a LedgerSnapshot,
    pub confirmed_occurrences: &'a [ConfirmedOccurrence],
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CandidatePolicy {
    pub policy_id: String,
    pub revision: String,
    pub compatible_date_window_days: u32,
    pub max_combination_members: usize,
    pub max_expansion_nodes: usize,
    pub max_returned_candidates: usize,
}

impl CandidatePolicy {
    pub fn validate(&self) -> Result<(), WorkspaceError> {
        if self.policy_id.trim().is_empty() || self.revision.trim().is_empty()
            || self.max_combination_members < 2 || self.max_expansion_nodes == 0
            || self.max_returned_candidates == 0
        { return Err(WorkspaceError::InvalidCandidate("invalid candidate policy".into())); }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum CandidateKind { Direct, Combination }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum CandidateReason {
    SameBusinessDate { observed_date_role: DateRole },
    CompatibleDateWindow { observed_date_role: DateRole, delta_days: u32 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CandidateMember {
    pub l0_id: Id,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CandidateDependency {
    pub ledger_generation: u64,
    pub account_id: Id,
    pub account_revision: u64,
    pub members: Vec<CandidateMember>,
    pub treatment_revisions: Vec<(Id, u64)>,
    pub policy_id: String,
    pub policy_revision: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Candidate {
    /// Stable key derived from exact input occurrence and ordered member IDs.
    pub key: String,
    pub observation: ConfirmedOccurrence,
    pub kind: CandidateKind,
    pub members: Vec<CandidateMember>,
    pub signed_quantity: Quantity,
    pub source_role: String,
    pub intent_role: super::EvidenceIntentRole,
    pub reason: CandidateReason,
    pub dependency: CandidateDependency,
    pub stale: bool,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum Coverage {
    Complete { expansion_nodes: usize },
    BudgetExhausted { expansion_nodes: usize, limit: usize, next_scope: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CandidateResult {
    pub candidates: Vec<Candidate>,
    pub coverage: Coverage,
    pub unresolved_observations: Vec<String>,
    pub algorithm_version: String,
}

pub fn find_candidates(input: &CandidateInput<'_>, policy: &CandidatePolicy) -> Result<CandidateResult, WorkspaceError> {
    policy.validate()?;
    let mut facts = input.ledger.active_leaf_facts.iter().collect::<Vec<_>>();
    facts.sort_by(|a,b| a.id.cmp(&b.id).then(a.revision.cmp(&b.revision)));
    let mut accounts = input.ledger.accounts.iter().collect::<Vec<_>>();
    accounts.sort_by(|a,b| a.id.cmp(&b.id));
    let mut candidates = Vec::new();
    let mut unresolved = Vec::new();
    let mut nodes = 0usize;
    let mut exhausted = false;
    let mut exhaustion_scope = None;
    let mut exhaustion_limit = None;

    for observation in input.observations {
        let occurrence = ConfirmedOccurrence {
            artifact_id: observation.artifact_id.clone(), locator: observation.locator.clone(),
            occurrence_discriminator: observation.occurrence_discriminator.clone(), account_id: observation.account_id.clone(),
            source_role: observation.source_role.clone(),
        };
        if input.confirmed_occurrences.iter().any(|seen| seen == &occurrence) {
            unresolved.push(observation.locator.clone());
            continue;
        }
        if observation.signed_quantity.amount.is_zero() {
            unresolved.push(observation.locator.clone());
            continue;
        }
        let account = match accounts.iter().find(|a| a.id == observation.account_id && a.active) {
            Some(value) => *value,
            None => { unresolved.push(observation.locator.clone()); continue; }
        };
        let negative = observation.signed_quantity.amount.is_negative();
        let magnitude = if negative { observation.signed_quantity.amount.checked_neg().map_err(|_| WorkspaceError::InvalidCandidate("quantity overflow".into()))? } else { observation.signed_quantity.amount };
        let target = Quantity::new(magnitude, observation.signed_quantity.commodity.clone());
        let eligible = facts.iter().copied().filter(|fact| {
            side_quantity(fact, &observation.account_id, negative).is_some_and(|q| q.commodity == target.commodity)
                && date_distance(fact, observation) <= policy.compatible_date_window_days
        }).collect::<Vec<_>>();
        let mut matches = Vec::<(CandidateKind, CandidateReason, Vec<&L0Fact>)>::new();
        for fact in &eligible {
            nodes = nodes.saturating_add(1);
            if nodes > policy.max_expansion_nodes { exhausted = true; exhaustion_scope = Some("combination-expansion".to_owned()); exhaustion_limit = Some(policy.max_expansion_nodes); break; }
            let Some(actual) = side_quantity(fact, &observation.account_id, negative) else { continue; };
            if actual.amount.exact_cmp(target.amount).ok() == Some(Ordering::Equal) {
                matches.push((CandidateKind::Direct, reason(fact, observation), vec![fact]));
            }
        }
        if exhausted { break; }
        let mut chosen = Vec::new();
        search_combinations(
            &eligible, observation, negative, &target, 0, &mut chosen, &mut matches,
            policy.max_combination_members, policy.max_expansion_nodes, &mut nodes, &mut exhausted,
        )?;
        if matches.is_empty() { unresolved.push(observation.locator.clone()); }
        for (kind, why, mut group) in matches {
            if candidates.len() >= policy.max_returned_candidates {
                exhausted = true;
                exhaustion_scope = Some("candidate-return-limit".to_owned());
                exhaustion_limit = Some(policy.max_returned_candidates);
                break;
            }
            group.sort_by(|a,b| a.id.cmp(&b.id));
            let members = group.iter().map(|f| CandidateMember { l0_id: f.id.clone(), revision: f.revision }).collect::<Vec<_>>();
            let treatment_revisions = input.ledger.current_treatments.iter()
                .filter(|t| t.members.iter().any(|m| members.iter().any(|cm| cm.l0_id == m.l0_id && cm.revision == m.revision)))
                .map(|t| (t.id.clone(), t.revision)).collect::<BTreeSet<_>>().into_iter().collect::<Vec<_>>();
            let key = candidate_key(&occurrence, &members);
            candidates.push(Candidate {
                key, observation: occurrence.clone(), kind, members: members.clone(),
                signed_quantity: observation.signed_quantity.clone(), source_role: observation.source_role.clone(), intent_role: observation.intent_role, reason: why,
                dependency: CandidateDependency { ledger_generation: input.ledger.generation, account_id: account.id.clone(),
                    account_revision: account.revision, members, treatment_revisions,
                    policy_id: policy.policy_id.clone(), policy_revision: policy.revision.clone() },
                stale: false, confirmed: false,
            });
        }
        if exhausted { break; }
    }
    candidates.sort_by(|a,b| a.observation.locator.cmp(&b.observation.locator)
        .then((a.kind != CandidateKind::Direct).cmp(&(b.kind != CandidateKind::Direct)))
        .then(a.key.cmp(&b.key)));
    Ok(CandidateResult {
        candidates,
        coverage: if exhausted { Coverage::BudgetExhausted { expansion_nodes: nodes, limit: exhaustion_limit.unwrap_or(policy.max_expansion_nodes), next_scope: exhaustion_scope.unwrap_or_else(|| "combination-expansion".into()) } }
            else { Coverage::Complete { expansion_nodes: nodes } },
        unresolved_observations: unresolved,
        algorithm_version: "finance-v2-candidates/1".into(),
    })
}

pub fn confirm_candidate(
    draft: &mut DraftSnapshot,
    candidate_key: &str,
    current: &LedgerSnapshot,
) -> Result<(), WorkspaceError> {
    if draft.abandoned || !matches!(draft.commit_state, super::draft::DraftCommitState::Unprepared) { return Err(WorkspaceError::DraftNotEditable); }
    if draft.import_cancelled { return Err(WorkspaceError::ImportCancelled); }
    let stale = {
        let candidate = draft.candidates.iter().find(|c| c.key == candidate_key).ok_or(WorkspaceError::InvalidCandidate("unknown candidate".into()))?;
        candidate.stale || candidate.dependency.ledger_generation != current.generation || !dependencies_match(candidate, current)
    };
    if stale {
        if let Some(candidate) = draft.candidates.iter_mut().find(|c| c.key == candidate_key) {
            candidate.stale = true;
            candidate.confirmed = false;
        }
        draft.draft_revision = draft.draft_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
        draft.operations.push(DraftOperation::CandidateInvalidated { candidate_key: candidate_key.to_owned(), reason: "dependency snapshot changed".into() });
        return Err(WorkspaceError::StaleCandidate);
    }
    let (confirmed_key, occurrence, members, source_role, requested_role, signed_quantity) = {
        let candidate = draft.candidates.iter().find(|c| c.key == candidate_key).ok_or(WorkspaceError::InvalidCandidate("unknown candidate".into()))?;
        if candidate.confirmed { return Ok(()); }
        (candidate.key.clone(), candidate.observation.clone(), candidate.members.clone(), candidate.source_role.clone(), candidate.intent_role, candidate.signed_quantity.clone())
    };
    if requested_role == super::EvidenceIntentRole::Refund
        && !members.iter().all(|member| super::draft::refund_relation_resolved(
            &super::MemberRevision { l0_id: member.l0_id.clone(), revision: member.revision }, draft, current)) {
        return Err(WorkspaceError::UnresolvedTreatment(members.first().map(|m| m.l0_id.clone()).ok_or(WorkspaceError::StaleCandidate)?));
    }
    if source_role.trim().is_empty() { return Err(WorkspaceError::InvalidCandidate("frozen source role is missing".into())); }
    let is_negative = signed_quantity.amount.is_negative();
    let item_id = draft.items.iter().find_map(|item| {
        let parsed = draft.fixed_parse.observations.get(item.observation_index)?;
        (parsed.artifact_id == occurrence.artifact_id && parsed.locator == occurrence.locator
            && parsed.occurrence_discriminator == occurrence.occurrence_discriminator)
            .then(|| item.item_id.clone())
    }).ok_or_else(|| WorkspaceError::InvalidCandidate("candidate occurrence has no workspace item".into()))?;
    let grouping_kind = if members.len() > 1 { super::EvidenceGroupingKind::Refinement } else { super::EvidenceGroupingKind::Ordinary };
    let fact_members = members.iter().map(|member| {
        let fact = current.active_leaf_facts.iter().find(|fact| fact.id == member.l0_id && fact.revision == member.revision)
            .ok_or(WorkspaceError::StaleCandidate)?;
        let (sign, allocated) = if !is_negative && fact.positive_account_id == occurrence.account_id { (super::refinement::EndpointSign::Positive, fact.positive.clone()) }
            else if is_negative && fact.negative_account_id == occurrence.account_id { (super::refinement::EndpointSign::Negative, fact.negative.clone()) }
            else { return Err(WorkspaceError::InvalidCandidate("candidate member does not contain observed account".into())); };
        Ok(super::EvidenceMember { member: super::MemberRevision { l0_id: member.l0_id.clone(), revision: member.revision }, sign,
            allocation: (grouping_kind == super::EvidenceGroupingKind::Refinement).then_some(allocated) })
    }).collect::<Result<Vec<_>, WorkspaceError>>()?;
    let artifact_id = occurrence.artifact_id.clone();
    draft.stage_intent(super::WorkspaceIntentPayload::EvidenceMatch(super::EvidenceMatchIntent {
        artifact_id, locator: occurrence.locator.clone(), occurrence_discriminator: occurrence.occurrence_discriminator.clone(),
        observed_account_id: occurrence.account_id.clone(), source_role,
        grouping_kind,
        requires_refund_treatment: requested_role == super::EvidenceIntentRole::Refund,
        signed_quantity,
        sign: if is_negative { super::refinement::EndpointSign::Negative } else { super::refinement::EndpointSign::Positive },
        members: fact_members,
    }), vec![item_id], current)?;
    if let Some(candidate) = draft.candidates.iter_mut().find(|candidate| candidate.key == candidate_key) { candidate.confirmed = true; }
    draft.append(DraftOperation::CandidateConfirmed { candidate_key: confirmed_key })
}

pub fn invalidate_candidates(draft: &mut DraftSnapshot, current: &LedgerSnapshot) -> Result<(), WorkspaceError> {
    if draft.abandoned || !matches!(draft.commit_state, super::draft::DraftCommitState::Unprepared) { return Err(WorkspaceError::DraftNotEditable); }
    let mut invalidated = Vec::new();
    for candidate in &mut draft.candidates {
        if candidate.dependency.ledger_generation != current.generation || !dependencies_match(candidate, current) {
            if !candidate.stale {
                candidate.stale = true;
                candidate.confirmed = false;
                invalidated.push(candidate.key.clone());
            }
        }
    }
    if !invalidated.is_empty() {
        draft.draft_revision = draft.draft_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
        draft.operations.extend(invalidated.into_iter().map(|candidate_key| DraftOperation::CandidateInvalidated { candidate_key, reason: "dependency snapshot changed".into() }));
    }
    Ok(())
}

pub fn update_candidate_set(draft: &mut DraftSnapshot, result: CandidateResult) -> Result<(), WorkspaceError> {
    if draft.abandoned || !matches!(draft.commit_state, super::draft::DraftCommitState::Unprepared) { return Err(WorkspaceError::DraftNotEditable); }
    if draft.import_cancelled { return Err(WorkspaceError::ImportCancelled); }
    draft.candidates = result.candidates;
    draft.candidate_coverage = Some(result.coverage);
    draft.unresolved_candidate_observations = result.unresolved_observations;
    draft.draft_revision = draft.draft_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?;
    Ok(())
}

pub fn invalidate_for_source_change(draft: &mut DraftSnapshot, artifact_id: &Id, locator: &str, occurrence_discriminator: &str, reason: &str) -> Result<(), WorkspaceError> {
    if draft.abandoned || !matches!(draft.commit_state, super::draft::DraftCommitState::Unprepared) { return Err(WorkspaceError::DraftNotEditable); }
    let mut keys = Vec::new();
    for candidate in &mut draft.candidates {
        if candidate.observation.artifact_id == *artifact_id
            && candidate.observation.locator == locator
            && candidate.observation.occurrence_discriminator == occurrence_discriminator
            && !candidate.stale {
            candidate.stale = true;
            candidate.confirmed = false;
            keys.push(candidate.key.clone());
        }
    }
    let changed = !keys.is_empty();
    for key in keys {
        draft.operations.push(DraftOperation::CandidateInvalidated { candidate_key: key, reason: reason.to_owned() });
    }
    if changed { draft.draft_revision = draft.draft_revision.checked_add(1).ok_or(WorkspaceError::RevisionOverflow)?; }
    Ok(())
}

fn dependencies_match(candidate: &Candidate, current: &LedgerSnapshot) -> bool {
    let account = current.accounts.iter().find(|a| a.id == candidate.dependency.account_id && a.active);
    if account.map_or(true, |a| a.revision != candidate.dependency.account_revision) { return false; }
    for member in &candidate.dependency.members {
        if !current.active_leaf_facts.iter().any(|f| f.id == member.l0_id && f.revision == member.revision) { return false; }
    }
    for (id, revision) in &candidate.dependency.treatment_revisions {
        if !current.current_treatments.iter().any(|t| t.id == *id && t.revision == *revision) { return false; }
    }
    true
}

fn search_combinations<'a>(
    facts: &[&'a L0Fact], observation: &MatchObservation, negative: bool, target: &Quantity,
    start: usize, chosen: &mut Vec<&'a L0Fact>, matches: &mut Vec<(CandidateKind, CandidateReason, Vec<&'a L0Fact>)>,
    max_members: usize, max_nodes: usize, nodes: &mut usize, exhausted: &mut bool,
) -> Result<(), WorkspaceError> {
    if *exhausted { return Ok(()); }
    for index in start..facts.len() {
        if chosen.len() >= max_members { continue; }
        *nodes = nodes.saturating_add(1);
        if *nodes > max_nodes { *exhausted = true; return Ok(()); }
        let fact = facts[index];
        let Some(side) = side_quantity(fact, &observation.account_id, negative) else { continue; };
        chosen.push(fact);
        let mut sum = crate::finance_v2_domain::Amount::new(0, 0).map_err(|_| WorkspaceError::InvalidCandidate("zero construction failed".into()))?;
        for member in chosen.iter() {
            sum = sum.checked_add(side_quantity(member, &observation.account_id, negative).ok_or_else(|| WorkspaceError::InvalidCandidate("candidate side changed".into()))?.amount)
                .map_err(|_| WorkspaceError::InvalidCandidate("combination amount overflow".into()))?;
        }
        match sum.exact_cmp(target.amount).map_err(|_| WorkspaceError::InvalidCandidate("amount comparison failed".into()))? {
            Ordering::Equal if chosen.len() >= 2 => matches.push((CandidateKind::Combination, reason(fact, observation), chosen.clone())),
            Ordering::Less if chosen.len() < max_members => search_combinations(facts, observation, negative, target, index + 1, chosen, matches, max_members, max_nodes, nodes, exhausted)?,
            _ => {}
        }
        chosen.pop();
        if *exhausted { return Ok(()); }
    }
    Ok(())
}

fn side_quantity<'a>(fact: &'a L0Fact, account_id: &Id, negative: bool) -> Option<&'a Quantity> {
    if negative {
        (fact.negative_account_id == *account_id).then_some(&fact.negative)
    } else {
        (fact.positive_account_id == *account_id).then_some(&fact.positive)
    }
}

fn date_distance(fact: &L0Fact, observation: &MatchObservation) -> u32 {
    fact.effective_date.as_naive().signed_duration_since(observation.business_date.as_naive()).num_days().unsigned_abs().min(u32::MAX as u64) as u32
}

fn reason(fact: &L0Fact, observation: &MatchObservation) -> CandidateReason {
    if fact.effective_date == observation.business_date {
        CandidateReason::SameBusinessDate { observed_date_role: observation.date_role.clone() }
    } else {
        CandidateReason::CompatibleDateWindow { observed_date_role: observation.date_role.clone(), delta_days: date_distance(fact, observation) }
    }
}

fn candidate_key(occurrence: &ConfirmedOccurrence, members: &[CandidateMember]) -> String {
    let member_ids = members.iter().map(|m| format!("{}@{}", m.l0_id, m.revision)).collect::<Vec<_>>().join(",");
    let parts = [occurrence.artifact_id.as_str(), &occurrence.locator, &occurrence.occurrence_discriminator,
        occurrence.account_id.as_str(), &occurrence.source_role, &member_ids];
    parts.iter().map(|part| format!("{}:{}", part.len(), part)).collect::<Vec<_>>().join("|")
}

