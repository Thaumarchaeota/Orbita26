use crate::capture;

#[tauri::command]
pub fn capture_screen() -> Result<capture::CaptureScreenResult, String> {
    capture::capture_primary_screen()
}

#[tauri::command]
pub fn capture_copy_clipboard(b64: String) -> Result<(), String> {
    capture::copy_png_to_clipboard(&b64)
}

#[tauri::command]
pub fn capture_save_file(app: tauri::AppHandle, b64: String) -> Result<String, String> {
    capture::save_png_file(&app, &b64)
}

#[tauri::command]
pub fn capture_crop(b64: String, x: u32, y: u32, w: u32, h: u32) -> Result<String, String> {
    capture::crop_png_base64(&b64, x, y, w, h)
}
