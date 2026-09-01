//! Cross-module regression checks for the non-TickTick sync safety boundary.
//!
//! These deliberately exercise only public service APIs.  They prevent a later
//! refactor from making a locally-valid DTO bypass the contract, identity,
//! delivery, collector, backup, or diagnostics invariants.

use std::fs;
use std::sync::Arc;

use orbita_sync::auth::AuthContext;
use orbita_sync::canonical::snapshot_content_hash;
use orbita_sync::config::state_dir_from;
use orbita_sync::db::repository::with_transaction;
use orbita_sync::db::Database;
use orbita_sync::diagnostics::{build_bundle, TimelineRepo};
use orbita_sync::diagnostics::timeline::EVENT_PUSH;
use orbita_sync::metrics::Metrics;
use orbita_sync::sync::{
    ack_delivery, apply_push_ops, pull_changes, AckRequest, OpStatus, PullRequest, PushRequest,
    SyncChange,
};
use orbita_sync::sync::schema_validate::{validate_ack_request, validate_pull_request, validate_push_request};
use orbita_sync::sync::validate::validate_operation;
use orbita_sync::tools::{online_backup, BackupOptions};
use rusqlite::Connection;
use serde_json::{json, Value};
use tempfile::{tempdir, TempDir};
use uuid::Uuid;

const CONTRACT_VERSION: &str = "journal-health/v1";
const WHEN: &str = "2026-01-15T08:00:00Z";

fn test_db() -> (TempDir, Arc<Database>) {
    let dir = tempdir().expect("test directory");
    let mut config = state_dir_from(dir.path());
    config.backup_dir = dir.path().join("backups");
    let db = Database::open(&config).expect("migrated test database");
    (dir, db)
}

fn auth(account_id: &str, device_id: &str, capabilities: &[&str]) -> AuthContext {
    AuthContext {
        account_id: account_id.to_owned(),
        device_id: device_id.to_owned(),
        capabilities: capabilities.iter().map(|cap| (*cap).to_owned()).collect(),
    }
}

fn note_change(record_id: &str) -> SyncChange {
    let natural_key = json!({ "id": record_id });
    let snapshot = json!({
        "id": record_id,
        "localDate": "2026-01-15",
        "source": "manual",
        "revision": 1,
        "payload": { "title": "acceptance", "body": "private note", "at": 1768464000 },
        "naturalKey": natural_key,
        "createdAtUtc": WHEN,
        "updatedAtUtc": WHEN,
        "deletedAtUtc": null
    });
    let content_hash = snapshot_content_hash("note", &snapshot).expect("note hash");
    SyncChange {
        op_id: Uuid::new_v4().to_string(),
        contract_version: CONTRACT_VERSION.to_owned(),
        domain: "journal".to_owned(),
        record_type: "note".to_owned(),
        record_id: record_id.to_owned(),
        kind: "upsert".to_owned(),
        // This is deliberately non-authoritative metadata; the fact itself is manual.
        origin: "desktop".to_owned(),
        local_revision: 1,
        base_server_version: None,
        content_hash: Some(content_hash),
        snapshot: Some(snapshot),
        tombstone: None,
        natural_key: Some(natural_key),
        conflict_id: None,
        created_at_utc: WHEN.to_owned(),
    }
}

