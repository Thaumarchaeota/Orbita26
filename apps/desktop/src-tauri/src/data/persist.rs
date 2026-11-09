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

const UI_THEME_ROLE_IDS: &[&str] = &[
    "surface.chrome", "surface.sidebar", "surface.page", "surface.card", "surface.control", "surface.inset",
    "text.primary", "text.secondary", "text.placeholder", "text.disabled", "border.subtle", "border.weekGrid", "brand.primary",
    "brand.primaryForeground", "brand.primaryHover", "state.selection.surface", "state.selection.foreground",
    "state.focus.ring", "state.focus.foreground", "state.neutral.hover", "state.hover.sidebar", "state.hover.page", "state.neutral.pressed",
    "state.disabled.surface", "state.disabled.foreground", "semantic.danger.foreground", "semantic.danger.surface",
    "semantic.success.foreground", "semantic.success.surface", "semantic.warning.foreground", "semantic.warning.surface",
    "semantic.info.foreground", "semantic.info.surface",
];

fn exact_keys(value: &serde_json::Value, keys: &[&str], label: &str) -> Result<(), String> {
    let object = value.as_object().ok_or_else(|| format!("{label} must be an object"))?;
    if object.len() != keys.len() || object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(format!("{label} contains unknown or missing fields"));
    }
    Ok(())
}

fn fill_surface_hover_colors(theme: &mut serde_json::Value) {
    let Some(colors) = theme.get_mut("colors").and_then(|value| value.as_object_mut()) else { return };
    let Some(seed) = colors.get("state.neutral.hover").cloned() else { return };
    for role in ["state.hover.sidebar", "state.hover.page"] {
        colors.entry(role.to_owned()).or_insert_with(|| seed.clone());
    }
}

fn fill_week_grid_color(theme: &mut serde_json::Value) {
    // Week-grid lines used to share border.subtle. Copy that color when the role
    // is absent so existing themes keep the same grid until the user edits it.
    // This only fills the in-memory document; startup does not rewrite settings.json.
    let Some(colors) = theme.get_mut("colors").and_then(|value| value.as_object_mut()) else { return };
    let Some(border) = colors.get("border.subtle").cloned() else { return };
    colors.entry("border.weekGrid".to_owned()).or_insert(border);
}

fn fill_theme_hover_roles(ui: &mut super::types::UiPrefs) {
    if let Some(presets) = ui.insight_theme_presets.as_mut() {
        for preset in presets {
            if let Some(theme) = preset.get_mut("theme") {
                fill_surface_hover_colors(theme);
                fill_week_grid_color(theme);
            }
        }
    }
    if let Some(applied) = ui.applied_insight_theme.as_mut() {
        if let Some(theme) = applied.get_mut("theme") {
            fill_surface_hover_colors(theme);
            fill_week_grid_color(theme);
        }
    }
}

