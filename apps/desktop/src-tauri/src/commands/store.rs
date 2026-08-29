use crate::data;

#[tauri::command]
pub fn read_settings(app: tauri::AppHandle) -> Result<data::AppSettings, String> {
    data::read_settings(&app)
}

#[tauri::command]
pub fn write_settings(app: tauri::AppHandle, settings: data::AppSettings) -> Result<(), String> {
    data::write_settings(&app, settings)
}

#[tauri::command]
pub fn read_ai_config(app: tauri::AppHandle) -> Result<data::AiConfig, String> {
    data::read_ai_config(&app)
}

#[tauri::command]
pub fn write_ai_config(app: tauri::AppHandle, config: data::AiConfig) -> Result<(), String> {
    data::write_ai_config(&app, config)
}

#[tauri::command]
pub fn list_ai_conversations(app: tauri::AppHandle) -> Result<Vec<data::ConversationMeta>, String> {
    data::list_conversations(&app)
}

#[tauri::command]
pub fn read_ai_conversation(app: tauri::AppHandle, id: String) -> Result<data::Conversation, String> {
    data::read_conversation(&app, id)
}

#[tauri::command]
pub fn write_ai_conversation(app: tauri::AppHandle, conversation: data::Conversation) -> Result<(), String> {
    data::write_conversation(&app, conversation)
}

#[tauri::command]
pub fn delete_ai_conversation(app: tauri::AppHandle, id: String) -> Result<(), String> {
    data::delete_conversation(&app, id)
}

#[tauri::command]
pub fn read_bookmarks(app: tauri::AppHandle) -> Result<Vec<data::BookmarkEntry>, String> {
    data::read_bookmarks(&app)
}

#[tauri::command]
pub fn write_bookmarks(app: tauri::AppHandle, items: Vec<data::BookmarkEntry>) -> Result<(), String> {
    data::write_bookmarks(&app, items)
}

#[tauri::command]
pub fn read_apps(app: tauri::AppHandle) -> Result<Vec<data::AppEntry>, String> {
    data::read_apps(&app)
}

#[tauri::command]
pub fn write_apps(app: tauri::AppHandle, items: Vec<data::AppEntry>) -> Result<(), String> {
    data::write_apps(&app, items)
}

#[tauri::command]
pub fn read_local_files(app: tauri::AppHandle) -> Result<Vec<data::LocalEntry>, String> {
    data::read_local_files(&app)
}

#[tauri::command]
pub fn write_local_files(app: tauri::AppHandle, items: Vec<data::LocalEntry>) -> Result<(), String> {
    data::write_local_files(&app, items)
}

#[tauri::command]
pub fn migrate_legacy_caches(app: tauri::AppHandle) -> Result<u32, String> {
    let n = data::migrate_legacy_caches(&app)?;
    data::rewrite_icon_paths(&app)?;
    Ok(n)
}
