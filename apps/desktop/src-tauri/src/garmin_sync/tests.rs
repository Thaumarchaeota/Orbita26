use std::fs;
use std::path::PathBuf;

use chrono::NaiveDate;
use rusqlite::Connection;
use uuid::Uuid;

use crate::garmin_sync::dates::{daily_range_on, format_ymd, validate_advanced_range_on};
use crate::garmin_sync::error::{
    GARMIN_RANGE_INVALID, GARMIN_RANGE_TOO_LARGE, GARMIN_RATE_LIMIT_COOLDOWN_ACTIVE,
    GARMIN_RATE_LIMIT_RESTORE_STALE, GARMIN_RATE_LIMIT_UNKNOWN,
};
use crate::garmin_sync::gate::{GateStore, STATE_CLOSED, STATE_CLOSED_UNKNOWN, STATE_OPEN};
use crate::garmin_sync::machine::{reconcile_items_on_startup, reconcile_jobs_on_startup};
use crate::garmin_sync::types::*;
use crate::garmin_sync::{
    daily_start, data_dir_key, install_gate_for_tests, job_continue, utc_now, DailyStartRequest,
    JobIdRevisionRequest, JobSnapshot, WorkItemSnapshot,
};
use crate::productivity_db::coordinator::with_write;
use crate::productivity_db::schema::{ensure_schema, initialize_fresh, CURRENT_SCHEMA_VERSION};

fn temp_dir(prefix: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4()));
    fs::create_dir_all(&p).unwrap();
    p
}

#[test]
fn priority_constants_match_locked_order() {
    assert_eq!(PRIORITY_DRAIN_COMMIT, 0);
    assert_eq!(PRIORITY_DAILY_CORE, 1);
    assert_eq!(PRIORITY_ADVANCED_CORE, 2);
    assert_eq!(PRIORITY_DETAIL, 3);
    assert_eq!(PRIORITY_ORIGINAL, 4);
}

#[test]
fn daily_range_is_seven_shanghai_days_ignoring_sync_days() {
    let today = NaiveDate::from_ymd_opt(2026, 10, 13).unwrap();
    let (from, to, days) = daily_range_on(today);
    assert_eq!(format_ymd(from), "2026-10-07");
    assert_eq!(format_ymd(to), "2026-10-13");
    assert_eq!(days.len(), 7);
    assert_eq!(format_ymd(*days.first().unwrap()), "2026-10-07");
    assert_eq!(format_ymd(*days.last().unwrap()), "2026-10-13");
}

#[test]
fn advanced_range_3000_ok_3001_too_large() {
    let today = NaiveDate::from_ymd_opt(2026, 10, 13).unwrap();
    let from_3000 = today - chrono::Duration::days(2999);
    let from_3001 = today - chrono::Duration::days(3000);
    let ok = validate_advanced_range_on(&format_ymd(from_3000), "2026-10-13", today).unwrap();
    assert_eq!(ok, 3000);
    let err = validate_advanced_range_on(&format_ymd(from_3001), "2026-10-13", today).unwrap_err();
    assert_eq!(err.code, GARMIN_RANGE_TOO_LARGE);
}

#[test]
fn advanced_range_reversed_malformed_future_invalid() {
    let today = NaiveDate::from_ymd_opt(2026, 10, 13).unwrap();
    assert_eq!(
        validate_advanced_range_on("2026-10-13", "2026-10-01", today)
            .unwrap_err()
            .code,
        GARMIN_RANGE_INVALID
    );
    assert_eq!(
        validate_advanced_range_on("2026/10/01", "2026-10-13", today)
            .unwrap_err()
            .code,
        GARMIN_RANGE_INVALID
    );
    assert_eq!(
        validate_advanced_range_on("2026-10-01", "2026-10-14", today)
            .unwrap_err()
            .code,
        GARMIN_RANGE_INVALID
    );
}

