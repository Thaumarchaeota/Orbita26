mod dates;
pub mod error;
mod gate;
mod lane;
mod machine;
pub(crate) mod protocol;
pub(crate) mod fetch_reuse;
pub(crate) mod store;
mod types;

#[cfg(test)]
mod tests;
#[cfg(test)]
#[path = "resume_tests.rs"]
mod resume_tests;
#[cfg(test)]
mod fetch_reuse_tests;

use std::path::{Path, PathBuf};

use chrono::Utc;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::productivity_db::coordinator::{self, in_transaction, with_read, with_write};
use gate::GateStore;

pub use error::{GarminSyncError, GarminSyncResult};
pub use types::*;

pub fn utc_now() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

pub fn data_dir_key(data_dir: &str) -> String {
    let path = Path::new(data_dir);
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for component in abs.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => { normalized.pop(); }
            other => normalized.push(other.as_os_str()),
        }
    }
    let mut hasher = Sha256::new();
    hasher.update(normalized.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn require_data_dir_key(data_dir: &str, expected: &str) -> GarminSyncResult<String> {
    let key = data_dir_key(data_dir);
    if key != expected {
        return Err(GarminSyncError::new(
            error::GARMIN_DATA_DIR_CHANGED,
            "dataDir identity does not match expectedDataDirKey",
        ));
    }
    Ok(key)
}

fn domain_err(e: GarminSyncError) -> crate::productivity_db::DomainError {
    crate::productivity_db::DomainError::from(e)
}

fn require_gate_open() -> GarminSyncResult<()> {
    if gate::process_gate_is_open() {
        Ok(())
    } else {
        let snapshot = gate::process_gate_snapshot();
        if snapshot.state == gate::STATE_CLOSED_UNKNOWN {
            Err(GarminSyncError::new(error::GARMIN_RATE_LIMIT_UNKNOWN, "Garmin global rate-limit gate is closed_unknown; requests are disabled until the gate can be safely initialized"))
        } else {
            Err(GarminSyncError::new(error::GARMIN_RATE_LIMIT_LATCHED, "Garmin global rate-limit gate is closed"))
        }
    }
}

fn bootstrap_data_dir(app_data: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(app_data.join("bootstrap.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("data_dir")
        .or_else(|| v.get("dataDir"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
}

/// Restore the 429 gate, acquire the request lane, pause nonterminal jobs as app_exit,
/// and reconcile in-flight items. Startup performs zero network and does not spawn Python.
pub fn startup(app: &AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // An existing bootstrap is durable evidence that this is not first launch. Removing the
    // gate file alone can therefore never satisfy the first-install initialization condition.
    let first_install = !app_data_dir.join("bootstrap.json").exists();
    let app_config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let store = GateStore::load(&app_config, first_install);
    if first_install && store.snapshot().state == gate::STATE_CLOSED_UNKNOWN {
        // Keep first-install evidence (no bootstrap) intact so a failed first gate write can
        // be retried on the next startup. Do not proceed into settings/data initialization.
        return Err("Garmin rate-limit gate could not be initialized on first launch".into());
    }
    gate::install_process_gate(store);
    let _ = lane::try_acquire_lane(&app_config);
    let _ = crate::data::get_data_dir(app)?;
    if let Some(data_dir) = bootstrap_data_dir(&app_data_dir) {
        reconcile_archive_on_startup(&data_dir)?;
    }
    Ok(())
}

fn reconcile_archive_on_startup(data_dir: &str) -> Result<(), String> {
    let path = coordinator::db_path(data_dir);
    if !path.exists() {
        return Ok(());
    }
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let jobs = store::list_jobs(&tx)?;
            let items = store::list_items(&tx)?;
            let next_jobs = machine::reconcile_jobs_on_startup(jobs.clone());
            let next_items = machine::reconcile_items_on_startup(items.clone());
            let now = utc_now();
            for (before, mut after) in jobs.into_iter().zip(next_jobs) {
                if before.state != after.state
                    || before.revision != after.revision
                    || before.pause_reason != after.pause_reason
                {
                    after.updated_at_utc = now.clone();
                    store::update_job(&tx, &after)?;
                }
            }
            for (before, after) in items.into_iter().zip(next_items) {
                if before.state != after.state || before.error_code != after.error_code {
                    store::persist_item_state(&tx, &after)?;
                }
            }
            Ok(())
        })
    })
    .map_err(|e| e.to_string())
}

pub fn rate_limit_status(data_dir: Option<&str>) -> GarminSyncResult<RateLimitStatusResponse> {
    let latch = gate::with_process_gate(|g| {
        g.refresh();
        g.snapshot()
    })
    .unwrap_or_else(gate::closed_unknown_snapshot);
    let mut eligible_tasks = Vec::new();
    if let Some(data_dir) = data_dir {
        let _ = with_read(data_dir, |conn| {
            if let Some(conn) = conn {
                in_transaction(conn, |tx| {
                    eligible_tasks = store::paused_jobs(&tx)?
                        .into_iter()
                        .map(|j| EligibleTask {
                            job_id: j.job_id,
                            kind: j.kind,
                            state: j.state,
                            pause_reason: j.pause_reason,
                            revision: j.revision,
                        })
                        .collect();
                    Ok(())
                })?;
            }
            Ok(())
        });
    }
    Ok(RateLimitStatusResponse {
        latch,
        eligible_tasks,
    })
}

pub fn rate_limit_restore(req: RestoreRequest) -> GarminSyncResult<RestoreResponse> {
    let latch = gate::with_process_gate(|g| g.restore(req.expected_latch_revision, req.user_initiated))
        .ok_or_else(|| {
            GarminSyncError::new(error::GARMIN_RATE_LIMIT_UNKNOWN, "rate-limit gate is not initialized")
        })??;
    Ok(RestoreResponse {
        latch,
        restored: true,
    })
}

/// Compatibility entry points must pass the same global gate and OS request lane before any
/// task record or Python process is created.
pub fn legacy_request_allowed() -> bool {
    gate::process_gate_is_open() && lane::lane_is_held()
}

/// Acquire the same per-request exclusion used by legacy login/sync, then re-read the
/// app-global gate while holding it so a request cannot pass a stale precheck.
pub(crate) fn acquire_legacy_request() -> Result<lane::RequestGuard, (&'static str, &'static str)> {
    if !lane::lane_is_held() {
        return Err((error::GARMIN_RATE_LIMIT_UNKNOWN, "未取得 Garmin 跨进程请求通道，网络请求已禁用"));
    }
    let guard = lane::try_acquire_request()
        .ok_or((error::GARMIN_RATE_LIMIT_UNKNOWN, "Garmin 请求正在进行，网络请求已禁用"))?;
    if let Some(err) = legacy_gate_error() {
        return Err(err);
    }
    Ok(guard)
}

pub fn legacy_gate_error() -> Option<(&'static str, &'static str)> {
    let open = gate::process_gate_is_open();
    let snapshot = gate::process_gate_snapshot();
    if snapshot.state == gate::STATE_CLOSED_UNKNOWN {
        return Some((error::GARMIN_RATE_LIMIT_UNKNOWN, "Garmin 全局限流门闩状态未知，网络请求已禁用"));
    }
    if !open {
        return Some((error::GARMIN_RATE_LIMIT_LATCHED, "Garmin 全局限流门闩已关闭"));
    }
    if !lane::lane_is_held() {
        return Some((error::GARMIN_RATE_LIMIT_UNKNOWN, "未取得 Garmin 跨进程请求通道，网络请求已禁用"));
    }
    None
}

pub fn legacy_observe_429(cooldown_until_utc: Option<String>) {
    let _ = gate::with_process_gate(|g| g.observe_429(cooldown_until_utc));
}

pub fn daily_start(data_dir: &str, req: DailyStartRequest) -> GarminSyncResult<DailyStartResponse> {
    let key = require_data_dir_key(data_dir, &req.expected_data_dir_key)?;
    require_gate_open()?;
    let (from, to, days) = dates::daily_range(None);
    let from_s = dates::format_ymd(from);
    let to_s = dates::format_ymd(to);
    let now = utc_now();
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            if let Some(existing) = store::job_by_request_id(&tx, &req.request_id, &key)? {
                return Ok(DailyStartResponse {
                    job: existing,
                    accepted: true,
                    coalesced: false,
                });
            }
            if let Some(mut existing) = store::nonterminal_daily(&tx, &key)? {
                let window_changed = existing.from_date != from_s || existing.to_date != to_s;
                existing.from_date = from_s.clone();
                existing.to_date = to_s.clone();
                existing.revision += 1;
                existing.updated_at_utc = now.clone();
                store::update_job(&tx, &existing)?;
                // The discovery result belongs to one exact daily range. Keep one marker
                // for the latest window and make it pending when that window rolls.
                coalesce_daily_discovery_marker(&tx, &existing, window_changed)?;
                // A daily coalesce narrows the dispatcher to the latest canonical window.
                // In-flight items may finish their already-issued request; only unclaimed
                // old work is terminalized here.
                let pending: Vec<(String, String, String)> = {
                    let mut stmt = tx.prepare("SELECT work_item_id,kind,target_key FROM garmin_sync_work_item WHERE job_id=?1 AND state='pending' AND kind IN ('fetch_daily_class','fetch_activity_summary')")?;
                    let mapped = stmt.query_map([&existing.job_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
                    mapped.collect::<Result<_, _>>()?
                };
                for (item_id, kind, target) in pending {
                    let parsed = target.split_once('|').filter(|(date, rest)| {
                        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
                            .is_some_and(|d| d.format("%Y-%m-%d").to_string() == *date)
                            && if kind == KIND_FETCH_DAILY_CLASS {
                                DAILY_CLASS_IDS.contains(&rest)
                            } else {
                                rest.strip_prefix("activity:").is_some_and(|id| !id.is_empty() && !id.contains('|'))
                            }
                    });
                    let in_range = parsed.is_some_and(|(date, _)| date >= from_s.as_str() && date <= to_s.as_str());
                    if !in_range {
                        tx.execute("UPDATE garmin_sync_work_item SET state='cancelled', result_code=?1, revision=revision+1 WHERE work_item_id=?2 AND state='pending'",
                            rusqlite::params![if parsed.is_some() { "outside_current_daily_range" } else { "invalid_target" }, item_id])?;
                    }
                }
                ensure_daily_items(&tx, &existing, &days)?;
                return Ok(DailyStartResponse {
                    job: existing,
                    accepted: true,
                    coalesced: true,
                });
            }
            let job = JobSnapshot {
                job_id: new_id(),
                data_dir_key: key.clone(),
                kind: KIND_DAILY.to_string(),
                from_date: from_s.clone(),
                to_date: to_s.clone(),
                timezone_policy: dates::TIMEZONE_POLICY.to_string(),
                intent: "daily_core".to_string(),
                force_details: false,
                force_original: false,
                scan_id: None,
                manifest_hash: None,
                state: JOB_QUEUED.to_string(),
                pause_reason: None,
                revision: 1,
                phase_stats_json: "{}".to_string(),
                error_code: None,
                error_summary: None,
                request_id: Some(req.request_id.clone()),
                created_at_utc: now.clone(),
                updated_at_utc: now,
                started_at_utc: None,
                finished_at_utc: None,
            };
            store::insert_job(&tx, &job)?;
            crate::health_db::sync_run::create_run(tx, &job.job_id, &req.request_id, &from_s, &to_s)
                .map_err(|e| domain_err(GarminSyncError::new(e.code, e.message)))?;
            ensure_daily_items(&tx, &job, &days)?;
            Ok(DailyStartResponse {
                job,
                accepted: true,
                coalesced: false,
            })
        })
    })
    .map_err(GarminSyncError::from)
}

