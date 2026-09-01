use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tombstone {
    pub id: String,
    pub revision: i64,
    pub deleted_at_utc: String,
}

/// Wire shape: `SyncOperation` in sync-envelope.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushRequest {
    pub contract_version: String,
    pub device_id: String,
    pub client_change_seq: i64,
    pub changes: Vec<SyncChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncChange {
    pub op_id: String,
    pub contract_version: String,
    pub domain: String,
    pub record_type: String,
    pub record_id: String,
    pub kind: String,
    pub origin: String,
    pub local_revision: i64,
    pub created_at_utc: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_server_version: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tombstone: Option<Tombstone>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub natural_key: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncErrorBody {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeOutcome {
    pub op_id: String,
    pub status: OpStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change_seq: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<SyncErrorBody>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpStatus {
    Accepted,
    Deduplicated,
    Conflict,
    Rejected,
    Retryable,
}

/// Wire shape: `SyncResult`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushResponse {
    pub contract_version: String,
    pub outcomes: Vec<ChangeOutcome>,
    pub next_change_seq: i64,
    #[serde(default)]
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PullRequest {
    pub contract_version: String,
    pub device_id: String,
    pub cursor: i64,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PullChange {
    pub op_id: String,
    pub contract_version: String,
    pub domain: String,
    pub record_type: String,
    pub record_id: String,
    pub kind: String,
    pub origin: String,
    pub local_revision: i64,
    pub server_version: i64,
    pub change_seq: i64,
    pub created_at_utc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tombstone: Option<Tombstone>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub natural_key: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PullResponse {
    pub contract_version: String,
    pub changes: Vec<PullChange>,
    pub next_change_seq: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AckRequest {
    pub contract_version: String,
    pub device_id: String,
    pub delivered_change_seq: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AckResponse {
    pub contract_version: String,
    pub delivered_change_seq: i64,
}

pub fn operation_fingerprint(op: &SyncChange) -> String {
    use crate::canonical::content_hash;
    use serde_json::json;
    // op_id identifies the receipt row, not its semantic payload. Hash every
    // mutable request field so retry is safe but reusing an id cannot silently
    // alter provenance, causality, timestamp, snapshot, or conflict intent.
    let fp = json!({
        "contractVersion": op.contract_version,
        "domain": op.domain,
        "recordType": op.record_type,
        "recordId": op.record_id,
        "kind": op.kind,
        "origin": op.origin,
        "localRevision": op.local_revision,
        "baseServerVersion": op.base_server_version,
        "contentHash": op.content_hash,
        "snapshot": op.snapshot,
        "tombstone": op.tombstone,
        "naturalKey": op.natural_key,
        "conflictId": op.conflict_id,
        "createdAtUtc": op.created_at_utc,
    });
    content_hash(&fp)
}

pub type PushOperation = SyncChange;
