use super::persist::{
    apps_path, bookmarks_path, cache_favicons_dir, cache_icons_dir, get_data_dir, write_json,
};
use super::types::{
    AiConfig, AppEntry, AppLink, AppSettings, BookmarkEntry, BookmarkLink, GridPrefs, LegacyAiSettings,
    LocalEntry,
};
use std::fs;
use std::path::Path;
use tauri::Manager;

pub(crate) fn read_standalone_ai_config(data_dir: &str) -> Option<AiConfig> {
    let path = super::persist::ai_config_path(data_dir);
    if !path.exists() {
        return None;
    }
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub(crate) fn merge_ai_from_legacy_file(settings: &mut AppSettings, data_dir: &str) {
    if let Some(ai) = read_standalone_ai_config(data_dir) {
        let empty_key = settings
            .ai
            .entries
            .first()
            .map(|e| e.api_key.is_empty())
            .unwrap_or(true);
        if empty_key {
            settings.ai = ai;
        }
    }
}

pub(crate) fn migrate_launcher_grid_prefs(settings: &mut AppSettings) {
    if settings.version >= 5 {
        return;
    }
    let default_top = super::defaults::default_top_grid();
    let dock_fallback = super::defaults::default_dock_left_grid();
    let mut top = settings.ui.top_grid.clone();
    let mut dock = settings.ui.dock_left_grid.clone();
    let bg = settings.ui.bookmarks_grid.clone();
    let ag = settings.ui.apps_grid.clone();
    if top.cols == 0 || dock.cols == 0 {
        let bg_cols = if bg.cols > 0 { bg.cols } else { default_top.cols };
        let ag_cols = if ag.cols > 0 { ag.cols } else { 2 };
        if settings.version >= 4 {
            if top.cols == 0 {
                top = if ag.cols > 0 { ag.clone() } else { default_top.clone() };
            }
            if dock.cols == 0 {
                dock = if bg.cols > 0 { bg.clone() } else { dock_fallback.clone() };
            }
        } else if bg_cols > ag_cols {
            if top.cols == 0 {
                top = if bg.cols > 0 { bg.clone() } else { default_top.clone() };
            }
            if dock.cols == 0 {
                dock = if ag.cols > 0 { ag.clone() } else { dock_fallback.clone() };
            }
        } else {
            if top.cols == 0 {
                top = if ag.cols > 0 { ag.clone() } else { default_top.clone() };
            }
            if dock.cols == 0 {
                dock = if bg.cols > 0 { bg.clone() } else { dock_fallback.clone() };
            }
        }
    }
    if top.cols <= 4 && dock.cols >= 3 && top.cols >= dock.cols && top.cols < default_top.cols {
        top.cols = default_top.cols;
        if dock.cols > 2 {
            dock.cols = 2;
        }
    }
    if top.cols < dock.cols {
        std::mem::swap(&mut top, &mut dock);
    }
    settings.ui.top_grid = top;
    settings.version = 5;
}

pub(crate) fn normalize_settings(settings: &mut AppSettings, data_dir: &str) {
    let defaults = super::defaults::default_settings(data_dir);
    if settings.theme.is_empty() {
        settings.theme = defaults.theme;
    }
    migrate_launcher_grid_prefs(settings);
}

pub(crate) fn apply_legacy_ai(config: &mut AiConfig, ai: LegacyAiSettings) {
    if let Some(key) = ai.api_key.filter(|s| !s.is_empty()) {
        if let Some(entry) = config.entries.first_mut() {
            entry.api_key = key;
        }
    }
    if let Some(url) = ai.base_url.filter(|s| !s.is_empty()) {
        if let Some(entry) = config.entries.first_mut() {
            entry.base_url = url;
        }
    }
    if let Some(model) = ai.model.filter(|s| !s.is_empty()) {
        config.active_model = model;
    }
}

fn migrate_legacy_bookmark(value: &serde_json::Value) -> Option<BookmarkEntry> {
    let id = value.get("id")?.as_str()?;
    let name = value.get("name")?.as_str()?;
    if value.get("kind").and_then(|k| k.as_str()) == Some("folder") {
        let children: Vec<BookmarkLink> = value
            .get("children")?
            .as_array()?
            .iter()
            .filter_map(|c| migrate_legacy_bookmark_link(c))
            .collect();
        return Some(BookmarkEntry::Folder {
            id: id.into(),
            name: name.into(),
            children,
        });
    }
    if value.get("kind").is_some() {
        return serde_json::from_value(value.clone()).ok();
    }
    let url = value.get("url")?.as_str()?;
    let icon = value
        .get("icon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(BookmarkEntry::Link {
        id: id.into(),
        name: name.into(),
        url: url.into(),
        icon,
    })
}

fn migrate_legacy_bookmark_link(value: &serde_json::Value) -> Option<BookmarkLink> {
    if value.get("kind").is_some() {
        return serde_json::from_value(value.clone()).ok();
    }
    let id = value.get("id")?.as_str()?;
    let name = value.get("name")?.as_str()?;
    let url = value.get("url")?.as_str()?;
    let icon = value
        .get("icon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(BookmarkLink::Link {
        id: id.into(),
        name: name.into(),
        url: url.into(),
        icon,
    })
}

