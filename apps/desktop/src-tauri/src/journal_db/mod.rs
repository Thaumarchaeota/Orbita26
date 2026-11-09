mod connection;
mod garmin;
pub(crate) mod health_query;
pub(crate) use health_query::{HealthOverviewRequest, HealthOverviewResponse, HealthSyncStatus};
mod project;
mod schema;
mod sync_meta;
pub(crate) mod util;

// Standalone harness tests use production schema via ensure_schema.
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use garmin::{
    GarminBodyMeasurementInput, GarminDailyInput, GarminExerciseInput, GarminRoutineInput,
    GarminSeriesInput, ingest_garmin_batch,
};
pub use health_query::{health_overview_query, health_sync_status};
pub use sync_meta::{set_garmin_sync_meta, set_garmin_sync_meta_app};
pub use project::{journal_delete, journal_list, journal_upsert};

pub(crate) use connection::{db_path_for_root, with_connection};
pub(crate) use schema::ensure_schema;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalListRequest {
    pub date: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalListResponse {
    pub entries: Vec<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalUpsertRequest {
    pub entry: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalUpsertResponse {
    pub entry: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalDeleteRequest {
    pub id: String,
}

pub fn open_db(app: &tauri::AppHandle) -> Result<rusqlite::Connection, String> {
    let root = crate::journal::journal_root(app)?;
    let path = db_path_for_root(&root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    ensure_schema(&conn, &path)?;
    Ok(conn)
}
