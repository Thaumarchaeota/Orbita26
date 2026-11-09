//! Applies one frozen E3 commit plan inside the caller's SQLite transaction.
//! This module deliberately performs no filesystem or process I/O.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::Transaction;
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[cfg(feature = "finance-v2-test-support")]
thread_local! {
    static SYNTHETIC_APPLY_DIAGNOSTIC: std::cell::RefCell<Option<String>> =
        std::cell::RefCell::new(None);
}

#[cfg(feature = "finance-v2-test-support")]
pub(crate) fn take_synthetic_apply_diagnostic() -> Option<String> {
    SYNTHETIC_APPLY_DIAGNOSTIC.with(|slot| slot.borrow_mut().take())
}

#[cfg(feature = "finance-v2-test-support")]
fn set_synthetic_apply_diagnostic(value: String) {
    SYNTHETIC_APPLY_DIAGNOSTIC.with(|slot| *slot.borrow_mut() = Some(value));
}

use crate::finance_v2_domain::{Amount, CommodityCode, FactStatus, Id, LedgerSnapshot, MemberRevision, Provenance, Quantity};
use crate::finance_v2_projection::{project_ledger, project_reports};
use crate::finance_v2_store::{
    self as store,
    evidence::{self, EvidenceRecord, EvidenceRole, EvidenceSign, RefinementLink},
    l0::{self, L0ChangeOrigin},
    read::read_ledger_snapshot,
    treatments::{self, TreatmentStatus},
    StoreError,
};
use crate::finance_v2_workspace::{
    self as workspace, EvidenceGroupingKind, FactMutation, ObservationQuality, ObservationValue,
    ParsedObservation, TreatmentMutation, WorkspaceIntentPayload,
};
use crate::finance_v2_workspace::refinement::{
    DraftCommitPlan, EndpointSign, RefinementIntent, TreatmentResolution,
};

#[derive(Clone, Debug)]
pub(crate) struct CommitApplyResult {
    pub id_map: Value,
    pub applied_generation_intents: Vec<Id>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct OccurrenceKey {
    artifact: Id,
    locator: String,
    discriminator: String,
}

fn fail() -> StoreError { StoreError::InvalidDomainValue }

fn deterministic_id(namespace: &str, parts: &[&str]) -> Result<Id, StoreError> {
    let mut hash = Sha256::new();
    hash.update(b"orbita-finance-v2-commit-id\0");
    hash.update(namespace.as_bytes());
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    let digest = hash.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Id::parse(uuid::Uuid::from_bytes(bytes).to_string()).map_err(|_| StoreError::InvalidDomainValue)
}

fn observation<'a>(plan: &'a DraftCommitPlan, key: &OccurrenceKey) -> Result<&'a ParsedObservation, StoreError> {
    let mut matches = plan.fixed_parse.iter().filter(|row| {
        row.artifact_id == key.artifact && row.locator == key.locator
            && row.occurrence_discriminator == key.discriminator
    });
    let first = matches.next().ok_or(StoreError::MissingReference)?;
    if matches.next().is_some() { return Err(fail()); }
    first.validate().map_err(|_| fail())?;
    if plan.source_context_id.as_ref() != Some(&first.source_context_id)
        || plan.source_context_revision != Some(first.source_context_revision)
        || plan.source_context_provider.as_ref() != Some(&first.source_context_provider)
    { return Err(StoreError::StaleRevision); }
    Ok(first)
}

fn source_for_role<'a>(row: &'a ParsedObservation, role: &str) -> Result<&'a workspace::ParseObservation, StoreError> {
    let mut fields = row.fields.iter().filter(|field| field.role == role);
    let field = fields.next().ok_or(StoreError::MissingReference)?;
    if fields.next().is_some() { return Err(fail()); }
    Ok(field)
}

fn validate_artifact(tx: &Transaction<'_>, row: &ParsedObservation) -> Result<(), StoreError> {
    let artifact = store::sources::find_artifact(tx, &row.artifact_id)?.ok_or(StoreError::MissingReference)?;
    if artifact.sha256 != row.artifact_sha256 || artifact.byte_length != row.artifact_byte_length
        || artifact.context_id != row.source_context_id || artifact.context_revision != row.source_context_revision
        || artifact.binding_revision != row.binding_revision
    { return Err(StoreError::StaleRevision); }
    if store::sources::current_binding_revision(tx)? != row.binding_revision { return Err(StoreError::StaleRevision); }
    if store::sources::active_context_revision(tx, &artifact.context_id)? != Some(artifact.context_revision) {
        return Err(StoreError::StaleRevision);
    }
    let context = store::sources::read_context_version(tx, &artifact.context_id, artifact.context_revision)?
        .ok_or(StoreError::MissingReference)?;
    if !context.active || context.id != row.source_context_id || context.provider != row.source_context_provider {
        return Err(StoreError::StaleRevision);
    }
    Ok(())
}

