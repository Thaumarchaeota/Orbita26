use std::fs;
use std::path::PathBuf;

use chrono::NaiveDate;
use uuid::Uuid;

use crate::garmin_sync::dates::{daily_range, format_ymd};
use crate::garmin_sync::error::{GARMIN_DATA_DIR_CHANGED, GARMIN_JOB_STATE_INVALID, GARMIN_RATE_LIMIT_LATCHED, REVISION_CONFLICT};
use crate::garmin_sync::gate::STATE_CLOSED;
use crate::garmin_sync::types::*;
use crate::garmin_sync::{data_dir_key, install_gate_for_tests, utc_now, JobGetRequest, JobIdRevisionRequest};
use crate::productivity_db::coordinator::{in_transaction, with_read, with_write};

struct Fixture {
    app_data: PathBuf,
    data_root: PathBuf,
    data_dir: String,
    job_id: String,
    revision: i64,
    today: NaiveDate,
    from: NaiveDate,
}

impl Fixture {
    fn new(state: &str, kind: &str) -> Self {
        let app_data = std::env::temp_dir().join(format!("garmin-resume-app-{}", Uuid::new_v4()));
        let data_root = std::env::temp_dir().join(format!("garmin-resume-data-{}", Uuid::new_v4()));
        fs::create_dir_all(&app_data).unwrap();
        fs::create_dir_all(&data_root).unwrap();
        install_gate_for_tests(&app_data, true);
        let data_dir = data_root.to_string_lossy().into_owned();
        with_write(&data_dir, |_| Ok(())).unwrap();
        let (from, today, _) = daily_range(None);
        let job_id = "resume-fixture-job".to_string();
        let now = utc_now();
        let job = JobSnapshot {
            job_id: job_id.clone(),
            data_dir_key: data_dir_key(&data_dir),
            kind: kind.into(),
            from_date: format_ymd(from),
            to_date: format_ymd(today),
            timezone_policy: "Asia/Shanghai".into(),
            intent: "daily_core".into(),
            force_details: false,
            force_original: false,
            scan_id: None,
            manifest_hash: None,
            state: state.into(),
            pause_reason: Some("app_exit".into()),
            revision: 9,
            phase_stats_json: "{}".into(),
            error_code: None,
            error_summary: None,
            request_id: Some("original-request".into()),
            created_at_utc: now.clone(),
            updated_at_utc: now,
            started_at_utc: None,
            finished_at_utc: None,
        };
        with_write(&data_dir, |conn| {
            in_transaction(conn, |tx| {
                crate::garmin_sync::store::insert_job(tx, &job).map_err(Into::into)
            })
        }).unwrap();
        Self { app_data, data_root, data_dir, job_id, revision: 9, today, from }
    }

    fn add_item(&self, id: &str, kind: &str, date: NaiveDate, target: &str, state: &str) {
        let item = WorkItemSnapshot {
            work_item_id: id.into(),
            job_id: self.job_id.clone(),
            kind: kind.into(),
            target_key: format!("{}|{}", format_ymd(date), target),
            priority: PRIORITY_DAILY_CORE,
            state: state.into(),
            attempt_count: 2,
            attempt_generation: 4,
            next_attempt_at_utc: Some("2099-01-01T00:00:00Z".into()),
            idempotency_key: format!("old-{id}"),
            input_hash: Some("old-input".into()),
            committed_hash: Some("committed-hash".into()),
            asset_version_id: Some("asset-version".into()),
            revision: 3,
            error_code: Some("prior-error".into()),
            result_code: Some("prior-result".into()),
        };
        with_write(&self.data_dir, |conn| {
            in_transaction(conn, |tx| crate::garmin_sync::store::insert_work_item(tx, &item).map_err(Into::into))
        }).unwrap();
    }

    fn request(&self, key: String, revision: i64) -> JobIdRevisionRequest {
        JobIdRevisionRequest {
            request_id: "resume-request".into(),
            expected_data_dir_key: key,
            job_id: self.job_id.clone(),
            expected_revision: revision,
        }
    }

    fn snapshot(&self) -> crate::garmin_sync::JobGetResponse {
        crate::garmin_sync::job_get(&self.data_dir, JobGetRequest { job_id: self.job_id.clone() }).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.app_data);
        let _ = fs::remove_dir_all(&self.data_root);
    }
}

