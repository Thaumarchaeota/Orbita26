use std::collections::HashMap;
use std::sync::OnceLock;

use anyhow::{anyhow, Result};
use jsonschema::{Draft, Resource, Validator};
use serde_json::Value;

const CONTRACT_VERSION: &str = "journal-health/v1";
const COMMON_URI: &str = "https://orbita.local/contracts/journal-health/v1/schemas/_common.json";
const ENVELOPE_URI: &str = "https://orbita.local/contracts/journal-health/v1/sync-envelope.json";

static VALIDATORS: OnceLock<HashMap<String, Validator>> = OnceLock::new();

macro_rules! schema_json {
    ($name:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../contracts/journal-health/v1/schemas/",
            $name,
            ".json"
        ))
    };
}

const ENVELOPE_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../contracts/journal-health/v1/sync-envelope.json"
));

const ENDPOINT_RECORD_SCHEMAS: &[(&str, &str)] = &[
    ("https://orbita.local/contracts/journal-health/v1/schemas/daily_metrics.json", schema_json!("daily_metrics")),
    ("https://orbita.local/contracts/journal-health/v1/schemas/metric_day_snapshot.json", schema_json!("metric_day_snapshot")),
    ("https://orbita.local/contracts/journal-health/v1/schemas/sleep_night.json", schema_json!("sleep_night")),
    ("https://orbita.local/contracts/journal-health/v1/schemas/nap.json", schema_json!("nap")),
    ("https://orbita.local/contracts/journal-health/v1/schemas/meal.json", schema_json!("meal")),
    ("https://orbita.local/contracts/journal-health/v1/schemas/activity.json", schema_json!("activity")),
    ("https://orbita.local/contracts/journal-health/v1/schemas/body_measurement.json", schema_json!("body_measurement")),
    ("https://orbita.local/contracts/journal-health/v1/schemas/event.json", schema_json!("event")),
    ("https://orbita.local/contracts/journal-health/v1/schemas/mood.json", schema_json!("mood")),
    ("https://orbita.local/contracts/journal-health/v1/schemas/note.json", schema_json!("note")),
];

pub fn validate_snapshot(record_type: &str, snapshot: &Value) -> Result<()> {
    let validators = validators();
    let schema = validators
        .get(record_type)
        .ok_or_else(|| anyhow!("no schema for record type: {record_type}"))?;
    if let Err(error) = schema.validate(snapshot) {
        return Err(anyhow!("schema validation failed: {error}"));
    }
    Ok(())
}

fn validators() -> &'static HashMap<String, Validator> {
    VALIDATORS.get_or_init(|| {
        let common_val: Value =
            serde_json::from_str(schema_json!("_common")).expect("parse _common.json");
        let specs: &[(&str, &str)] = &[
            ("daily_metrics", schema_json!("daily_metrics")),
            ("metric_day_snapshot", schema_json!("metric_day_snapshot")),
            ("sleep_night", schema_json!("sleep_night")),
            ("nap", schema_json!("nap")),
            ("meal", schema_json!("meal")),
            ("activity", schema_json!("activity")),
            ("body_measurement", schema_json!("body_measurement")),
            ("event", schema_json!("event")),
            ("mood", schema_json!("mood")),
            ("note", schema_json!("note")),
        ];
        let mut map = HashMap::new();
        for (name, raw) in specs {
            let doc: Value = serde_json::from_str(raw).unwrap_or_else(|e| panic!("parse {name}: {e}"));
            let common_resource =
                Resource::from_contents(common_val.clone()).unwrap_or_else(|e| {
                    panic!("common resource: {e}")
                });
            let validator = Validator::options()
                .with_draft(Draft::Draft202012)
                .with_resource(COMMON_URI, common_resource)
                .build(&doc)
                .unwrap_or_else(|e| panic!("compile schema {name}: {e}"));
            map.insert((*name).to_string(), validator);
        }
        map
    })
}