fn exact_source(
    tx: &Transaction<'_>, plan: &DraftCommitPlan, key: &OccurrenceKey, role: &str,
    account_id: &Id, signed_quantity: &crate::finance_v2_domain::Quantity, sign: EndpointSign, at: i64,
) -> Result<(Id, ParsedObservation), StoreError> {
    let row = observation(plan, key)?;
    validate_artifact(tx, row)?;
    let field = source_for_role(row, role)?;
    let binding = field.binding.as_ref().ok_or(StoreError::MissingReference)?;
    if binding.account_id.as_ref() != Some(account_id) { return Err(StoreError::StaleRevision); }
    let (account_revision, account_active): (i64, i64) = tx.query_row(
        "SELECT revision,active FROM finance_v2_accounts WHERE id=?1", [account_id.as_str()],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional()?.ok_or(StoreError::MissingReference)?;
    if u64::try_from(account_revision).map_err(|_| StoreError::IncompatibleSchema)? != binding.account_revision.ok_or(StoreError::StaleRevision)?
        || account_active != 1 { return Err(StoreError::StaleRevision); }
    if let Some(via_id) = &binding.via_id {
        let (via_revision, via_active): (i64, i64) = tx.query_row(
            "SELECT revision,active FROM finance_v2_vias WHERE id=?1", [via_id.as_str()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?.ok_or(StoreError::MissingReference)?;
        if u64::try_from(via_revision).map_err(|_| StoreError::IncompatibleSchema)? != binding.via_revision.ok_or(StoreError::StaleRevision)?
            || via_active != 1 { return Err(StoreError::StaleRevision); }
        let mapped: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM finance_v2_account_via_history WHERE account_id=?1 AND via_id=?2 AND active=1 AND revision=(SELECT MAX(revision) FROM finance_v2_account_via_history WHERE account_id=?1 AND via_id=?2))",
            rusqlite::params![account_id.as_str(), via_id.as_str()], |r| r.get(0),
        )?;
        if !mapped { return Err(StoreError::StaleRevision); }
        if !plan.dependency_account_via_bindings.iter().any(|captured| captured.account_id == *account_id
            && captured.via_id == *via_id && captured.active) { return Err(StoreError::StaleRevision); }
    }
    if signed_quantity.amount.is_zero()
        || (sign == EndpointSign::Negative) != signed_quantity.amount.is_negative()
    { return Err(fail()); }
    match &field.value {
        ObservationValue::SignedQuantity(value) if value == signed_quantity => {}
        _ => return Err(fail()),
    }
    let evidence = evidence_for_row(tx, row, at)?;
    if row.quality != ObservationQuality::Confirmed { return Err(fail()); }
    Ok((evidence, row.clone()))
}

fn sign_to_evidence(sign: EndpointSign) -> EvidenceSign {
    match sign { EndpointSign::Positive => EvidenceSign::Positive, EndpointSign::Negative => EvidenceSign::Negative }
}

fn positive_magnitude(value: &Quantity) -> Result<Quantity, StoreError> {
    let amount = if value.amount.is_negative() { value.amount.checked_neg() } else { Ok(value.amount) }
        .map_err(|_| StoreError::InvalidDomainValue)?;
    if !amount.is_positive() { return Err(fail()); }
    Ok(Quantity::new(amount, value.commodity.clone()))
}

fn validate_member_endpoint(
    tx: &Transaction<'_>, member: &MemberRevision, account: &Id, sign: EndpointSign,
    source_quantity: &Quantity, allocation: Option<&Quantity>,
) -> Result<(), StoreError> {
    let fact = l0::read_current_l0(tx, &member.l0_id)?.ok_or(StoreError::MissingReference)?;
    if fact.revision != member.revision || fact.status != FactStatus::Active { return Err(StoreError::StaleRevision); }
    let endpoint = match sign {
        EndpointSign::Positive if fact.positive_account_id == *account => &fact.positive,
        EndpointSign::Negative if fact.negative_account_id == *account => &fact.negative,
        _ => return Err(StoreError::InvalidEvidenceAllocation),
    };
    let expected = match allocation { Some(value) => value.clone(), None => positive_magnitude(source_quantity)? };
    if endpoint.commodity != expected.commodity
        || endpoint.amount.exact_cmp(expected.amount).map_err(|_| fail())? != std::cmp::Ordering::Equal
    { return Err(StoreError::InvalidEvidenceAllocation); }
    Ok(())
}

fn evidence_for_row(tx: &Transaction<'_>, row: &ParsedObservation, at: i64) -> Result<Id, StoreError> {
    let found = evidence::find_occurrence(tx, &row.artifact_id, &row.locator, &row.occurrence_discriminator)?;
    if let Some(existing) = found {
        if existing.profile_id != row.profile_id || existing.profile_revision != row.profile_revision
            || existing.raw_text_version != row.source_row.raw_text_version || existing.raw_text != row.source_row.raw_text
        { return Err(StoreError::DuplicateEvidenceOccurrence); }
        return Ok(existing.id);
    }
    let id = deterministic_id("evidence", &[row.artifact_id.as_str(), &row.locator, &row.occurrence_discriminator])?;
    evidence::insert_evidence(tx, &EvidenceRecord {
        id: id.clone(), artifact_id: row.artifact_id.clone(), locator: row.locator.clone(),
        occurrence_discriminator: row.occurrence_discriminator.clone(), profile_id: row.profile_id.clone(),
        profile_revision: row.profile_revision.clone(), raw_text_version: row.source_row.raw_text_version,
        raw_text: row.source_row.raw_text.clone(),
    }, at)?;
    Ok(id)
}

fn occurrence_key(artifact: &Id, locator: &str, discriminator: &str) -> OccurrenceKey {
    OccurrenceKey { artifact: artifact.clone(), locator: locator.to_owned(), discriminator: discriminator.to_owned() }
}

fn candidate_key_for_match(value: &workspace::EvidenceMatchIntent) -> String {
    let members = value.members.iter().map(|member| format!("{}@{}", member.member.l0_id, member.member.revision)).collect::<Vec<_>>().join(",");
    [value.artifact_id.as_str(), value.locator.as_str(), value.occurrence_discriminator.as_str(),
        value.observed_account_id.as_str(), value.source_role.as_str(), members.as_str()]
        .iter().map(|part| format!("{}:{}", part.len(), part)).collect::<Vec<_>>().join("|")
}

fn apply_fact(tx: &Transaction<'_>, mutation: &FactMutation, operation: &Id, at: i64, link_map: &mut Vec<Value>) -> Result<(), StoreError> {
    match mutation {
        FactMutation::Create { fact } => {
            let mut value = fact.clone();
            let origin = match &value.provenance {
                Provenance::Imported { evidence_ids } if evidence_ids.is_empty() => return Err(fail()),
                Provenance::Imported { .. } => L0ChangeOrigin::CreatedImported,
                Provenance::Manual { .. } => L0ChangeOrigin::CreatedManual,
            };
            l0::append_l0_version(tx, &value, None, at, origin)?;
        }
        FactMutation::Amend { expected, fact, manual_change } => {
            let mut value = fact.clone();
            if manual_change.reason.trim().is_empty() || value.id != expected.l0_id
                || value.revision != expected.revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?
            { return Err(fail()); }
            l0::append_l0_version(tx, &value, Some(expected.revision), at, L0ChangeOrigin::ManualAmend)?;
            rebind_active_links(tx, &value.id, value.revision, operation, at, link_map)?;
            store::commit::record_l0_change(tx, &value.id, value.revision, operation, manual_change.changed_at_utc_micros, &manual_change.reason)?;
        }
        FactMutation::Delete { expected, deleted_version, manual_change } => {
            let value = deleted_version;
            if manual_change.reason.trim().is_empty() || value.id != expected.l0_id || value.status != FactStatus::Deleted
                || value.revision != expected.revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)? { return Err(fail()); }
            l0::append_l0_version(tx, value, Some(expected.revision), at, L0ChangeOrigin::Deleted)?;
            let transition = link_transition_id(operation, &value.id, value.revision)?;
            retire_active_links(tx, &value.id, expected.revision, &transition, at)?;
            store::commit::record_l0_change(tx, &value.id, value.revision, operation, manual_change.changed_at_utc_micros, &manual_change.reason)?;
        }
        FactMutation::Restore { expected_revision, restored_version, manual_change } => {
            let value = restored_version;
            if manual_change.reason.trim().is_empty() || value.revision != expected_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?
                || value.status != FactStatus::Active { return Err(fail()); }
            l0::append_l0_version(tx, value, Some(*expected_revision), at, L0ChangeOrigin::Restored)?;
            let source_revision = expected_revision.checked_sub(1).ok_or(StoreError::InvalidDomainValue)?;
            let deletion_operation: String = tx.query_row(
                "SELECT operation_id FROM finance_v2_l0_change_audit WHERE fact_id=?1 AND revision=?2",
                rusqlite::params![value.id.as_str(), i64::try_from(*expected_revision).map_err(|_| StoreError::InvalidDomainValue)?],
                |row| row.get(0),
            )?;
            let deletion_operation = Id::parse(deletion_operation).map_err(|_| StoreError::IncompatibleSchema)?;
            let transition = link_transition_id(&deletion_operation, &value.id, *expected_revision)?;
            let (ordinary, groups) = evidence::revoked_links_for_operation(tx, &value.id, source_revision, &transition)?;
            restore_revoked_links(tx, &value.id, value.revision, operation, at, Some((&ordinary, &groups)), link_map)?;
            store::commit::record_l0_change(tx, &value.id, value.revision, operation, manual_change.changed_at_utc_micros, &manual_change.reason)?;
        }
    }
    Ok(())
}

