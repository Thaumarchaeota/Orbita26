use rusqlite::{params, Connection, OptionalExtension};
use base64::Engine;

use crate::productivity_db::coordinator::in_transaction;

use super::error::{HealthError, HealthResult};
use super::repository;
use super::types::{
    ActivitiesListResponse, ActivityDetailResponse, ExportFitFromZipRequest, GarminClassCoverageEntry,
    ListActivitiesQuery, MealSnapshot, ReadActivityAssetRequest, ReadActivityAssetResponse,
    RetryOriginalDownloadRequest,
};
use super::activity_files;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetHealthRootRequest {
    pub id: String,
    pub root_kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthRootResponse {
    pub root_kind: String,
    pub snapshot: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListGarminSyncRunsQuery {
    pub local_date_from: Option<String>,
    pub local_date_to: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
}

fn default_limit() -> u32 {
    50
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminSyncRunRecord {
    pub id: String,
    pub started_at_utc: String,
    pub finished_at_utc: Option<String>,
    pub entry_point: String,
    pub requested_local_date_from: String,
    pub requested_local_date_to: String,
    pub overall_status: String,
    pub submitted_class_count: u32,
    pub skipped_same_hash_count: u32,
    pub retained_gap_count: u32,
    pub error_code: Option<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListGarminSyncRunsResponse {
    pub runs: Vec<GarminSyncRunRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetGarminSyncRunRequest {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetGarminSyncRunResponse {
    pub run: GarminSyncRunRecord,
    pub coverage: Vec<GarminClassCoverageEntry>,
}

pub fn get_meal_by_id(data_dir: &str, id: &str) -> HealthResult<MealSnapshot> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            repository::get_meal(conn, id)?
                .ok_or_else(|| HealthError::root_not_found("meal not found"))?
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

pub fn get_health_root(data_dir: &str, req: GetHealthRootRequest) -> HealthResult<HealthRootResponse> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let snapshot = match req.root_kind.as_str() {
                "meal" => {
                    let meal = repository::get_meal(conn, &req.id)?
                        .ok_or_else(|| HealthError::root_not_found("meal not found"))?;
                    serde_json::to_value(meal).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
                }
                "day" => read_day_root(conn, &req.id)?,
                "activity" => read_activity_root(conn, &req.id)?,
                "nap" => read_nap_root(conn, &req.id)?,
                "sleep-night" | "sleep_night" => read_sleep_night_root(conn, &req.id)?,
                other => Err(HealthError::invalid_patch(format!("unknown root kind: {other}")))?,
            };
            HealthRootResponse {
                root_kind: req.root_kind,
                snapshot,
            }
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

fn read_day_root(conn: &Connection, id: &str) -> HealthResult<Value> {
    conn.query_row(
        "SELECT id, revision, local_date, source, data_json, created_at_utc, updated_at_utc, deleted_at_utc
         FROM health_day WHERE id = ?1",
        params![id],
        |row| {
            let data_json: String = row.get(4)?;
            let data: Value = serde_json::from_str(&data_json).unwrap_or(json!({}));
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "revision": row.get::<_, i64>(1)?,
                "localDate": row.get::<_, String>(2)?,
                "source": row.get::<_, String>(3)?,
                "data": data,
                "createdAt": row.get::<_, String>(5)?,
                "updatedAt": row.get::<_, String>(6)?,
                "deletedAt": row.get::<_, Option<String>>(7)?,
            }))
        },
    )
    .optional()
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
    .ok_or_else(|| HealthError::root_not_found("health day not found"))
}

fn read_activity_root(conn: &Connection, id: &str) -> HealthResult<Value> {
    let row = repository::get_activity_row(conn, id)?
        .ok_or_else(|| HealthError::root_not_found("activity not found"))?;
    let activity = repository::activity_row_to_list_item(row)?;
    let assets = repository::list_activity_assets(conn, id)?;
    Ok(serde_json::to_value(json!({
        "activity": activity,
        "assets": assets,
    }))
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?)
}

pub fn list_activities(data_dir: &str, query: ListActivitiesQuery) -> HealthResult<ActivitiesListResponse> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let limit = query.limit.clamp(1, 500);
            let activities = repository::list_activities(
                conn,
                query.local_date_from.as_deref(),
                query.local_date_to.as_deref(),
                limit,
                query.offset,
            )?;
            ActivitiesListResponse { activities }
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

pub fn get_activity(data_dir: &str, id: &str) -> HealthResult<ActivityDetailResponse> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let row = repository::get_activity_row(conn, id)?
                .ok_or_else(|| HealthError::root_not_found("activity not found"))?;
            let activity = repository::activity_row_to_list_item(row)?;
            let assets = repository::list_activity_assets(conn, id)?;
            ActivityDetailResponse { activity, assets }
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

pub fn read_asset_bytes(
    data_dir: &str,
    req: ReadActivityAssetRequest,
) -> HealthResult<ReadActivityAssetResponse> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let asset = repository::get_activity_asset(conn, &req.activity_id, &req.kind)?
                .ok_or_else(|| HealthError::root_not_found("activity asset not found"))?;
            let (relative_path, sha256, status) = asset;
            if status != "ready" {
                return Err(HealthError::root_not_found(format!(
                    "activity asset not ready: {status}"
                )).into());
            }
            let bytes = activity_files::read_asset_bytes(data_dir, &relative_path)?;
            ReadActivityAssetResponse {
                kind: req.kind,
                relative_path,
                sha256,
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
            }
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

pub fn retry_original_download(data_dir: &str, req: RetryOriginalDownloadRequest) -> HealthResult<()> {
    crate::productivity_db::coordinator::with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            repository::get_activity_row(tx, &req.activity_id)?
                .ok_or_else(|| HealthError::root_not_found("activity not found"))?;
            Ok(repository::mark_activity_asset_pending(tx, &req.activity_id, "original_zip")?)
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

pub fn export_fit_from_zip(data_dir: &str, req: ExportFitFromZipRequest) -> HealthResult<()> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let asset = repository::get_activity_asset(conn, &req.activity_id, "original_zip")?
                .ok_or_else(|| HealthError::root_not_found("original zip asset not found"))?;
            let (relative_path, _, status) = asset;
            if status != "ready" {
                return Err(HealthError::root_not_found(format!(
                    "original zip asset not ready: {status}"
                )).into());
            }
            let zip_path = std::path::PathBuf::from(data_dir).join(relative_path);
            activity_files::export_fit_from_zip(&zip_path, std::path::Path::new(&req.output_path))?;
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

fn read_nap_root(conn: &Connection, id: &str) -> HealthResult<Value> {
    conn.query_row(
        "SELECT id, revision, wake_local_date, source, started_at_utc, ended_at_utc,
                nap_json, created_at_utc, updated_at_utc, deleted_at_utc
         FROM health_nap WHERE id = ?1",
        params![id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "revision": row.get::<_, i64>(1)?,
                "wakeLocalDate": row.get::<_, String>(2)?,
                "source": row.get::<_, String>(3)?,
                "startedAt": row.get::<_, String>(4)?,
                "endedAt": row.get::<_, String>(5)?,
                "nap": serde_json::from_str::<Value>(&row.get::<_, String>(6)?).unwrap_or(json!({})),
                "createdAt": row.get::<_, String>(7)?,
                "updatedAt": row.get::<_, String>(8)?,
                "deletedAt": row.get::<_, Option<String>>(9)?,
            }))
        },
    )
    .optional()
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
    .ok_or_else(|| HealthError::root_not_found("nap not found"))
}

fn read_sleep_night_root(conn: &Connection, id: &str) -> HealthResult<Value> {
    conn.query_row(
        "SELECT id, revision, wake_local_date, source, night_json, created_at_utc, updated_at_utc, deleted_at_utc
         FROM health_sleep_night WHERE id = ?1",
        params![id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "revision": row.get::<_, i64>(1)?,
                "wakeLocalDate": row.get::<_, String>(2)?,
                "source": row.get::<_, String>(3)?,
                "night": serde_json::from_str::<Value>(&row.get::<_, String>(4)?).unwrap_or(json!({})),
                "createdAt": row.get::<_, String>(5)?,
                "updatedAt": row.get::<_, String>(6)?,
                "deletedAt": row.get::<_, Option<String>>(7)?,
            }))
        },
    )
    .optional()
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
    .ok_or_else(|| HealthError::root_not_found("sleep night not found"))
}