fn garmin_activity_change(record_id: &str) -> SyncChange {
    let natural_key = json!({ "externalId": "garmin-activity-42", "source": "garmin" });
    let mut snapshot = json!({
        "id": record_id,
        "localDate": "2026-01-15",
        "source": "garmin",
        "revision": 1,
        "externalId": "garmin-activity-42",
        "activity": { "sport": "running", "duration": 1800, "metrics": { "startTime": 1768464000 } },
        "contentHash": "",
        "naturalKey": natural_key,
        "createdAtUtc": WHEN,
        "updatedAtUtc": WHEN,
        "deletedAtUtc": null
    });
    let content_hash = snapshot_content_hash("activity", &snapshot).expect("activity hash");
    snapshot["contentHash"] = Value::String(content_hash.clone());
    SyncChange {
        op_id: Uuid::new_v4().to_string(),
        contract_version: CONTRACT_VERSION.to_owned(),
        domain: "health".to_owned(),
        record_type: "activity".to_owned(),
        record_id: record_id.to_owned(),
        kind: "upsert".to_owned(),
        // An untrusted client must not turn a Garmin fact into a manual fact by this label.
        origin: "manual".to_owned(),
        local_revision: 1,
        base_server_version: None,
        content_hash: Some(content_hash),
        snapshot: Some(snapshot),
        tombstone: None,
        natural_key: Some(natural_key),
        conflict_id: None,
        created_at_utc: WHEN.to_owned(),
    }
}

#[test]
fn published_request_schemas_reject_unknown_fields_and_identity_divergence() {
    let device_id = Uuid::new_v4().to_string();
    let push = PushRequest {
        contract_version: CONTRACT_VERSION.to_owned(),
        device_id: device_id.clone(),
        client_change_seq: 0,
        changes: vec![],
    };
    validate_push_request(&push).expect("published push schema accepts its DTO");
    validate_pull_request(&PullRequest {
        contract_version: CONTRACT_VERSION.to_owned(),
        device_id: device_id.clone(),
        cursor: 0,
        limit: Some(1),
    })
    .expect("published pull schema accepts its DTO");
    validate_ack_request(&AckRequest {
        contract_version: CONTRACT_VERSION.to_owned(),
        device_id,
        delivered_change_seq: 0,
    })
    .expect("published ack schema accepts its DTO");

    let record_id = Uuid::new_v4().to_string();
    let mut mismatched = note_change(&record_id);
    mismatched.snapshot.as_mut().unwrap()["id"] = Value::String(Uuid::new_v4().to_string());
    assert!(validate_operation(&mismatched).is_err(), "snapshot.id must not be able to diverge from recordId");

    let raw = serde_json::to_value(PushRequest {
        contract_version: CONTRACT_VERSION.to_owned(),
        device_id: Uuid::new_v4().to_string(),
        client_change_seq: 0,
        changes: vec![],
    })
    .unwrap();
    let mut unknown_field = raw.as_object().unwrap().clone();
    unknown_field.insert("schemaVersion".to_owned(), json!(1));
    let parsed: Result<PushRequest, _> = serde_json::from_value(Value::Object(unknown_field));
    assert!(parsed.is_err(), "wire DTO must deny fields absent from the contract");
}

#[test]
fn ack_cannot_advance_past_a_watermark_issued_to_that_device() {
    let (_dir, db) = test_db();
    let account_id = Uuid::new_v4().to_string();
    let writer_id = Uuid::new_v4().to_string();
    let reader_id = Uuid::new_v4().to_string();
    let writer = auth(&account_id, &writer_id, &["sync"]);
    let reader = auth(&account_id, &reader_id, &["sync"]);
    let metrics = Metrics::new();

    let pushed = apply_push_ops(
        &db,
        &writer,
        PushRequest {
            contract_version: CONTRACT_VERSION.to_owned(),
            device_id: writer_id,
            client_change_seq: 0,
            changes: vec![note_change(&Uuid::new_v4().to_string())],
        },
        &metrics,
        Some("op-chain".to_owned()),
    )
    .expect("writer push");
    assert_eq!(pushed.outcomes[0].status, OpStatus::Accepted);
    let issued_seq = pushed.outcomes[0].change_seq.expect("server sequence");

    assert!(ack_delivery(
        &db,
        &reader,
        AckRequest {
            contract_version: CONTRACT_VERSION.to_owned(),
            device_id: reader_id.clone(),
            delivered_change_seq: issued_seq,
        },
        None,
    )
    .is_err(), "a device must not ACK data it was never issued");

    let pulled = pull_changes(
        &db,
        &reader,
        PullRequest {
            contract_version: CONTRACT_VERSION.to_owned(),
            device_id: reader_id.clone(),
            cursor: 0,
            limit: Some(10),
        },
        &metrics,
        Some("op-chain".to_owned()),
    )
    .expect("reader pull");
    assert_eq!(pulled.next_change_seq, issued_seq);

    let ack = ack_delivery(
        &db,
        &reader,
        AckRequest {
            contract_version: CONTRACT_VERSION.to_owned(),
            device_id: reader_id,
            delivered_change_seq: issued_seq,
        },
        Some("op-chain".to_owned()),
    )
    .expect("ACK after pull");
    assert_eq!(ack.delivered_change_seq, issued_seq);
}