fn rebind_active_links(tx: &Transaction<'_>, fact_id: &Id, new_revision: u64, operation: &Id, at: i64, link_map: &mut Vec<Value>) -> Result<(), StoreError> {
    let transition = link_transition_id(operation, fact_id, new_revision)?;
    let (ordinary, groups) = retire_active_links(tx, fact_id, new_revision.checked_sub(1).ok_or(StoreError::InvalidDomainValue)?, &transition, at)?;
    restore_revoked_links(tx, fact_id, new_revision, operation, at, Some((&ordinary, &groups)), link_map)
}

fn link_transition_id(operation: &Id, fact_id: &Id, revision: u64) -> Result<Id, StoreError> {
    deterministic_id("evidence-link-transition", &[operation.as_str(), fact_id.as_str(), &revision.to_string()])
}

fn retire_active_links(tx: &Transaction<'_>, fact_id: &Id, expected_revision: u64, transition: &Id, at: i64) -> Result<(BTreeSet<String>, BTreeMap<String, BTreeSet<String>>), StoreError> {
    let mut stmt = tx.prepare("SELECT c.id,c.revision,h.grouping_kind,h.group_id,h.leaf_l0_revision FROM finance_v2_evidence_link_current c JOIN finance_v2_evidence_link_history h USING(id,revision) WHERE c.status='active' AND h.status='active' AND h.leaf_l0_id=?1 ORDER BY c.id")?;
    let rows = stmt.query_map([fact_id.as_str()], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,i64>(4)?)))?;
    let mut links = Vec::new();
    for row in rows { links.push(row?); }
    drop(stmt);
    let mut groups = BTreeSet::new();
    let mut ordinary = BTreeSet::new();
    for (raw_id, raw_revision, grouping, group_id, leaf_revision) in links {
        if u64::try_from(leaf_revision).ok() != Some(expected_revision) { return Err(StoreError::InvalidEvidenceAllocation); }
        if grouping == "refinement" {
            groups.insert(group_id.ok_or(StoreError::InvalidEvidenceAllocation)?);
        } else {
            ordinary.insert(raw_id.clone());
            evidence::revoke_link_for_operation(tx, &Id::parse(raw_id).map_err(|_| StoreError::IncompatibleSchema)?,
                u64::try_from(raw_revision).map_err(|_| StoreError::IncompatibleSchema)?, transition, at)?;
        }
    }
    let mut exact_groups = BTreeMap::new();
    for group_id in groups {
        let mut stmt = tx.prepare("SELECT id FROM finance_v2_evidence_link_current WHERE group_id=?1 AND grouping_kind='refinement' AND relation_kind='refinement' AND status='active' ORDER BY id")?;
        let rows = stmt.query_map([group_id.as_str()], |r| r.get::<_, String>(0))?;
        let mut ids = BTreeSet::new();
        for row in rows { ids.insert(row?); }
        drop(stmt);
        if ids.is_empty() { return Err(StoreError::InvalidEvidenceAllocation); }
        exact_groups.insert(group_id.clone(), ids);
        evidence::revoke_refinement_group_for_operation(tx, &group_id, transition, at)?;
    }
    Ok((ordinary, exact_groups))
}

