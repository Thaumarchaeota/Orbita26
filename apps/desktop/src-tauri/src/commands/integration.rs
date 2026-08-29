use crate::bkeasy;
use crate::garmin;
use crate::ledger_sidecar;
use crate::hwmon;
use crate::journal;
use crate::window_shell;

#[tauri::command]
pub fn get_system_stats() -> hwmon::SystemStats {
    hwmon::read_stats()
}

#[tauri::command]
pub fn repair_window(window: tauri::WebviewWindow, reload: bool) -> Result<(), String> {
    window_shell::repair_window(&window, reload)
}

#[tauri::command]
pub fn journal_list(
    app: tauri::AppHandle,
    req: journal::JournalListRequest,
) -> Result<journal::JournalListResponse, String> {
    journal::journal_list(&app, req)
}

#[tauri::command]
pub fn journal_upsert(
    app: tauri::AppHandle,
    req: journal::JournalUpsertRequest,
) -> Result<journal::JournalUpsertResponse, String> {
    journal::journal_upsert(&app, req)
}

#[tauri::command]
pub fn journal_delete(app: tauri::AppHandle, req: journal::JournalDeleteRequest) -> Result<(), String> {
    journal::journal_delete(&app, req)
}

#[tauri::command]
pub fn bkeasy_summary(app: tauri::AppHandle) -> Result<bkeasy::BkeasySummary, String> {
    bkeasy::bkeasy_summary(&app)
}

#[tauri::command]
pub fn ledger_api_base(app: tauri::AppHandle) -> Result<String, String> {
    ledger_sidecar::ensure_started(&app)?;
    ledger_sidecar::api_base()
}

#[tauri::command]
pub fn ensure_ledger_sidecar(app: tauri::AppHandle) {
    ledger_sidecar::ensure_started_background(&app);
}

#[tauri::command]
pub fn restart_ledger_sidecar(app: tauri::AppHandle) -> Result<String, String> {
    ledger_sidecar::restart_sidecar(&app)?;
    ledger_sidecar::api_base()
}

#[tauri::command]
pub fn ledger_bill_nonempty(app: tauri::AppHandle) -> Result<bool, String> {
    ledger_sidecar::ledger_bill_nonempty(&app)
}

#[tauri::command]
pub fn init_ledger_bill(app: tauri::AppHandle, overwrite: bool) -> Result<(), String> {
    ledger_sidecar::init_ledger_bill(&app, overwrite)
}

#[tauri::command]
pub fn garmin_status(app: tauri::AppHandle) -> Result<garmin::GarminStatus, String> {
    garmin::garmin_status(&app)
}

#[tauri::command]
pub async fn garmin_sync(
    app: tauri::AppHandle,
    req: garmin::GarminSyncRequest,
) -> Result<garmin::GarminSyncResponse, String> {
    tauri::async_runtime::spawn_blocking(move || garmin::garmin_sync(&app, req))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn garmin_login(
    app: tauri::AppHandle,
    req: garmin::GarminLoginRequest,
) -> Result<garmin::GarminLoginResponse, String> {
    tauri::async_runtime::spawn_blocking(move || garmin::garmin_login(&app, req))
        .await
        .map_err(|e| e.to_string())?
}