fn coalesce_daily_discovery_marker(
    tx: &rusqlite::Transaction<'_>,
    job: &JobSnapshot,
    force_refresh: bool,
) -> GarminSyncResult<()> {
    let rows: Vec<(String, String)> = {
        let mut stmt = tx.prepare("SELECT work_item_id,target_key FROM garmin_sync_work_item WHERE job_id=?1 AND kind='activity_list_discovery' ORDER BY work_item_id")?;
        let mapped = stmt.query_map([&job.job_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        mapped.collect::<Result<_, _>>()?
    };
    let target = format!("{}|activity_list_discovery", job.from_date);
    let winner = rows.iter().position(|(_, existing_target)| existing_target == &target)
        .or_else(|| (!rows.is_empty()).then_some(0));
    for (index, (item_id, _)) in rows.iter().enumerate() {
        if Some(index) == winner { continue; }
        tx.execute(
            "UPDATE garmin_sync_work_item SET state='cancelled',next_attempt_at_utc=NULL,error_code=NULL,result_code='historical_daily_window',revision=revision+1 WHERE work_item_id=?1",
            [item_id],
        )?;
    }
    if let Some(index) = winner {
        let (item_id, old_target) = &rows[index];
        if old_target != &target || force_refresh {
            tx.execute(
                "UPDATE garmin_sync_work_item SET target_key=?1,state='pending',attempt_count=0,attempt_generation=attempt_generation+1,next_attempt_at_utc=NULL,idempotency_key=?2,error_code=NULL,result_code=NULL,revision=revision+1 WHERE work_item_id=?3",
                rusqlite::params![target, format!("{}:activity_list_discovery:{}", job.job_id, job.from_date), item_id],
            )?;
        }
    }
    Ok(())
}

fn ensure_daily_items(
    tx: &rusqlite::Transaction,
    job: &JobSnapshot,
    days: &[chrono::NaiveDate],
) -> GarminSyncResult<()> {
    for day in days {
        let date = dates::format_ymd(*day);
        for class_id in DAILY_CLASS_IDS {
            let target_key = format!("{date}|{class_id}");
            if store::work_item_exists(tx, &job.job_id, KIND_FETCH_DAILY_CLASS, &target_key)? {
                continue;
            }
            let attempt_generation = 1;
            let item = WorkItemSnapshot {
                work_item_id: new_id(),
                job_id: job.job_id.clone(),
                kind: KIND_FETCH_DAILY_CLASS.to_string(),
                target_key: target_key.clone(),
                priority: PRIORITY_DAILY_CORE,
                state: ITEM_PENDING.to_string(),
                attempt_count: 0,
                attempt_generation,
                next_attempt_at_utc: None,
                idempotency_key: format!(
                    "{}:{}:{}:{}",
                    job.job_id, KIND_FETCH_DAILY_CLASS, target_key, attempt_generation
                ),
                input_hash: None,
                committed_hash: None,
                asset_version_id: None,
                revision: 1,
                error_code: None,
                result_code: None,
            };
            store::insert_work_item(tx, &item)?;
        }
    }
    Ok(())
}

pub fn scan_start(data_dir: &str, req: ScanStartRequest) -> GarminSyncResult<ScanStartResponse> {
    dates::validate_advanced_range(&req.from_date, &req.to_date)?;
    if req.mode != "fill_gaps" && req.mode != "revalidate" {
        return Err(GarminSyncError::new(
            error::GARMIN_RANGE_INVALID,
            "mode must be fill_gaps or revalidate",
        ));
    }
    let key = require_data_dir_key(data_dir, &req.expected_data_dir_key)?;
    let now = utc_now();
    let scan = ScanSnapshot {
        scan_id: new_id(),
        request_id: req.request_id.clone(),
        data_dir_key: key.clone(),
        from_date: req.from_date,
        to_date: req.to_date,
        timezone_policy: dates::TIMEZONE_POLICY.to_string(),
        mode: req.mode,
        force_details: req.force_details,
        force_original: req.force_original,
        state: SCAN_SCANNING.to_string(),
        page_cursor: None,
        page_evidence_json: serde_json::json!({ "requestId": req.request_id }).to_string(),
        manifest_hash: None,
        revision: 1,
        error_code: None,
        error_summary: None,
        created_at_utc: now,
        finished_at_utc: None,
    };
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            if let Some(existing) = store::scan_by_request_id(&tx, &req.request_id)? {
                if existing.data_dir_key != key {
                    return Err(domain_err(GarminSyncError::new(error::GARMIN_DATA_DIR_CHANGED, "requestId belongs to a scan in another dataDir")));
                }
                return Ok(ScanStartResponse { scan: existing });
            }
            require_gate_open().map_err(domain_err)?;
            store::insert_scan(&tx, &scan)?;
            Ok(ScanStartResponse { scan: scan.clone() })
        })
    })
    .map_err(GarminSyncError::from)
}

