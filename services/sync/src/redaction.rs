use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::sync::PushRequest;

const SENSITIVE_KEYS: &[&str] = &[
    "token",
    "password",
    "secret",
    "authorization",
    "invite_code",
    "device_token",
    "api_key",
    "private_key",
];

const PAYLOAD_KEYS: &[&str] = &[
    "snapshot",
    "payload",
    "data",
    "night",
    "activity",
    "body",
    "tombstone",
    "operations",
    "changes",
];

pub fn hash_id(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(&hasher.finalize()[..8])
}

pub fn redact_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(redact_map(map)),
        Value::Array(items) => Value::Array(items.iter().map(redact_value).collect()),
        other => other.clone(),
    }
}

fn redact_map(map: &Map<String, Value>) -> Map<String, Value> {
    map.iter()
        .map(|(k, v)| {
            if is_sensitive_key(k) || is_payload_key(k) {
                (k.clone(), Value::String("[REDACTED]".to_string()))
            } else {
                (k.clone(), redact_value(v))
            }
        })
        .collect()
}

fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    SENSITIVE_KEYS
        .iter()
        .any(|s| lower.contains(s) || lower.ends_with("_hash"))
}

fn is_payload_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    PAYLOAD_KEYS.iter().any(|s| lower == *s)
}

pub fn redact_sync_request_summary(kind: &str, req: &PushRequest) -> String {
    let kinds: Vec<&str> = req.changes.iter().map(|o| o.kind.as_str()).collect();
    let types: Vec<&str> = req
        .changes
        .iter()
        .map(|o| o.record_type.as_str())
        .collect();
    format!("{kind} kinds={kinds:?} types={types:?}")
}

pub fn redact_json_str(raw: &str) -> String {
    match serde_json::from_str::<Value>(raw) {
        Ok(v) => serde_json::to_string(&redact_value(&v)).unwrap_or_else(|_| "[unparseable]".to_string()),
        Err(_) => "[unparseable]".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redacts_token_fields() {
        let v = json!({"device_token": "abc", "record_id": "x"});
        let out = redact_value(&v);
        assert_eq!(out["device_token"], "[REDACTED]");
        assert_eq!(out["record_id"], "x");
    }

    #[test]
    fn redacts_snapshot_payload() {
        let v = json!({"snapshot": {"body": "secret"}, "op_id": "1"});
        let out = redact_value(&v);
        assert_eq!(out["snapshot"], "[REDACTED]");
        assert_eq!(out["op_id"], "1");
    }

    #[test]
    fn hash_id_stable() {
        assert_eq!(hash_id("device-1"), hash_id("device-1"));
        assert_ne!(hash_id("a"), hash_id("b"));
    }
}