fn migrate_legacy_app(value: &serde_json::Value) -> Option<AppEntry> {
    let id = value.get("id")?.as_str()?;
    let name = value.get("name")?.as_str()?;
    if value.get("kind").and_then(|k| k.as_str()) == Some("folder") {
        let children: Vec<AppLink> = value
            .get("children")?
            .as_array()?
            .iter()
            .filter_map(|c| migrate_legacy_app_link(c))
            .collect();
        return Some(AppEntry::Folder {
            id: id.into(),
            name: name.into(),
            children,
        });
    }
    if value.get("kind").is_some() {
        return serde_json::from_value(value.clone()).ok();
    }
    let path = value.get("path")?.as_str()?;
    let icon = value
        .get("icon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(AppEntry::App {
        id: id.into(),
        name: name.into(),
        path: path.into(),
        icon,
    })
}

fn migrate_legacy_app_link(value: &serde_json::Value) -> Option<AppLink> {
    if value.get("kind").is_some() {
        return serde_json::from_value(value.clone()).ok();
    }
    let id = value.get("id")?.as_str()?;
    let name = value.get("name")?.as_str()?;
    let path = value.get("path")?.as_str()?;
    let icon = value
        .get("icon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(AppLink::App {
        id: id.into(),
        name: name.into(),
        path: path.into(),
        icon,
    })
}

fn migrate_legacy_local(value: &serde_json::Value) -> Option<LocalEntry> {
    if value.get("kind").and_then(|k| k.as_str()) == Some("group") {
        let id = value.get("id")?.as_str()?;
        let name = value.get("name")?.as_str()?;
        let children: Vec<LocalEntry> = value
            .get("children")?
            .as_array()?
            .iter()
            .filter_map(migrate_legacy_local)
            .collect();
        return Some(LocalEntry::Group {
            id: id.into(),
            name: name.into(),
            children,
            color: None,
        });
    }
    if value.get("kind").is_some() {
        return serde_json::from_value(value.clone()).ok();
    }
    let id = value.get("id")?.as_str()?;
    let name = value.get("name")?.as_str()?;
    let path = value.get("path")?.as_str()?;
    let kind = value.get("kind").and_then(|k| k.as_str()).unwrap_or("file");
    if kind == "folder" {
        return Some(LocalEntry::FolderShortcut {
            id: id.into(),
            name: name.into(),
            path: path.into(),
            color: None,
        });
    }
    Some(LocalEntry::File {
        id: id.into(),
        name: name.into(),
        path: path.into(),
        color: None,
    })
}

pub(crate) fn read_json_bookmarks(path: &Path) -> Result<Vec<BookmarkEntry>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let Some(arr) = value.as_array() else {
        return Ok(vec![]);
    };
    Ok(arr.iter().filter_map(migrate_legacy_bookmark).collect())
}

pub(crate) fn read_json_apps(path: &Path) -> Result<Vec<AppEntry>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let Some(arr) = value.as_array() else {
        return Ok(vec![]);
    };
    Ok(arr.iter().filter_map(migrate_legacy_app).collect())
}

pub(crate) fn read_json_local(path: &Path) -> Result<Vec<LocalEntry>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let Some(arr) = value.as_array() else {
        return Ok(vec![]);
    };
    Ok(arr.iter().filter_map(migrate_legacy_local).collect())
}

pub fn migrate_legacy_caches(app: &tauri::AppHandle) -> Result<u32, String> {
    let data_dir = get_data_dir(app)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut moved = 0u32;
    moved += copy_dir_files(&app_data.join("icons"), &cache_icons_dir(&data_dir))?;
    moved += copy_dir_files(&app_data.join("favicons"), &cache_favicons_dir(&data_dir))?;
    Ok(moved)
}

fn copy_dir_files(from: &Path, to: &Path) -> Result<u32, String> {
    if !from.exists() {
        return Ok(0);
    }
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name() else {
            continue;
        };
        let dest = to.join(name);
        if !dest.exists() {
            fs::copy(&path, &dest).map_err(|e| e.to_string())?;
            n += 1;
        }
    }
    Ok(n)
}

pub fn rewrite_icon_paths(app: &tauri::AppHandle) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let old_icons = app_data.join("icons").to_string_lossy().into_owned();
    let old_favicons = app_data.join("favicons").to_string_lossy().into_owned();
    let new_icons = cache_icons_dir(&data_dir).to_string_lossy().into_owned();
    let new_favicons = cache_favicons_dir(&data_dir).to_string_lossy().into_owned();

    let mut bookmarks = read_json_bookmarks(&bookmarks_path(&data_dir))?;
    let mut apps = read_json_apps(&apps_path(&data_dir))?;
    let mut changed = false;
    for b in &mut bookmarks {
        match b {
            BookmarkEntry::Link { icon, .. } => {
                if let Some(icon) = icon {
                    if icon.starts_with(&old_favicons) {
                        *icon = icon.replacen(&old_favicons, &new_favicons, 1);
                        changed = true;
                    }
                }
            }
            BookmarkEntry::Folder { children, .. } => {
                for child in children {
                    if let BookmarkLink::Link { icon, .. } = child {
                        if let Some(icon) = icon {
                            if icon.starts_with(&old_favicons) {
                                *icon = icon.replacen(&old_favicons, &new_favicons, 1);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
    }
    for a in &mut apps {
        match a {
            AppEntry::App { icon, .. } => {
                if let Some(icon) = icon {
                    if icon.starts_with(&old_icons) {
                        *icon = icon.replacen(&old_icons, &new_icons, 1);
                        changed = true;
                    }
                }
            }
            AppEntry::Folder { children, .. } => {
                for child in children {
                    if let AppLink::App { icon, .. } = child {
                        if let Some(icon) = icon {
                            if icon.starts_with(&old_icons) {
                                *icon = icon.replacen(&old_icons, &new_icons, 1);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
    }
    if changed {
        write_json(&bookmarks_path(&data_dir), &bookmarks)?;
        write_json(&apps_path(&data_dir), &apps)?;
    }
    Ok(())
}