pub fn scan_cancel(data_dir: &str, req: ScanCancelRequest) -> GarminSyncResult<ScanMutationResponse> {
    let key = require_data_dir_key(data_dir, &req.expected_data_dir_key)?;
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let mut scan = store::get_scan(&tx, &req.scan_id)?;
            if scan.data_dir_key != key {
                return Err(domain_err(GarminSyncError::new(error::GARMIN_DATA_DIR_CHANGED, "scan is bound to a different dataDir")));
            }
            if scan.revision != req.expected_revision {
                return Err(domain_err(GarminSyncError::new(
                    error::REVISION_CONFLICT,
                    "scan revision mismatch",
                )));
            }
            let next_state = machine::apply_scan_cancel_state(&scan.state)?;
            scan.state = next_state.to_string();
            scan.revision += 1;
            scan.finished_at_utc = Some(utc_now());
            store::update_scan(&tx, &scan)?;
            Ok(ScanMutationResponse { scan })
        })
    })
    .map_err(GarminSyncError::from)
}

pub fn job_start(data_dir: &str, req: JobStartRequest) -> GarminSyncResult<JobMutationResponse> {
    let key = require_data_dir_key(data_dir, &req.expected_data_dir_key)?;
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            if let Some(existing) = store::job_by_request_id(&tx, &req.request_id, &key)? {
                return Ok(JobMutationResponse { job: existing });
            }
            // An idempotent replay above does not create work and remains readable after 429.
            require_gate_open().map_err(domain_err)?;
            let scan = store::get_scan(&tx, &req.scan_id)?;
            if scan.revision != req.expected_revision {
                return Err(domain_err(GarminSyncError::new(
                    error::REVISION_CONFLICT,
                    "scan revision mismatch",
                )));
            }
            if scan.state != SCAN_READY {
                return Err(domain_err(GarminSyncError::new(
                    error::GARMIN_SCAN_INCOMPLETE,
                    "scan is not ready",
                )));
            }
            if scan.data_dir_key != key {
                return Err(domain_err(GarminSyncError::new(
                    error::GARMIN_DATA_DIR_CHANGED,
                    "scan is bound to a different dataDir",
                )));
            }
            if scan.manifest_hash.as_deref() != Some(req.manifest_hash.as_str()) {
                return Err(domain_err(GarminSyncError::new(
                    error::GARMIN_SCAN_STALE,
                    "manifest hash mismatch",
                )));
            }
            if let Some(created) = dates::shanghai_ymd_from_utc_iso(&scan.created_at_utc) {
                if created != dates::shanghai_today() {
                    return Err(domain_err(GarminSyncError::new(
                        error::GARMIN_SCAN_STALE,
                        "scan created on a previous Shanghai day",
                    )));
                }
            }
            if store::has_nonterminal_advanced(&tx, &key)? {
                return Err(domain_err(GarminSyncError::new(
                    error::GARMIN_JOB_ACTIVE,
                    "an advanced nonterminal job already exists",
                )));
            }
            let now = utc_now();
            let job = JobSnapshot {
                job_id: new_id(),
                data_dir_key: key,
                kind: KIND_ADVANCED.to_string(),
                from_date: scan.from_date.clone(),
                to_date: scan.to_date.clone(),
                timezone_policy: scan.timezone_policy.clone(),
                intent: scan.mode.clone(),
                force_details: scan.force_details,
                force_original: scan.force_original,
                scan_id: Some(scan.scan_id.clone()),
                manifest_hash: scan.manifest_hash.clone(),
                state: JOB_QUEUED.to_string(),
                pause_reason: None,
                revision: 1,
                phase_stats_json: "{}".to_string(),
                error_code: None,
                error_summary: None,
                request_id: Some(req.request_id.clone()),
                created_at_utc: now.clone(),
                updated_at_utc: now,
                started_at_utc: None,
                finished_at_utc: None,
            };
            store::insert_job(&tx, &job)?;
            Ok(JobMutationResponse { job })
        })
    })
    .map_err(GarminSyncError::from)
}

