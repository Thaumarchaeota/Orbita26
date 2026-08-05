use std::path::Path;
use std::process::Command;
use sysinfo::{ProcessesToUpdate, System};
use tauri::AppHandle;

use crate::data;

fn exe_name(path: &str) -> String {
    let path = path.trim();
    if path.is_empty() {
        return "v2rayN.exe".to_string();
    }
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("v2rayN.exe")
        .to_string()
}

fn exe_name_from_settings(app: &AppHandle) -> Result<String, String> {
    let settings = data::read_settings(app)?;
    Ok(exe_name(&settings.integrations.v2ray.exe_path))
}

fn process_running(exe_name: &str) -> bool {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let target = exe_name.to_ascii_lowercase();
    system
        .processes()
        .values()
        .any(|p| p.name().to_string_lossy().to_ascii_lowercase() == target)
}

pub fn is_running(app: &AppHandle) -> Result<bool, String> {
    Ok(process_running(&exe_name_from_settings(app)?))
}

pub fn launch(app: &AppHandle) -> Result<(), String> {
    let settings = data::read_settings(app)?;
    let path = settings.integrations.v2ray.exe_path.trim();
    if path.is_empty() {
        return Err("未配置 v2rayN 路径".into());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", path])
            .spawn()
            .map_err(|e| format!("启动失败: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(path)
            .spawn()
            .map_err(|e| format!("启动失败: {e}"))?;
    }
    Ok(())
}

pub fn stop(app: &AppHandle) -> Result<(), String> {
    stop_by_name(&exe_name_from_settings(app)?)
}

#[cfg(target_os = "windows")]
fn stop_by_name(exe_name: &str) -> Result<(), String> {
    let out = Command::new("taskkill")
        .args(["/IM", exe_name, "/F"])
        .output()
        .map_err(|e| format!("关闭失败: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let msg = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if msg.contains("not found")
        || msg.contains("找不到")
        || msg.contains("No tasks")
        || msg.contains("没有运行")
    {
        return Ok(());
    }
    Err(format!("关闭失败: {}", msg.trim()))
}

#[cfg(not(target_os = "windows"))]
fn stop_by_name(exe_name: &str) -> Result<(), String> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let target = exe_name.to_ascii_lowercase();
    let pids: Vec<_> = system
        .processes()
        .iter()
        .filter(|(_, p)| p.name().to_string_lossy().to_ascii_lowercase() == target)
        .map(|(pid, _)| *pid)
        .collect();
    for pid in pids {
        if let Some(proc) = system.process(pid) {
            proc.kill();
        }
    }
    Ok(())
}