/// Compile an endpoint schema from the published contract rather than trusting
/// Rust DTO deserialization alone.  DTOs prevent unknown fields, while this
/// catches contract-required cross-field constraints before any DB mutation.
fn validate_endpoint(definition: &str, value: &Value) -> Result<()> {
    let common: Value = serde_json::from_str(schema_json!("_common"))?;
    let envelope: Value = serde_json::from_str(ENVELOPE_SCHEMA)?;
    let wrapper = serde_json::json!({
        "$ref": format!("{ENVELOPE_URI}#/$defs/{definition}")
    });
    let mut binding = Validator::options();
    let mut options = binding
        .with_draft(Draft::Draft202012)
        .with_resource(COMMON_URI, Resource::from_contents(common)?)
        .with_resource(ENVELOPE_URI, Resource::from_contents(envelope)?);
    // Endpoint schemas reference every concrete snapshot schema through the
    // envelope. Register all of them; otherwise a resolver can leave the
    // oneOf unvalidated and accept a shape Rust happened to deserialize.
    for (uri, raw) in ENDPOINT_RECORD_SCHEMAS {
        let schema: Value = serde_json::from_str(raw)?;
        options = options.with_resource(*uri, Resource::from_contents(schema)?);
    }
    let validator = options.build(&wrapper)?;
    if let Err(error) = validator.validate(value) {
        return Err(anyhow!("{definition} contract validation failed: {error}"));
    }
    Ok(())
}

pub fn validate_push_request(request: &crate::sync::types::PushRequest) -> Result<()> {
    validate_endpoint("SyncOperation", &serde_json::to_value(request)?)
}

pub fn validate_pull_request(request: &crate::sync::types::PullRequest) -> Result<()> {
    validate_endpoint("PullRequest", &serde_json::to_value(request)?)
}

pub fn validate_ack_request(request: &crate::sync::types::AckRequest) -> Result<()> {
    validate_endpoint("AckRequest", &serde_json::to_value(request)?)
}

pub fn validate_push_response(response: &crate::sync::types::PushResponse) -> Result<()> {
    validate_endpoint("SyncResult", &serde_json::to_value(response)?)
}

pub fn validate_pull_response(response: &crate::sync::types::PullResponse) -> Result<()> {
    validate_endpoint("PullResponse", &serde_json::to_value(response)?)
}

pub fn validate_ack_response(response: &crate::sync::types::AckResponse) -> Result<()> {
    validate_endpoint("AckResponse", &serde_json::to_value(response)?)
}

pub fn validate_change_contract(change: &crate::sync::types::SyncChange) -> Result<()> {
    if change.contract_version != CONTRACT_VERSION {
        return Err(anyhow!("per-change contractVersion mismatch"));
    }
    Ok(())
}

pub fn validate_content_hash_pattern(hash: &str) -> Result<()> {
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)) {
        return Err(anyhow!("contentHash must be 64-char lowercase hex"));
    }
    Ok(())
}

pub fn validate_uuid(id: &str) -> Result<()> {
    uuid::Uuid::parse_str(id).map_err(|_| anyhow!("invalid uuid"))?;
    Ok(())
}

pub fn validate_rfc3339_utc(ts: &str) -> Result<()> {
    if ts.contains('.') {
        return Err(anyhow!("sub-second timestamps prohibited in v1"));
    }
    chrono::DateTime::parse_from_rfc3339(ts)
        .map_err(|_| anyhow!("invalid RFC3339 timestamp"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_content_hash() {
        assert!(validate_content_hash_pattern("abc").is_err());
    }

    #[test]
    fn validates_note_fixture_shape() {
        let snap: Value = serde_json::from_str(include_str!(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../contracts/journal-health/v1/fixtures/note.json"
            )
        ))
        .unwrap();
        assert!(validate_snapshot("note", &snap).is_ok());
    }
}
