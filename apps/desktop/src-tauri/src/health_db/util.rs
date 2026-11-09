use chrono::{DateTime, FixedOffset, TimeZone, Utc};
use sha2::{Digest, Sha256};

use super::error::{HealthError, HealthResult};

pub fn utc_now() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn beijing_offset() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).unwrap()
}

pub fn local_date_from_instant(iso: &str) -> Result<String, String> {
    let dt = DateTime::parse_from_rfc3339(iso)
        .or_else(|_| {
            DateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%SZ")
                .map_err(|e| e.to_string())
        })
        .map_err(|e| format!("invalid instant: {e}"))?;
    Ok(dt.with_timezone(&beijing_offset()).format("%Y-%m-%d").to_string())
}

pub fn instant_to_unix(iso: &str) -> Result<i64, String> {
    let dt = DateTime::parse_from_rfc3339(iso)
        .or_else(|_| DateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%SZ"))
        .map_err(|e| format!("invalid instant: {e}"))?;
    Ok(dt.timestamp())
}

pub fn unix_to_instant(ts: i64) -> String {
    Utc.timestamp_opt(ts, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_else(|| utc_now())
}

pub fn datetime_to_instant_beijing(date: &str, hm: &str) -> Result<String, String> {
    let y: i32 = date[0..4].parse().map_err(|_| "invalid year")?;
    let m: u32 = date[5..7].parse().map_err(|_| "invalid month")?;
    let d: u32 = date[8..10].parse().map_err(|_| "invalid day")?;
    let parts: Vec<&str> = hm.split(':').collect();
    if parts.len() < 2 {
        return Err("invalid time".into());
    }
    let hh: u32 = parts[0].parse().map_err(|_| "invalid hour")?;
    let mm: u32 = parts[1].parse().map_err(|_| "invalid minute")?;
    let tz = beijing_offset();
    let dt = tz
        .with_ymd_and_hms(y, m, d, hh, mm, 0)
        .single()
        .ok_or_else(|| "invalid datetime".to_string())?;
    Ok(dt.with_timezone(&Utc).format("%Y-%m-%dT%H:%M:%SZ").to_string())
}

pub fn content_hash(value: &serde_json::Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn valid_meal_slot(slot: &str) -> bool {
    matches!(slot, "breakfast" | "lunch" | "dinner" | "late_night" | "coffee" | "beverage" | "snack" | "other")
}

pub fn normalize_meal_slot(raw: &str) -> String {
    raw.trim().to_string()
}

pub fn parse_instant(iso: &str) -> HealthResult<i64> {
    instant_to_unix(iso).map_err(HealthError::invalid_time)
}

pub fn parse_local_date(iso: &str) -> HealthResult<String> {
    local_date_from_instant(iso).map_err(HealthError::invalid_time)
}

pub fn parse_datetime_beijing(date: &str, hm: &str) -> HealthResult<String> {
    datetime_to_instant_beijing(date, hm).map_err(HealthError::invalid_time)
}
