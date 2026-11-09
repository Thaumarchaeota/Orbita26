use rusqlite::{OptionalExtension, Transaction};

use super::error::{GarminSyncError, GarminSyncResult, GARMIN_JOB_NOT_FOUND, GARMIN_SCAN_NOT_FOUND};
use super::types::{
    job_is_terminal, JobSnapshot, ScanSnapshot, WorkItemSnapshot, JOB_PAUSED, KIND_ADVANCED,
    KIND_DAILY,
};

fn job_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<JobSnapshot> {
    Ok(JobSnapshot {
        job_id: row.get("job_id")?,
        data_dir_key: row.get("data_dir_key")?,
        kind: row.get("kind")?,
        from_date: row.get("from_date")?,
        to_date: row.get("to_date")?,
        timezone_policy: row.get("timezone_policy")?,
        intent: row.get("intent")?,
        force_details: row.get::<_, i64>("force_details")? != 0,
        force_original: row.get::<_, i64>("force_original")? != 0,
        scan_id: row.get("scan_id")?,
        manifest_hash: row.get("manifest_hash")?,
        state: row.get("state")?,
        pause_reason: row.get("pause_reason")?,
        revision: row.get("revision")?,
        phase_stats_json: row.get("phase_stats_json")?,
        error_code: row.get("error_code")?,
        error_summary: row.get("error_summary")?,
        request_id: row.get("request_id")?,
        created_at_utc: row.get("created_at_utc")?,
        updated_at_utc: row.get("updated_at_utc")?,
        started_at_utc: row.get("started_at_utc")?,
        finished_at_utc: row.get("finished_at_utc")?,
    })
}

fn scan_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScanSnapshot> {
    Ok(ScanSnapshot {
        scan_id: row.get("scan_id")?,
        request_id: row.get("request_id")?,
        data_dir_key: row.get("data_dir_key")?,
        from_date: row.get("from_date")?,
        to_date: row.get("to_date")?,
        timezone_policy: row.get("timezone_policy")?,
        mode: row.get("mode")?,
        force_details: row.get::<_, i64>("force_details")? != 0,
        force_original: row.get::<_, i64>("force_original")? != 0,
        state: row.get("state")?,
        page_cursor: row.get("page_cursor")?,
        page_evidence_json: row.get("page_evidence_json")?,
        manifest_hash: row.get("manifest_hash")?,
        revision: row.get("revision")?,
        error_code: row.get("error_code")?,
        error_summary: row.get("error_summary")?,
        created_at_utc: row.get("created_at_utc")?,
        finished_at_utc: row.get("finished_at_utc")?,
    })
}

fn item_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkItemSnapshot> {
    Ok(WorkItemSnapshot {
        work_item_id: row.get("work_item_id")?,
        job_id: row.get("job_id")?,
        kind: row.get("kind")?,
        target_key: row.get("target_key")?,
        priority: row.get("priority")?,
        state: row.get("state")?,
        attempt_count: row.get("attempt_count")?,
        attempt_generation: row.get("attempt_generation")?,
        next_attempt_at_utc: row.get("next_attempt_at_utc")?,
        idempotency_key: row.get("idempotency_key")?,
        input_hash: row.get("input_hash")?,
        committed_hash: row.get("committed_hash")?,
        asset_version_id: row.get("asset_version_id")?,
        revision: row.get("revision")?,
        error_code: row.get("error_code")?,
        result_code: row.get("result_code")?,
    })
}

const JOB_SELECT: &str = "SELECT job_id, data_dir_key, kind, from_date, to_date, timezone_policy, intent,
  force_details, force_original, scan_id, manifest_hash, state, pause_reason, revision, phase_stats_json,
  error_code, error_summary, request_id, created_at_utc, updated_at_utc, started_at_utc, finished_at_utc
  FROM garmin_sync_job";

const SCAN_SELECT: &str = "SELECT scan_id, data_dir_key, from_date, to_date, timezone_policy, mode,
  force_details, force_original, state, page_cursor, page_evidence_json, manifest_hash, revision,
  error_code, error_summary, created_at_utc, finished_at_utc, request_id FROM garmin_scan";

const ITEM_SELECT: &str = "SELECT work_item_id, job_id, kind, target_key, priority, state, attempt_count,
  attempt_generation, next_attempt_at_utc, idempotency_key, input_hash, committed_hash, asset_version_id,
  revision, error_code, result_code FROM garmin_sync_work_item";

pub fn get_job(tx: &Transaction, job_id: &str) -> GarminSyncResult<JobSnapshot> {
    tx.query_row(&format!("{JOB_SELECT} WHERE job_id = ?1"), [job_id], job_from_row)
        .optional()?
        .ok_or_else(|| GarminSyncError::new(GARMIN_JOB_NOT_FOUND, "job not found"))
}

