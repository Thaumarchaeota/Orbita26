use crate::admin_window;

#[tauri::command]
pub fn open_admin_window(app: tauri::AppHandle) -> Result<(), String> {
    admin_window::open_admin_window(&app)
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn dev_open_finance_detail(app: tauri::AppHandle) -> Result<(), String> {
    admin_window::dev_open_finance_detail(&app)
}