fn decode_link_quantity(value: &Value) -> Result<(Quantity, EvidenceSign), StoreError> {
    let coefficient = value.get("coefficient").and_then(Value::as_str).ok_or(StoreError::IncompatibleSchema)?
        .parse::<i128>().map_err(|_| StoreError::IncompatibleSchema)?;
    let scale = u8::try_from(value.get("scale").and_then(Value::as_u64).ok_or(StoreError::IncompatibleSchema)?)
        .map_err(|_| StoreError::IncompatibleSchema)?;
    let commodity = CommodityCode::parse(value.get("commodity").and_then(Value::as_str).ok_or(StoreError::IncompatibleSchema)?.to_owned())
        .map_err(|_| StoreError::IncompatibleSchema)?;
    let sign = match value.get("sign").and_then(Value::as_str) {
        Some("positive") => EvidenceSign::Positive,
        Some("negative") => EvidenceSign::Negative,
        _ => return Err(StoreError::IncompatibleSchema),
    };
    Ok((Quantity::new(Amount::new(coefficient, scale).map_err(|_| StoreError::IncompatibleSchema)?, commodity), sign))
}

fn restore_revoked_links(tx: &Transaction<'_>, fact_id: &Id, new_revision: u64, operation: &Id, at: i64, selection: Option<(&BTreeSet<String>, &BTreeMap<String, BTreeSet<String>>)>, link_map: &mut Vec<Value>) -> Result<(), StoreError> {
    let mut stmt = tx.prepare("SELECT c.id,c.evidence_id,c.observed_account_id,c.observation_role,c.relation_kind,c.grouping_kind,c.group_id,h.allocation_payload FROM finance_v2_evidence_link_current c JOIN finance_v2_evidence_link_history h USING(id,revision) WHERE c.status='revoked' AND h.status='revoked' AND h.leaf_l0_id=?1 ORDER BY c.id")?;
    let rows = stmt.query_map([fact_id.as_str()], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?)))?;
    let mut old = Vec::new();
    for row in rows { old.push(row?); }
    drop(stmt);
    let mut groups = BTreeSet::new();
    for (old_id, raw_evidence, raw_account, role, relation, grouping, group_id, payload) in old {
        if let Some((ordinary_ids, group_ids)) = selection.as_ref() {
            if (grouping == "ordinary" && !ordinary_ids.contains(&old_id))
                || (grouping == "refinement" && group_id.as_ref().map_or(true, |id| group_ids.get(id).map_or(true, |ids| !ids.contains(&old_id)))) { continue; }
        }
        let old_id = Id::parse(old_id).map_err(|_| StoreError::IncompatibleSchema)?;
        let evidence_id = Id::parse(raw_evidence).map_err(|_| StoreError::IncompatibleSchema)?;
        let account = Id::parse(raw_account).map_err(|_| StoreError::IncompatibleSchema)?;
        match grouping.as_str() {
            "ordinary" => {
                let link_id = deterministic_id("restored-evidence-link", &[operation.as_str(), old_id.as_str(), fact_id.as_str(), &new_revision.to_string()])?;
                let member = MemberRevision { l0_id: fact_id.clone(), revision: new_revision };
                match relation.as_str() {
                    "ordinary" => evidence::append_ordinary_link(tx, &link_id, &evidence_id, &account, &role, EvidenceRole::Ordinary, &member, None, at)?,
                    "refund" => evidence::append_refund_link(tx, &link_id, &evidence_id, &account, &role, &member, None, at)?,
                    _ => return Err(StoreError::InvalidEvidenceAllocation),
                };
                link_map.push(json!({"factId":fact_id,"linkId":link_id,"restoredLinkId":old_id,"evidenceId":evidence_id}));
            }
            "refinement" => { groups.insert(group_id.ok_or(StoreError::InvalidEvidenceAllocation)?); }
            _ => return Err(StoreError::InvalidEvidenceAllocation),
        }
        let _ = payload;
    }
    if let Some((_, selected_groups)) = selection.as_ref() { groups.retain(|group| selected_groups.contains_key(group)); }
    for group_id in groups {
        let mut members = Vec::new();
        let selected_ids = selection.as_ref().and_then(|(_, selected)| selected.get(&group_id));
        let selected_ids = match selected_ids {
            Some(ids) => ids,
            None => return Err(StoreError::InvalidEvidenceAllocation),
        };
        for selected_id in selected_ids {
            let member = tx.query_row("SELECT c.id,c.evidence_id,c.observed_account_id,c.observation_role,h.leaf_l0_id,h.leaf_l0_revision,h.allocation_payload FROM finance_v2_evidence_link_current c JOIN finance_v2_evidence_link_history h USING(id,revision) WHERE c.id=?1 AND c.group_id=?2 AND c.status='revoked' AND h.status='revoked' ORDER BY c.id", rusqlite::params![selected_id, group_id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,i64>(5)?,r.get::<_,Option<String>>(6)?)))?;
            members.push(member);
        }
        if members.is_empty() { return Err(StoreError::InvalidEvidenceAllocation); }
        let mut links = Vec::new();
        let mut source = None;
        let mut evidence_id = None;
        let mut account = None;
        let mut role = None;
        for (raw_id, raw_evidence, raw_account, observation_role, raw_leaf, raw_revision, allocation_payload) in members {
            let payload: Value = serde_json::from_str(allocation_payload.as_deref().ok_or(StoreError::IncompatibleSchema)?)
                .map_err(|_| StoreError::IncompatibleSchema)?;
            let (allocated, member_sign) = decode_link_quantity(payload.get("allocation").ok_or(StoreError::IncompatibleSchema)?)?;
            let (source_quantity, source_sign) = decode_link_quantity(payload.get("source").ok_or(StoreError::IncompatibleSchema)?)?;
            if source.as_ref().is_some_and(|(prior, prior_sign): &(Quantity, EvidenceSign)| prior != &source_quantity || *prior_sign != source_sign) { return Err(StoreError::InvalidEvidenceAllocation); }
            source = Some((source_quantity, source_sign));
            let current_evidence = Id::parse(raw_evidence).map_err(|_| StoreError::IncompatibleSchema)?;
            let current_account = Id::parse(raw_account).map_err(|_| StoreError::IncompatibleSchema)?;
            if evidence_id.as_ref().is_some_and(|prior| prior != &current_evidence)
                || account.as_ref().is_some_and(|prior| prior != &current_account)
                || role.as_ref().is_some_and(|prior| prior != &observation_role)
            { return Err(StoreError::InvalidEvidenceAllocation); }
            evidence_id = Some(current_evidence.clone()); account = Some(current_account.clone()); role = Some(observation_role.clone());
            let leaf = Id::parse(raw_leaf).map_err(|_| StoreError::IncompatibleSchema)?;
            let leaf_revision = u64::try_from(raw_revision).map_err(|_| StoreError::IncompatibleSchema)?;
            let actual_revision = if leaf == *fact_id { new_revision } else { leaf_revision };
            let link_id = deterministic_id("restored-refinement-link", &[operation.as_str(), &group_id, &raw_id, &actual_revision.to_string()])?;
            links.push(RefinementLink { id: link_id, revision: 1, evidence_id: current_evidence,
                observed_account_id: current_account, observation_role, leaf: MemberRevision { l0_id: leaf, revision: actual_revision },
                sign: member_sign, allocation: allocated });
        }
        let (source_quantity, source_sign) = source.ok_or(StoreError::InvalidEvidenceAllocation)?;
        evidence::append_refinement_group(tx, &group_id, &evidence_id.ok_or(StoreError::MissingReference)?,
            &account.ok_or(StoreError::MissingReference)?, &role.ok_or(StoreError::MissingReference)?,
            &source_quantity, source_sign, &links, at)?;
        for link in &links { link_map.push(json!({"factId":link.leaf.l0_id,"linkId":link.id,"groupId":group_id})); }
    }
    Ok(())
}

