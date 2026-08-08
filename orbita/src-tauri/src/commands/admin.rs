use crate::admin_window;

#[tauri::command]
pub fn open_admin_window(app: tauri::AppHandle) -> Result<(), String> {
    admin_window::open_admin_window(&app)
}
