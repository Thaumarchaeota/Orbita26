use crate::data::get_data_dir;
use crate::garmin_sync;

#[tauri::command]
pub fn garmin_sync_rate_limit_status(
    app: tauri::AppHandle,
) -> Result<garmin_sync::RateLimitStatusResponse, String> {
    let data_dir = get_data_dir(&app).ok();
    garmin_sync::rate_limit_status(data_dir.as_deref()).map_err(Into::into)
}

#[tauri::command]
pub fn garmin_sync_rate_limit_restore(
    req: garmin_sync::RestoreRequest,
) -> Result<garmin_sync::RestoreResponse, String> {
    garmin_sync::rate_limit_restore(req).map_err(Into::into)
}

#[tauri::command]
pub fn garmin_sync_daily_start(
    app: tauri::AppHandle,
    req: garmin_sync::DailyStartRequest,
) -> Result<garmin_sync::DailyStartResponse, String> {
    garmin_sync::daily_start(&get_data_dir(&app)?, req).map_err(Into::into)
}

#[tauri::command]
pub fn garmin_sync_scan_start(
    app: tauri::AppHandle,
    req: garmin_sync::ScanStartRequest,
) -> Result<garmin_sync::ScanStartResponse, String> {
    garmin_sync::scan_start(&get_data_dir(&app)?, req).map_err(Into::into)
}

#[tauri::command]
pub fn garmin_sync_scan_cancel(
    app: tauri::AppHandle,
    req: garmin_sync::ScanCancelRequest,
) -> Result<garmin_sync::ScanMutationResponse, String> {
    garmin_sync::scan_cancel(&get_data_dir(&app)?, req).map_err(Into::into)
}

#[tauri::command]
pub fn garmin_sync_job_start(
    app: tauri::AppHandle,
    req: garmin_sync::JobStartRequest,
) -> Result<garmin_sync::JobMutationResponse, String> {
    garmin_sync::job_start(&get_data_dir(&app)?, req).map_err(Into::into)
}

#[tauri::command]
pub fn garmin_sync_job_pause(
    app: tauri::AppHandle,
    req: garmin_sync::JobIdRevisionRequest,
) -> Result<garmin_sync::JobMutationResponse, String> {
    garmin_sync::job_pause(&get_data_dir(&app)?, req).map_err(Into::into)
}

#[tauri::command]
pub fn garmin_sync_job_continue(
    app: tauri::AppHandle,
    req: garmin_sync::JobIdRevisionRequest,
) -> Result<garmin_sync::JobMutationResponse, String> {
    garmin_sync::job_continue(&get_data_dir(&app)?, req).map_err(Into::into)
}

#[tauri::command]
pub fn garmin_sync_job_cancel(
    app: tauri::AppHandle,
    req: garmin_sync::JobIdRevisionRequest,
) -> Result<garmin_sync::JobMutationResponse, String> {
    garmin_sync::job_cancel(&get_data_dir(&app)?, req).map_err(Into::into)
}

#[tauri::command]
pub fn garmin_sync_job_get(
    app: tauri::AppHandle,
    req: garmin_sync::JobGetRequest,
) -> Result<garmin_sync::JobGetResponse, String> {
    garmin_sync::job_get(&get_data_dir(&app)?, req).map_err(Into::into)
}

#[tauri::command]
pub fn garmin_sync_scan_get(
    app: tauri::AppHandle,
    req: garmin_sync::ScanGetRequest,
) -> Result<garmin_sync::ScanGetResponse, String> {
    garmin_sync::scan_get(&get_data_dir(&app)?, req).map_err(Into::into)
}
