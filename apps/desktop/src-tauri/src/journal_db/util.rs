use chrono::Utc;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn new_uuid() -> String {
    Uuid::new_v4().to_string()
}

pub fn normalize_id(id: &str) -> String {
    let id = id.trim();
    if let Some(idx) = id.rfind(':') {
        id[idx + 1..].to_string()
    } else {
        id.to_string()
    }
}

pub fn content_hash(value: &Value) -> String {
    let canonical = serde_json::to_string(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn year_from_date(date: &str) -> Result<i32, String> {
    date.get(0..4)
        .ok_or_else(|| "invalid date".to_string())?
        .parse()
        .map_err(|_| "invalid date year".to_string())
}

pub fn dates_in_range(from: &str, to: &str) -> Result<Vec<String>, String> {
    use chrono::{Duration, NaiveDate};
    let start = NaiveDate::parse_from_str(from, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let end = NaiveDate::parse_from_str(to, "%Y-%m-%d").map_err(|e| e.to_string())?;
    if end < start {
        return Err("invalid date range".into());
    }
    let mut out = Vec::new();
    let mut cur = start;
    while cur <= end {
        out.push(cur.format("%Y-%m-%d").to_string());
        cur += Duration::days(1);
    }
    Ok(out)
}
