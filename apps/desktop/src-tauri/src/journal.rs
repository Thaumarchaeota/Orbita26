use chrono::{Datelike, FixedOffset, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

use crate::data;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalListRequest {
    pub date: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalListResponse {
    pub entries: Vec<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalUpsertRequest {
    pub entry: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalUpsertResponse {
    pub entry: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalDeleteRequest {
    pub id: String,
}

#[derive(Debug, Serialize)]
struct JournalFile {
    entries: Vec<Value>,
}

pub fn journal_root(app: &AppHandle) -> Result<String, String> {
    let settings = data::read_settings(app)?;
    let root = settings.integrations.journal.data_root.trim();
    if root.is_empty() {
        return Ok(data::get_data_dir(app)?);
    }
    Ok(root.to_string())
}

fn journal_path(root: &str, year: i32) -> PathBuf {
    Path::new(root).join("journal").join(format!("{year}.json"))
}

fn year_from_date(date: &str) -> Result<i32, String> {
    let y: i32 = date
        .get(0..4)
        .ok_or_else(|| "invalid date".to_string())?
        .parse()
        .map_err(|_| "invalid date year".to_string())?;
    Ok(y)
}

fn read_file(path: &Path) -> Result<JournalFile, String> {
    if !path.exists() {
        return Ok(JournalFile { entries: vec![] });
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let entries = v
        .get("entries")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(JournalFile { entries })
}

fn write_file(path: &Path, file: &JournalFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let v = json!({ "entries": file.entries });
    fs::write(path, serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn entry_kind(entry: &Value) -> Option<&str> {
    entry.get("kind").and_then(|k| k.as_str())
}

fn entry_date(entry: &Value) -> Option<&str> {
    entry.get("date").and_then(|d| d.as_str())
}

fn entry_id(entry: &Value) -> Option<&str> {
    entry.get("id").and_then(|d| d.as_str())
}

fn is_primary_mood(entry: &Value) -> bool {
    entry.get("primary").and_then(|p| p.as_bool()).unwrap_or(false)
}

fn new_id(path: &Path) -> String {
    let rel = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("journal.json");
    format!("journal/{rel}:{}", Uuid::new_v4())
}

fn clear_primary_mood(entries: &mut [Value], date: &str) {
    for e in entries.iter_mut() {
        if entry_kind(e) == Some("mood") && entry_date(e) == Some(date) && is_primary_mood(e) {
            if let Some(obj) = e.as_object_mut() {
                obj.insert("primary".into(), Value::Bool(false));
            }
        }
    }
}

fn normalize_mood_upsert(entry: &mut Value) {
    let primary = entry.get("primary").and_then(|p| p.as_bool()).unwrap_or(false);
    if primary {
        return;
    }
    if let Some(obj) = entry.as_object_mut() {
        obj.insert("primary".into(), Value::Bool(false));
    }
}

pub fn journal_list(app: &AppHandle, req: JournalListRequest) -> Result<JournalListResponse, String> {
    let root = journal_root(app)?;
    let mut years: Vec<i32> = Vec::new();
    if let Some(ref d) = req.date {
        years.push(year_from_date(d)?);
    } else if let (Some(ref f), Some(ref t)) = (&req.from, &req.to) {
        let yf = year_from_date(f)?;
        let yt = year_from_date(t)?;
        for y in yf..=yt {
            years.push(y);
        }
    } else {
        let tz = FixedOffset::east_opt(8 * 3600).ok_or("tz")?;
        years.push(Utc::now().with_timezone(&tz).year());
    }
    years.sort_unstable();
    years.dedup();

    let mut out = Vec::new();
    for y in years {
        let path = journal_path(&root, y);
        let file = read_file(&path)?;
        for e in file.entries {
            let date = entry_date(&e).unwrap_or("");
            if let Some(ref d) = req.date {
                if date != d.as_str() {
                    continue;
                }
            }
            if let (Some(ref f), Some(ref t)) = (&req.from, &req.to) {
                if date < f.as_str() || date > t.as_str() {
                    continue;
                }
            }
            out.push(e);
        }
    }
    Ok(JournalListResponse { entries: out })
}

pub fn journal_upsert(app: &AppHandle, req: JournalUpsertRequest) -> Result<JournalUpsertResponse, String> {
    let root = journal_root(app)?;
    let mut entry = req.entry;
    let kind = entry_kind(&entry).ok_or("entry.kind required")?.to_string();
    let date = entry_date(&entry).ok_or("entry.date required")?.to_string();
    let year = year_from_date(&date)?;
    let path = journal_path(&root, year);
    let mut file = read_file(&path)?;

    if kind == "mood" {
        let primary = entry.get("primary").and_then(|p| p.as_bool()).unwrap_or(false);
        if primary {
            clear_primary_mood(&mut file.entries, &date);
        } else {
            normalize_mood_upsert(&mut entry);
        }
    }

    let upserted = if kind == "routine" || kind == "daily" {
        let idx = file.entries.iter().position(|e| {
            entry_kind(e) == Some(kind.as_str()) && entry_date(e) == Some(date.as_str())
        });
        if let Some(i) = idx {
            let existing_id = entry_id(&file.entries[i]).unwrap_or("").to_string();
            if let Some(obj) = entry.as_object_mut() {
                obj.insert("id".into(), json!(existing_id));
            }
            file.entries[i] = entry.clone();
            entry
        } else {
            if entry.get("id").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                if let Some(obj) = entry.as_object_mut() {
                    obj.insert("id".into(), json!(new_id(&path)));
                }
            }
            file.entries.push(entry.clone());
            entry
        }
    } else if kind == "exercise" {
        let ext = entry
            .get("externalId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let idx = if !ext.is_empty() {
            file.entries.iter().position(|e| {
                entry_kind(e) == Some("exercise")
                    && e.get("externalId").and_then(|v| v.as_str()) == Some(ext.as_str())
            })
        } else {
            None
        };
        if let Some(i) = idx {
            let existing_id = entry_id(&file.entries[i]).unwrap_or("").to_string();
            if let Some(obj) = entry.as_object_mut() {
                obj.insert("id".into(), json!(existing_id));
            }
            file.entries[i] = entry.clone();
            entry
        } else {
            if entry.get("id").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                if let Some(obj) = entry.as_object_mut() {
                    obj.insert("id".into(), json!(new_id(&path)));
                }
            }
            file.entries.push(entry.clone());
            entry
        }
    } else {
        let id = entry.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if id.is_empty() {
            if let Some(obj) = entry.as_object_mut() {
                obj.insert("id".into(), json!(new_id(&path)));
            }
            file.entries.push(entry.clone());
            entry
        } else {
            let idx = file.entries.iter().position(|e| entry_id(e) == Some(id.as_str()));
            if let Some(i) = idx {
                file.entries[i] = entry.clone();
            } else {
                file.entries.push(entry.clone());
            }
            entry
        }
    };

    write_file(&path, &file)?;
    Ok(JournalUpsertResponse { entry: upserted })
}

pub fn journal_delete(app: &AppHandle, req: JournalDeleteRequest) -> Result<(), String> {
    let root = journal_root(app)?;
    let id = req.id.trim();
    if id.is_empty() {
        return Err("id required".into());
    }
    let parts: Vec<&str> = id.split(':').collect();
    if parts.len() < 2 {
        return Err("invalid id".into());
    }
    let file_part = parts[0].trim_start_matches("journal/");
    let year: i32 = file_part
        .get(0..4)
        .ok_or("invalid id year")?
        .parse()
        .map_err(|_| "invalid id year")?;
    let path = journal_path(&root, year);
    let mut file = read_file(&path)?;
    let before = file.entries.len();
    file.entries.retain(|e| entry_id(e) != Some(id));
    if file.entries.len() == before {
        return Err("entry not found".into());
    }
    write_file(&path, &file)?;
    Ok(())
}

pub fn beijing_today() -> String {
    let tz = FixedOffset::east_opt(8 * 3600).unwrap();
    Utc::now().with_timezone(&tz).format("%Y-%m-%d").to_string()
}

pub fn beijing_now_ts() -> i64 {
    Utc::now().timestamp()
}

pub fn datetime_to_unix_beijing(date: &str, time: &str) -> Result<i64, String> {
    let date = date.trim();
    let time = time.trim();
    if date.len() < 10 || !time.contains(':') {
        return Err("日期或时间格式无效".into());
    }
    let y: i32 = date[0..4].parse().map_err(|_| "invalid year")?;
    let m: u32 = date[5..7].parse().map_err(|_| "invalid month")?;
    let d: u32 = date[8..10].parse().map_err(|_| "invalid day")?;
    let parts: Vec<&str> = time.split(':').collect();
    if parts.len() < 2 {
        return Err("invalid time".into());
    }
    let hh: u32 = parts[0].parse().map_err(|_| "invalid hour")?;
    let mm: u32 = parts[1].parse().map_err(|_| "invalid minute")?;
    if hh > 23 || mm > 59 {
        return Err("invalid time".into());
    }
    let tz = FixedOffset::east_opt(8 * 3600).ok_or("tz")?;
    let dt = tz
        .with_ymd_and_hms(y, m, d, hh, mm, 0)
        .single()
        .ok_or_else(|| "invalid datetime".to_string())?;
    Ok(dt.timestamp())
}

fn prev_date(date: &str) -> Result<String, String> {
    let y: i32 = date[0..4].parse().map_err(|_| "invalid date")?;
    let m: u32 = date[5..7].parse().map_err(|_| "invalid date")?;
    let d: u32 = date[8..10].parse().map_err(|_| "invalid date")?;
    let tz = FixedOffset::east_opt(8 * 3600).ok_or("tz")?;
    let dt = tz
        .with_ymd_and_hms(y, m, d, 0, 0, 0)
        .single()
        .ok_or_else(|| "invalid date".to_string())?
        - chrono::Duration::days(1);
    Ok(dt.format("%Y-%m-%d").to_string())
}

pub fn resolve_night_timestamps(
    wake_date: &str,
    sleep_hm: &str,
    wake_hm: &str,
) -> Result<(i64, i64), String> {
    let wake_ts = datetime_to_unix_beijing(wake_date, wake_hm)?;
    let sleep_date = if sleep_hm >= wake_hm {
        prev_date(wake_date)?
    } else {
        wake_date.to_string()
    };
    let sleep_ts = datetime_to_unix_beijing(&sleep_date, sleep_hm)?;
    Ok((sleep_ts, wake_ts))
}

fn week_start_beijing(date: &str) -> Result<String, String> {
    let y: i32 = date[0..4].parse().map_err(|_| "invalid date")?;
    let m: u32 = date[5..7].parse().map_err(|_| "invalid date")?;
    let d: u32 = date[8..10].parse().map_err(|_| "invalid date")?;
    let tz = FixedOffset::east_opt(8 * 3600).ok_or("tz")?;
    let dt = tz
        .with_ymd_and_hms(y, m, d, 12, 0, 0)
        .single()
        .ok_or_else(|| "invalid date".to_string())?;
    let weekday = dt.weekday().num_days_from_monday();
    let start = dt - chrono::Duration::days(weekday as i64);
    Ok(start.format("%Y-%m-%d").to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalSnapshot {
    pub date: String,
    pub configured: bool,
    pub sleep_hours: Option<f64>,
    pub hydration_ml: Option<i64>,
    pub week_exercise_days: u32,
    pub event_count: u32,
    pub mood_count: u32,
    pub intake_kcal: Option<u32>,
    pub meal_count: u32,
    pub meals_summary: Vec<String>,
    pub events: Vec<String>,
    pub moods: Vec<String>,
}

pub fn build_journal_snapshot(app: &AppHandle, date: Option<&str>) -> Result<JournalSnapshot, String> {
    let date = date
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(beijing_today);
    let _root = journal_root(app)?;
    let configured = !data::get_data_dir(app)?.is_empty();

    let day_entries = journal_list(
        app,
        JournalListRequest {
            date: Some(date.clone()),
            from: None,
            to: None,
        },
    )?
    .entries;

    let routine = day_entries
        .iter()
        .find(|e| entry_kind(e) == Some("routine"));
    let sleep_hours = routine.and_then(|r| {
        let night = r.get("data")?.get("night")?;
        if let Some(stages) = night.get("stages") {
            let deep = stages.get("deep").and_then(|v| v.as_i64()).unwrap_or(0);
            let light = stages.get("light").and_then(|v| v.as_i64()).unwrap_or(0);
            let rem = stages.get("rem").and_then(|v| v.as_i64()).unwrap_or(0);
            let total = deep + light + rem;
            if total > 0 {
                return Some(total as f64 / 3600.0);
            }
        }
        let sleep = night.get("sleep")?.as_i64()?;
        let wake = night.get("wake")?.as_i64()?;
        if wake > sleep {
            Some((wake - sleep) as f64 / 3600.0)
        } else {
            None
        }
    });

    let daily = day_entries
        .iter()
        .find(|e| entry_kind(e) == Some("daily"));
    let hydration_ml = daily.and_then(|d| {
        d.get("data")?
            .get("hydrationMl")?
            .as_i64()
            .filter(|v| *v > 0)
    });

    let week_start = week_start_beijing(&date)?;
    let week_entries = journal_list(
        app,
        JournalListRequest {
            date: None,
            from: Some(week_start),
            to: Some(date.clone()),
        },
    )?
    .entries;
    let week_exercise_days = week_entries
        .iter()
        .filter(|e| entry_kind(e) == Some("exercise"))
        .filter_map(|e| entry_date(e))
        .collect::<HashSet<_>>()
        .len() as u32;

    let events: Vec<String> = day_entries
        .iter()
        .filter(|e| entry_kind(e) == Some("event"))
        .filter_map(|e| e.get("remark").and_then(|v| v.as_str()).map(str::to_string))
        .collect();
    let moods: Vec<String> = day_entries
        .iter()
        .filter(|e| entry_kind(e) == Some("mood") && !is_primary_mood(e))
        .filter_map(|e| {
            let emoji = e
                .get("data")
                .and_then(|d| d.get("emoji"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let note = e
                .get("data")
                .and_then(|d| d.get("note"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let label = format!("{emoji} {note}").trim().to_string();
            if label.is_empty() {
                None
            } else {
                Some(label)
            }
        })
        .collect();

    let mut intake_kcal: u32 = 0;
    let mut meals_summary: Vec<String> = Vec::new();
    if let Some(d) = daily {
        if let Some(meals) = d.get("data").and_then(|x| x.get("meals")).and_then(|m| m.as_array()) {
            for m in meals {
                let kcal = m.get("kcal").and_then(|v| v.as_i64()).unwrap_or(0);
                if kcal > 0 {
                    intake_kcal += kcal as u32;
                }
                let slot = m.get("slot").and_then(|v| v.as_str()).unwrap_or("snack");
                let slot_label = match slot {
                    "breakfast" => "早餐",
                    "lunch" => "午餐",
                    "dinner" => "晚餐",
                    _ => "其他",
                };
                let text = m.get("text").and_then(|v| v.as_str()).unwrap_or("");
                meals_summary.push(format!("{slot_label} {kcal}kcal {text}").trim().to_string());
            }
        }
    }
    let meal_count = meals_summary.len() as u32;
    let intake_kcal = if intake_kcal > 0 {
        Some(intake_kcal)
    } else {
        None
    };

    Ok(JournalSnapshot {
        date,
        configured,
        sleep_hours,
        hydration_ml,
        week_exercise_days,
        event_count: events.len() as u32,
        mood_count: moods.len() as u32,
        intake_kcal,
        meal_count,
        meals_summary,
        events,
        moods,
    })
}

pub fn upsert_routine_night_from_garmin(
    app: &AppHandle,
    date: &str,
    night: Map<String, Value>,
    naps: Option<Vec<Map<String, Value>>>,
) -> Result<(), String> {
    let existing = journal_list(
        app,
        JournalListRequest {
            date: Some(date.to_string()),
            from: None,
            to: None,
        },
    )?
    .entries
    .into_iter()
    .find(|e| entry_kind(e) == Some("routine"));

    let mut data = json!({ "naps": [] });
    if let Some(ref r) = existing {
        if let Some(d) = r.get("data") {
            data = d.clone();
            if data.get("naps").is_none() {
                data["naps"] = json!([]);
            }
        }
    }
    if let Some(new_naps) = naps {
        let kept: Vec<Value> = data
            .get("naps")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter(|n| {
                        n.get("source")
                            .and_then(|s| s.as_str())
                            .map(|s| s != "garmin")
                            .unwrap_or(true)
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        let mut merged = kept;
        for n in new_naps {
            merged.push(Value::Object(n));
        }
        data["naps"] = Value::Array(merged);
    }
    data["night"] = Value::Object(night);

    let mut entry = json!({
        "kind": "routine",
        "date": date,
        "tz": "Asia/Shanghai",
        "data": data,
    });
    if let Some(r) = existing {
        if let Some(id) = r.get("id") {
            entry["id"] = id.clone();
        }
    }
    journal_upsert(app, JournalUpsertRequest { entry })?;
    Ok(())
}

pub fn upsert_daily_from_garmin(
    app: &AppHandle,
    date: &str,
    fetched_at: i64,
    data_map: Map<String, Value>,
) -> Result<(), String> {
    let existing = journal_list(
        app,
        JournalListRequest {
            date: Some(date.to_string()),
            from: None,
            to: None,
        },
    )?
    .entries
    .into_iter()
    .find(|e| entry_kind(e) == Some("daily"));

    let mut merged = data_map;
    if let Some(ex) = &existing {
        if let Some(old) = ex.get("data").and_then(|d| d.as_object()) {
            if let Some(meals) = old.get("meals") {
                merged.insert("meals".into(), meals.clone());
            }
        }
    }

    let mut entry = json!({
        "kind": "daily",
        "date": date,
        "source": "garmin",
        "fetchedAt": fetched_at,
        "data": Value::Object(merged),
    });
    if let Some(ex) = existing {
        if let Some(id) = ex.get("id") {
            entry["id"] = id.clone();
        }
    }
    journal_upsert(app, JournalUpsertRequest { entry })?;
    Ok(())
}

pub fn upsert_exercise_from_garmin(
    app: &AppHandle,
    date: &str,
    external_id: &str,
    sport: &str,
    duration: i64,
    metrics: Map<String, Value>,
) -> Result<(), String> {
    let entry = json!({
        "kind": "exercise",
        "date": date,
        "source": "garmin",
        "externalId": external_id,
        "data": {
            "sport": sport,
            "duration": duration,
            "metrics": Value::Object(metrics),
        }
    });
    journal_upsert(app, JournalUpsertRequest { entry })?;
    Ok(())
}
