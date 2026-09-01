use anyhow::{anyhow, Result};

use super::schema_validate::{
    validate_change_contract, validate_content_hash_pattern, validate_rfc3339_utc, validate_snapshot,
    validate_uuid,
};
use super::types::{SyncChange, Tombstone};

pub const ALLOWED_DOMAINS: &[&str] = &["health", "journal"];

const HEALTH_TYPES: &[&str] = &[
    "daily_metrics",
    "metric_day_snapshot",
    "sleep_night",
    "nap",
    "meal",
    "activity",
    "body_measurement",
];
const JOURNAL_TYPES: &[&str] = &["event", "mood", "note"];

pub fn validate_domain_type_kind(op: &SyncChange) -> Result<()> {
    if !ALLOWED_DOMAINS.contains(&op.domain.as_str()) {
        return Err(anyhow!("unsupported domain"));
    }
    let allowed_types = match op.domain.as_str() {
        "health" => HEALTH_TYPES,
        "journal" => JOURNAL_TYPES,
        _ => return Err(anyhow!("unsupported domain")),
    };
    if !allowed_types.contains(&op.record_type.as_str()) {
        return Err(anyhow!("invalid domain/type combination"));
    }
    match op.kind.as_str() {
        "upsert" | "delete" | "restore" | "resolve" => {}
        _ => return Err(anyhow!("unsupported kind")),
    }
    Ok(())
}

pub fn validate_operation(op: &SyncChange) -> Result<()> {
    validate_change_contract(op)?;
    validate_uuid(&op.op_id)?;
    validate_uuid(&op.record_id)?;
    validate_rfc3339_utc(&op.created_at_utc)?;
    validate_domain_type_kind(op)?;

    if op.origin.is_empty() {
        return Err(anyhow!("origin required"));
    }
    if op.local_revision < 1 {
        return Err(anyhow!("localRevision must be >= 1"));
    }

    match op.kind.as_str() {
        "delete" => {
            if op.snapshot.is_some() {
                return Err(anyhow!("delete must not include snapshot"));
            }
            if op.content_hash.is_some() {
                return Err(anyhow!("delete must not include contentHash"));
            }
            if op.conflict_id.is_some() {
                return Err(anyhow!("delete must not include conflictId"));
            }
            if op.tombstone.is_none() || op.natural_key.is_none() {
                return Err(anyhow!("delete requires tombstone and naturalKey"));
            }
            validate_tombstone(op.tombstone.as_ref().unwrap())?;
            crate::sync::natural_key::validate_tombstone_identity(
                &op.record_id,
                &op.tombstone.as_ref().unwrap().id,
            )?;
            crate::sync::natural_key::validate_natural_key_for_delete(
                &op.record_type,
                op.natural_key.as_ref().unwrap(),
            )?;
        }
        "upsert" | "restore" => {
            require_snapshot_fields(op)?;
            if op.conflict_id.is_some() {
                return Err(anyhow!("upsert/restore must not include conflictId"));
            }
            validate_content_hash_pattern(op.content_hash.as_ref().unwrap())?;
            validate_snapshot(&op.record_type, op.snapshot.as_ref().unwrap())?;
            crate::sync::natural_key::validate_snapshot_identity(
                &op.record_type,
                &op.record_id,
                op.natural_key.as_ref().unwrap(),
                op.snapshot.as_ref().unwrap(),
            )?;
        }
        "resolve" => {
            require_snapshot_fields(op)?;
            if let Some(cid) = &op.conflict_id {
                validate_uuid(cid)?;
            } else {
                return Err(anyhow!("resolve requires conflictId"));
            }
            validate_content_hash_pattern(op.content_hash.as_ref().unwrap())?;
            validate_snapshot(&op.record_type, op.snapshot.as_ref().unwrap())?;
            crate::sync::natural_key::validate_snapshot_identity(
                &op.record_type,
                &op.record_id,
                op.natural_key.as_ref().unwrap(),
                op.snapshot.as_ref().unwrap(),
            )?;
        }
        other => return Err(anyhow!("unsupported kind: {other}")),
    }
    Ok(())
}

fn require_snapshot_fields(op: &SyncChange) -> Result<()> {
    if op.tombstone.is_some() {
        return Err(anyhow!("must not include tombstone"));
    }
    if op.snapshot.is_none() || op.natural_key.is_none() || op.content_hash.is_none() {
        return Err(anyhow!("requires snapshot, naturalKey, contentHash"));
    }
    Ok(())
}

fn validate_tombstone(t: &Tombstone) -> Result<()> {
    validate_uuid(&t.id)?;
    validate_rfc3339_utc(&t.deleted_at_utc)?;
    if t.revision < 1 {
        return Err(anyhow!("invalid tombstone revision"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> SyncChange {
        SyncChange {
            op_id: "00000000-0000-4000-8000-000000000099".into(),
            contract_version: "journal-health/v1".into(),
            domain: "journal".into(),
            record_type: "note".into(),
            record_id: "00000000-0000-4000-8000-000000000001".into(),
            kind: "upsert".into(),
            origin: "manual".into(),
            local_revision: 1,
            base_server_version: None,
            content_hash: Some("a".repeat(64)),
            snapshot: Some(json!({})),
            tombstone: None,
            natural_key: Some(json!({"id": "x"})),
            conflict_id: None,
            created_at_utc: "2026-01-15T08:00:00Z".into(),
        }
    }

    #[test]
    fn rejects_health_type_in_journal_domain() {
        let mut op = base();
        op.domain = "journal".into();
        op.record_type = "meal".into();
        assert!(validate_domain_type_kind(&op).is_err());
    }

    #[test]
    fn resolve_requires_conflict_id() {
        let mut op = base();
        op.kind = "resolve".into();
        assert!(validate_operation(&op).is_err());
        op.conflict_id = Some("00000000-0000-4000-8000-000000000010".into());
        assert!(validate_operation(&op).is_err());
    }
}