#[test]
fn paused_daily_requeues_only_current_gaps_and_preserves_success_and_pending() {
    let f = Fixture::new(JOB_PAUSED, KIND_DAILY);
    f.add_item("success", KIND_FETCH_DAILY_CLASS, f.today, "health_day_summary", ITEM_SUCCEEDED);
    f.add_item("gap-current", KIND_FETCH_DAILY_CLASS, f.today, "sleep_night", "gap");
    f.add_item("activity-gap", "fetch_activity_summary", f.today, "activity:activity-1", "gap");
    f.add_item("pending", KIND_FETCH_DAILY_CLASS, f.today, "nap", ITEM_PENDING);
    f.add_item("gap-old-date", KIND_FETCH_DAILY_CLASS, f.from - chrono::Duration::days(1), "nap", "gap");
    f.add_item("gap-invalid-class", KIND_FETCH_DAILY_CLASS, f.today, "unknown_class", "gap");

    let resumed = crate::garmin_sync::resume_daily_request(
        &f.data_dir,
        f.request(data_dir_key(&f.data_dir), f.revision),
    ).unwrap();
    assert_eq!(resumed.job.state, JOB_RUNNING);
    assert_eq!(resumed.job.pause_reason, None);
    assert_eq!(resumed.job.revision, f.revision + 1);

    let after = f.snapshot();
    let item = |id: &str| after.recent_items.iter().find(|item| item.work_item_id == id).unwrap();
    let success = item("success");
    assert_eq!(success.state, ITEM_SUCCEEDED);
    assert_eq!(success.committed_hash.as_deref(), Some("committed-hash"));
    assert_eq!(success.attempt_generation, 4);
    let gap = item("gap-current");
    assert_eq!(gap.state, ITEM_PENDING);
    assert_eq!(gap.attempt_generation, 5);
    assert_eq!(gap.attempt_count, 0);
    assert_eq!(gap.next_attempt_at_utc, None);
    assert_eq!(gap.input_hash, None);
    assert_eq!(gap.committed_hash, None);
    assert_eq!(gap.error_code, None);
    assert_eq!(gap.idempotency_key, format!("{}:{}:{}:{}", f.job_id, KIND_FETCH_DAILY_CLASS, gap.target_key, 5));
    let activity = item("activity-gap");
    assert_eq!(activity.state, ITEM_PENDING);
    assert_eq!(activity.attempt_generation, 5);
    assert_eq!(item("pending").attempt_generation, 4);
    assert_eq!(item("gap-old-date").state, "gap");
    assert_eq!(item("gap-invalid-class").state, "gap");
}

#[test]
fn resume_rejects_stale_revision_wrong_data_dir_and_non_paused_or_non_daily_jobs() {
    let f = Fixture::new(JOB_PAUSED, KIND_DAILY);
    let before = f.snapshot();

    let stale = crate::garmin_sync::resume_daily_request(&f.data_dir, f.request(data_dir_key(&f.data_dir), f.revision - 1)).unwrap_err();
    assert_eq!(stale.code, REVISION_CONFLICT);
    let wrong_key = crate::garmin_sync::resume_daily_request(&f.data_dir, f.request("other-key".into(), f.revision)).unwrap_err();
    assert_eq!(wrong_key.code, GARMIN_DATA_DIR_CHANGED);
    let after = f.snapshot();
    assert_eq!(serde_json::to_value((&after.job, &after.recent_items)).unwrap(), serde_json::to_value((&before.job, &before.recent_items)).unwrap());

    let advanced = Fixture::new(JOB_PAUSED, KIND_ADVANCED);
    advanced.add_item("advanced-item", KIND_FETCH_DAILY_CLASS, advanced.today, "nap", "gap");
    let advanced_before = advanced.snapshot();
    let error = crate::garmin_sync::resume_daily_request(
        &advanced.data_dir,
        advanced.request(data_dir_key(&advanced.data_dir), advanced.revision),
    ).unwrap_err();
    assert_eq!(error.code, GARMIN_JOB_STATE_INVALID);
    let advanced_after = advanced.snapshot();
    assert_eq!(serde_json::to_value((&advanced_after.job, &advanced_after.recent_items)).unwrap(), serde_json::to_value((&advanced_before.job, &advanced_before.recent_items)).unwrap());

    let blocked = Fixture::new(JOB_BLOCKED_RATE_LIMIT, KIND_DAILY);
    blocked.add_item("blocked-item", KIND_FETCH_DAILY_CLASS, blocked.today, "nap", "gap");
    let blocked_before = blocked.snapshot();
    let error = crate::garmin_sync::resume_daily_request(
        &blocked.data_dir,
        blocked.request(data_dir_key(&blocked.data_dir), blocked.revision),
    ).unwrap_err();
    assert_eq!(error.code, GARMIN_JOB_STATE_INVALID);
    let blocked_after = blocked.snapshot();
    assert_eq!(blocked_after.job.state, JOB_BLOCKED_RATE_LIMIT);
    assert_eq!(serde_json::to_value((&blocked_after.job, &blocked_after.recent_items)).unwrap(), serde_json::to_value((&blocked_before.job, &blocked_before.recent_items)).unwrap());
}

#[test]
fn closed_global_gate_refuses_resume_without_mutating_job_or_items() {
    let f = Fixture::new(JOB_PAUSED, KIND_DAILY);
    f.add_item("gap", KIND_FETCH_DAILY_CLASS, f.today, "nap", "gap");
    let before = f.snapshot();
    crate::garmin_sync::observe_429_for_tests(Some("2099-01-01T00:00:00Z".into())).unwrap();
    assert_eq!(crate::garmin_sync::rate_limit_status(Some(&f.data_dir)).unwrap().latch.state, STATE_CLOSED);

    let error = crate::garmin_sync::resume_daily_request(
        &f.data_dir,
        f.request(data_dir_key(&f.data_dir), f.revision),
    ).unwrap_err();
    assert_eq!(error.code, GARMIN_RATE_LIMIT_LATCHED);
    let after = f.snapshot();
    assert_eq!(serde_json::to_value(after.job).unwrap(), serde_json::to_value(before.job).unwrap());
    assert_eq!(serde_json::to_value(after.recent_items).unwrap(), serde_json::to_value(before.recent_items).unwrap());
}