#[test]
fn observe_429_closes_and_bumps_generation() {
    let dir = temp_dir("garmin-gate-429");
    let mut store = GateStore::load(&dir, true);
    assert_eq!(store.snapshot().state, STATE_OPEN);
    assert_eq!(store.snapshot().generation, 1);
    let until = "2099-01-01T00:00:00Z".to_string();
    let next = store.observe_429(Some(until.clone())).unwrap();
    assert_eq!(next.state, STATE_CLOSED);
    assert_eq!(next.generation, 2);
    assert_eq!(next.last_status, Some(429));
    assert_eq!(next.cooldown_until_utc.as_deref(), Some(until.as_str()));
    let reloaded = GateStore::load(&dir, false);
    assert_eq!(reloaded.snapshot().generation, 2);
    assert_eq!(reloaded.snapshot().state, STATE_CLOSED);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn corrupt_gate_file_is_closed_unknown_and_not_overwritten() {
    let dir = temp_dir("garmin-gate-corrupt");
    let path = dir.join("garmin_rate_limit_gate.v1");
    fs::write(&path, "{not json").unwrap();
    let original = fs::read(&path).unwrap();
    let store = GateStore::load(&dir, true);
    assert_eq!(store.snapshot().state, STATE_CLOSED_UNKNOWN);
    let after = fs::read(&path).unwrap();
    assert_eq!(original, after);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn deleting_initialized_gate_does_not_reopen_it() {
    let dir = temp_dir("garmin-gate-delete");
    let first = GateStore::load(&dir, true);
    assert_eq!(first.snapshot().state, STATE_OPEN);
    fs::remove_file(dir.join("garmin_rate_limit_gate.v1")).unwrap();
    let after_delete = GateStore::load(&dir, true);
    assert_eq!(after_delete.snapshot().state, STATE_CLOSED_UNKNOWN);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn failed_first_gate_write_keeps_first_install_retryable() {
    let dir = temp_dir("garmin-gate-first-write-retry");
    // A directory at the target path makes the atomic rename fail before the marker is written.
    fs::create_dir(dir.join("garmin_rate_limit_gate.v1")).unwrap();
    let failed = GateStore::load(&dir, true);
    assert_eq!(failed.snapshot().state, STATE_CLOSED_UNKNOWN);
    assert!(!dir.join(GATE_INITIALIZED_NAME).exists());

    fs::remove_dir(dir.join("garmin_rate_limit_gate.v1")).unwrap();
    let retried = GateStore::load(&dir, true);
    assert_eq!(retried.snapshot().state, STATE_OPEN);
    assert!(dir.join(GATE_INITIALIZED_NAME).exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn restore_cannot_overwrite_a_newer_concurrent_429() {
    let dir = temp_dir("garmin-gate-cas");
    let mut initializer = GateStore::load(&dir, true);
    let gen2 = initializer.observe_429(Some("2000-01-01T00:00:00Z".into())).unwrap().generation;
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let restore_barrier = barrier.clone();
    let restore_dir = dir.clone();
    let restore = std::thread::spawn(move || {
        let mut store = GateStore::load(&restore_dir, false);
        restore_barrier.wait();
        store.restore(gen2, true)
    });
    let observe_barrier = barrier.clone();
    let observe_dir = dir.clone();
    let observe = std::thread::spawn(move || {
        let mut store = GateStore::load(&observe_dir, false);
        observe_barrier.wait();
        store.observe_429(Some("2099-01-01T00:00:00Z".into()))
    });
    let _ = restore.join().unwrap();
    let observed = observe.join().unwrap().unwrap();
    let final_store = GateStore::load(&dir, false);
    assert_eq!(observed.generation, 3);
    assert_eq!(final_store.snapshot().generation, 3);
    assert_eq!(final_store.snapshot().state, STATE_CLOSED);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn restore_during_cooldown_rejected() {
    let dir = temp_dir("garmin-gate-cd");
    let mut store = GateStore::load(&dir, true);
    store
        .observe_429(Some("2099-12-31T00:00:00Z".to_string()))
        .unwrap();
    let gen = store.snapshot().generation;
    let err = store.restore(gen, true).unwrap_err();
    assert_eq!(err.code, GARMIN_RATE_LIMIT_COOLDOWN_ACTIVE);
    assert_eq!(store.snapshot().state, STATE_CLOSED);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn restore_closed_unknown_rejected() {
    let dir = temp_dir("garmin-gate-unk");
    fs::write(dir.join("garmin_rate_limit_gate.v1"), "{\"schemaVersion\":99}").unwrap();
    let mut store = GateStore::load(&dir, true);
    assert_eq!(store.snapshot().state, STATE_CLOSED_UNKNOWN);
    let err = store.restore(store.snapshot().generation, true).unwrap_err();
    assert_eq!(err.code, GARMIN_RATE_LIMIT_UNKNOWN);
    assert_eq!(store.snapshot().state, STATE_CLOSED_UNKNOWN);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn restore_stale_generation_rejected() {
    let dir = temp_dir("garmin-gate-stale");
    let mut store = GateStore::load(&dir, true);
    store
        .observe_429(Some("2000-01-01T00:00:00Z".to_string()))
        .unwrap();
    let err = store.restore(1, true).unwrap_err();
    assert_eq!(err.code, GARMIN_RATE_LIMIT_RESTORE_STALE);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn successful_restore_does_not_change_a_paused_job() {
    let app_data = temp_dir("garmin-restore-job-app");
    let data_root = temp_dir("garmin-restore-job-data");
    install_gate_for_tests(&app_data, true);
    crate::garmin_sync::observe_429_for_tests(Some("2000-01-01T00:00:00Z".to_string())).unwrap();

    with_write(&data_root.to_string_lossy(), |_| Ok(())).unwrap();
    let now = utc_now();
    let job = JobSnapshot {
        job_id: "job-paused".into(),
        data_dir_key: data_dir_key(&data_root.to_string_lossy()),
        kind: KIND_DAILY.into(),
        from_date: "2026-10-07".into(),
        to_date: "2026-10-13".into(),
        timezone_policy: "Asia/Shanghai".into(),
        intent: "daily_core".into(),
        force_details: false,
        force_original: false,
        scan_id: None,
        manifest_hash: None,
        state: JOB_PAUSED.into(),
        pause_reason: Some(PAUSE_APP_EXIT.into()),
        revision: 3,
        phase_stats_json: "{}".into(),
        error_code: None,
        error_summary: None,
        request_id: Some("r1".into()),
        created_at_utc: now.clone(),
        updated_at_utc: now,
        started_at_utc: None,
        finished_at_utc: None,
    };
    crate::productivity_db::coordinator::with_write(&data_root.to_string_lossy(), |conn| {
        crate::productivity_db::coordinator::in_transaction(conn, |tx| {
            crate::garmin_sync::insert_job(&tx, &job).map_err(Into::into)
        })
    })
    .unwrap();

    let restored = crate::garmin_sync::rate_limit_restore(RestoreRequest {
        request_id: "restore-1".into(),
        expected_latch_revision: 2,
        user_initiated: true,
    })
    .unwrap();
    assert_eq!(restored.latch.state, STATE_OPEN);
    assert_eq!(restored.latch.generation, 2);

    let after = crate::garmin_sync::job_get(
        &data_root.to_string_lossy(),
        JobGetRequest {
            job_id: "job-paused".into(),
        },
    )
    .unwrap();
    assert_eq!(after.job.state, JOB_PAUSED);
    assert_eq!(after.job.revision, 3);
    assert_eq!(after.job.pause_reason.as_deref(), Some(PAUSE_APP_EXIT));
    let _ = fs::remove_dir_all(&app_data);
    let _ = fs::remove_dir_all(&data_root);
}

fn sample_job(state: &str, revision: i64) -> JobSnapshot {
    JobSnapshot {
        job_id: "j1".into(),
        data_dir_key: "abc".into(),
        kind: KIND_DAILY.into(),
        from_date: "2026-10-07".into(),
        to_date: "2026-10-13".into(),
        timezone_policy: "Asia/Shanghai".into(),
        intent: "daily_core".into(),
        force_details: false,
        force_original: false,
        scan_id: None,
        manifest_hash: None,
        state: state.into(),
        pause_reason: None,
        revision,
        phase_stats_json: "{}".into(),
        error_code: None,
        error_summary: None,
        request_id: None,
        created_at_utc: "2026-10-13T00:00:00Z".into(),
        updated_at_utc: "2026-10-13T00:00:00Z".into(),
        started_at_utc: None,
        finished_at_utc: None,
    }
}

fn sample_item(state: &str, committed: Option<&str>) -> WorkItemSnapshot {
    WorkItemSnapshot {
        work_item_id: "w1".into(),
        job_id: "j1".into(),
        kind: KIND_FETCH_DAILY_CLASS.into(),
        target_key: "2026-10-13|nap".into(),
        priority: PRIORITY_DAILY_CORE,
        state: state.into(),
        attempt_count: 1,
        attempt_generation: 1,
        next_attempt_at_utc: None,
        idempotency_key: "k".into(),
        input_hash: None,
        committed_hash: committed.map(|s| s.to_string()),
        asset_version_id: None,
        revision: 1,
        error_code: Some("TMP".into()),
        result_code: None,
    }
}

#[test]
fn startup_reconcile_marks_app_exit_without_network() {
    let jobs = reconcile_jobs_on_startup(vec![
        sample_job(JOB_QUEUED, 1),
        sample_job(JOB_RUNNING, 4),
        sample_job(JOB_COMPLETED, 2),
    ]);
    assert_eq!(jobs[0].state, JOB_PAUSED);
    assert_eq!(jobs[0].pause_reason.as_deref(), Some(PAUSE_APP_EXIT));
    assert_eq!(jobs[0].revision, 2);
    assert_eq!(jobs[1].state, JOB_PAUSED);
    assert_eq!(jobs[1].revision, 5);
    assert_eq!(jobs[2].state, JOB_COMPLETED);
    assert_eq!(jobs[2].revision, 2);

    let items = reconcile_items_on_startup(vec![
        sample_item(ITEM_FETCHING, Some("hash")),
        sample_item(ITEM_STAGED, None),
        sample_item(ITEM_COMMITTING, Some("")),
    ]);
    assert_eq!(items[0].state, ITEM_SUCCEEDED);
    assert_eq!(items[0].revision, 1);
    assert_eq!(items[1].state, ITEM_PENDING);
    assert_eq!(items[1].error_code, None);
    assert_eq!(items[2].state, ITEM_PENDING);
}

#[test]
fn one_advanced_nonterminal_job_unique_index() {
    let dir = temp_dir("garmin-v10-unique");
    let archive = dir.join("archive");
    fs::create_dir_all(&archive).unwrap();
    let db = archive.join("archive.sqlite");
    let conn = Connection::open(&db).unwrap();
    initialize_fresh(&conn).unwrap();
    conn.execute_batch(
        "DROP TABLE garmin_sync_work_item; DROP TABLE garmin_sync_job; DROP TABLE garmin_scan_activity; DROP TABLE garmin_scan; DROP INDEX idx_task_item_type; ALTER TABLE productivity_task DROP COLUMN item_type_id;",
    )
    .unwrap();
    conn.execute(
        "UPDATE archive_meta SET value='9' WHERE key='schema_version'",
        [],
    )
    .unwrap();
    drop(conn);
    let conn = Connection::open(&db).unwrap();
    ensure_schema(&conn, &db).unwrap();
    assert_eq!(
        crate::productivity_db::schema::read_schema_version(&conn).unwrap(),
        Some(CURRENT_SCHEMA_VERSION)
    );
    let now = utc_now();
    conn.execute(
        "INSERT INTO garmin_sync_job (
           job_id, data_dir_key, kind, from_date, to_date, timezone_policy, intent,
           force_details, force_original, state, revision, phase_stats_json, created_at_utc, updated_at_utc
         ) VALUES ('a1','key1','advanced','2026-01-01','2026-01-02','Asia/Shanghai','fill_gaps',0,0,'queued',1,'{}',?1,?1)",
        rusqlite::params![now],
    )
    .unwrap();
    let err = conn.execute(
        "INSERT INTO garmin_sync_job (
           job_id, data_dir_key, kind, from_date, to_date, timezone_policy, intent,
           force_details, force_original, state, revision, phase_stats_json, created_at_utc, updated_at_utc
         ) VALUES ('a2','key1','advanced','2026-01-01','2026-01-03','Asia/Shanghai','fill_gaps',0,0,'running',1,'{}',?1,?1)",
        rusqlite::params![now],
    )
    .unwrap_err();
    assert!(err.to_string().contains("UNIQUE") || err.to_string().contains("idx_garmin_job_one_advanced"));
    conn.execute(
        "INSERT INTO garmin_sync_job (
           job_id, data_dir_key, kind, from_date, to_date, timezone_policy, intent,
           force_details, force_original, state, revision, phase_stats_json, created_at_utc, updated_at_utc
         ) VALUES ('a3','key1','advanced','2026-01-01','2026-01-03','Asia/Shanghai','fill_gaps',0,0,'completed',1,'{}',?1,?1)",
        rusqlite::params![now],
    )
    .unwrap();
    drop(conn);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn duplicate_daily_request_coalesces() {
    let app_data = temp_dir("garmin-daily-app");
    let data_root = temp_dir("garmin-daily-data");
    install_gate_for_tests(&app_data, true);
    let data_dir = data_root.to_string_lossy().into_owned();
    let key = data_dir_key(&data_dir);
    let first = daily_start(
        &data_dir,
        DailyStartRequest {
            request_id: "req-a".into(),
            expected_data_dir_key: key.clone(),
        },
    )
    .unwrap();
    assert!(!first.coalesced);
    assert_eq!(first.job.kind, KIND_DAILY);
    let items = crate::garmin_sync::job_get(
        &data_dir,
        JobGetRequest {
            job_id: first.job.job_id.clone(),
        },
    )
    .unwrap();
    assert_eq!(items.recent_items.len(), 11 * 7);

    let same = daily_start(
        &data_dir,
        DailyStartRequest {
            request_id: "req-a".into(),
            expected_data_dir_key: key.clone(),
        },
    )
    .unwrap();
    assert_eq!(same.job.job_id, first.job.job_id);
    assert!(!same.coalesced);

    let coalesced = daily_start(
        &data_dir,
        DailyStartRequest {
            request_id: "req-b".into(),
            expected_data_dir_key: key,
        },
    )
    .unwrap();
    assert!(coalesced.coalesced);
    assert_eq!(coalesced.job.job_id, first.job.job_id);
    assert!(coalesced.job.revision > first.job.revision);
    let _ = fs::remove_dir_all(&app_data);
    let _ = fs::remove_dir_all(&data_root);
}

#[test]
fn coalescing_rolling_window_rekeys_one_discovery_marker() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE garmin_sync_work_item (work_item_id TEXT PRIMARY KEY, job_id TEXT, kind TEXT, target_key TEXT, priority INTEGER, state TEXT, attempt_count INTEGER, attempt_generation INTEGER, next_attempt_at_utc TEXT, idempotency_key TEXT, input_hash TEXT, committed_hash TEXT, asset_version_id TEXT, revision INTEGER, error_code TEXT, result_code TEXT);").unwrap();
    conn.execute("INSERT INTO garmin_sync_work_item VALUES ('marker-a','job','activity_list_discovery','2026-10-07|activity_list_discovery',1,'succeeded',2,2,NULL,'old',NULL,NULL,NULL,3,NULL,'complete')", []).unwrap();
    conn.execute("INSERT INTO garmin_sync_work_item VALUES ('marker-b','job','activity_list_discovery','2026-10-07|activity_list_discovery',1,'gap',1,1,NULL,'old-duplicate',NULL,NULL,NULL,1,'activity_list_incomplete','incomplete')", []).unwrap();
    let job = JobSnapshot {
        job_id: "job".into(), data_dir_key: "key".into(), kind: KIND_DAILY.into(),
        from_date: "2026-10-14".into(), to_date: "2026-10-20".into(), timezone_policy: "Asia/Shanghai".into(),
        intent: "daily_core".into(), force_details: false, force_original: false, scan_id: None, manifest_hash: None,
        state: "running".into(), pause_reason: None, revision: 2, phase_stats_json: "{}".into(), error_code: None,
        error_summary: None, request_id: None, created_at_utc: "now".into(), updated_at_utc: "now".into(),
        started_at_utc: Some("now".into()), finished_at_utc: None,
    };
    let tx = conn.transaction().unwrap();
    super::coalesce_daily_discovery_marker(&tx, &job, true).unwrap();
    tx.commit().unwrap();

    let current: (String, String, i64, String) = conn.query_row(
        "SELECT target_key,state,attempt_count,idempotency_key FROM garmin_sync_work_item WHERE work_item_id='marker-a'",
        [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).unwrap();
    assert_eq!(current, ("2026-10-14|activity_list_discovery".into(), "pending".into(), 0, "job:activity_list_discovery:2026-10-14".into()));
    let effective: i64 = conn.query_row("SELECT COUNT(*) FROM garmin_sync_work_item WHERE job_id='job' AND kind='activity_list_discovery' AND target_key='2026-10-14|activity_list_discovery' AND state<>'cancelled'", [], |r| r.get(0)).unwrap();
    assert_eq!(effective, 1);
    let historical: (String, String) = conn.query_row("SELECT state,result_code FROM garmin_sync_work_item WHERE work_item_id='marker-b'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(historical, ("cancelled".into(), "historical_daily_window".into()));
}

#[test]
fn continue_leaves_paused_when_gate_closed() {
    let app_data = temp_dir("garmin-continue-app");
    let data_root = temp_dir("garmin-continue-data");
    let mut store = GateStore::load(&app_data, true);
    store
        .observe_429(Some("2099-01-01T00:00:00Z".to_string()))
        .unwrap();
    crate::garmin_sync::gate::install_process_gate(store);
    let data_dir = data_root.to_string_lossy().into_owned();
    with_write(&data_dir, |_| Ok(())).unwrap();
    let now = utc_now();
    let job = JobSnapshot {
        job_id: "paused-job".into(),
        data_dir_key: data_dir_key(&data_dir),
        kind: KIND_DAILY.into(),
        from_date: "2026-10-07".into(),
        to_date: "2026-10-13".into(),
        timezone_policy: "Asia/Shanghai".into(),
        intent: "daily_core".into(),
        force_details: false,
        force_original: false,
        scan_id: None,
        manifest_hash: None,
        state: JOB_PAUSED.into(),
        pause_reason: Some(PAUSE_USER.into()),
        revision: 1,
        phase_stats_json: "{}".into(),
        error_code: None,
        error_summary: None,
        request_id: Some("c1".into()),
        created_at_utc: now.clone(),
        updated_at_utc: now,
        started_at_utc: None,
        finished_at_utc: None,
    };
    crate::productivity_db::coordinator::with_write(&data_dir, |conn| {
        crate::productivity_db::coordinator::in_transaction(conn, |tx| {
            crate::garmin_sync::insert_job(&tx, &job).map_err(Into::into)
        })
    })
    .unwrap();
    let err = job_continue(
        &data_dir,
        JobIdRevisionRequest {
            request_id: "continue-wrong-dir".into(),
            expected_data_dir_key: "wrong-key".into(),
            job_id: "paused-job".into(),
            expected_revision: 1,
        },
    )
    .unwrap_err();
    assert_eq!(err.code, crate::garmin_sync::error::GARMIN_DATA_DIR_CHANGED);
    let after = crate::garmin_sync::job_get(
        &data_dir,
        JobGetRequest {
            job_id: "paused-job".into(),
        },
    )
    .unwrap();
    assert_eq!(after.job.state, JOB_PAUSED);
    let _ = fs::remove_dir_all(&app_data);
    let _ = fs::remove_dir_all(&data_root);
}

#[test]
fn legacy_sync_gate_rejects_before_any_network_entry() {
    let config = temp_dir("garmin-legacy-gate");
    install_gate_for_tests(&config, true);
    assert!(!crate::garmin_sync::legacy_request_allowed());
    crate::garmin_sync::observe_429_for_tests(Some("2099-01-01T00:00:00Z".into())).unwrap();
    assert!(!crate::garmin_sync::legacy_request_allowed());
    let _ = fs::remove_dir_all(config);
}

#[test]
fn legacy_request_lane_is_exclusive_and_raii_released() {
    let request = crate::garmin_sync::lane::try_acquire_request().unwrap();
    assert!(crate::garmin_sync::lane::try_acquire_request().is_none());
    drop(request);
    assert!(crate::garmin_sync::lane::try_acquire_request().is_some());
}

#[test]
fn scan_start_replay_returns_same_scan_and_checks_data_dir_binding() {
    let app_data = temp_dir("garmin-scan-replay-app");
    let data_root = temp_dir("garmin-scan-replay-data");
    install_gate_for_tests(&app_data, true);
    let data_dir = data_root.to_string_lossy().into_owned();
    let key = data_dir_key(&data_dir);
    let first = crate::garmin_sync::scan_start(&data_dir, ScanStartRequest {
        request_id: "scan-replay-1".into(), expected_data_dir_key: key.clone(),
        from_date: "2026-10-01".into(), to_date: "2026-10-02".into(), mode: "fill_gaps".into(),
        force_details: false, force_original: false }).unwrap();
    let replay = crate::garmin_sync::scan_start(&data_dir, ScanStartRequest {
        request_id: "scan-replay-1".into(), expected_data_dir_key: key,
        from_date: "2026-10-01".into(), to_date: "2026-10-02".into(), mode: "fill_gaps".into(),
        force_details: false, force_original: false }).unwrap();
    assert_eq!(first.scan.scan_id, replay.scan.scan_id);
    assert_eq!(first.scan.revision, replay.scan.revision);
    let wrong_dir = crate::garmin_sync::scan_start(&data_dir, ScanStartRequest {
        request_id: "scan-replay-1".into(), expected_data_dir_key: "other-dir".into(),
        from_date: "2026-10-01".into(), to_date: "2026-10-02".into(), mode: "fill_gaps".into(),
        force_details: false, force_original: false }).unwrap_err();
    assert_eq!(wrong_dir.code, crate::garmin_sync::error::GARMIN_DATA_DIR_CHANGED);
    let _ = fs::remove_dir_all(app_data);
    let _ = fs::remove_dir_all(data_root);
}

#[test]
fn job_start_replay_returns_prior_job_before_scan_or_active_job_checks() {
    let app_data = temp_dir("garmin-job-replay-app");
    let data_root = temp_dir("garmin-job-replay-data");
    install_gate_for_tests(&app_data, true);
    let data_dir = data_root.to_string_lossy().into_owned();
    with_write(&data_dir, |_| Ok(())).unwrap();
    let now = utc_now();
    let prior = JobSnapshot { job_id: "prior-start-job".into(), data_dir_key: data_dir_key(&data_dir),
        kind: KIND_ADVANCED.into(), from_date: "2026-10-01".into(), to_date: "2026-10-02".into(),
        timezone_policy: "Asia/Shanghai".into(), intent: "fill_gaps".into(), force_details: false,
        force_original: false, scan_id: Some("prior-scan".into()), manifest_hash: Some("manifest".into()),
        state: JOB_QUEUED.into(), pause_reason: None, revision: 1, phase_stats_json: "{}".into(),
        error_code: None, error_summary: None, request_id: Some("job-start-replay-1".into()),
        created_at_utc: now.clone(), updated_at_utc: now, started_at_utc: None, finished_at_utc: None };
    crate::productivity_db::coordinator::with_write(&data_dir, |conn| {
        crate::productivity_db::coordinator::in_transaction(conn, |tx| {
            crate::garmin_sync::insert_job(tx, &prior).map_err(Into::into)
        })
    }).unwrap();
    let replay = crate::garmin_sync::job_start(&data_dir, JobStartRequest {
        request_id: "job-start-replay-1".into(), expected_data_dir_key: data_dir_key(&data_dir),
        scan_id: "missing-scan-is-irrelevant-on-replay".into(), expected_revision: 999,
        manifest_hash: "different-payload-is-ignored-on-replay".into() }).unwrap();
    assert_eq!(replay.job.job_id, prior.job_id);
    let _ = fs::remove_dir_all(app_data);
    let _ = fs::remove_dir_all(data_root);
}