fn apply_treatment(tx: &Transaction<'_>, mutation: &TreatmentMutation, operation: &Id, at: i64) -> Result<(), StoreError> {
    match mutation {
        TreatmentMutation::Apply { treatment } => { treatments::append_treatment_version(tx, treatment, TreatmentStatus::Active, None, at)?; }
        TreatmentMutation::Amend { expected_revision, treatment, manual_change } => {
            if manual_change.reason.trim().is_empty() || treatment.revision != expected_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)? { return Err(fail()); }
            treatments::append_treatment_version(tx, treatment, TreatmentStatus::Active, Some(*expected_revision), at)?;
            store::commit::record_treatment_change(tx, &treatment.id, treatment.revision, operation, manual_change.changed_at_utc_micros, &manual_change.reason)?;
        }
        TreatmentMutation::Release { expected_revision, tombstone, manual_change } => {
            if manual_change.reason.trim().is_empty() || tombstone.revision != expected_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)? { return Err(fail()); }
            treatments::append_treatment_version(tx, tombstone, TreatmentStatus::Deleted, Some(*expected_revision), at)?;
            store::commit::record_treatment_change(tx, &tombstone.id, tombstone.revision, operation, manual_change.changed_at_utc_micros, &manual_change.reason)?;
        }
    }
    Ok(())
}

