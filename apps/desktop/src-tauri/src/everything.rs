use crate::data::read_settings;
use std::path::Path;
use std::process::Command;
use tauri::AppHandle;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EverythingHit {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

fn decode_output(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    #[cfg(target_os = "windows")]
    {
        return decode_acp(bytes);
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(target_os = "windows")]
fn decode_acp(bytes: &[u8]) -> String {
    use windows::Win32::Globalization::{MultiByteToWideChar, CP_ACP};

    if bytes.is_empty() {
        return String::new();
    }
    unsafe {
        let len = MultiByteToWideChar(CP_ACP, Default::default(), bytes, None);
        if len == 0 {
            return String::from_utf8_lossy(bytes).into_owned();
        }
        let mut wide = vec![0u16; len as usize];
        let written = MultiByteToWideChar(CP_ACP, Default::default(), bytes, Some(&mut wide));
        if written == 0 {
            return String::from_utf8_lossy(bytes).into_owned();
        }
        String::from_utf16_lossy(&wide)
    }
}

pub fn search(app: &AppHandle, query: &str, limit: u32) -> Result<Vec<EverythingHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let es_path = read_settings(app)?.integrations.everything.exe_path.trim().to_string();
    if es_path.is_empty() {
        return Err("请先在设置 → 本地中配置 Everything es.exe 路径".into());
    }
    if !Path::new(&es_path).exists() {
        return Err(format!("未找到 es.exe: {es_path}"));
    }

    let limit = limit.clamp(1, 200);
    let output = Command::new(&es_path)
        .args(["-n", &limit.to_string(), "-s", q])
        .output()
        .map_err(|e| format!("执行 es 失败: {e}"))?;

    if !output.status.success() {
        let err = decode_output(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "Everything 搜索失败，请确认 Everything 已运行".into()
        } else {
            err
        });
    }

    Ok(decode_output(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|path| {
            let p = Path::new(path);
            EverythingHit {
                path: path.to_string(),
                name: p
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.to_string()),
                is_dir: p.is_dir(),
            }
        })
        .collect())
}