fn validate_theme_document(theme: &serde_json::Value) -> Result<(), String> {
    let mut theme_keys = vec!["schemaVersion", "engineVersion", "metadata", "colors", "stateRules"];
    if theme.get("selection").is_some() { theme_keys.push("selection"); }
    exact_keys(theme, &theme_keys, "theme")?;
    if theme["schemaVersion"] != 1 || theme["engineVersion"] != 1 { return Err("unsupported theme version".into()); }
    let metadata = &theme["metadata"];
    exact_keys(metadata, &["id", "name", "revision", "updatedAt"], "theme metadata")?;
    let id = metadata["id"].as_str().filter(|value| !value.trim().is_empty() && value.len() <= 128).ok_or("invalid theme id")?;
    let name = metadata["name"].as_str().filter(|value| !value.trim().is_empty() && value.len() <= 80).ok_or("invalid theme name")?;
    let _ = (id, name);
    if metadata["revision"].as_u64().filter(|value| *value > 0).is_none() || metadata["updatedAt"].as_str().filter(|value| value.len() <= 64).is_none() { return Err("invalid theme metadata".into()); }
    let colors = &theme["colors"];
    exact_keys(colors, UI_THEME_ROLE_IDS, "theme colors")?;
    for role in UI_THEME_ROLE_IDS {
        let color = &colors[*role];
        exact_keys(color, &["oklch"], "theme color")?;
        let oklch = &color["oklch"];
        exact_keys(oklch, &["l", "c", "h"], "theme OKLCH")?;
        let l = oklch["l"].as_f64().filter(|value| (0.0..=1.0).contains(value)).ok_or("invalid theme lightness")?;
        let c = oklch["c"].as_f64().filter(|value| (0.0..=0.5).contains(value)).ok_or("invalid theme chroma")?;
        let h = oklch["h"].as_f64().filter(|value| (0.0..360.0).contains(value)).ok_or("invalid theme hue")?;
        let _ = (l, c, h);
    }
    let rules = &theme["stateRules"];
    let mut rule_keys = vec!["hoverAlpha", "pressedAlpha", "disabledAlpha", "focusAlpha"];
    if rules.get("focusEnabled").is_some() { rule_keys.push("focusEnabled"); }
    exact_keys(rules, &rule_keys, "theme state rules")?;
    for name in ["hoverAlpha", "pressedAlpha", "disabledAlpha", "focusAlpha"] {
        if rules[name].as_f64().filter(|value| (0.0..=1.0).contains(value)).is_none() { return Err("invalid theme state rule".into()); }
    }
    if let Some(enabled) = rules.get("focusEnabled") {
        if !enabled.is_boolean() { return Err("invalid theme focusEnabled".into()); }
    }
    if let Some(selection) = theme.get("selection") {
        exact_keys(selection, &["mode", "lightnessDelta"], "theme selection")?;
        if !matches!(selection["mode"].as_str(), Some("relative") | Some("custom")) || selection["lightnessDelta"].as_f64().filter(|value| (-1.0..=1.0).contains(value)).is_none() {
            return Err("invalid theme selection".into());
        }
    }
    Ok(())
}

fn validate_theme_settings(ui: &super::types::UiPrefs) -> Result<(), String> {
    // Theme settings are bounded and allowlisted before persistence; unknown versions must stay readable as errors, per SPEC-0006 §4.
    let fields_set = ui.insight_theme_presets.is_some() as u8 + ui.applied_insight_theme.is_some() as u8 + ui.insight_theme_library_revision.is_some() as u8;
    if fields_set == 0 { return Ok(()); }
    if fields_set != 3 { return Err("incomplete or unsupported Insight theme settings".into()); }
    let raw = serde_json::json!({
        "presets": &ui.insight_theme_presets,
        "applied": &ui.applied_insight_theme,
        "revision": &ui.insight_theme_library_revision,
    });
    if raw.to_string().len() > 1024 * 1024 { return Err("Insight theme settings exceed 1 MiB".into()); }
    let presets = ui.insight_theme_presets.as_ref().expect("checked above");
    let mut ids = std::collections::HashSet::new();
    for preset in presets {
        exact_keys(preset, &["id", "name", "revision", "builtin", "theme"], "theme preset")?;
        let id = preset["id"].as_str().filter(|value| !value.trim().is_empty() && value.len() <= 128).ok_or("invalid preset id")?;
        let name = preset["name"].as_str().filter(|value| !value.trim().is_empty() && value.len() <= 80).ok_or("invalid preset name")?;
        let _ = name;
        if !ids.insert(id.to_owned()) || preset["builtin"] != false || preset["revision"].as_u64().filter(|value| *value > 0).is_none() { return Err("invalid or duplicate user theme preset".into()); }
        validate_theme_document(&preset["theme"])?;
    }
    let applied = ui.applied_insight_theme.as_ref().expect("checked above");
    exact_keys(applied, &["schemaVersion", "presetId", "presetName", "revision", "appliedAt", "theme"], "applied theme")?;
    let preset_id_valid = applied["presetId"].is_null() || applied["presetId"].as_str().map_or(false, |value| value.len() <= 128);
    if applied["schemaVersion"] != 1 || !preset_id_valid
        || applied["presetName"].as_str().map_or(true, |value| value.trim().is_empty() || value.len() > 80)
        || applied["revision"].as_u64().filter(|value| *value > 0).is_none() || applied["appliedAt"].as_str().map_or(true, |value| value.len() > 64) {
        return Err("invalid applied theme metadata".into());
    }
    validate_theme_document(&applied["theme"])
}