fn mutate_job(
    data_dir: &str,
    req: JobIdRevisionRequest,
    f: impl FnOnce(&JobSnapshot) -> GarminSyncResult<JobSnapshot>,
) -> GarminSyncResult<JobMutationResponse> {
    let key = require_data_dir_key(data_dir, &req.expected_data_dir_key)?;
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let job = store::get_job(&tx, &req.job_id)?;
            if job.data_dir_key != key {
                return Err(domain_err(GarminSyncError::new(error::GARMIN_DATA_DIR_CHANGED, "job is bound to a different dataDir")));
            }
            if job.revision != req.expected_revision {
                return Err(domain_err(GarminSyncError::new(
                    error::REVISION_CONFLICT,
                    "job revision mismatch",
                )));
            }
            let mut next = f(&job)?;
            next.updated_at_utc = utc_now();
            store::update_job(&tx, &next)?;
            Ok(JobMutationResponse { job: next })
        })
    })
    .map_err(GarminSyncError::from)
}

pub fn job_pause(data_dir: &str, req: JobIdRevisionRequest) -> GarminSyncResult<JobMutationResponse> {
    mutate_job(data_dir, req, machine::apply_pause)
}

pub fn job_cancel(data_dir: &str, req: JobIdRevisionRequest) -> GarminSyncResult<JobMutationResponse> {
    mutate_job(data_dir, req, machine::apply_cancel)
}

