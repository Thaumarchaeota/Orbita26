//! Independent offline counterexamples for invocation-only normalized reuse.
use super::fetch_reuse::*;
use super::protocol::{validate_pair, UnitRequest, UnitResponse, PROTOCOL_VERSION};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

fn context() -> ReuseContext {
    ReuseContext {
        job_id: "job".into(), data_dir_key: "dir".into(), token_dir: PathBuf::from("synthetic-token-root"),
        gate_generation: 4, auth_epoch: 2,
        credential_files: vec![("synthetic-credential".into(), 12, SystemTime::UNIX_EPOCH, SystemTime::UNIX_EPOCH)],
    }
}

fn entry(class_id: &str, id: &str) -> Value {
    let mut result = json!({"classId":class_id,"localDate":"2026-10-23","completeness":"complete",
        "parserVersion":2,"contentHash":"a".repeat(64),"payload":{"value":42}});
    if class_id == "activity" { result["externalId"] = json!(id); }
    result
}

fn request(class_id: &str, id: &str) -> UnitRequest {
    UnitRequest { protocol_version:PROTOCOL_VERSION, request_id:"new-request".into(), job_id:"job".into(),
        work_item_id:"independent-work-item".into(), data_dir_key:"dir".into(), cancellation_generation:17,
        unit_kind:if class_id == "activity" {"fetch_activity_summary"} else {"fetch_daily_class"}.into(),
        target:if class_id == "activity" {json!({"localDate":"2026-10-23","externalId":id})}
            else {json!({"localDate":"2026-10-23","classId":class_id})}, staging_path:None }
}

#[test]
fn reuse_stamps_current_work_identity_and_preserves_payload_hash_once() {
    let ctx = context();
    for (class_id, id) in [("sleep_night", ""), ("nap", ""), ("activity", "42")] {
        let mut reuse = RunFetchReuse::default();
        let original = entry(class_id, id);
        assert!(reuse.insert(&ctx, original.clone()));
        let req = request(class_id, id);
        let response = reuse.take_for(&ctx, &req).unwrap();
        validate_pair(&req, &response, "dir").unwrap();
        assert_eq!(response.payload, Some(original));
        assert_eq!(response.content_hash, Some("a".repeat(64)));
        assert_eq!(response.work_item_id, "independent-work-item");
        assert_eq!(response.cancellation_generation, 17);
        assert!(response.related_entries.is_empty());
        assert!(reuse.take_for(&ctx, &req).is_none());
    }
}

#[test]
fn absent_or_mismatched_target_is_a_cache_miss_without_substituting_another_unit() {
    let ctx = context();
    let mut reuse = RunFetchReuse::default();
    assert!(reuse.take_for(&ctx, &request("nap", "")).is_none());
    assert!(reuse.insert(&ctx, entry("activity", "42")));
    assert!(reuse.take_for(&ctx, &request("activity", "43")).is_none());
    let mut req = request("activity", "42");
    req.target["localDate"] = json!("2026-10-22");
    assert!(reuse.take_for(&ctx, &req).is_none());
    assert!(reuse.take_for(&ctx, &request("nap", "")).is_none());
    assert!(reuse.take_for(&ctx, &request("activity", "42")).is_some());
    // New invocation has no persisted reuse, including when only a summary gap remains.
    assert!(RunFetchReuse::default().take_for(&ctx, &request("activity", "42")).is_none());
}

#[test]
fn every_context_change_invalidates_old_results_and_unknown_context_fails_closed() {
    let original = context();
    let mut changed = Vec::new();
    let mut value = original.clone(); value.job_id = "other-job".into(); changed.push(value);
    let mut value = original.clone(); value.data_dir_key = "other-dir".into(); changed.push(value);
    let mut value = original.clone(); value.token_dir = PathBuf::from("other-token-root"); changed.push(value);
    let mut value = original.clone(); value.gate_generation += 1; changed.push(value);
    let mut value = original.clone(); value.auth_epoch += 1; changed.push(value);
    let mut value = original.clone(); value.credential_files[0].1 += 1; changed.push(value);
    let mut value = original.clone(); value.credential_files[0].2 += Duration::from_secs(1); changed.push(value);
    let mut value = original.clone(); value.credential_files[0].3 += Duration::from_secs(1); changed.push(value);
    let mut value = original.clone(); value.credential_files.push(("new-file".into(), 1, SystemTime::UNIX_EPOCH, SystemTime::UNIX_EPOCH)); changed.push(value);
    for ctx in changed {
        let mut reuse = RunFetchReuse::default();
        assert!(reuse.insert(&original, entry("nap", "")));
        assert!(reuse.take_for(&ctx, &request("nap", "")).is_none());
        assert!(reuse.take_for(&original, &request("nap", "")).is_none());
    }
    let mut reuse = RunFetchReuse::default();
    assert!(reuse.insert(&original, entry("nap", "")));
    reuse.observe_context(None);
    assert!(reuse.take_for(&original, &request("nap", "")).is_none());
}

