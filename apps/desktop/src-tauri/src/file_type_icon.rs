use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use serde::{Deserialize, Serialize};

use crate::app_icon;

static SESSION_CACHE: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Deserialize)]
pub struct FileTypeIconItem {
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct FileTypeIcon {
    pub path: String,
    pub data_url: Option<String>,
}

pub fn resolve_batch(cache_dir: &PathBuf, items: &[FileTypeIconItem]) -> Vec<FileTypeIcon> {
    let _ = std::fs::create_dir_all(cache_dir);
    items
        .iter()
        .map(|item| FileTypeIcon {
            path: item.path.clone(),
            data_url: resolve_one(cache_dir, &item.path, item.is_dir).ok(),
        })
        .collect()
}

fn resolve_one(cache_dir: &PathBuf, path: &str, is_dir: bool) -> Result<String, String> {
    let key = cache_key(path, is_dir);
    if let Some(url) = SESSION_CACHE.lock().unwrap().get(&key) {
        return Ok(url.clone());
    }
    let cached = cache_dir.join(format!("{key}.png"));
    if !cached.exists() {
        app_icon::cache_icon(cache_dir, &key, path)?;
    }
    let url = app_icon::read_data_url(&cached.to_string_lossy())?;
    SESSION_CACHE.lock().unwrap().insert(key, url.clone());
    Ok(url)
}

fn cache_key(path: &str, is_dir: bool) -> String {
    if is_dir {
        return "__dir__".into();
    }
    let p = Path::new(path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "lnk" {
        return format!("lnk__{}", hash_str(path));
    }
    let prog = prog_id(p).unwrap_or_default();
    format!("{}__{}", sanitize(&ext), sanitize(&prog))
}

fn sanitize(s: &str) -> String {
    let out: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    if out.is_empty() {
        "_".into()
    } else {
        out
    }
}

fn hash_str(s: &str) -> String {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

#[cfg(target_os = "windows")]
fn prog_id(path: &Path) -> Option<String> {
    win::prog_id_for_path(path)
}

#[cfg(not(target_os = "windows"))]
fn prog_id(_path: &Path) -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
mod win {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::UI::Shell::{
        AssocQueryStringW, ASSOCF_INIT_DEFAULTTOSTAR, ASSOCSTR_PROGID,
    };

    fn to_wide(path: &Path) -> Vec<u16> {
        OsStr::new(path).encode_wide().chain(Some(0)).collect()
    }

    pub fn prog_id_for_path(path: &Path) -> Option<String> {
        let wide = to_wide(path);
        let mut buf = [0u16; 512];
        let mut size = buf.len() as u32;
        unsafe {
            if AssocQueryStringW(
                ASSOCF_INIT_DEFAULTTOSTAR,
                ASSOCSTR_PROGID,
                PCWSTR::from_raw(wide.as_ptr()),
                None,
                Some(PWSTR::from_raw(buf.as_mut_ptr())),
                &mut size,
            )
            .is_err()
            {
                return None;
            }
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        let s = String::from_utf16_lossy(&buf[..end]);
        if s.is_empty() { None } else { Some(s) }
    }
}
