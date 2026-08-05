use std::path::Path;
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

pub fn open_local_path(app: &AppHandle, path: &str) -> Result<(), String> {
    let p = Path::new(path.trim());
    if !p.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("打开失败: {e}"))
}

pub fn reveal_path_in_explorer(path: &str) -> Result<(), String> {
    let p = Path::new(path.trim());
    if !p.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    #[cfg(target_os = "windows")]
    {
        let status = if p.is_dir() {
            Command::new("explorer").arg(path).status()
        } else {
            Command::new("explorer").args(["/select,", path]).status()
        };
        status.map_err(|e| format!("打开资源管理器失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("仅支持 Windows".into())
    }
}