#[test]
fn wrong_job_or_directory_request_cannot_consume_reuse() {
    for field in ["job", "directory"] {
        let ctx = context();
        let mut reuse = RunFetchReuse::default();
        assert!(reuse.insert(&ctx, entry("nap", "")));
        let mut req = request("nap", "");
        if field == "job" { req.job_id = "other".into(); } else { req.data_dir_key = "other".into(); }
        assert!(reuse.take_for(&ctx, &req).is_none());
        assert!(reuse.take_for(&ctx, &request("nap", "")).is_none());
    }
}

#[test]
fn rejects_incomplete_or_invalid_entries_without_displacing_a_successful_sibling() {
    let ctx = context();
    let mut invalid = Vec::new();
    for completeness in ["empty", "failed", "incomplete"] {
        let mut value = entry("nap", ""); value["completeness"] = json!(completeness); invalid.push(value);
    }
    for version in [json!(1), json!(null), json!("2")] {
        let mut value = entry("nap", ""); value["parserVersion"] = version; invalid.push(value);
    }
    let mut value = entry("nap", ""); value["contentHash"] = json!(""); invalid.push(value);
    let mut value = entry("nap", ""); value["payload"] = json!(null); invalid.push(value);
    let mut value = entry("nap", ""); value["localDate"] = json!("2026-2-03"); invalid.push(value);
    let mut value = entry("nap", ""); value["localDate"] = json!("2026-02-30"); invalid.push(value);
    invalid.push(entry("health_day_summary", ""));
    invalid.push(entry("activity", ""));
    invalid.push(entry("activity", "x|y"));
    for value in invalid {
        let mut reuse = RunFetchReuse::default();
        assert!(reuse.insert(&ctx, entry("sleep_night", "")));
        assert!(!reuse.insert(&ctx, value.clone()), "unexpectedly accepted {value}");
        assert!(reuse.take_for(&ctx, &request("sleep_night", "")).is_some());
    }
}

fn sized_entry(id: &str, bytes: usize) -> Value {
    let mut value = entry("activity", id);
    value["payload"]["padding"] = json!("");
    let overhead = serde_json::to_vec(&value).unwrap().len();
    value["payload"]["padding"] = json!("x".repeat(bytes - overhead));
    assert_eq!(serde_json::to_vec(&value).unwrap().len(), bytes);
    value
}

#[test]
fn entry_byte_limit_is_inclusive_and_rejected_overflow_keeps_prior_results() {
    let ctx = context();
    let mut reuse = RunFetchReuse::default();
    assert!(reuse.insert(&ctx, sized_entry("42", MAX_REUSE_ENTRY_BYTES)));
    assert!(!reuse.insert(&ctx, sized_entry("43", MAX_REUSE_ENTRY_BYTES + 1)));
    assert!(reuse.take_for(&ctx, &request("activity", "42")).is_some());
}

#[test]
fn total_byte_and_count_limits_are_bounded_and_consumption_releases_budget() {
    let ctx = context();
    let mut reuse = RunFetchReuse::default();
    assert!(reuse.insert(&ctx, sized_entry("41", MAX_REUSE_ENTRY_BYTES)));
    assert!(reuse.insert(&ctx, sized_entry("42", MAX_REUSE_BYTES - MAX_REUSE_ENTRY_BYTES)));
    assert!(!reuse.insert(&ctx, entry("activity", "43")));
    assert!(reuse.take_for(&ctx, &request("activity", "41")).is_some());
    assert!(reuse.insert(&ctx, entry("activity", "43")));
    reuse.clear();
    for id in 0..MAX_REUSE_ENTRIES { assert!(reuse.insert(&ctx, entry("activity", &id.to_string()))); }
    assert!(!reuse.insert(&ctx, entry("activity", "overflow")));
    assert!(reuse.take_for(&ctx, &request("activity", "0")).is_some());
    assert!(reuse.insert(&ctx, entry("activity", "overflow")));
    // Duplicate identity cannot replace a previously acquired source snapshot.
    assert!(!reuse.insert(&ctx, entry("activity", "1")));
}

#[test]
fn sleep_pool_stops_at_seven_independently_of_activity_capacity_and_releases_slots() {
    let ctx = context();
    let mut reuse = RunFetchReuse::default();
    for day in 17..24 {
        let mut value = entry(if day % 2 == 0 { "sleep_night" } else { "nap" }, "");
        value["localDate"] = json!(format!("2026-10-{day}"));
        assert!(reuse.insert(&ctx, value));
    }
    assert!(!reuse.insert(&ctx, entry("sleep_night", "")));
    assert!(reuse.insert(&ctx, entry("activity", "42")));
    assert!(reuse.take_for(&ctx, &request("nap", "")).is_some());
    assert!(reuse.insert(&ctx, entry("sleep_night", "")));
    reuse.clear();
    assert!(reuse.insert(&ctx, entry("nap", "")));
}

