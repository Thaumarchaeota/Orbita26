use rusqlite::{OptionalExtension, Transaction};
use serde_json::{json, Value};
use base64::Engine;

use crate::productivity_db::coordinator::in_transaction;

use super::super::activity_files;
use super::super::error::{HealthError, HealthResult};
use super::super::repository::{self, ActivityUpsertFields};
use super::super::sync_run::{insert_coverage, require_run_exists, set_date_range_meta, update_run_success};
use super::super::types::{
    GarminApplyRequest, GarminApplyResult, GarminApplyUnitRequest, GarminApplyUnitResponse,
    GarminClassCoverageEntry, GarminClassEntry,
};
use super::super::util::{instant_to_unix, new_uuid, parse_instant, utc_now};

const VALID_CLASSES: &[&str] = &[
    "health_day_summary",
    "health_day_sample_hr",
    "health_day_sample_stress",
    "health_day_sample_body_battery",
    "health_day_sample_spo2",
    "health_day_sample_respiration",
    "health_day_sample_hrv",
    "health_day_sample_steps",
    "sleep_night",
    "nap",
    "activity",
    "body_comp_on_day",
];

fn confirmed_no_data_without_prior_fact(result_code: &str, completeness: &str, prior_fact_exists: bool) -> bool {
    result_code == "no_data" && completeness == "empty" && !prior_fact_exists
}