fn apply_refinement(tx: &Transaction<'_>, base: &LedgerSnapshot, plan: &DraftCommitPlan, intent: &RefinementIntent, operation: &Id, at: i64, link_map: &mut Vec<Value>) -> Result<(), StoreError> {
    let parent = l0::read_current_l0(tx, &intent.parent.l0_id)?.ok_or(StoreError::MissingReference)?;
    let target_revision = intent.parent.revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?;
    let transition = link_transition_id(operation, &parent.id, target_revision)?;
    retire_active_links(tx, &parent.id, intent.parent.revision, &transition, at)?;
    let mut imported_children = BTreeMap::<Id, BTreeSet<Id>>::new();
    for allocation in &intent.evidence_allocations {
        let source = &allocation.source;
        let key = occurrence_key(&source.artifact_id, &source.locator, &source.occurrence_discriminator);
        let (evidence_id, _) = exact_source(tx, plan, &key, &source.role, &source.account_id, &source.signed_quantity, source.sign, at)?;
        for piece in &allocation.pieces { imported_children.entry(piece.child_id.clone()).or_default().insert(evidence_id.clone()); }
    }
    let mut refined = parent.clone();
    refined.revision = target_revision;
    refined.status = FactStatus::Refined;
    l0::append_l0_version(tx, &refined, Some(intent.parent.revision), at, L0ChangeOrigin::Refined)?;
    for child in &intent.children {
        let mut value = child.clone();
        if let Some(ids) = imported_children.get(&value.id) {
            if ids.is_empty() { return Err(fail()); }
            if matches!(&value.provenance, Provenance::Imported { evidence_ids } if !evidence_ids.is_empty()) { return Err(fail()); }
            value.provenance = Provenance::Imported { evidence_ids: ids.iter().cloned().collect() };
        } else if matches!(&value.provenance, Provenance::Imported { .. }) { return Err(fail()); }
        let origin = if matches!(&value.provenance, Provenance::Imported { .. }) { L0ChangeOrigin::CreatedImported } else { L0ChangeOrigin::CreatedManual };
        l0::append_l0_version(tx, &value, None, at, origin)?;
    }
    for resolution in &intent.treatment_resolutions {
        match resolution {
            TreatmentResolution::Replace { old_treatment_id, old_revision, replacement } => {
                treatments::append_treatment_version(tx, replacement, TreatmentStatus::Active, Some(*old_revision), at)?;
                store::commit::record_treatment_change(tx, old_treatment_id, replacement.revision, operation, at, "refinement replacement")?;
            }
            TreatmentResolution::Dissolve { old_treatment_id, old_revision, resulting_treatments } => {
                let old = base.current_treatments.iter().find(|t| t.id == *old_treatment_id && t.revision == *old_revision).ok_or(StoreError::StaleRevision)?;
                let tombstone = crate::finance_v2_domain::Treatment { revision: old_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?, ..old.clone() };
                treatments::append_treatment_version(tx, &tombstone, TreatmentStatus::Deleted, Some(*old_revision), at)?;
                store::commit::record_treatment_change(tx, old_treatment_id, tombstone.revision, operation, at, "refinement dissolution")?;
                for treatment in resulting_treatments { treatments::append_treatment_version(tx, treatment, TreatmentStatus::Active, None, at)?; }
            }
        }
    }
    let mut groups: BTreeMap<(OccurrenceKey, Id, String, EndpointSign), (Id, crate::finance_v2_domain::Quantity, Vec<RefinementLink>)> = BTreeMap::new();
    for allocation in &intent.evidence_allocations {
        let source = &allocation.source;
        let key = occurrence_key(&source.artifact_id, &source.locator, &source.occurrence_discriminator);
        let (evidence_id, _) = exact_source(tx, plan, &key, &source.role, &source.account_id, &source.signed_quantity, source.sign, at)?;
        let bucket = groups.entry((key, source.account_id.clone(), source.role.clone(), source.sign))
            .or_insert_with(|| (evidence_id.clone(), source.signed_quantity.clone(), Vec::new()));
        if bucket.0 != evidence_id || bucket.1 != source.signed_quantity { return Err(fail()); }
        for piece in &allocation.pieces {
            bucket.2.push(RefinementLink {
                id: deterministic_id("refinement-link", &[intent.intent_id.as_str(), evidence_id.as_str(), piece.child_id.as_str(), source.account_id.as_str(), &source.role])?,
                revision: 1, evidence_id: evidence_id.clone(), observed_account_id: source.account_id.clone(),
                observation_role: source.role.clone(), leaf: MemberRevision { l0_id: piece.child_id.clone(), revision: piece.child_revision },
                sign: sign_to_evidence(piece.sign), allocation: piece.allocated.clone(),
            });
        }
    }
    for ((key, account, role, sign), (evidence_id, quantity, links)) in groups {
        let group_id = deterministic_id("refinement-group", &[intent.intent_id.as_str(), evidence_id.as_str(), account.as_str(), &role])?;
        evidence::append_refinement_group(tx, group_id.as_str(), &evidence_id, &account, &role,
            &quantity, sign_to_evidence(sign), &links, at)?;
        for link in &links { link_map.push(json!({"intentId":intent.intent_id,"linkId":link.id,"groupId":group_id,"evidenceId":evidence_id})); }
        let _ = key;
    }
    Ok(())
}