pub fn job_continue(data_dir: &str, req: JobIdRevisionRequest) -> GarminSyncResult<JobMutationResponse> {
    let gate_open = gate::process_gate_is_open();
    mutate_job(data_dir, req, |job| {
        machine::apply_continue(job, gate_open)
    })
}

/// Resume only the confirmed daily job and requeue its current-window gaps. The
/// expected root and revision prevent a dialog opened before a switch/coalesce
/// from acting on a different job (Garmin workflow plan, Implementation 2026-10-23).
pub fn resume_daily_request(data_dir: &str, req: JobIdRevisionRequest) -> GarminSyncResult<JobMutationResponse> {
    let key = require_data_dir_key(data_dir, &req.expected_data_dir_key)?;
    require_gate_open()?;
    let (from, to, _) = dates::daily_range(None);
    let from = dates::format_ymd(from);
    let to = dates::format_ymd(to);
    coordinator::with_write_expected(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let mut job = store::get_job(tx, &req.job_id).map_err(domain_err)?;
            if job.data_dir_key != key {
                return Err(domain_err(GarminSyncError::new(error::GARMIN_DATA_DIR_CHANGED, "job is bound to a different dataDir")));
            }
            if job.revision != req.expected_revision {
                return Err(domain_err(GarminSyncError::new(error::REVISION_CONFLICT, "job revision mismatch")));
            }
            if job.kind != KIND_DAILY || job.state != JOB_PAUSED {
                return Err(domain_err(GarminSyncError::new(error::GARMIN_JOB_STATE_INVALID, "only a paused daily job can resume")));
            }
            require_gate_open().map_err(domain_err)?;
            for mut item in store::list_items_for_job(tx, &job.job_id).map_err(domain_err)? {
                if item.state != "gap" || !matches!(item.kind.as_str(), KIND_FETCH_DAILY_CLASS | "fetch_activity_summary") {
                    continue;
                }
                let Some((date, target)) = item.target_key.split_once('|') else { continue };
                let valid_date = dates::parse_ymd_strict(date).is_ok() && date >= from.as_str() && date <= to.as_str();
                let valid_target = if item.kind == KIND_FETCH_DAILY_CLASS {
                    DAILY_CLASS_IDS.contains(&target)
                } else {
                    target.strip_prefix("activity:").is_some_and(|id| !id.trim().is_empty() && !id.contains('|'))
                };
                if !valid_date || !valid_target { continue; }
                item.state = ITEM_PENDING.into();
                item.attempt_generation += 1;
                item.attempt_count = 0;
                item.next_attempt_at_utc = None;
                item.idempotency_key = format!("{}:{}:{}:{}", job.job_id, item.kind, item.target_key, item.attempt_generation);
                item.input_hash = None;
                item.committed_hash = None;
                item.asset_version_id = None;
                item.error_code = None;
                item.result_code = None;
                item.revision += 1;
                tx.execute("UPDATE garmin_sync_work_item SET state=?1,attempt_generation=?2,attempt_count=0,next_attempt_at_utc=NULL,idempotency_key=?3,input_hash=NULL,committed_hash=NULL,asset_version_id=NULL,error_code=NULL,result_code=NULL,revision=?4 WHERE work_item_id=?5 AND job_id=?6 AND state='gap'",
                    rusqlite::params![item.state, item.attempt_generation, item.idempotency_key, item.revision, item.work_item_id, job.job_id])?;
            }
            job.state = JOB_RUNNING.into();
            job.pause_reason = None;
            job.error_code = None;
            job.error_summary = None;
            job.revision += 1;
            job.updated_at_utc = utc_now();
            store::update_job(tx, &job).map_err(domain_err)?;
            Ok(JobMutationResponse { job })
        })
    }).map_err(GarminSyncError::from)
}