pub fn list_garmin_sync_runs(data_dir: &str, query: ListGarminSyncRunsQuery) -> HealthResult<ListGarminSyncRunsResponse> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let limit = query.limit.clamp(1, 200);
            let mut stmt = conn
                .prepare(
                    "SELECT id, started_at_utc, finished_at_utc, entry_point,
                            requested_local_date_from, requested_local_date_to,
                            overall_status, submitted_class_count, skipped_same_hash_count,
                            retained_gap_count, error_code, error_summary
                     FROM garmin_sync_run
                     WHERE (?1 IS NULL OR requested_local_date_to >= ?1)
                       AND (?2 IS NULL OR requested_local_date_from <= ?2)
                     ORDER BY started_at_utc DESC
                     LIMIT ?3 OFFSET ?4",
                )
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let rows = stmt
                .query_map(
                    params![
                        query.local_date_from,
                        query.local_date_to,
                        limit,
                        query.offset
                    ],
                    map_sync_run_row,
                )
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let mut runs = Vec::new();
            for row in rows {
                runs.push(row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?);
            }
            ListGarminSyncRunsResponse { runs }
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

pub fn get_garmin_sync_run(data_dir: &str, run_id: &str) -> HealthResult<GetGarminSyncRunResponse> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let run = conn
                .query_row(
                    "SELECT id, started_at_utc, finished_at_utc, entry_point,
                            requested_local_date_from, requested_local_date_to,
                            overall_status, submitted_class_count, skipped_same_hash_count,
                            retained_gap_count, error_code, error_summary
                     FROM garmin_sync_run WHERE id = ?1",
                    params![run_id],
                    map_sync_run_row,
                )
                .optional()
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
                .ok_or_else(|| HealthError::root_not_found("sync run not found"))?;
            let mut stmt = conn
                .prepare(
                    "SELECT class_id, local_date, external_id, outcome, submitted_root_ids_json,
                            error_code, error_summary
                     FROM garmin_sync_run_coverage WHERE run_id = ?1 ORDER BY local_date, class_id",
                )
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let rows = stmt
                .query_map(params![run_id], |row| {
                    let ids_json: String = row.get(4)?;
                    let submitted_root_ids: Vec<String> =
                        serde_json::from_str(&ids_json).unwrap_or_default();
                    Ok(GarminClassCoverageEntry {
                        class_id: row.get(0)?,
                        local_date: row.get(1)?,
                        external_id: row.get(2)?,
                        outcome: row.get(3)?,
                        submitted_root_ids,
                        error_code: row.get(5)?,
                        error_summary: row.get(6)?,
                    })
                })
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let mut coverage = Vec::new();
            for row in rows {
                coverage.push(row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?);
            }
            GetGarminSyncRunResponse { run, coverage }
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepNightListItem {
    pub id: String,
    pub wake_local_date: String,
    pub source: String,
    pub night: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NapListItem {
    pub id: String,
    pub wake_local_date: String,
    pub source: String,
    pub started_at: String,
    pub ended_at: String,
    pub nap: Value,
}

pub fn list_sleep_nights(
    data_dir: &str,
    local_date_from: &str,
    local_date_to: &str,
) -> HealthResult<Vec<SleepNightListItem>> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let mut stmt = conn
                .prepare(
                    "SELECT id, wake_local_date, source, night_json FROM health_sleep_night
                     WHERE deleted_at_utc IS NULL AND wake_local_date >= ?1 AND wake_local_date <= ?2
                     ORDER BY wake_local_date ASC, id ASC",
                )
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let rows = stmt
                .query_map(params![local_date_from, local_date_to], |row| {
                    let night_json: String = row.get(3)?;
                    Ok(SleepNightListItem {
                        id: row.get(0)?,
                        wake_local_date: row.get(1)?,
                        source: row.get(2)?,
                        night: serde_json::from_str(&night_json).unwrap_or(json!({})),
                    })
                })
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?);
            }
            out
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