#[test]
fn garmin_fact_cannot_be_authorized_by_forging_origin() {
    let (_dir, db) = test_db();
    let account_id = Uuid::new_v4().to_string();
    let device_id = Uuid::new_v4().to_string();
    let unprivileged = auth(&account_id, &device_id, &["sync"]);
    let metrics = Metrics::new();

    let response = apply_push_ops(
        &db,
        &unprivileged,
        PushRequest {
            contract_version: CONTRACT_VERSION.to_owned(),
            device_id,
            client_change_seq: 0,
            changes: vec![garmin_activity_change(&Uuid::new_v4().to_string())],
        },
        &metrics,
        None,
    )
    .expect("authorization denial is a per-operation result");
    assert_eq!(response.outcomes[0].status, OpStatus::Rejected);
    assert_eq!(
        response.outcomes[0].error.as_ref().map(|error| error.code.as_str()),
        Some("UNAUTHORIZED_GARMIN")
    );
}

#[test]
fn online_backup_is_read_only_to_source_and_publishes_no_temporary_image() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("live.sqlite");
    let destination = dir.path().join("backup.sqlite");
    {
        let connection = Connection::open(&source).unwrap();
        connection
            .execute_batch("CREATE TABLE facts (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO facts VALUES (1, 'original');")
            .unwrap();
    }
    let source_before = fs::read(&source).unwrap();

    online_backup(&source, &destination, &BackupOptions::default()).expect("online backup");

    assert_eq!(fs::read(&source).unwrap(), source_before, "backup must not mutate its source image");
    let backup = Connection::open(&destination).unwrap();
    let body: String = backup
        .query_row("SELECT body FROM facts WHERE id = 1", [], |row| row.get(0))
        .unwrap();
    assert_eq!(body, "original");
    assert!(
        fs::read_dir(dir.path())
            .unwrap()
            .all(|entry| !entry.unwrap().file_name().to_string_lossy().contains(".tmp")),
        "a successful publish must leave no partially-written temporary backup"
    );
}

#[test]
fn diagnostics_bundle_excludes_payload_and_internal_correlation_identifiers() {
    let (_dir, db) = test_db();
    let account_id = Uuid::new_v4().to_string();
    let op_id = Uuid::new_v4().to_string();
    with_transaction(&db, |tx| {
        TimelineRepo::append_event(
            tx,
            &account_id,
            &op_id,
            Some("internal-correlation-secret"),
            Some("collector-device-secret"),
            EVENT_PUSH,
            &json!({
                "status": "accepted",
                "kind": "upsert",
                "domain": "journal",
                "recordType": "note",
                "recordId": "record-id-must-not-leak",
                "snapshot": { "payload": { "body": "private diagnostic body" } }
            }),
        )
    })
    .unwrap();

    let serialized = serde_json::to_string(&build_bundle(&db, &account_id, Some(&op_id)).unwrap()).unwrap();
    for secret in [
        "private diagnostic body",
        "record-id-must-not-leak",
        "internal-correlation-secret",
        "collector-device-secret",
    ] {
        assert!(!serialized.contains(secret), "diagnostics exported secret: {secret}");
    }
    assert!(serialized.contains("accepted"));
    assert!(serialized.contains("recordType"));
}
