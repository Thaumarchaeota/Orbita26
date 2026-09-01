use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::canonical::{canonical_json, content_hash};

pub fn validate_and_hash(record_type: &str, natural_key: &Value, snapshot: &Value) -> Result<String> {
    validate_natural_key(record_type, natural_key, snapshot)?;
    Ok(content_hash(natural_key))
}

/// Identity fields are duplicated deliberately in the envelope and snapshot.
/// Reject divergence before persistence: accepting either copy would let a
/// client move a record onto another fact's natural-key slot.
pub fn validate_snapshot_identity(
    record_type: &str,
    record_id: &str,
    natural_key: &Value,
    snapshot: &Value,
) -> Result<()> {
    let snapshot_id = snapshot
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("snapshot id required"))?;
    if snapshot_id != record_id {
        return Err(anyhow!("snapshot id must equal recordId"));
    }
    let embedded = snapshot
        .get("naturalKey")
        .ok_or_else(|| anyhow!("snapshot naturalKey required"))?;
    if canonical_json(embedded) != canonical_json(natural_key) {
        return Err(anyhow!("snapshot naturalKey must equal envelope naturalKey"));
    }
    let derived = build_natural_key_from_snapshot(record_type, snapshot)?;
    if canonical_json(&derived) != canonical_json(natural_key) {
        return Err(anyhow!("naturalKey does not match snapshot identity fields"));
    }
    validate_natural_key(record_type, natural_key, snapshot)
}

pub fn validate_tombstone_identity(record_id: &str, tombstone_id: &str) -> Result<()> {
    if record_id != tombstone_id {
        return Err(anyhow!("tombstone id must equal recordId"));
    }
    Ok(())
}

/// Source comes from the signed/validated fact representation, never from the
/// client supplied `origin` label.  Deletes retain source in their natural key.
pub fn fact_source(op: &crate::sync::types::SyncChange) -> &str {
    op.snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.get("source"))
        .and_then(Value::as_str)
        .or_else(|| {
            op.natural_key
                .as_ref()
                .and_then(|natural_key| natural_key.get("source"))
                .and_then(Value::as_str)
        })
        .unwrap_or("manual")
}

pub fn validate_natural_key(record_type: &str, natural_key: &Value, snapshot: &Value) -> Result<()> {
    let obj = natural_key
        .as_object()
        .ok_or_else(|| anyhow!("naturalKey must be object"))?;
    let source = natural_key_source(natural_key, snapshot);

    match record_type {
        "daily_metrics" => require_fields(obj, &["localDate", "source"]),
        "metric_day_snapshot" => {
            require_fields(obj, &["localDate", "metricName", "source", "coverage", "contentHash"])
        }
        "sleep_night" => require_fields(obj, &["wakeDate", "source"]),
        "nap" if source == "garmin" => require_fields(obj, &["localDate", "source", "externalKey"]),
        "nap" => require_fields(obj, &["id"]),
        "meal" | "event" | "mood" | "note" => require_fields(obj, &["id"]),
        "activity" if source == "garmin" => require_fields(obj, &["externalId", "source"]),
        "activity" => require_fields(obj, &["id"]),
        "body_measurement" => require_fields(obj, &["localDate", "source", "contentHash"]),
        other => Err(anyhow!("unsupported record_type for natural key: {other}")),
    }
}

pub fn validate_natural_key_for_delete(record_type: &str, natural_key: &Value) -> Result<()> {
    let obj = natural_key
        .as_object()
        .ok_or_else(|| anyhow!("naturalKey must be object"))?;
    let source = natural_key_source(natural_key, &Value::Null);
    match record_type {
        "daily_metrics" => require_fields(obj, &["localDate", "source"]),
        "metric_day_snapshot" => {
            require_fields(obj, &["localDate", "metricName", "source", "coverage", "contentHash"])
        }
        "sleep_night" => require_fields(obj, &["wakeDate", "source"]),
        "nap" if source == "garmin" => require_fields(obj, &["localDate", "source", "externalKey"]),
        "nap" => require_fields(obj, &["id"]),
        "meal" | "event" | "mood" | "note" => require_fields(obj, &["id"]),
        "activity" if source == "garmin" => require_fields(obj, &["externalId", "source"]),
        "activity" => require_fields(obj, &["id"]),
        "body_measurement" => require_fields(obj, &["localDate", "source", "contentHash"]),
        other => Err(anyhow!("unsupported record_type for natural key: {other}")),
    }
}

fn natural_key_source<'a>(natural_key: &'a Value, snapshot: &'a Value) -> &'a str {
    natural_key
        .get("source")
        .and_then(|v| v.as_str())
        .or_else(|| snapshot.get("source").and_then(|v| v.as_str()))
        .unwrap_or("manual")
}

fn require_fields(obj: &serde_json::Map<String, Value>, fields: &[&str]) -> Result<()> {
    for f in fields {
        if !obj.contains_key(*f) {
            return Err(anyhow!("naturalKey missing field: {f}"));
        }
    }
    Ok(())
}

pub fn canonical_natural_key_json(natural_key: &Value) -> String {
    canonical_json(natural_key)
}

pub fn build_natural_key_from_snapshot(record_type: &str, snapshot: &Value) -> Result<Value> {
    let source = snapshot
        .get("source")
        .and_then(|v| v.as_str())
        .unwrap_or("manual");
    let nk = match record_type {
        "daily_metrics" => json!({
            "localDate": snapshot.get("localDate"),
            "source": source
        }),
        "metric_day_snapshot" => json!({
            "localDate": snapshot.get("localDate"),
            "metricName": snapshot.get("metricName"),
            "source": source,
            "coverage": snapshot.get("payload").and_then(|p| p.get("coverage")),
            "contentHash": snapshot.get("contentHash")
        }),
        "sleep_night" => json!({
            "wakeDate": snapshot.get("wakeDate"),
            "source": source
        }),
        "nap" if source == "garmin" => json!({
            "localDate": snapshot.get("localDate"),
            "source": source,
            "externalKey": snapshot.get("externalKey")
        }),
        "nap" => json!({ "id": snapshot.get("id") }),
        "meal" | "event" | "mood" | "note" => json!({ "id": snapshot.get("id") }),
        "activity" if source == "garmin" => json!({
            "externalId": snapshot.get("externalId"),
            "source": source
        }),
        "activity" => json!({ "id": snapshot.get("id") }),
        "body_measurement" => json!({
            "localDate": snapshot.get("localDate"),
            "source": source,
            "contentHash": snapshot.get("contentHash")
        }),
        other => return Err(anyhow!("cannot derive natural key for {other}")),
    };
    Ok(nk)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn garmin_delete_natural_key_from_key_not_snapshot() {
        let nk = json!({
            "externalId": "123",
            "source": "garmin"
        });
        validate_natural_key_for_delete("activity", &nk).unwrap();
    }
}
