use super::types::{
    AiConfig, AppEntry, AppSettings, BookmarkEntry, Bootstrap, Conversation, ConversationMeta,
    LegacyAppSettings, LocalEntry,
};
use super::defaults::default_settings;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub(crate) fn bootstrap_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("bootstrap.json"))
}

pub fn default_data_dir(app: &tauri::AppHandle) -> Result<String, String> {
    let p = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("data");
    Ok(p.to_string_lossy().into())
}

pub fn get_data_dir(app: &tauri::AppHandle) -> Result<String, String> {
    let bp = bootstrap_path(app)?;
    if bp.exists() {
        let raw = fs::read_to_string(&bp).map_err(|e| e.to_string())?;
        let b: Bootstrap = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        return Ok(b.data_dir);
    }
    let default = default_data_dir(app)?;
    set_data_dir(app, default.clone())?;
    Ok(default)
}

pub fn set_data_dir(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let bp = bootstrap_path(app)?;
    if let Some(parent) = bp.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let b = Bootstrap { data_dir: path };
    fs::write(
        &bp,
        serde_json::to_string_pretty(&b).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn settings_path(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("settings.json")
}

pub(crate) fn ai_config_path(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("ai").join("config.json")
}

pub(crate) fn conversations_dir(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("ai").join("conversations")
}

fn conversation_path(data_dir: &str, id: &str) -> Result<PathBuf, String> {
    validate_conversation_id(id)?;
    Ok(conversations_dir(data_dir).join(format!("{id}.json")))
}

pub fn bookmarks_path(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("bookmarks.json")
}

pub fn apps_path(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("apps.json")
}

pub fn local_files_path(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("local-files.json")
}

pub fn cache_icons_dir(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("cache").join("icons")
}

pub fn cache_favicons_dir(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("cache").join("favicons")
}

pub fn cache_file_type_icons_dir(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("cache").join("file-type-icons")
}

fn validate_conversation_id(id: &str) -> Result<(), String> {
    let ok = id.len() == 36
        && id.as_bytes().iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_hexdigit(),
        });
    if ok {
        Ok(())
    } else {
        Err("invalid conversation id".into())
    }
}

pub fn ensure_under_dir(path: &str, allowed_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(allowed_dir).map_err(|e| e.to_string())?;
    let allowed = allowed_dir
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = PathBuf::from(path);
    let canon = if target.exists() {
        target.canonicalize().map_err(|e| e.to_string())?
    } else {
        let parent = target
            .parent()
            .ok_or_else(|| "invalid path".to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        parent.join(
            target
                .file_name()
                .ok_or_else(|| "invalid path".to_string())?,
        )
    };
    if !canon.starts_with(&allowed) {
        return Err("path outside cache dir".into());
    }
    Ok(canon)
}

pub fn read_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let data_dir = get_data_dir(app)?;
    let path = settings_path(&data_dir);
    if !path.exists() {
        let mut s = default_settings(&data_dir);
        super::migrate::merge_ai_from_legacy_file(&mut s, &data_dir);
        write_json(&path, &s)?;
        return Ok(s);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if let Ok(mut s) = serde_json::from_str::<AppSettings>(&raw) {
        s.data_dir = data_dir.clone();
        super::migrate::merge_ai_from_legacy_file(&mut s, &data_dir);
        super::migrate::normalize_settings(&mut s, &data_dir);
        return Ok(s);
    }
    if let Ok(legacy) = serde_json::from_str::<LegacyAppSettings>(&raw) {
        let mut s = default_settings(&data_dir);
        s.version = 0;
        s.theme = legacy.theme.unwrap_or_else(|| "light".into());
        if let Some(ai) = legacy.ai {
            super::migrate::apply_legacy_ai(&mut s.ai, ai);
        }
        super::migrate::merge_ai_from_legacy_file(&mut s, &data_dir);
        write_json(&path, &s)?;
        return Ok(s);
    }
    Err("invalid settings.json".into())
}

pub fn write_settings(app: &tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let current = get_data_dir(app)?;
    if settings.data_dir != current {
        set_data_dir(app, settings.data_dir.clone())?;
    }
    let data_dir = get_data_dir(app)?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let mut s = settings;
    s.data_dir = data_dir;
    if s.version == 0 {
        s.version = 1;
    }
    write_json(&settings_path(&s.data_dir), &s)
}

pub fn read_ai_config(app: &tauri::AppHandle) -> Result<AiConfig, String> {
    Ok(read_settings(app)?.ai)
}

pub fn write_ai_config(app: &tauri::AppHandle, config: AiConfig) -> Result<(), String> {
    let mut settings = read_settings(app)?;
    settings.ai = config;
    write_settings(app, settings)
}

pub fn list_conversations(app: &tauri::AppHandle) -> Result<Vec<ConversationMeta>, String> {
    let data_dir = get_data_dir(app)?;
    let dir = conversations_dir(&data_dir);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let conv: Conversation = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        items.push(ConversationMeta {
            id: conv.id,
            title: conv.title,
            updated_at: conv.updated_at,
        });
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

pub fn read_conversation(app: &tauri::AppHandle, id: String) -> Result<Conversation, String> {
    let data_dir = get_data_dir(app)?;
    let path = conversation_path(&data_dir, &id)?;
    if !path.exists() {
        return Err("conversation not found".into());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn write_conversation(app: &tauri::AppHandle, conversation: Conversation) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    let dir = conversations_dir(&data_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = conversation_path(&data_dir, &conversation.id)?;
    write_json(&path, &conversation)
}

pub fn delete_conversation(app: &tauri::AppHandle, id: String) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    let path = conversation_path(&data_dir, &id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn read_bookmarks(app: &tauri::AppHandle) -> Result<Vec<BookmarkEntry>, String> {
    let data_dir = get_data_dir(app)?;
    super::migrate::read_json_bookmarks(&bookmarks_path(&data_dir))
}

pub fn write_bookmarks(app: &tauri::AppHandle, items: Vec<BookmarkEntry>) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    write_json(&bookmarks_path(&data_dir), &items)
}

pub fn read_apps(app: &tauri::AppHandle) -> Result<Vec<AppEntry>, String> {
    let data_dir = get_data_dir(app)?;
    super::migrate::read_json_apps(&apps_path(&data_dir))
}

pub fn write_apps(app: &tauri::AppHandle, items: Vec<AppEntry>) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    write_json(&apps_path(&data_dir), &items)
}

pub fn read_local_files(app: &tauri::AppHandle) -> Result<Vec<LocalEntry>, String> {
    let data_dir = get_data_dir(app)?;
    super::migrate::read_json_local(&local_files_path(&data_dir))
}

pub fn write_local_files(app: &tauri::AppHandle, items: Vec<LocalEntry>) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    write_json(&local_files_path(&data_dir), &items)
}

pub(crate) fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub(crate) fn read_json_array<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Vec<T>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