// Insight 与 Panel 分目录，会话不共用（ADR 0036）。
pub(crate) fn insight_conversations_dir(data_dir: &str) -> PathBuf {
    Path::new(data_dir)
        .join("ai")
        .join("insight")
        .join("conversations")
}

fn conversation_path_in(dir: &Path, id: &str) -> Result<PathBuf, String> {
    validate_conversation_id(id)?;
    Ok(dir.join(format!("{id}.json")))
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
        fill_theme_hover_roles(&mut s.ui);
        validate_theme_settings(&s.ui)?;
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

pub fn write_settings(app: &tauri::AppHandle, mut settings: AppSettings) -> Result<(), String> {
    fill_theme_hover_roles(&mut settings.ui);
    validate_theme_settings(&settings.ui)?;
    let current = get_data_dir(app)?;
    if settings.data_dir != current {
        let target = settings.data_dir.clone();
        crate::productivity_db::switch_data_dir(&target).map_err(|e| e.to_string())?;
        if let Err(e) = set_data_dir(app, target) {
            crate::productivity_db::switch_data_dir(&current)
                .map_err(|e2| format!("{e}; rollback switch failed: {e2}"))?;
            return Err(e);
        }
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

fn list_conversations_in(dir: &Path) -> Result<Vec<ConversationMeta>, String> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
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

pub fn list_conversations(app: &tauri::AppHandle) -> Result<Vec<ConversationMeta>, String> {
    let data_dir = get_data_dir(app)?;
    list_conversations_in(&conversations_dir(&data_dir))
}

pub fn list_insight_conversations(app: &tauri::AppHandle) -> Result<Vec<ConversationMeta>, String> {
    let data_dir = get_data_dir(app)?;
    list_conversations_in(&insight_conversations_dir(&data_dir))
}

fn read_conversation_in(dir: &Path, id: &str) -> Result<Conversation, String> {
    let path = conversation_path_in(dir, id)?;
    if !path.exists() {
        return Err("conversation not found".into());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn read_conversation(app: &tauri::AppHandle, id: String) -> Result<Conversation, String> {
    let data_dir = get_data_dir(app)?;
    read_conversation_in(&conversations_dir(&data_dir), &id)
}

pub fn read_insight_conversation(app: &tauri::AppHandle, id: String) -> Result<Conversation, String> {
    let data_dir = get_data_dir(app)?;
    read_conversation_in(&insight_conversations_dir(&data_dir), &id)
}

fn write_conversation_in(dir: &Path, conversation: &Conversation) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = conversation_path_in(dir, &conversation.id)?;
    write_json(&path, conversation)
}

pub fn write_conversation(app: &tauri::AppHandle, conversation: Conversation) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    write_conversation_in(&conversations_dir(&data_dir), &conversation)
}

pub fn write_insight_conversation(
    app: &tauri::AppHandle,
    conversation: Conversation,
) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    write_conversation_in(&insight_conversations_dir(&data_dir), &conversation)
}

fn delete_conversation_in(dir: &Path, id: &str) -> Result<(), String> {
    let path = conversation_path_in(dir, id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn delete_conversation(app: &tauri::AppHandle, id: String) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    delete_conversation_in(&conversations_dir(&data_dir), &id)
}

pub fn delete_insight_conversation(app: &tauri::AppHandle, id: String) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    delete_conversation_in(&insight_conversations_dir(&data_dir), &id)
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