fn sized_sleep_entry(class_id: &str, bytes: usize) -> Value {
    let mut value = entry(class_id, "");
    value["payload"]["padding"] = json!("");
    let overhead = serde_json::to_vec(&value).unwrap().len();
    value["payload"]["padding"] = json!("x".repeat(bytes - overhead));
    assert_eq!(serde_json::to_vec(&value).unwrap().len(), bytes);
    value
}

#[test]
fn sleep_byte_pool_is_inclusive_at_256k_and_separate_from_activity_bytes() {
    let ctx = context();
    let mut reuse = RunFetchReuse::default();
    assert!(reuse.insert(&ctx, sized_sleep_entry("sleep_night", MAX_SLEEP_REUSE_BYTES)));
    assert!(!reuse.insert(&ctx, entry("nap", "")));
    assert!(reuse.insert(&ctx, sized_entry("42", MAX_REUSE_BYTES - MAX_SLEEP_REUSE_BYTES)));
    assert!(reuse.take_for(&ctx, &request("sleep_night", "")).is_some());
    assert!(reuse.insert(&ctx, entry("nap", "")));
    reuse.observe_context(None);
    assert!(reuse.insert(&ctx, sized_sleep_entry("sleep_night", MAX_SLEEP_REUSE_BYTES)));
}

fn discovery(rows: Vec<Value>) -> UnitResponse {
    UnitResponse { protocol_version:PROTOCOL_VERSION, request_id:"discovery-request".into(),
        job_id:"job".into(), work_item_id:"discovery-item".into(), unit_kind:"discover_activity_list".into(),
        data_dir_key:"dir".into(), cancellation_generation:0, outcome:"complete".into(),
        payload:Some(json!({"activities":rows,"evidence":{"complete":true,"duplicateActivityIds":false}})),
        content_hash:None, asset_length:None, asset_metadata:None, related_entries:Vec::new() }
}

fn discovery_row(id: &str) -> Value {
    json!({"externalId":id,"localDate":"2026-10-23","normalizedEntry":entry("activity", id)})
}

#[test]
fn discovery_repeated_ids_even_identical_reject_all_optional_rows_before_inserting() {
    let ctx = context();
    for duplicate in [discovery_row("42"), json!({"externalId":"42","localDate":"2026-10-22"})] {
        let mut reuse = RunFetchReuse::default();
        let response = discovery(vec![discovery_row("41"), discovery_row("42"), duplicate]);
        assert!(!reuse.ingest_discovery(&ctx, &response));
        assert!(reuse.take_for(&ctx, &request("activity", "41")).is_none());
        assert!(reuse.take_for(&ctx, &request("activity", "42")).is_none());
    }
}

#[test]
fn discovery_requires_complete_evidence_correct_context_and_valid_outer_ids() {
    let ctx = context();
    let valid = discovery(vec![discovery_row("42")]);
    let mut invalid = Vec::new();
    for outcome in ["incomplete", "retryable_failure", "rate_limited", "empty_unverified"] {
        let mut value = valid.clone(); value.outcome = outcome.into(); invalid.push(value);
    }
    let mut value = valid.clone(); value.unit_kind = "fetch_activity_summary".into(); invalid.push(value);
    let mut value = valid.clone(); value.job_id = "other".into(); invalid.push(value);
    let mut value = valid.clone(); value.data_dir_key = "other".into(); invalid.push(value);
    let mut value = valid.clone(); value.payload = None; invalid.push(value);
    for complete in [json!(false), json!(null), json!("true")] {
        let mut value = valid.clone(); value.payload.as_mut().unwrap()["evidence"]["complete"] = complete; invalid.push(value);
    }
    let mut value = valid.clone(); value.payload.as_mut().unwrap()["evidence"]["duplicateActivityIds"] = json!(true); invalid.push(value);
    for id in [json!(""), json!("  "), json!("x|y"), json!(42), json!(null)] {
        let mut row = discovery_row("42"); row["externalId"] = id;
        invalid.push(discovery(vec![discovery_row("41"), row]));
    }
    for response in invalid {
        let mut reuse = RunFetchReuse::default();
        assert!(!reuse.ingest_discovery(&ctx, &response));
        assert!(reuse.take_for(&ctx, &request("activity", "41")).is_none());
        assert!(reuse.take_for(&ctx, &request("activity", "42")).is_none());
    }
    let mut reuse = RunFetchReuse::default();
    assert!(reuse.ingest_discovery(&ctx, &discovery(Vec::new())));
    assert!(reuse.take_for(&ctx, &request("activity", "42")).is_none());
}