pub fn get_scan(tx: &Transaction, scan_id: &str) -> GarminSyncResult<ScanSnapshot> {
    tx.query_row(&format!("{SCAN_SELECT} WHERE scan_id = ?1"), [scan_id], scan_from_row)
        .optional()?
        .ok_or_else(|| GarminSyncError::new(GARMIN_SCAN_NOT_FOUND, "scan not found"))
}

pub fn scan_by_request_id(tx: &Transaction, request_id: &str) -> GarminSyncResult<Option<ScanSnapshot>> {
    Ok(tx.query_row(
        &format!("{SCAN_SELECT} WHERE request_id = ?1"),
        [request_id], scan_from_row,
    ).optional()?)
}

pub fn job_by_request_id(tx: &Transaction, request_id: &str, data_dir_key: &str) -> GarminSyncResult<Option<JobSnapshot>> {
    Ok(tx
        .query_row(
            &format!("{JOB_SELECT} WHERE request_id = ?1 AND data_dir_key = ?2"),
            rusqlite::params![request_id, data_dir_key],
            job_from_row,
        )
        .optional()?)
}

pub fn nonterminal_daily(tx: &Transaction, data_dir_key: &str) -> GarminSyncResult<Option<JobSnapshot>> {
    let mut stmt = tx.prepare(&format!(
        "{JOB_SELECT} WHERE data_dir_key = ?1 AND kind = ?2"
    ))?;
    let jobs = stmt
        .query_map(rusqlite::params![data_dir_key, KIND_DAILY], job_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(jobs.into_iter().find(|j| !job_is_terminal(&j.state)))
}

pub fn insert_job(tx: &Transaction, job: &JobSnapshot) -> GarminSyncResult<()> {
    tx.execute(
        "INSERT INTO garmin_sync_job (
           job_id, data_dir_key, kind, from_date, to_date, timezone_policy, intent,
           force_details, force_original, scan_id, manifest_hash, state, pause_reason, revision,
           phase_stats_json, error_code, error_summary, request_id, created_at_utc, updated_at_utc,
           started_at_utc, finished_at_utc
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        rusqlite::params![
            job.job_id,
            job.data_dir_key,
            job.kind,
            job.from_date,
            job.to_date,
            job.timezone_policy,
            job.intent,
            if job.force_details { 1 } else { 0 },
            if job.force_original { 1 } else { 0 },
            job.scan_id,
            job.manifest_hash,
            job.state,
            job.pause_reason,
            job.revision,
            job.phase_stats_json,
            job.error_code,
            job.error_summary,
            job.request_id,
            job.created_at_utc,
            job.updated_at_utc,
            job.started_at_utc,
            job.finished_at_utc,
        ],
    )
    .map_err(map_job_insert_err)?;
    Ok(())
}

fn map_job_insert_err(e: rusqlite::Error) -> GarminSyncError {
    let msg = e.to_string();
    if msg.contains("idx_garmin_job_one_advanced") || msg.contains("UNIQUE constraint") {
        GarminSyncError::new(
            super::error::GARMIN_JOB_ACTIVE,
            "an advanced nonterminal job already exists for this dataDir",
        )
    } else {
        GarminSyncError::new("ARCHIVE_LIFECYCLE_ERROR", msg)
    }
}

pub fn update_job(tx: &Transaction, job: &JobSnapshot) -> GarminSyncResult<()> {
    tx.execute(
        "UPDATE garmin_sync_job SET
           from_date=?1, to_date=?2, timezone_policy=?3, intent=?4, force_details=?5, force_original=?6,
           scan_id=?7, manifest_hash=?8, state=?9, pause_reason=?10, revision=?11, phase_stats_json=?12,
           error_code=?13, error_summary=?14, request_id=?15, updated_at_utc=?16, started_at_utc=?17,
           finished_at_utc=?18
         WHERE job_id=?19",
        rusqlite::params![
            job.from_date,
            job.to_date,
            job.timezone_policy,
            job.intent,
            if job.force_details { 1 } else { 0 },
            if job.force_original { 1 } else { 0 },
            job.scan_id,
            job.manifest_hash,
            job.state,
            job.pause_reason,
            job.revision,
            job.phase_stats_json,
            job.error_code,
            job.error_summary,
            job.request_id,
            job.updated_at_utc,
            job.started_at_utc,
            job.finished_at_utc,
            job.job_id,
        ],
    )?;
    Ok(())
}

pub fn insert_scan(tx: &Transaction, scan: &ScanSnapshot) -> GarminSyncResult<()> {
    tx.execute(
        "INSERT INTO garmin_scan (
           scan_id, data_dir_key, from_date, to_date, timezone_policy, mode, force_details, force_original,
           state, page_cursor, page_evidence_json, manifest_hash, revision, error_code, error_summary,
           created_at_utc, finished_at_utc, request_id
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
        rusqlite::params![
            scan.scan_id,
            scan.data_dir_key,
            scan.from_date,
            scan.to_date,
            scan.timezone_policy,
            scan.mode,
            if scan.force_details { 1 } else { 0 },
            if scan.force_original { 1 } else { 0 },
            scan.state,
            scan.page_cursor,
            scan.page_evidence_json,
            scan.manifest_hash,
            scan.revision,
            scan.error_code,
            scan.error_summary,
            scan.created_at_utc,
            scan.finished_at_utc,
            scan.request_id,
        ],
    )?;
    Ok(())
}

pub fn update_scan(tx: &Transaction, scan: &ScanSnapshot) -> GarminSyncResult<()> {
    tx.execute(
        "UPDATE garmin_scan SET state=?1, revision=?2, finished_at_utc=?3, error_code=?4, error_summary=?5
         WHERE scan_id=?6",
        rusqlite::params![
            scan.state,
            scan.revision,
            scan.finished_at_utc,
            scan.error_code,
            scan.error_summary,
            scan.scan_id,
        ],
    )?;
    Ok(())
}

pub fn insert_work_item(tx: &Transaction, item: &WorkItemSnapshot) -> GarminSyncResult<()> {
    tx.execute(
        "INSERT INTO garmin_sync_work_item (
           work_item_id, job_id, kind, target_key, priority, state, attempt_count, attempt_generation,
           next_attempt_at_utc, idempotency_key, input_hash, committed_hash, asset_version_id, revision,
           error_code, result_code
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        rusqlite::params![
            item.work_item_id,
            item.job_id,
            item.kind,
            item.target_key,
            item.priority,
            item.state,
            item.attempt_count,
            item.attempt_generation,
            item.next_attempt_at_utc,
            item.idempotency_key,
            item.input_hash,
            item.committed_hash,
            item.asset_version_id,
            item.revision,
            item.error_code,
            item.result_code,
        ],
    )?;
    Ok(())
}

pub fn work_item_exists(
    tx: &Transaction,
    job_id: &str,
    kind: &str,
    target_key: &str,
) -> GarminSyncResult<bool> {
    let n: i64 = tx.query_row(
        "SELECT COUNT(*) FROM garmin_sync_work_item WHERE job_id=?1 AND kind=?2 AND target_key=?3",
        rusqlite::params![job_id, kind, target_key],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

pub fn list_jobs(tx: &Transaction) -> GarminSyncResult<Vec<JobSnapshot>> {
    let mut stmt = tx.prepare(JOB_SELECT)?;
    let rows = stmt.query_map([], job_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn list_items(tx: &Transaction) -> GarminSyncResult<Vec<WorkItemSnapshot>> {
    let mut stmt = tx.prepare(ITEM_SELECT)?;
    let rows = stmt.query_map([], item_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn list_items_for_job(tx: &Transaction, job_id: &str) -> GarminSyncResult<Vec<WorkItemSnapshot>> {
    let mut stmt = tx.prepare(&format!("{ITEM_SELECT} WHERE job_id=?1"))?;
    let rows = stmt.query_map([job_id], item_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn persist_item_state(tx: &Transaction, item: &WorkItemSnapshot) -> GarminSyncResult<()> {
    tx.execute(
        "UPDATE garmin_sync_work_item SET state=?1, error_code=?2, result_code=?3
         WHERE work_item_id=?4",
        rusqlite::params![item.state, item.error_code, item.result_code, item.work_item_id],
    )?;
    Ok(())
}

pub fn paused_jobs(tx: &Transaction) -> GarminSyncResult<Vec<JobSnapshot>> {
    let mut stmt = tx.prepare(&format!("{JOB_SELECT} WHERE state = ?1"))?;
    let rows = stmt.query_map([JOB_PAUSED], job_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn has_nonterminal_advanced(tx: &Transaction, data_dir_key: &str) -> GarminSyncResult<bool> {
    let mut stmt = tx.prepare(&format!(
        "{JOB_SELECT} WHERE data_dir_key = ?1 AND kind = ?2"
    ))?;
    let jobs = stmt
        .query_map(rusqlite::params![data_dir_key, KIND_ADVANCED], job_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(jobs.iter().any(|j| !job_is_terminal(&j.state)))
}