/// Apply the exact prepared plan. The caller owns rollback/commit and performs
/// receipt, generation, and materialization orchestration around this function.
pub(crate) fn apply_commit_plan(
    tx: &Transaction<'_>, plan: &DraftCommitPlan, recorded_at_utc_us: i64,
) -> Result<CommitApplyResult, StoreError> {
    #[cfg(feature = "finance-v2-test-support")]
    SYNTHETIC_APPLY_DIAGNOSTIC.with(|slot| *slot.borrow_mut() = None);
    if (plan.required_durable_revision != plan.durable_revision
        && plan.required_durable_revision != plan.durable_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?)
        || plan.payload_sha256.trim().is_empty() {
        return Err(StoreError::StaleRevision);
    }
    let base = read_ledger_snapshot(tx)?;
    if base.generation != plan.ledger_generation { return Err(StoreError::GenerationConflict); }
    if plan.prospective_amend_plan.ledger_generation != plan.ledger_generation { return Err(StoreError::GenerationConflict); }
    let (mapping_revision, bindings) = store::accounts::read_account_via_snapshot(tx)?;
    if mapping_revision != plan.account_via_mapping_revision { return Err(StoreError::StaleRevision); }
    for captured in &plan.dependency_account_via_bindings {
        if !bindings.iter().any(|live| live.account_id == captured.account_id && live.via_id == captured.via_id
            && live.revision == captured.revision && live.active == captured.active)
        { return Err(StoreError::StaleRevision); }
    }
    for intent in &plan.confirmed_intents {
        if let WorkspaceIntentPayload::Refinement(refinement) = &intent.payload {
            refinement.validate_against(&base).map_err(|_| fail())?;
        }
    }
    for candidate_key in &plan.confirmed_candidate_keys {
        if !plan.confirmed_intents.iter().any(|intent| match &intent.payload {
            WorkspaceIntentPayload::EvidenceMatch(value) => candidate_key_for_match(value) == *candidate_key,
            _ => false,
        }) { return Err(StoreError::InvalidEvidenceAllocation); }
    }
    for intent in &plan.confirmed_intents {
        if let WorkspaceIntentPayload::CandidateConfirmation { candidate_key } = &intent.payload {
            if !plan.confirmed_candidate_keys.contains(candidate_key)
                || !plan.confirmed_intents.iter().any(|other| match &other.payload {
                    WorkspaceIntentPayload::EvidenceMatch(value) => candidate_key_for_match(value) == *candidate_key,
                    _ => false,
                }) { return Err(StoreError::InvalidEvidenceAllocation); }
        }
    }

    let mut needed = BTreeSet::<OccurrenceKey>::new();
    for intent in &plan.confirmed_intents {
        if !intent.explicitly_staged || intent.undone { return Err(fail()); }
        match &intent.payload {
            WorkspaceIntentPayload::EvidenceMatch(value) => { needed.insert(occurrence_key(&value.artifact_id, &value.locator, &value.occurrence_discriminator)); }
            WorkspaceIntentPayload::Refinement(value) => for allocation in &value.evidence_allocations {
                needed.insert(occurrence_key(&allocation.source.artifact_id, &allocation.source.locator, &allocation.source.occurrence_discriminator));
            },
            _ => {}
        }
    }
    let mut evidence_map = BTreeMap::<OccurrenceKey, Id>::new();
    for key in &needed {
        let row = observation(plan, key)?;
        validate_artifact(tx, row)?;
        evidence_map.insert(key.clone(), evidence_for_row(tx, row, recorded_at_utc_us)?);
    }

    let mut imported_for_fact = BTreeMap::<Id, BTreeSet<Id>>::new();
    for intent in &plan.confirmed_intents {
        match &intent.payload {
            WorkspaceIntentPayload::EvidenceMatch(match_intent) => {
                let key = occurrence_key(&match_intent.artifact_id, &match_intent.locator, &match_intent.occurrence_discriminator);
                let evidence_id = evidence_map.get(&key).ok_or(StoreError::MissingReference)?;
                for member in &match_intent.members { imported_for_fact.entry(member.member.l0_id.clone()).or_default().insert(evidence_id.clone()); }
            }
            WorkspaceIntentPayload::Refinement(refinement) => for allocation in &refinement.evidence_allocations {
                let key = occurrence_key(&allocation.source.artifact_id, &allocation.source.locator, &allocation.source.occurrence_discriminator);
                let evidence_id = evidence_map.get(&key).ok_or(StoreError::MissingReference)?;
                for piece in &allocation.pieces { imported_for_fact.entry(piece.child_id.clone()).or_default().insert(evidence_id.clone()); }
            },
            _ => {}
        }
    }

    let mut id_map_evidence = Vec::new();
    for (key, id) in &evidence_map {
        id_map_evidence.push(json!({"artifactId":key.artifact,"locator":key.locator,"occurrenceDiscriminator":key.discriminator,"evidenceId":id}));
    }
    let mut applied = Vec::new();
    let mut link_map = Vec::new();
    for intent in &plan.confirmed_intents {
        match &intent.payload {
            WorkspaceIntentPayload::Fact(mutation) => {
                match mutation {
                    FactMutation::Create { fact } => {
                        let mut fact = fact.clone();
                        if let Some(ids) = imported_for_fact.get(&fact.id) {
                            if ids.is_empty() { return Err(fail()); }
                            let canonical = ids.iter().cloned().collect::<Vec<_>>();
                        if matches!(&fact.provenance, Provenance::Imported { evidence_ids } if !evidence_ids.is_empty() && evidence_ids.as_slice() != canonical.as_slice()) { return Err(fail()); }
                            fact.provenance = Provenance::Imported { evidence_ids: canonical };
                        } else if matches!(&fact.provenance, Provenance::Imported { .. }) { return Err(fail()); }
                        apply_fact(tx, &FactMutation::Create { fact }, &plan.operation_id, recorded_at_utc_us, &mut link_map)?;
                    }
                    _ => apply_fact(tx, mutation, &plan.operation_id, recorded_at_utc_us, &mut link_map)?,
                }
            }
            WorkspaceIntentPayload::Treatment(value) => apply_treatment(tx, value, &plan.operation_id, recorded_at_utc_us)?,
            WorkspaceIntentPayload::Refinement(value) => apply_refinement(tx, &base, plan, value, &plan.operation_id, recorded_at_utc_us, &mut link_map)?,
            WorkspaceIntentPayload::EvidenceMatch(_) | WorkspaceIntentPayload::CandidateConfirmation { .. } => {}
        }
        if !matches!(&intent.payload, WorkspaceIntentPayload::CandidateConfirmation { .. }) {
            applied.push(intent.intent_id.clone());
        }
    }

    // Evidence links are written after facts and refinement children so every
    // link targets a current active leaf of the exact frozen revision.
    for intent in &plan.confirmed_intents {
        let WorkspaceIntentPayload::EvidenceMatch(value) = &intent.payload else { continue; };
        let key = occurrence_key(&value.artifact_id, &value.locator, &value.occurrence_discriminator);
        let (evidence_id, row) = exact_source(tx, plan, &key, &value.source_role, &value.observed_account_id, &value.signed_quantity, value.sign, recorded_at_utc_us)?;
        if evidence_map.get(&key) != Some(&evidence_id) { return Err(fail()); }
        if !row.fields.iter().any(|field| field.role == value.source_role && field.binding.as_ref().and_then(|b| b.account_id.as_ref()) == Some(&value.observed_account_id)) { return Err(fail()); }
        if value.requires_refund_treatment && value.grouping_kind == EvidenceGroupingKind::Refinement { return Err(fail()); }
        match value.grouping_kind {
            EvidenceGroupingKind::Ordinary => {
                if value.members.len() != 1 || value.members[0].allocation.is_some() { return Err(fail()); }
                let member = &value.members[0];
                if member.sign != value.sign { return Err(fail()); }
                validate_member_endpoint(tx, &member.member, &value.observed_account_id, value.sign, &value.signed_quantity, None)?;
                let id = deterministic_id("ordinary-link", &[plan.operation_id.as_str(), intent.intent_id.as_str(), evidence_id.as_str(), member.member.l0_id.as_str()])?;
                let role = if value.requires_refund_treatment { EvidenceRole::Refund } else { EvidenceRole::Ordinary };
                match value.members[0].sign {
                    EndpointSign::Positive | EndpointSign::Negative => {}
                }
                if role == EvidenceRole::Refund {
                    evidence::append_refund_link(tx, &id, &evidence_id, &value.observed_account_id, &value.source_role, &member.member, None, recorded_at_utc_us)?;
                } else {
                    evidence::append_ordinary_link(tx, &id, &evidence_id, &value.observed_account_id, &value.source_role, role, &member.member, None, recorded_at_utc_us)?;
                }
                link_map.push(json!({"intentId":intent.intent_id,"linkId":id,"evidenceId":evidence_id}));
            }
            EvidenceGroupingKind::Refinement => {
                if value.members.len() < 2 || value.members.iter().any(|m| m.allocation.is_none()) { return Err(fail()); }
                let group = deterministic_id("evidence-group", &[plan.operation_id.as_str(), intent.intent_id.as_str(), evidence_id.as_str()])?;
                let mut links = Vec::new();
                for member in &value.members {
                    if member.sign != value.sign { return Err(fail()); }
                    validate_member_endpoint(tx, &member.member, &value.observed_account_id, member.sign, &value.signed_quantity, member.allocation.as_ref())?;
                    links.push(RefinementLink {
                        id: deterministic_id("evidence-refinement-link", &[plan.operation_id.as_str(), intent.intent_id.as_str(), evidence_id.as_str(), member.member.l0_id.as_str()])?,
                        revision: 1, evidence_id: evidence_id.clone(), observed_account_id: value.observed_account_id.clone(),
                        observation_role: value.source_role.clone(), leaf: member.member.clone(), sign: sign_to_evidence(member.sign),
                        allocation: member.allocation.clone().ok_or(StoreError::InvalidEvidenceAllocation)?,
                    });
                }
                let magnitude = positive_magnitude(&value.signed_quantity)?;
                evidence::append_refinement_group(tx, group.as_str(), &evidence_id, &value.observed_account_id,
                    &value.source_role, &magnitude, sign_to_evidence(value.sign), &links, recorded_at_utc_us)?;
                link_map.push(json!({"intentId":intent.intent_id,"groupId":group,"evidenceId":evidence_id}));
            }
        }
        let _ = row;
    }

    for version in &plan.prospective_amend_plan.refund_versions {
        let mut fact = version.fact.clone();
        if fact.id != version.expected.l0_id || fact.revision != version.expected.revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?
            || version.manual_change.reason.trim().is_empty() { return Err(fail()); }
        if let Provenance::Imported { .. } = &fact.provenance {
            if let Some(ids) = imported_for_fact.get(&fact.id) { fact.provenance = Provenance::Imported { evidence_ids: ids.iter().cloned().collect() }; }
        }
        l0::append_l0_version(tx, &fact, Some(version.expected.revision), recorded_at_utc_us, L0ChangeOrigin::ManualAmend)?;
        rebind_active_links(tx, &fact.id, fact.revision, &plan.operation_id, recorded_at_utc_us, &mut link_map)?;
        store::commit::record_l0_change(tx, &fact.id, fact.revision, &plan.operation_id, version.manual_change.changed_at_utc_micros, &version.manual_change.reason)?;
    }
    for version in &plan.prospective_amend_plan.treatment_versions {
        if version.treatment.id != version.treatment_id
            || version.treatment.revision != version.expected_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?
            || version.manual_changes.iter().any(|change| change.reason.trim().is_empty()) { return Err(fail()); }
        treatments::append_treatment_version(tx, &version.treatment, TreatmentStatus::Active, Some(version.expected_revision), recorded_at_utc_us)?;
        if !version.manual_changes.is_empty() {
            let changed_at = version.manual_changes.iter().map(|change| change.changed_at_utc_micros).max().ok_or(StoreError::InvalidDomainValue)?;
            let reason = version.manual_changes.iter().map(|change| change.reason.as_str()).collect::<Vec<_>>().join("\n\n");
            store::commit::record_treatment_change(tx, &version.treatment_id, version.treatment.revision, &plan.operation_id, changed_at, &reason)?;
        }
    }

    evidence::validate_occurrence_claims(tx)?;
    l0::validate_all_active_imported_links(tx)?;
    let snapshot = read_ledger_snapshot(tx)?;
    for intent in &plan.confirmed_intents {
        if let WorkspaceIntentPayload::EvidenceMatch(value) = &intent.payload {
            if value.requires_refund_treatment {
                let member = value.members.first().ok_or(StoreError::InvalidEvidenceAllocation)?;
                if value.members.len() != 1 || !snapshot.current_treatments.iter().any(|treatment| treatment.refund_edges.iter().any(|edge|
                    edge.refund.l0_id == member.member.l0_id && edge.refund.revision == member.member.revision
                )) { return Err(StoreError::InvalidEvidenceAllocation); }
            }
        }
    }
    // `commit_once_verified` runs this helper inside `write_facts`, before it
    // advances the persisted generation. Validate the exact next-generation
    // candidate locally; the store still advances the database once afterward
    // and re-projects its newly read snapshot before commit.
    let candidate_generation = plan
        .ledger_generation
        .checked_add(1)
        .ok_or(StoreError::InvalidDomainValue)?;
    if snapshot.generation != plan.ledger_generation {
        return Err(StoreError::GenerationConflict);
    }
    let mut candidate_snapshot = snapshot;
    candidate_snapshot.generation = candidate_generation;
    let ledger = project_ledger(&candidate_snapshot).map_err(|error| {
        #[cfg(feature = "finance-v2-test-support")]
        set_synthetic_apply_diagnostic(format!("candidate_project_ledger: {error:?}"));
        fail()
    })?;
    project_reports(&candidate_snapshot, &ledger).map_err(|error| {
        #[cfg(feature = "finance-v2-test-support")]
        set_synthetic_apply_diagnostic(format!("candidate_project_reports: {error:?}"));
        fail()
    })?;
    Ok(CommitApplyResult { id_map: json!({"draftId":plan.draft_id,"evidence":id_map_evidence,"links":link_map}), applied_generation_intents: applied })
}
