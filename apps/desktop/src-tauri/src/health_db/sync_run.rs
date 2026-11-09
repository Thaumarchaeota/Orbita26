use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::json;

use super::error::{HealthError, HealthResult};
use super::types::GarminClassCoverageEntry;
use super::util::{new_uuid, utc_now};

pub fn require_run_exists(tx: &Transaction, run_id: &str) -> HealthResult<()> {
    let exists = tx
        .query_row(
            "SELECT 1 FROM garmin_sync_run WHERE id = ?1",
            params![run_id],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
        .is_some();
    if !exists {
        return Err(HealthError::garmin_apply_invalid_batch("sync run not found"));
    }
    Ok(())
}

pub fn create_run(
    tx: &Transaction,
    run_id: &str,
    entry_point: &str,
    from: &str,
    to: &str,
) -> HealthResult<()> {
    tx.execute(
        "INSERT INTO garmin_sync_run (
            id, started_at_utc, finished_at_utc, entry_point,
            requested_local_date_from, requested_local_date_to,
            overall_status, submitted_class_count, skipped_same_hash_count, retained_gap_count
        ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, 'aborted', 0, 0, 0)",
        params![run_id, utc_now(), entry_point, from, to],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn finish_run_failed(
    conn: &Connection,
    run_id: &str,
    error_code: &str,
    error_summary: &str,
) -> HealthResult<()> {
    conn.execute(
        "UPDATE garmin_sync_run SET finished_at_utc = ?1, overall_status = 'failed',
         error_code = ?2, error_summary = ?3 WHERE id = ?4",
        params![utc_now(), error_code, error_summary, run_id],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    set_meta(conn, "syncing", "0")?;
    set_meta(conn, "last_error", error_summary)?;
    Ok(())
}

pub fn finish_run_aborted(conn: &Connection, run_id: &str, error_code: &str, error_summary: &str) -> HealthResult<()> {
    conn.execute(
        "UPDATE garmin_sync_run SET finished_at_utc = ?1, overall_status = 'aborted',
         error_code = ?2, error_summary = ?3 WHERE id = ?4",
        params![utc_now(), error_code, error_summary, run_id],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    set_meta(conn, "syncing", "0")?;
    Ok(())
}

pub fn update_run_success(
    tx: &Transaction,
    run_id: &str,
    overall_status: &str,
    submitted: u32,
    skipped: u32,
    retained: u32,
    error_code: Option<&str>,
    error_summary: Option<&str>,
) -> HealthResult<()> {
    tx.execute(
        "UPDATE garmin_sync_run SET finished_at_utc = ?1, overall_status = ?2,
         submitted_class_count = ?3, skipped_same_hash_count = ?4, retained_gap_count = ?5,
         error_code = ?6, error_summary = ?7 WHERE id = ?8",
        params![
            utc_now(),
            overall_status,
            submitted,
            skipped,
            retained,
            error_code,
            error_summary,
            run_id
        ],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    if overall_status == "success" || overall_status == "partial_success" {
        set_meta_tx(tx, "last_success_at", &utc_now())?;
        set_meta_tx(tx, "last_error", "")?;
    }
    set_meta_tx(tx, "syncing", "0")?;
    Ok(())
}

pub fn insert_coverage(tx: &Transaction, run_id: &str, entry: &GarminClassCoverageEntry) -> HealthResult<()> {
    let ids_json = serde_json::to_string(&entry.submitted_root_ids).unwrap_or("[]".into());
    tx.execute(
        "INSERT INTO garmin_sync_run_coverage (
            id, run_id, class_id, local_date, external_id, outcome,
            submitted_root_ids_json, error_code, error_summary
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            new_uuid(),
            run_id,
            entry.class_id,
            entry.local_date,
            entry.external_id,
            entry.outcome,
            ids_json,
            entry.error_code,
            entry.error_summary
        ],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> HealthResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO health_sync_meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn set_meta_tx(tx: &Transaction, key: &str, value: &str) -> HealthResult<()> {
    tx.execute(
        "INSERT OR REPLACE INTO health_sync_meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn set_date_range_meta(tx: &Transaction, from: &str, to: &str) -> HealthResult<()> {
    set_meta_tx(tx, "earliest_local_date", from)?;
    set_meta_tx(tx, "latest_local_date", to)?;
    Ok(())
}

pub fn read_sync_meta(conn: &Connection) -> HealthResult<serde_json::Map<String, serde_json::Value>> {
    let mut out = serde_json::Map::new();
    let mut stmt = conn
        .prepare("SELECT key, value FROM health_sync_meta")
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    for row in rows {
        let (k, v) = row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        out.insert(k, json!(v));
    }
    Ok(out)
}

pub fn list_pending_original_download_ids(conn: &Connection) -> HealthResult<Vec<String>> {
    super::repository::list_pending_original_garmin_ids(conn)
}
