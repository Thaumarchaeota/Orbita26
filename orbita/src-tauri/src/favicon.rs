use std::path::{Path, PathBuf};
use std::time::Duration;

fn normalize_url(url: &str) -> Result<url::Url, String> {
    let trimmed = url.trim();
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    url::Url::parse(&with_scheme).map_err(|e| e.to_string())
}

fn fetch_bytes(client: &reqwest::blocking::Client, url: &str) -> Option<Vec<u8>> {
    client
        .get(url)
        .send()
        .ok()?
        .error_for_status()
        .ok()?
        .bytes()
        .ok()
        .map(|b| b.to_vec())
}

fn save_png(bytes: &[u8], out: &Path) -> Result<(), String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let saved = if rgba.width() > 128 || rgba.height() > 128 {
        image::imageops::resize(&rgba, 128, 128, image::imageops::FilterType::Lanczos3)
    } else {
        rgba
    };
    saved.save(out).map_err(|e| e.to_string())?;
    Ok(())
}

fn icon_candidates(origin: &str, host: &str) -> Vec<String> {
    vec![
        format!("{origin}/favicon.ico"),
        format!("https://icons.duckduckgo.com/ip3/{host}.ico"),
        format!("https://www.google.com/s2/favicons?domain={host}&sz=128"),
    ]
}

pub fn cache(cache_dir: &PathBuf, id: &str, url: &str) -> Result<String, String> {
    let page = normalize_url(url)?;
    let origin = page.origin().ascii_serialization();
    let host = page.host_str().ok_or("无效网址")?;
    std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    let out = cache_dir.join(format!("{id}.png"));

    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    for candidate in icon_candidates(&origin, host) {
        let Some(bytes) = fetch_bytes(&client, &candidate) else {
            continue;
        };
        if save_png(&bytes, &out).is_ok() {
            return Ok(out.to_string_lossy().into_owned());
        }
    }
    Err("无法获取图标".into())
}

pub fn delete_cached(path: &str) -> Result<(), String> {
    let p = PathBuf::from(path);
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