pub fn garmin_apply(data_dir: &str, req: GarminApplyRequest) -> HealthResult<GarminApplyResult> {
    validate_batch(&req.batch)?;
    let data_dir = data_dir.to_string();
    crate::productivity_db::coordinator::with_write_expected(&data_dir, |conn| {
        in_transaction(conn, |tx| Ok(apply_in_tx(tx, &data_dir, &req)?))
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

/// Atomically applies one daily date × class result and checkpoints its durable work item.
/// Empty or failed results only write coverage/gap diagnostics; `process_entry` leaves facts intact.
pub fn garmin_apply_unit(data_dir: &str, req: GarminApplyUnitRequest) -> HealthResult<GarminApplyUnitResponse> {
    let actual_key = crate::garmin_sync::data_dir_key(data_dir);
    if actual_key != req.expected_data_dir_key {
        return Err(HealthError::garmin_apply_invalid_batch("expectedDataDirKey mismatch"));
    }
    let expected_kind = if req.entry.class_id == "activity" { "fetch_activity_summary" } else { "fetch_daily_class" };
    if req.run_id != req.job_id || req.job_id.is_empty() || req.work_item_id.is_empty()
        || (!DAILY_CLASSES.contains(&req.entry.class_id.as_str()) && req.entry.class_id != "activity")
    {
        return Err(HealthError::garmin_apply_invalid_batch("unit identity or class is invalid"));
    }
    let date = req.entry.local_date.clone();
    if req.entry.content_hash.as_deref().is_some_and(str::is_empty) {
        return Err(HealthError::garmin_apply_invalid_batch("contentHash cannot be empty"));
    }
    if req.entry.class_id == "activity" {
        let external_id = req.entry.external_id.as_deref().filter(|s| !s.is_empty())
            .ok_or_else(|| HealthError::garmin_apply_invalid_batch("activity summary requires externalId"))?;
        if req.entry.completeness == "complete" {
            let payload = req.entry.payload.as_ref().ok_or_else(|| HealthError::garmin_apply_invalid_batch("complete activity summary requires payload"))?;
            if payload.get("garminActivityId").and_then(Value::as_str) != Some(external_id) {
                return Err(HealthError::garmin_apply_invalid_batch("activity summary externalId mismatch"));
            }
        }
    }
    let root = data_dir.to_string();
    crate::productivity_db::coordinator::with_write_expected(&root, |conn| {
        in_transaction(conn, |tx| {
            require_run_exists(tx, &req.run_id)?;
            let item: Option<(String, String, String, String, i64, i64)> = tx.query_row(
                "SELECT job_id, kind, target_key, state, attempt_count, attempt_generation FROM garmin_sync_work_item WHERE work_item_id=?1",
                [&req.work_item_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            ).optional().map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let (item_job, kind, target, item_state, attempt_count, attempt_generation) = item.ok_or_else(|| HealthError::garmin_apply_invalid_batch("work item not found"))?;
            let job_range: (String, String, String, String) = tx.query_row(
                "SELECT kind, from_date, to_date, timezone_policy FROM garmin_sync_job WHERE job_id=?1",
                [&req.job_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            ).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let date_in_job = |candidate: &str| {
                chrono::NaiveDate::parse_from_str(candidate, "%Y-%m-%d").ok()
                    .filter(|date| date.format("%Y-%m-%d").to_string() == candidate)
                    .zip(chrono::NaiveDate::parse_from_str(&job_range.1, "%Y-%m-%d").ok())
                    .zip(chrono::NaiveDate::parse_from_str(&job_range.2, "%Y-%m-%d").ok())
                    .is_some_and(|((date, from), to)| job_range.0 == "daily" && job_range.3 == "Asia/Shanghai" && date >= from && date <= to)
            };
            let expected_target = if req.entry.class_id == "activity" {
                format!("{}|activity:{}", date, req.entry.external_id.as_deref().unwrap_or(""))
            } else { format!("{}|{}", date, req.entry.class_id) };
            let duplicate_generation_count: i64 = tx.query_row(
                "SELECT COUNT(*) FROM garmin_sync_work_item WHERE job_id=?1 AND kind=?2 AND target_key=?3 AND attempt_generation=?4",
                rusqlite::params![req.job_id, expected_kind, expected_target, req.attempt_generation], |r| r.get(0),
            ).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let valid_daily_range = chrono::NaiveDate::parse_from_str(&job_range.1, "%Y-%m-%d").ok()
                .zip(chrono::NaiveDate::parse_from_str(&job_range.2, "%Y-%m-%d").ok())
                .is_some_and(|(from, to)| (to - from).num_days() == 6);
            if item_job != req.job_id || kind != expected_kind || target != expected_target
                || !valid_daily_range || !date_in_job(&date) || duplicate_generation_count != 1
                || item_state != "fetching" || attempt_count != req.expected_attempt_count || attempt_generation != req.attempt_generation
            {
                return Err(HealthError::garmin_apply_invalid_batch("work item state or attempt generation does not match unit").into());
            }
            let job_key: String = tx.query_row("SELECT data_dir_key FROM garmin_sync_job WHERE job_id=?1", [&req.job_id], |r| r.get(0))
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            if job_key != actual_key {
                return Err(HealthError::garmin_apply_invalid_batch("job dataDir binding mismatch").into());
            }
            let mut changed = Vec::new();
            let mut day_revisions = std::collections::HashSet::new();
            let mut coverage = process_entry(tx, &root, &req.entry, 2, &mut changed, &mut day_revisions)?;
            // A provider-confirmed no-data result is complete only when there is no prior
            // Garmin snapshot to retain. Empty or unverified responses remain gaps.
            let prior_fact_exists = repository::get_class_hash(
                tx,
                &req.entry.class_id,
                &date,
                req.entry.external_id.as_deref().unwrap_or(""),
            )?.is_some();
            if confirmed_no_data_without_prior_fact(&req.result_code, &req.entry.completeness, prior_fact_exists) {
                coverage.outcome = "no_data".into();
                coverage.error_code = None;
                coverage.error_summary = None;
            }
            for day in day_revisions {
                let id = repository::ensure_health_day(tx, &day)?;
                repository::bump_health_day_revision(tx, &id)?;
            }
            insert_coverage(tx, &req.run_id, &coverage)?;
            let success = matches!(coverage.outcome.as_str(), "replaced" | "skipped_same_hash" | "no_data");
            let state = if success { "succeeded" } else { "gap" };
            let result = if success { coverage.outcome.as_str() } else { req.result_code.as_str() };
            tx.execute(
                "UPDATE garmin_sync_work_item SET state=?1, committed_hash=?2, error_code=?3, result_code=?4, revision=revision+1 WHERE work_item_id=?5",
                rusqlite::params![state, req.entry.content_hash, req.error_code.clone().or(coverage.error_code.clone()), result, req.work_item_id],
            ).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let (done, gaps): (i64, i64) = tx.query_row(
                "SELECT SUM(CASE WHEN state IN ('succeeded','skipped_same_hash') THEN 1 ELSE 0 END), SUM(CASE WHEN state='gap' THEN 1 ELSE 0 END) FROM garmin_sync_work_item WHERE job_id=?1",
                [&req.job_id], |r| Ok((r.get::<_, Option<i64>>(0)?.unwrap_or(0), r.get::<_, Option<i64>>(1)?.unwrap_or(0))),
            ).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let total: i64 = tx.query_row("SELECT COUNT(*) FROM garmin_sync_work_item WHERE job_id=?1", [&req.job_id], |r| r.get(0))
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let state = "running";
            let (state, pause_reason) = match req.pause_state.as_deref() {
                Some("paused") if req.pause_reason.as_deref() == Some("token") => ("paused", Some("token")),
                Some("blocked_rate_limit") if req.pause_reason.as_deref() == Some("rate_limit") => ("blocked_rate_limit", Some("rate_limit")),
                Some(_) => return Err(HealthError::garmin_apply_invalid_batch("invalid unit pause checkpoint").into()),
                None if req.pause_reason.is_none() => (state, None),
                None => return Err(HealthError::garmin_apply_invalid_batch("pauseReason requires pauseState").into()),
            };
            tx.execute(
                "UPDATE garmin_sync_job SET state=?1, pause_reason=?2, error_code=?3, error_summary=?4, revision=revision+1, phase_stats_json=?5, updated_at_utc=?6, finished_at_utc=CASE WHEN ?1 IN ('completed','partial') THEN ?6 ELSE NULL END WHERE job_id=?7",
                rusqlite::params![state, pause_reason, req.error_code, req.pause_state.as_deref().map(|_| "Garmin unit paused safely"), serde_json::json!({"completed":done,"gaps":gaps,"total":total}).to_string(), super::super::util::utc_now(), req.job_id],
            ).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            if req.pause_state.is_none() {
                let job = crate::garmin_sync::store::get_job(tx, &req.job_id)
                    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
                crate::reconcile_daily_job_terminal_state(tx, &job)
                    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            }
            Ok(GarminApplyUnitResponse { job_id:req.job_id.clone(), work_item_id:req.work_item_id.clone(), result_code:result.to_string(), outcome:coverage.outcome, content_hash:req.entry.content_hash.clone() })
        })
    }).map_err(|e| HealthError::new(e.code, e.message))
}

#[cfg(test)]
mod daily_unit_outcome_tests {
    use super::confirmed_no_data_without_prior_fact;

    #[test]
    fn no_data_is_success_only_when_the_source_confirmed_it_and_no_prior_fact_exists() {
        assert!(confirmed_no_data_without_prior_fact("no_data", "empty", false));
        assert!(!confirmed_no_data_without_prior_fact("empty_unverified", "empty", false));
        assert!(!confirmed_no_data_without_prior_fact("no_data", "empty", true));
        assert!(!confirmed_no_data_without_prior_fact("no_data", "failed", false));
    }
}

const DAILY_CLASSES: &[&str] = &[
    "health_day_summary", "health_day_sample_hr", "health_day_sample_stress", "health_day_sample_body_battery",
    "health_day_sample_spo2", "health_day_sample_respiration", "health_day_sample_hrv", "health_day_sample_steps",
    "sleep_night", "nap", "body_comp_on_day",
];

fn validate_batch(batch: &super::super::types::GarminNormalizedBatch) -> HealthResult<()> {
    if batch.run_id.is_empty() {
        return Err(HealthError::garmin_apply_invalid_batch("runId required"));
    }
    for entry in &batch.entries {
        if !VALID_CLASSES.contains(&entry.class_id.as_str()) {
            return Err(HealthError::garmin_apply_invalid_batch(format!(
                "unknown classId: {}",
                entry.class_id
            )));
        }
        if entry.completeness == "complete" {
            if entry.content_hash.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                return Err(HealthError::garmin_apply_invalid_batch(
                    "complete entry requires contentHash",
                ));
            }
            if entry.payload.is_none() {
                return Err(HealthError::garmin_apply_invalid_batch(
                    "complete entry requires payload",
                ));
            }
            if entry.class_id == "activity" && entry.external_id.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                return Err(HealthError::garmin_apply_invalid_batch(
                    "activity requires externalId",
                ));
            }
            if entry.class_id == "activity" {
                let payload = entry.payload.as_ref().ok_or_else(|| {
                    HealthError::garmin_apply_invalid_batch("complete entry requires payload")
                })?;
                if payload
                    .get("startedAt")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .is_none()
                {
                    return Err(HealthError::garmin_apply_invalid_batch(
                        "activity requires startedAt",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn apply_in_tx(tx: &Transaction, data_dir: &str, req: &GarminApplyRequest) -> HealthResult<GarminApplyResult> {
    let batch = &req.batch;
    require_run_exists(tx, &batch.run_id)?;
    let mut submitted = 0u32;
    let mut skipped = 0u32;
    let mut retained = 0u32;
    let mut changed_roots: Vec<Value> = Vec::new();
    let mut coverage: Vec<GarminClassCoverageEntry> = Vec::new();
    let mut day_revision_pending: std::collections::HashSet<String> = std::collections::HashSet::new();

    for entry in &batch.entries {
        let outcome = process_entry(tx, data_dir, entry, batch.parser_version, &mut changed_roots, &mut day_revision_pending)?;
        match outcome.outcome.as_str() {
            "replaced" => submitted += 1,
            "skipped_same_hash" => skipped += 1,
            _ => retained += 1,
        }
        insert_coverage(tx, &batch.run_id, &outcome)?;
        coverage.push(outcome);
    }

    for local_date in day_revision_pending {
        let day_id = repository::ensure_health_day(tx, &local_date)?;
        repository::bump_health_day_revision(tx, &day_id)?;
    }

    let overall_status = if retained > 0 {
        "partial_success"
    } else {
        // An unchanged complete snapshot is still a successful sync; no writes are needed.
        "success"
    };

    update_run_success(
        tx,
        &batch.run_id,
        overall_status,
        submitted,
        skipped,
        retained,
        None,
        None,
    )?;
    set_date_range_meta(tx, &batch.local_date_from, &batch.local_date_to)?;

    Ok(GarminApplyResult {
        run_id: batch.run_id.clone(),
        overall_status: overall_status.to_string(),
        submitted_class_count: submitted,
        skipped_same_hash_count: skipped,
        retained_gap_count: retained,
        changed_roots,
        coverage,
    })
}

fn process_entry(
    tx: &Transaction,
    data_dir: &str,
    entry: &GarminClassEntry,
    batch_parser_version: i32,
    changed_roots: &mut Vec<Value>,
    day_revision_pending: &mut std::collections::HashSet<String>,
) -> HealthResult<GarminClassCoverageEntry> {
    let external_id = entry.external_id.as_deref().unwrap_or("");
    if entry.completeness != "complete" {
        let outcome = match entry.completeness.as_str() {
            "empty" => "retained_empty",
            "failed" => "retained_failed",
            "incomplete" => "retained_incomplete",
            _ => "retained_failed",
        };
        return Ok(GarminClassCoverageEntry {
            class_id: entry.class_id.clone(),
            local_date: entry.local_date.clone(),
            external_id: entry.external_id.clone(),
            outcome: outcome.to_string(),
            submitted_root_ids: vec![],
            error_code: entry.error_code.clone(),
            error_summary: entry.error_summary.clone(),
        });
    }
    let hash = entry.content_hash.as_deref().unwrap_or("");
    let parser_version = entry.parser_version.unwrap_or(batch_parser_version);
    if let Some((stored_hash, _)) =
        repository::get_class_hash(tx, &entry.class_id, &entry.local_date, external_id)?
    {
        if stored_hash == hash {
            if entry.class_id == "activity" {
                let payload = entry.payload.as_ref().unwrap();
                if let Some(activity_id) =
                    apply_pending_activity_assets_on_hash_skip(tx, data_dir, external_id, payload)?
                {
                    day_revision_pending.insert(entry.local_date.clone());
                    return Ok(GarminClassCoverageEntry {
                        class_id: entry.class_id.clone(),
                        local_date: entry.local_date.clone(),
                        external_id: entry.external_id.clone(),
                        outcome: "skipped_same_hash".to_string(),
                        submitted_root_ids: vec![activity_id],
                        error_code: None,
                        error_summary: None,
                    });
                }
            }
            return Ok(GarminClassCoverageEntry {
                class_id: entry.class_id.clone(),
                local_date: entry.local_date.clone(),
                external_id: entry.external_id.clone(),
                outcome: "skipped_same_hash".to_string(),
                submitted_root_ids: vec![],
                error_code: None,
                error_summary: None,
            });
        }
    }

    let payload = entry.payload.as_ref().unwrap();
    let root_ids = match entry.class_id.as_str() {
        "health_day_summary" | "body_comp_on_day" => {
            apply_day_patch(tx, &entry.local_date, payload, entry.class_id == "body_comp_on_day")?;
            day_revision_pending.insert(entry.local_date.clone());
            vec![repository::ensure_health_day(tx, &entry.local_date)?]
        }
        id if id.starts_with("health_day_sample_") => {
            apply_sample_class(tx, &entry.local_date, id, payload, hash, parser_version)?;
            day_revision_pending.insert(entry.local_date.clone());
            vec![repository::ensure_health_day(tx, &entry.local_date)?]
        }
        "sleep_night" => vec![apply_sleep_night(tx, &entry.local_date, payload, hash, parser_version)?],
        "nap" => apply_nap_set(tx, &entry.local_date, payload)?,
        "activity" => vec![apply_activity(tx, data_dir, &entry.local_date, external_id, payload, hash, parser_version)?],
        _ => vec![],
    };

    repository::set_class_hash(tx, &entry.class_id, &entry.local_date, external_id, hash, parser_version)?;
    for id in &root_ids {
        changed_roots.push(json!({ "id": id, "classId": entry.class_id }));
    }

    Ok(GarminClassCoverageEntry {
        class_id: entry.class_id.clone(),
        local_date: entry.local_date.clone(),
        external_id: entry.external_id.clone(),
        outcome: "replaced".to_string(),
        submitted_root_ids: root_ids,
        error_code: None,
        error_summary: None,
    })
}

fn apply_day_patch(tx: &Transaction, local_date: &str, payload: &Value, body_only: bool) -> HealthResult<()> {
    let mut patch = json!({});
    let obj = payload.as_object().ok_or_else(|| HealthError::garmin_apply_invalid_batch("day payload must be object"))?;
    let mut map_key = |k: &str, target: &str| {
        if let Some(v) = obj.get(k) {
            patch[target] = v.clone();
        }
    };
    if !body_only {
        map_key("restingHeartRateBpm", "restingHr");
        map_key("minHeartRateBpm", "minHr");
        map_key("maxHeartRateBpm", "maxHr");
        map_key("avgHeartRateBpm", "avgHr");
        map_key("avgSpO2Percent", "spo2Avg");
        map_key("minSpO2Percent", "spo2Min");
        map_key("avgStress", "avgStress");
        map_key("maxStress", "maxStress");
        map_key("avgRespirationBpm", "avgRespiration");
        map_key("totalSteps", "steps");
        map_key("totalCaloriesKcal", "totalCalories");
        map_key("activeCaloriesKcal", "activeCalories");
        map_key("hydrationMl", "hydrationMl");
    }
    map_key("weightKg", "weightKg");
    map_key("bodyFatPercent", "bodyFatPercent");
    if !body_only {
        if let (Some(lo), Some(hi)) = (obj.get("bodyBatteryLow"), obj.get("bodyBatteryHigh")) {
            patch["bodyBattery"] = json!({ "low": lo, "high": hi });
        }
    }
    repository::patch_day_data(tx, local_date, &patch)?;
    Ok(())
}

fn sample_metric_for_class(class_id: &str) -> (&str, &str) {
    match class_id {
        "health_day_sample_hr" => ("heartRate", "default"),
        "health_day_sample_stress" => ("stress", "default"),
        "health_day_sample_body_battery" => ("bodyBattery", "default"),
        "health_day_sample_spo2" => ("spo2", "default"),
        "health_day_sample_respiration" => ("respiration", "default"),
        "health_day_sample_hrv" => ("hrv", "default"),
        "health_day_sample_steps" => ("steps", "default"),
        _ => ("unknown", "default"),
    }
}

fn apply_sample_class(
    tx: &Transaction,
    local_date: &str,
    class_id: &str,
    payload: &Value,
    content_hash: &str,
    parser_version: i32,
) -> HealthResult<()> {
    let metric = payload
        .get("metric")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| sample_metric_for_class(class_id).0);
    let series = payload
        .get("series")
        .and_then(|v| v.as_str())
        .unwrap_or("default");
    let samples = payload.get("samples").cloned().unwrap_or(json!([]));
    let snapshot = json!({ "samples": samples });
    let snapshot_json = serde_json::to_string(&snapshot).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let day_id = repository::ensure_health_day(tx, local_date)?;
    repository::guard_health_day_write(tx, &day_id)?;
    repository::delete_samples_for_metric(tx, local_date, metric, series)?;
    repository::insert_sample_set(
        tx,
        &day_id,
        local_date,
        metric,
        series,
        &snapshot_json,
        content_hash,
        parser_version,
    )?;
    Ok(())
}

fn apply_sleep_night(tx: &Transaction, wake_date: &str, payload: &Value, hash: &str, parser_version: i32) -> HealthResult<String> {
    let started = payload.get("startedAt").and_then(|v| v.as_str()).ok_or_else(|| HealthError::garmin_apply_invalid_batch("sleep startedAt required"))?;
    let ended = payload.get("endedAt").and_then(|v| v.as_str()).ok_or_else(|| HealthError::garmin_apply_invalid_batch("sleep endedAt required"))?;
    let start_sec = parse_instant(started)?;
    let end_sec = parse_instant(ended)?;
    let mut night = json!({
        "sleep": start_sec,
        "wake": end_sec,
        "source": "garmin",
    });
    if let Some(score) = payload.get("sleepScore") {
        night["score"] = score.clone();
    }
    if let Some(segs) = payload.get("stageSegments").and_then(|v| v.as_array()) {
        let mut level_segments = Vec::new();
        let mut stages = json!({ "deep": 0, "light": 0, "rem": 0, "awake": 0 });
        for seg in segs {
            let s = seg.get("startedAt").and_then(|v| v.as_str()).and_then(|x| instant_to_unix(x).ok());
            let e = seg.get("endedAt").and_then(|v| v.as_str()).and_then(|x| instant_to_unix(x).ok());
            let stage = seg.get("stage").and_then(|v| v.as_str()).unwrap_or("light");
            if let (Some(s), Some(e)) = (s, e) {
                level_segments.push(json!({ "start": s, "end": e, "stage": stage }));
                if let Some(obj) = stages.as_object_mut() {
                    let dur = (e - s).max(0);
                    let key = match stage {
                        "deep" => "deep",
                        "rem" => "rem",
                        "awake" => "awake",
                        _ => "light",
                    };
                    let cur = obj.get(key).and_then(|v| v.as_i64()).unwrap_or(0);
                    obj.insert(key.to_string(), json!(cur + dur));
                }
            }
        }
        if !level_segments.is_empty() {
            night["levelSegments"] = json!(level_segments);
            night["stages"] = stages;
        }
    }
    let night_json = serde_json::to_string(&night).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let now = utc_now();
    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM health_sleep_night WHERE wake_local_date = ?1 AND deleted_at_utc IS NULL",
            rusqlite::params![wake_date],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let id = if let Some(id) = existing {
        let revision: i64 = tx
            .query_row(
                "SELECT revision FROM health_sleep_night WHERE id = ?1",
                rusqlite::params![id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
            + 1;
        tx.execute(
            "UPDATE health_sleep_night SET night_json = ?1, content_hash = ?2, parser_version = ?3, revision = ?4, updated_at_utc = ?5 WHERE id = ?6",
            rusqlite::params![night_json, hash, parser_version, revision, now, id],
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        id
    } else {
        let id = new_uuid();
        tx.execute(
            "INSERT INTO health_sleep_night (id, revision, wake_local_date, source, night_json, content_hash, parser_version, created_at_utc, updated_at_utc)
             VALUES (?1, 1, ?2, 'garmin', ?3, ?4, ?5, ?6, ?6)",
            rusqlite::params![id, wake_date, night_json, hash, parser_version, now],
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        id
    };
    Ok(id)
}

fn apply_nap_set(tx: &Transaction, wake_date: &str, payload: &Value) -> HealthResult<Vec<String>> {
    let naps = payload.get("naps").and_then(|v| v.as_array()).ok_or_else(|| HealthError::garmin_apply_invalid_batch("nap payload requires naps"))?;
    if naps.is_empty() {
        return Ok(vec![]);
    }
    let mut payload_keys: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    let mut root_ids = Vec::new();
    for nap in naps {
        let started = nap.get("startedAt").and_then(|v| v.as_str()).ok_or_else(|| HealthError::garmin_apply_invalid_batch("nap startedAt required"))?;
        let ended = nap.get("endedAt").and_then(|v| v.as_str()).ok_or_else(|| HealthError::garmin_apply_invalid_batch("nap endedAt required"))?;
        payload_keys.insert((started.to_string(), ended.to_string()));
        let start_sec = parse_instant(started)?;
        let end_sec = parse_instant(ended)?;
        let nap_json = json!({ "start": start_sec, "end": end_sec });
        let nap_json_str = serde_json::to_string(&nap_json).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        let existing: Option<(String, i64)> = tx
            .query_row(
                "SELECT id, revision FROM health_nap WHERE wake_local_date = ?1 AND source = 'garmin'
                 AND started_at_utc = ?2 AND ended_at_utc = ?3 AND deleted_at_utc IS NULL",
                rusqlite::params![wake_date, started, ended],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        let id = if let Some((id, revision)) = existing {
            let now = utc_now();
            tx.execute(
                "UPDATE health_nap SET nap_json = ?1, revision = ?2, updated_at_utc = ?3 WHERE id = ?4",
                rusqlite::params![nap_json_str, revision + 1, now, id],
            )
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            id
        } else {
            let id = new_uuid();
            let now = utc_now();
            tx.execute(
                "INSERT INTO health_nap (id, revision, wake_local_date, source, started_at_utc, ended_at_utc, nap_json, created_at_utc, updated_at_utc)
                 VALUES (?1, 1, ?2, 'garmin', ?3, ?4, ?5, ?6, ?6)",
                rusqlite::params![id, wake_date, started, ended, nap_json_str, now],
            )
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            id
        };
        root_ids.push(id);
    }
    let mut stmt = tx
        .prepare(
            "SELECT id, revision, started_at_utc, ended_at_utc FROM health_nap
             WHERE wake_local_date = ?1 AND source = 'garmin' AND deleted_at_utc IS NULL",
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params![wake_date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let now = utc_now();
    for row in rows {
        let (id, revision, started, ended) = row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        if !payload_keys.contains(&(started, ended)) {
            tx.execute(
                "UPDATE health_nap SET deleted_at_utc = ?1, revision = ?2, updated_at_utc = ?1 WHERE id = ?3",
                rusqlite::params![now, revision + 1, id],
            )
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        }
    }
    Ok(root_ids)
}

fn optional_f64(v: &Value) -> Option<f64> {
    if v.is_null() {
        return None;
    }
    v.as_f64()
        .or_else(|| v.as_i64().map(|n| n as f64))
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn optional_str<'a>(v: Option<&'a Value>) -> Option<&'a str> {
    v.and_then(|x| x.as_str()).map(str::trim).filter(|s| !s.is_empty())
}

fn parse_optional_instant(v: Option<&Value>) -> HealthResult<Option<String>> {
    let Some(raw) = optional_str(v) else {
        return Ok(None);
    };
    super::super::util::instant_to_unix(raw)
        .map_err(HealthError::invalid_time)?;
    Ok(Some(raw.to_string()))
}

struct AssetApplyOutcome {
    activity_full_ok: bool,
    details_ok: bool,
    new_detail_failed: bool,
}

fn incoming_asset_has_ready_bytes(asset: &Value) -> bool {
    asset.get("status").and_then(|v| v.as_str()) == Some("ready")
        && asset
            .get("contentBase64")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty())
}

fn stored_activity_asset_needs_bytes(
    tx: &Transaction,
    activity_id: &str,
    kind: &str,
) -> HealthResult<bool> {
    Ok(match repository::get_activity_asset(tx, activity_id, kind)? {
        None => true,
        Some((_, _, status)) => status == "pending" || status == "failed",
    })
}

fn activity_payload_has_retryable_asset_bytes(
    tx: &Transaction,
    activity_id: &str,
    payload: &Value,
) -> HealthResult<bool> {
    let assets = payload.get("assets").and_then(|v| v.as_array());
    let Some(assets) = assets else {
        return Ok(false);
    };
    for asset in assets {
        let kind = asset.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if !matches!(kind, "original_zip" | "activity_full" | "details") {
            continue;
        }
        if incoming_asset_has_ready_bytes(asset) && stored_activity_asset_needs_bytes(tx, activity_id, kind)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn apply_pending_activity_assets_on_hash_skip(
    tx: &Transaction,
    data_dir: &str,
    garmin_id: &str,
    payload: &Value,
) -> HealthResult<Option<String>> {
    let Some((activity_id, _)) = repository::find_activity_by_garmin_id(tx, garmin_id)? else {
        return Ok(None);
    };
    if !activity_payload_has_retryable_asset_bytes(tx, &activity_id, payload)? {
        return Ok(None);
    }
    let had_existing_detail_assets = repository::get_activity_asset(tx, &activity_id, "activity_full")?
        .filter(|(_, _, status)| status == "ready")
        .is_some()
        || repository::get_activity_asset(tx, &activity_id, "details")?
            .filter(|(_, _, status)| status == "ready")
            .is_some();
    let asset_outcome =
        apply_activity_assets(tx, data_dir, &activity_id, payload, had_existing_detail_assets)?;
    let detail_status = compute_detail_status(
        asset_outcome.activity_full_ok,
        asset_outcome.details_ok,
        had_existing_detail_assets,
        asset_outcome.new_detail_failed,
    );
    let now = utc_now();
    tx.execute(
        "UPDATE health_activity SET detail_status = ?1, revision = revision + 1, updated_at_utc = ?2 WHERE id = ?3",
        rusqlite::params![detail_status, now, activity_id],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(Some(activity_id))
}

fn apply_activity_assets(
    tx: &Transaction,
    data_dir: &str,
    activity_id: &str,
    payload: &Value,
    had_existing_detail_assets: bool,
) -> HealthResult<AssetApplyOutcome> {
    let assets = payload.get("assets").and_then(|v| v.as_array());
    let Some(assets) = assets else {
        return Ok(AssetApplyOutcome {
            activity_full_ok: false,
            details_ok: false,
            new_detail_failed: false,
        });
    };
    let now = utc_now();
    let mut activity_full_ok = false;
    let mut details_ok = false;
    let mut new_detail_failed = false;
    for asset in assets {
        let kind = asset.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if kind.is_empty() {
            continue;
        }
        let status = asset.get("status").and_then(|v| v.as_str()).unwrap_or("failed");
        if status == "ready" {
            let b64 = asset
                .get("contentBase64")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty());
            if let Some(b64) = b64 {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
                let (relative_path, sha256) =
                    activity_files::write_asset_atomic(data_dir, activity_id, kind, &bytes)?;
                repository::upsert_activity_asset(
                    tx,
                    activity_id,
                    kind,
                    Some(&relative_path),
                    Some(&sha256),
                    "ready",
                    Some(&now),
                )?;
                match kind {
                    "activity_full" => activity_full_ok = true,
                    "details" => details_ok = true,
                    _ => {}
                }
                continue;
            }
        }
        if matches!(kind, "activity_full" | "details") && had_existing_detail_assets {
            new_detail_failed = true;
            continue;
        }
        if kind == "original_zip" && status != "ready" {
            if repository::get_activity_asset(tx, activity_id, kind)?
                .filter(|(_, _, s)| s == "ready")
                .is_some()
            {
                continue;
            }
        }
        repository::upsert_activity_asset(
            tx,
            activity_id,
            kind,
            None,
            asset.get("sha256").and_then(|v| v.as_str()),
            status,
            None,
        )?;
        if matches!(kind, "activity_full" | "details") {
            new_detail_failed = true;
        }
    }
    Ok(AssetApplyOutcome {
        activity_full_ok,
        details_ok,
        new_detail_failed,
    })
}

fn compute_detail_status(
    activity_full_ok: bool,
    details_ok: bool,
    had_existing_detail_assets: bool,
    new_detail_failed: bool,
) -> &'static str {
    if activity_full_ok && details_ok {
        "synced"
    } else if new_detail_failed && had_existing_detail_assets {
        "stale"
    } else {
        "unsynced"
    }
}

fn apply_activity(
    tx: &Transaction,
    data_dir: &str,
    local_date: &str,
    garmin_id: &str,
    payload: &Value,
    hash: &str,
    parser_version: i32,
) -> HealthResult<String> {
    let started = payload
        .get("startedAt")
        .and_then(|v| v.as_str())
        .ok_or_else(|| HealthError::garmin_apply_invalid_batch("activity startedAt required"))?;
    super::super::util::instant_to_unix(started).map_err(HealthError::invalid_time)?;
    let ended = parse_optional_instant(payload.get("endedAt"))?;
    let type_key = optional_str(payload.get("typeKey")).or_else(|| optional_str(payload.get("type")));
    let title = optional_str(payload.get("title"));
    let duration_seconds = optional_f64(payload.get("durationSeconds").unwrap_or(&Value::Null));
    let elapsed_duration_seconds =
        optional_f64(payload.get("elapsedDurationSeconds").unwrap_or(&Value::Null));
    let moving_duration_seconds =
        optional_f64(payload.get("movingDurationSeconds").unwrap_or(&Value::Null));
    let distance_meters = optional_f64(payload.get("distanceMeters").unwrap_or(&Value::Null));
    let elevation_gain_meters =
        optional_f64(payload.get("elevationGainMeters").unwrap_or(&Value::Null));
    let avg_heart_rate_bpm = optional_f64(payload.get("avgHeartRateBpm").unwrap_or(&Value::Null));
    let avg_speed_mps = optional_f64(payload.get("avgSpeedMps").unwrap_or(&Value::Null));
    let avg_pace_seconds_per_km =
        optional_f64(payload.get("avgPaceSecondsPerKm").unwrap_or(&Value::Null));
    let avg_power_watts = optional_f64(payload.get("avgPowerWatts").unwrap_or(&Value::Null));
    // Garmin activity calories only; not verified against Garmin Connect UI yet.
    let calories = optional_f64(payload.get("calories").unwrap_or(&Value::Null));
    let suspected_duplicate_of = payload
        .get("suspectedDuplicateOf")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let start_sec = parse_instant(started)?;
    let legacy_duration = duration_seconds.map(|d| d.round() as i64);
    let activity_json = json!({
        "sport": type_key.as_deref().unwrap_or("activity"),
        "duration": legacy_duration,
        "metrics": {
            "startTime": start_sec,
            "distance": distance_meters,
        },
        "name": title,
    });
    let activity_json_str =
        serde_json::to_string(&activity_json).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let existing_id = repository::find_activity_by_garmin_id(tx, garmin_id)?;
    let activity_id = existing_id
        .as_ref()
        .map(|(id, _)| id.clone())
        .unwrap_or_else(new_uuid);
    let had_existing_detail_assets = repository::get_activity_asset(tx, &activity_id, "activity_full")?
        .filter(|(_, _, status)| status == "ready")
        .is_some()
        || repository::get_activity_asset(tx, &activity_id, "details")?
            .filter(|(_, _, status)| status == "ready")
            .is_some();
    let asset_outcome = apply_activity_assets(tx, data_dir, &activity_id, payload, had_existing_detail_assets)?;
    let detail_status = compute_detail_status(
        asset_outcome.activity_full_ok,
        asset_outcome.details_ok,
        had_existing_detail_assets,
        asset_outcome.new_detail_failed,
    );
    repository::upsert_garmin_activity(
        tx,
        &activity_id,
        ActivityUpsertFields {
            local_date,
            garmin_id,
            started_at: started,
            ended_at: ended.as_deref(),
            type_key,
            title,
            duration_seconds,
            elapsed_duration_seconds,
            moving_duration_seconds,
            distance_meters,
            elevation_gain_meters,
            avg_heart_rate_bpm,
            avg_speed_mps,
            avg_pace_seconds_per_km,
            avg_power_watts,
            calories,
            detail_status,
            activity_json: &activity_json_str,
            content_hash: hash,
            parser_version,
            suspected_duplicate_of: suspected_duplicate_of.as_deref(),
        },
    )
}
