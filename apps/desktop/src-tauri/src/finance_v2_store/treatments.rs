use std::collections::HashSet;

use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::{json, Value};

use crate::finance_v2_domain::{MemberRevision, Treatment};
use super::StoreError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TreatmentStatus { Active, Deleted }

pub fn restore_treatment(
    tx:&Transaction<'_>, prior:&Treatment, expected_current_revision:u64, recorded_at_utc_us:i64,
)->Result<u64,StoreError>{
    let revision=expected_current_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?;
    let restored=Treatment{revision,..prior.clone()};
    append_treatment_version(tx,&restored,TreatmentStatus::Active,Some(expected_current_revision),recorded_at_utc_us)
}

pub fn append_treatment_version(
    tx: &Transaction<'_>,
    treatment: &Treatment,
    status: TreatmentStatus,
    expected_revision: Option<u64>,
    recorded_at_utc_us: i64,
) -> Result<u64, StoreError> {
    if treatment.revision == 0 || treatment.members.is_empty() {
        return Err(StoreError::InvalidDomainValue);
    }
    let revision = i64::try_from(treatment.revision).map_err(|_| StoreError::InvalidDomainValue)?;
    let expected = expected_revision.map(i64::try_from).transpose().map_err(|_| StoreError::InvalidDomainValue)?;
    let current: Option<i64> = tx.query_row("SELECT revision FROM finance_v2_treatment_current WHERE id=?1", [treatment.id.as_str()], |row| row.get(0)).optional()?;
    match (current, expected) {
        (None, None) if revision == 1 => {},
        (Some(now), Some(want)) if now == want && want.checked_add(1) == Some(revision) => {},
        _ => return Err(StoreError::StaleRevision),
    }
    validate_graph(tx, treatment, status)?;
    let members = encode_members(&treatment.members)?;
    let merge_groups = serde_json::to_string(&json!(treatment.merge_groups.iter().map(|g| g.members.iter().map(member_json).collect::<Vec<_>>()).collect::<Vec<_>>())).map_err(|_| StoreError::InvalidDomainValue)?;
    let refund_edges = serde_json::to_string(&json!(treatment.refund_edges.iter().map(|e| json!({"refund":member_json(&e.refund),"payment":member_json(&e.payment),"coefficient":e.amount.amount.coefficient().to_string(),"scale":e.amount.amount.scale(),"commodity":e.amount.commodity.as_str()})).collect::<Vec<_>>())).map_err(|_| StoreError::InvalidDomainValue)?;
    let status_text = match status { TreatmentStatus::Active => "active", TreatmentStatus::Deleted => "deleted" };
    tx.execute("INSERT INTO finance_v2_treatment_versions(id,revision,owner_l0_id,members_payload,merge_groups_payload,refund_edges_payload,title,notes,status,recorded_at_utc_us) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", params![treatment.id.as_str(),revision,treatment.owner_l0_id.as_str(),members,merge_groups,refund_edges,treatment.title,treatment.notes,status_text,recorded_at_utc_us])?;
    if current.is_none() {
        tx.execute("INSERT INTO finance_v2_treatment_current(id,revision) VALUES (?1,?2)", params![treatment.id.as_str(),revision])?;
    } else {
        let changed = tx.execute("UPDATE finance_v2_treatment_current SET revision=?2 WHERE id=?1 AND revision=?3", params![treatment.id.as_str(),revision,expected])?;
        if changed != 1 { return Err(StoreError::StaleRevision); }
    }
    Ok(treatment.revision)
}

fn validate_graph(tx: &Transaction<'_>, treatment: &Treatment, status: TreatmentStatus) -> Result<(), StoreError> {
    let mut member_ids = HashSet::new();
    let mut member_revisions = std::collections::HashMap::new();
    for member in &treatment.members {
        if !member_ids.insert(member.l0_id.as_str()) { return Err(StoreError::InvalidDomainValue); }
        member_revisions.insert(member.l0_id.as_str(), member.revision);
        let revision = i64::try_from(member.revision).map_err(|_| StoreError::InvalidDomainValue)?;
        let member_status: Option<String> = tx.query_row("SELECT v.status FROM finance_v2_l0_current c JOIN finance_v2_l0_versions v ON v.id=c.id AND v.revision=c.revision WHERE c.id=?1 AND c.revision=?2", params![member.l0_id.as_str(),revision], |row| row.get(0)).optional()?;
        if status == TreatmentStatus::Active && member_status.as_deref() != Some("active") { return Err(StoreError::MissingReference); }
    }
    if !member_ids.contains(treatment.owner_l0_id.as_str()) { return Err(StoreError::InvalidDomainValue); }
    for group in &treatment.merge_groups {
        if group.members.len() < 2 { return Err(StoreError::InvalidDomainValue); }
        let mut group_seen = HashSet::new();
        for member in &group.members {
            if !member_ids.contains(member.l0_id.as_str()) || !group_seen.insert(member.l0_id.as_str())
                || member_revisions.get(member.l0_id.as_str()) != Some(&member.revision) { return Err(StoreError::InvalidDomainValue); }
        }
    }
    for edge in &treatment.refund_edges {
        if edge.refund.l0_id == edge.payment.l0_id
            || !member_ids.contains(edge.refund.l0_id.as_str())
            || !member_ids.contains(edge.payment.l0_id.as_str())
            || member_revisions.get(edge.refund.l0_id.as_str()) != Some(&edge.refund.revision)
            || member_revisions.get(edge.payment.l0_id.as_str()) != Some(&edge.payment.revision)
            || !edge.amount.amount.is_positive()
        { return Err(StoreError::InvalidDomainValue); }
    }
    if status == TreatmentStatus::Active {
        let mut statement = tx.prepare("SELECT v.id,v.members_payload FROM finance_v2_treatment_current c JOIN finance_v2_treatment_versions v USING(id,revision) WHERE v.status='active' AND v.id<>?1")?;
        let rows = statement.query_map([treatment.id.as_str()], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (_, payload) = row?;
            let existing = decode_members(&payload)?;
            if existing.iter().any(|m| member_ids.contains(m.l0_id.as_str())) { return Err(StoreError::InvalidDomainValue); }
        }
    }
    Ok(())
}

pub(crate) fn encode_members(members: &[MemberRevision]) -> Result<String, StoreError> {
    serde_json::to_string(&json!(members.iter().map(member_json).collect::<Vec<_>>())).map_err(|_| StoreError::InvalidDomainValue)
}

pub(crate) fn decode_members(payload: &str) -> Result<Vec<MemberRevision>, StoreError> {
    let values: Vec<Value> = serde_json::from_str(payload).map_err(|_| StoreError::IncompatibleSchema)?;
    values.into_iter().map(|value| {
        let id = value.get("id").and_then(Value::as_str).ok_or(StoreError::IncompatibleSchema)?;
        let revision = value.get("revision").and_then(Value::as_u64).filter(|v| *v > 0).ok_or(StoreError::IncompatibleSchema)?;
        Ok(MemberRevision { l0_id: crate::finance_v2_domain::Id::parse(id).map_err(|_| StoreError::IncompatibleSchema)?, revision })
    }).collect()
}

fn member_json(member: &MemberRevision) -> Value { json!({"id":member.l0_id.as_str(),"revision":member.revision}) }