pub fn list_naps(
    data_dir: &str,
    local_date_from: &str,
    local_date_to: &str,
) -> HealthResult<Vec<NapListItem>> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let mut stmt = conn
                .prepare(
                    "SELECT id, wake_local_date, source, started_at_utc, ended_at_utc, nap_json
                     FROM health_nap
                     WHERE deleted_at_utc IS NULL AND wake_local_date >= ?1 AND wake_local_date <= ?2
                     ORDER BY wake_local_date ASC, id ASC",
                )
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let rows = stmt
                .query_map(params![local_date_from, local_date_to], |row| {
                    let nap_json: String = row.get(5)?;
                    Ok(NapListItem {
                        id: row.get(0)?,
                        wake_local_date: row.get(1)?,
                        source: row.get(2)?,
                        started_at: row.get(3)?,
                        ended_at: row.get(4)?,
                        nap: serde_json::from_str(&nap_json).unwrap_or(json!({})),
                    })
                })
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?);
            }
            out
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

pub fn hydration_ml_for_date(data_dir: &str, local_date: &str) -> HealthResult<Option<i64>> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let v: Option<f64> = conn
                .query_row(
                    "SELECT json_extract(data_json, '$.hydrationMl') FROM health_day
                     WHERE local_date = ?1 AND deleted_at_utc IS NULL",
                    params![local_date],
                    |row| row.get(0),
                )
                .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            v.map(|n| n as i64).filter(|n| *n > 0)
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}

fn map_sync_run_row(row: &rusqlite::Row) -> rusqlite::Result<GarminSyncRunRecord> {
    Ok(GarminSyncRunRecord {
        id: row.get(0)?,
        started_at_utc: row.get(1)?,
        finished_at_utc: row.get(2)?,
        entry_point: row.get(3)?,
        requested_local_date_from: row.get(4)?,
        requested_local_date_to: row.get(5)?,
        overall_status: row.get(6)?,
        submitted_class_count: row.get::<_, i32>(7)? as u32,
        skipped_same_hash_count: row.get::<_, i32>(8)? as u32,
        retained_gap_count: row.get::<_, i32>(9)? as u32,
        error_code: row.get(10)?,
        error_summary: row.get(11)?,
    })
}
