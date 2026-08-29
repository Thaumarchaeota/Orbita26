use tauri::Manager;

use crate::app_icon;
use crate::data;
use crate::favicon;
use crate::file_type_icon;

#[tauri::command]
pub fn cache_app_icon(app: tauri::AppHandle, app_id: String, path: String) -> Result<Option<String>, String> {
    let data_dir = data::get_data_dir(&app)?;
    let cache_dir = data::cache_icons_dir(&data_dir);
    match app_icon::cache_icon(&cache_dir, &app_id, &path) {
        Ok(p) => Ok(Some(p)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn delete_app_icon(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let data_dir = data::get_data_dir(&app)?;
    let cache_dir = data::cache_icons_dir(&data_dir);
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("icons");
    if data::ensure_under_dir(&path, &cache_dir).is_err()
        && data::ensure_under_dir(&path, &legacy).is_err()
    {
        return Ok(());
    }
    app_icon::delete_cached(&path)
}

#[tauri::command]
pub fn read_app_icon_data(path: String) -> Result<Option<String>, String> {
    if !std::path::Path::new(&path).exists() {
        return Ok(None);
    }
    app_icon::read_data_url(&path).map(Some)
}

#[tauri::command]
pub async fn get_file_type_icons(
    app: tauri::AppHandle,
    items: Vec<file_type_icon::FileTypeIconItem>,
) -> Result<Vec<file_type_icon::FileTypeIcon>, String> {
    let data_dir = data::get_data_dir(&app)?;
    let cache_dir = data::cache_file_type_icons_dir(&data_dir);
    tauri::async_runtime::spawn_blocking(move || file_type_icon::resolve_batch(&cache_dir, &items))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cache_favicon(app: tauri::AppHandle, bookmark_id: String, url: String) -> Result<Option<String>, String> {
    let data_dir = data::get_data_dir(&app)?;
    let cache_dir = data::cache_favicons_dir(&data_dir);
    let result = tauri::async_runtime::spawn_blocking(move || favicon::cache(&cache_dir, &bookmark_id, &url))
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.ok())
}

#[tauri::command]
pub fn delete_favicon(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let data_dir = data::get_data_dir(&app)?;
    let cache_dir = data::cache_favicons_dir(&data_dir);
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("favicons");
    if data::ensure_under_dir(&path, &cache_dir).is_err()
        && data::ensure_under_dir(&path, &legacy).is_err()
    {
        return Ok(());
    }
    favicon::delete_cached(&path)
}