#[test]
fn discovery_normalization_identity_mismatch_misses_only_that_summary() {
    let ctx = context();
    let mut invalid_rows = Vec::new();
    let mut row = discovery_row("42"); row["normalizedEntry"]["externalId"] = json!("43"); invalid_rows.push(row);
    let mut row = discovery_row("42"); row["normalizedEntry"]["localDate"] = json!("2026-10-22"); invalid_rows.push(row);
    let mut row = discovery_row("42"); row["normalizedEntry"]["classId"] = json!("nap"); invalid_rows.push(row);
    let mut row = discovery_row("42"); row["normalizedEntry"]["completeness"] = json!("failed"); invalid_rows.push(row);
    let mut row = discovery_row("42"); row.as_object_mut().unwrap().remove("normalizedEntry"); invalid_rows.push(row);
    for row in invalid_rows {
        let mut reuse = RunFetchReuse::default();
        assert!(reuse.ingest_discovery(&ctx, &discovery(vec![discovery_row("41"), row])));
        assert!(reuse.take_for(&ctx, &request("activity", "41")).is_some());
        assert!(reuse.take_for(&ctx, &request("activity", "42")).is_none());
    }
}

#[test]
fn discovery_over_budget_preserves_base_list_and_falls_back_only_for_unstored_summaries() {
    let ctx = context();
    let response = discovery((0..=MAX_REUSE_ENTRIES).map(|id| discovery_row(&id.to_string())).collect());
    let original = response.clone();
    let mut reuse = RunFetchReuse::default();
    assert!(reuse.ingest_discovery(&ctx, &response));
    assert_eq!(response, original);
    for id in 0..MAX_REUSE_ENTRIES { assert!(reuse.take_for(&ctx, &request("activity", &id.to_string())).is_some()); }
    assert!(reuse.take_for(&ctx, &request("activity", &MAX_REUSE_ENTRIES.to_string())).is_none());

    let mut first = discovery_row("41"); first["normalizedEntry"] = sized_entry("41", MAX_REUSE_ENTRY_BYTES);
    let mut second = discovery_row("42"); second["normalizedEntry"] = sized_entry("42", MAX_REUSE_BYTES - MAX_REUSE_ENTRY_BYTES);
    let mut reuse = RunFetchReuse::default();
    assert!(reuse.ingest_discovery(&ctx, &discovery(vec![first, second, discovery_row("43")])));
    assert!(reuse.take_for(&ctx, &request("activity", "41")).is_some());
    assert!(reuse.take_for(&ctx, &request("activity", "42")).is_some());
    assert!(reuse.take_for(&ctx, &request("activity", "43")).is_none());
}

#[cfg(windows)]
#[test]
fn credential_capture_tracks_synthetic_file_set_and_metadata_and_rejects_unknown_directory() {
    // This test installs only a temporary process gate. Run global-gate tests serially.
    struct Fixture { root: PathBuf, previous: Option<super::gate::GateStore> }
    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() { super::gate::install_process_gate(previous); }
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    let root = std::env::temp_dir().join(format!("orbita-reuse-metadata-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let previous = super::gate::with_process_gate(|gate| gate.clone());
    let fixture = Fixture { root, previous };
    let gate_dir = fixture.root.join("gate");
    let tokens = fixture.root.join("synthetic-tokens");
    std::fs::create_dir_all(&tokens).unwrap();
    super::install_gate_for_tests(&gate_dir, true);
    let _lane = super::lane::try_acquire_request().expect("serial test owns the request lane");
    std::fs::write(tokens.join("garmin_tokens.json"), b"synthetic fixture only").unwrap();
    let first = capture_context("job", "dir", &tokens).expect("regular synthetic metadata");
    std::fs::write(tokens.join("garmin_route.json"), b"diagnostic changes are irrelevant").unwrap();
    assert_eq!(capture_context("job", "dir", &tokens).as_ref(), Some(&first));
    std::fs::write(tokens.join("garmin_tokens.json"), b"synthetic fixture with a different length only").unwrap();
    let changed = capture_context("job", "dir", &tokens).unwrap();
    assert_ne!(first, changed);
    std::fs::write(tokens.join("oauth-extra.json"), b"another synthetic fixture").unwrap();
    let added = capture_context("job", "dir", &tokens).unwrap();
    assert_ne!(changed, added);
    std::fs::remove_file(tokens.join("oauth-extra.json")).unwrap();
    assert_eq!(capture_context("job", "dir", &tokens).as_ref(), Some(&changed));
    advance_auth_epoch();
    assert_ne!(capture_context("job", "dir", &tokens).unwrap(), changed);
    std::fs::create_dir(tokens.join("unknown-directory")).unwrap();
    assert!(capture_context("job", "dir", &tokens).is_none());
}
