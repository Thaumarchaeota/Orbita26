pub mod activity_files;
pub mod commands;
pub mod error;
pub mod host_lock;
pub mod projection;
pub mod read;
pub mod repository;
pub mod sync_run;
pub mod types;
pub mod util;

pub use commands::{
    apply_health_ai_batch, create_meal, delete_meal, garmin_apply, garmin_apply_unit, get_meal, list_meals,
    search_meal_foods, sync_meals_from_journal_json, update_meal, update_meal_metadata, ApplyHealthAiBatchRequest,
    ApplyHealthAiBatchResponse,
};
pub use error::HealthError;
pub use projection::{health_overview_query, health_sync_status};
pub use read::{
    export_fit_from_zip, get_activity, list_activities, list_naps, list_sleep_nights,
    read_asset_bytes, retry_original_download,
};
pub use types::*;

use crate::data::get_data_dir;
use crate::journal_db::{HealthOverviewRequest, HealthOverviewResponse, HealthSyncStatus};
use crate::productivity_db::coordinator;
use crate::productivity_db::DomainError;
use tauri::AppHandle;

fn data_dir_for(app: &AppHandle) -> Result<String, String> {
    get_data_dir(app)
}

pub fn health_overview_query_app(
    app: &AppHandle,
    req: HealthOverviewRequest,
) -> Result<HealthOverviewResponse, String> {
    let root = data_dir_for(app)?;
    coordinator::with_read(&root, |conn| {
        let conn = conn.ok_or_else(|| DomainError::archive_lifecycle("archive not initialized"))?;
        health_overview_query(conn, req).map_err(DomainError::archive_lifecycle)
    })
    .map_err(String::from)
}

pub fn health_sync_status_app(app: &AppHandle) -> Result<HealthSyncStatus, String> {
    let root = data_dir_for(app)?;
    coordinator::with_read(&root, |conn| {
        let conn = conn.ok_or_else(|| DomainError::archive_lifecycle("archive not initialized"))?;
        health_sync_status(conn).map_err(DomainError::archive_lifecycle)
    })
    .map_err(String::from)
}

pub fn get_meal_app(app: &AppHandle, id: &str) -> Result<MealResponse, String> {
    get_meal(&data_dir_for(app)?, id).map_err(String::from)
}

pub fn create_meal_app(app: &AppHandle, req: CreateMealRequest) -> Result<MealResponse, String> {
    create_meal(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn update_meal_app(app: &AppHandle, req: UpdateMealRequest) -> Result<MealResponse, String> {
    update_meal(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn delete_meal_app(app: &AppHandle, req: DeleteMealRequest) -> Result<MealResponse, String> {
    delete_meal(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn list_meals_app(app: &AppHandle, query: ListMealsQuery) -> Result<MealsListResponse, String> {
    list_meals(&data_dir_for(app)?, query).map_err(String::from)
}

pub fn garmin_apply_app(app: &AppHandle, req: GarminApplyRequest) -> Result<GarminApplyResult, String> {
    garmin_apply(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn search_meal_foods_app(
    app: &AppHandle,
    query: SearchMealFoodsQuery,
) -> Result<SearchMealFoodsResponse, String> {
    search_meal_foods(&data_dir_for(app)?, query).map_err(String::from)
}

pub fn sync_meals_from_journal_app(app: &AppHandle, date: &str, meals: serde_json::Value) -> Result<(), String> {
    sync_meals_from_journal_json(&data_dir_for(app)?, date, meals).map_err(String::from)
}

#[cfg(test)]
mod tests;

pub fn get_health_root_app(app: &AppHandle, req: read::GetHealthRootRequest) -> Result<read::HealthRootResponse, String> {
    read::get_health_root(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn list_garmin_sync_runs_app(
    app: &AppHandle,
    query: read::ListGarminSyncRunsQuery,
) -> Result<read::ListGarminSyncRunsResponse, String> {
    read::list_garmin_sync_runs(&data_dir_for(app)?, query).map_err(String::from)
}

pub fn get_garmin_sync_run_app(app: &AppHandle, run_id: &str) -> Result<read::GetGarminSyncRunResponse, String> {
    read::get_garmin_sync_run(&data_dir_for(app)?, run_id).map_err(String::from)
}

pub fn list_activities_app(
    app: &AppHandle,
    query: ListActivitiesQuery,
) -> Result<ActivitiesListResponse, String> {
    list_activities(&data_dir_for(app)?, query).map_err(String::from)
}

pub fn get_activity_app(app: &AppHandle, id: &str) -> Result<ActivityDetailResponse, String> {
    get_activity(&data_dir_for(app)?, id).map_err(String::from)
}

pub fn read_activity_asset_app(
    app: &AppHandle,
    req: ReadActivityAssetRequest,
) -> Result<ReadActivityAssetResponse, String> {
    read_asset_bytes(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn retry_activity_original_app(app: &AppHandle, req: RetryOriginalDownloadRequest) -> Result<(), String> {
    retry_original_download(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn export_activity_fit_app(app: &AppHandle, req: ExportFitFromZipRequest) -> Result<(), String> {
    export_fit_from_zip(&data_dir_for(app)?, req).map_err(String::from)
}
