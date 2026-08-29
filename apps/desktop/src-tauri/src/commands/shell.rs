use std::process::Command;
use tauri_plugin_dialog::DialogExt;

use crate::data;
use crate::everything;
use crate::obsidian;
use crate::paths;
use crate::v2ray;
use crate::zotero;

fn programs_menu_path() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
        Ok(format!(
            r"{appdata}\Microsoft\Windows\Start Menu\Programs"
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").map_err(|e| e.to_string())
    }
}

fn documents_path() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
        Ok(format!(r"{home}\Documents"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn get_programs_menu_path() -> Result<String, String> {
    programs_menu_path()
}

#[tauri::command]
pub async fn pick_local_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let default_dir = documents_path()?;
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(default_dir)
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn pick_local_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let default_dir = documents_path()?;
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(default_dir)
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub fn open_local_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    paths::open_local_path(&app, &path)
}

#[tauri::command]
pub fn open_with_cursor(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let settings = data::read_settings(&app)?;
    let exe = settings.integrations.cursor.exe_path.trim();
    if exe.is_empty() {
        return Err("请先在设置中配置 Cursor 路径".into());
    }
    Command::new(exe)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开 Cursor 失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_with_dialog(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::path::Path;
        let p = Path::new(&path);
        if !p.is_file() {
            return Err(if p.is_dir() {
                "请选择文件".into()
            } else {
                format!("文件不存在: {path}")
            });
        }
        Command::new("rundll32")
            .args(["shell32.dll,OpenAs_RunDLL", &path])
            .spawn()
            .map_err(|e| format!("打开方式失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("仅支持 Windows".into())
    }
}

#[tauri::command]
pub fn open_recycle_bin() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg("shell:RecycleBinFolder")
            .spawn()
            .map_err(|e| format!("打开回收站失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("仅支持 Windows".into())
    }
}

#[tauri::command]
pub fn reveal_path_in_explorer(path: String) -> Result<(), String> {
    paths::reveal_path_in_explorer(&path)
}

#[tauri::command]
pub fn search_everything(
    app: tauri::AppHandle,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<everything::EverythingHit>, String> {
    everything::search(&app, &query, limit.unwrap_or(50))
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn pick_app_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let default_dir = programs_menu_path()?;
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("程序", &["exe", "lnk"])
            .set_directory(default_dir)
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub fn launch_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("启动失败: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(&path)
            .spawn()
            .map_err(|e| format!("启动失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn launch_v2ray(app: tauri::AppHandle) -> Result<(), String> {
    v2ray::launch(&app)
}

#[tauri::command]
pub fn is_v2ray_running(app: tauri::AppHandle) -> Result<bool, String> {
    v2ray::is_running(&app)
}

#[tauri::command]
pub fn stop_v2ray(app: tauri::AppHandle) -> Result<(), String> {
    v2ray::stop(&app)
}

#[tauri::command]
pub async fn list_zotero_items(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<zotero::ZoteroItem>, String> {
    let n = limit.unwrap_or(20);
    let settings = data::read_settings(&app)?;
    let zotero_dir = settings.integrations.zotero.data_dir;
    let note_dir = settings.integrations.zotero.article_note_dir;
    tauri::async_runtime::spawn_blocking(move || {
        zotero::list_recent_items(&zotero_dir, &note_dir, n)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_obsidian_notes(
    app: tauri::AppHandle,
    limit: Option<u32>,
    subdir: Option<String>,
) -> Result<Vec<obsidian::ObsidianNote>, String> {
    let n = limit.unwrap_or(50);
    let settings = data::read_settings(&app)?;
    let vault_dir = settings.integrations.obsidian.vault_dir;
    tauri::async_runtime::spawn_blocking(move || obsidian::list_notes(&vault_dir, n, subdir.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}
