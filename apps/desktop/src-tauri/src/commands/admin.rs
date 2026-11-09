use crate::admin_window;

#[tauri::command]
pub fn open_admin_window(app: tauri::AppHandle) -> Result<(), String> {
    admin_window::open_admin_window(&app)
}

#[tauri::command]
pub fn insight_set_has_unsaved(has_unsaved: bool) {
    admin_window::set_insight_has_unsaved(has_unsaved);
}

#[tauri::command]
pub fn insight_has_unsaved() -> bool {
    admin_window::insight_has_unsaved()
}

#[tauri::command]
pub fn open_insight_item(app: tauri::AppHandle, window: tauri::WebviewWindow, req: serde_json::Value) -> Result<admin_window::InsightItemNavigationStatus, String> {
    if window.label() != "main" { return Err("open_insight_item is available from Orbita Panel only".into()); }
    let req = serde_json::from_value(req).map_err(|e| format!("invalid request: {e}"))?;
    admin_window::open_insight_item(&app, req)
}

#[tauri::command]
pub fn claim_insight_item_navigation(app: tauri::AppHandle, window: tauri::WebviewWindow, req: serde_json::Value) -> Result<Option<admin_window::InsightItemNavigationRequest>, String> {
    if window.label() != admin_window::ADMIN_LABEL { return Err("navigation claims are available from Orbita Insight only".into()); }
    let req = serde_json::from_value(req).map_err(|e| format!("invalid request: {e}"))?;
    admin_window::claim_insight_item_navigation(&app, req)
}

#[tauri::command]
pub fn ack_insight_item_navigation(app: tauri::AppHandle, window: tauri::WebviewWindow, req: serde_json::Value) -> Result<admin_window::InsightItemNavigationStatus, String> {
    if window.label() != admin_window::ADMIN_LABEL { return Err("navigation acknowledgments are available from Orbita Insight only".into()); }
    let req = serde_json::from_value(req).map_err(|e| format!("invalid request: {e}"))?;
    admin_window::ack_insight_item_navigation(&app, req)
}

#[tauri::command]
pub fn get_insight_item_navigation_result(app: tauri::AppHandle, window: tauri::WebviewWindow, req: serde_json::Value) -> Result<admin_window::InsightItemNavigationStatus, String> {
    if window.label() != "main" && window.label() != "admin" { return Err("navigation results are available from Orbita Panel and Insight only".into()); }
    let req = serde_json::from_value(req).map_err(|e| format!("invalid request: {e}"))?;
    admin_window::get_insight_item_navigation_result(&app, req)
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn dev_open_finance_detail(app: tauri::AppHandle) -> Result<(), String> {
    admin_window::dev_open_finance_detail(&app)
}