pub fn job_get(data_dir: &str, req: JobGetRequest) -> GarminSyncResult<JobGetResponse> {
    with_read(data_dir, |conn| {
        let conn = conn.ok_or_else(|| {
            crate::productivity_db::DomainError::archive_lifecycle("archive not initialized")
        })?;
        in_transaction(conn, |tx| {
            let job = store::get_job(&tx, &req.job_id)?;
            let items = store::list_items_for_job(&tx, &req.job_id)?;
            let failures = items
                .iter()
                .filter(|i| i.error_code.is_some() || i.state.contains("failed"))
                .cloned()
                .collect();
            let recent_items = items;
            Ok(JobGetResponse {
                job,
                phase_counts: serde_json::json!({}),
                recent_items,
                failures,
            })
        })
    })
    .map_err(GarminSyncError::from)
}

pub fn scan_get(data_dir: &str, req: ScanGetRequest) -> GarminSyncResult<ScanGetResponse> {
    with_read(data_dir, |conn| {
        let conn = conn.ok_or_else(|| {
            crate::productivity_db::DomainError::archive_lifecycle("archive not initialized")
        })?;
        in_transaction(conn, |tx| {
            let scan = store::get_scan(&tx, &req.scan_id)?;
            Ok(ScanGetResponse {
                scan,
                preview: serde_json::json!([]),
            })
        })
    })
    .map_err(GarminSyncError::from)
}

#[cfg(test)]
pub fn observe_429_for_tests(cooldown_until_utc: Option<String>) -> GarminSyncResult<GateSnapshot> {
    gate::with_process_gate(|g| g.observe_429(cooldown_until_utc))
        .ok_or_else(|| GarminSyncError::new(error::GARMIN_RATE_LIMIT_UNKNOWN, "gate not initialized"))?
}

#[cfg(test)]
pub fn install_gate_for_tests(dir: &Path, create_open_if_missing: bool) {
    gate::install_process_gate(GateStore::load(dir, create_open_if_missing));
}

#[cfg(test)]
pub use dates::{daily_range_on, validate_advanced_range_on, ADVANCED_RANGE_MAX_DAYS};
#[cfg(test)]
pub use machine::{reconcile_items_on_startup, reconcile_jobs_on_startup};
#[cfg(test)]
pub use store::insert_job;
