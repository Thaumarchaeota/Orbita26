use chrono::{Datelike, FixedOffset, TimeZone, Utc};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use tauri::AppHandle;

use crate::data;
use crate::journal_db::{
    self, GarminBodyMeasurementInput, GarminDailyInput, GarminExerciseInput, GarminRoutineInput,
    GarminSeriesInput, ingest_garmin_batch, set_garmin_sync_meta,
};

pub use crate::journal_db::{
    JournalDeleteRequest, JournalListRequest, JournalListResponse, JournalUpsertRequest,
    JournalUpsertResponse,
};

pub fn journal_root(app: &AppHandle) -> Result<String, String> {
    let settings = data::read_settings(app)?;
    let root = settings.integrations.journal.data_root.trim();
    if root.is_empty() {
        return Ok(data::get_data_dir(app)?);
    }
    Ok(root.to_string())
}

fn with_root<F, T>(app: &AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&str) -> Result<T, String>,
{
    let root = journal_root(app)?;
    f(&root)
}

pub fn journal_list(app: &AppHandle, req: JournalListRequest) -> Result<JournalListResponse, String> {
    with_root(app, |root| journal_db::journal_list(root, req))
}

pub fn journal_upsert(app: &AppHandle, req: JournalUpsertRequest) -> Result<JournalUpsertResponse, String> {
    with_root(app, |root| journal_db::journal_upsert(root, req))
}

pub fn journal_delete(app: &AppHandle, req: JournalDeleteRequest) -> Result<(), String> {
    with_root(app, |root| journal_db::journal_delete(root, req))
}

pub fn beijing_today() -> String {
    let tz = FixedOffset::east_opt(8 * 3600).unwrap();
    Utc::now().with_timezone(&tz).format("%Y-%m-%d").to_string()
}

pub fn beijing_now_hhmm() -> String {
    let tz = FixedOffset::east_opt(8 * 3600).unwrap();
    Utc::now().with_timezone(&tz).format("%H:%M").to_string()
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

fn entry_kind(entry: &Value) -> Option<&str> {
    entry.get("kind").and_then(|k| k.as_str())
}

fn is_primary_mood(entry: &Value) -> bool {
    entry.get("primary").and_then(|p| p.as_bool()).unwrap_or(false)
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
        .filter_map(|e| e.get("date").and_then(|d| d.as_str()))
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

pub fn ingest_garmin_sync(
    app: &AppHandle,
    dailies: Vec<GarminDailyInput>,
    routines: Vec<GarminRoutineInput>,
    exercises: Vec<GarminExerciseInput>,
    series: Vec<GarminSeriesInput>,
    measurements: Vec<GarminBodyMeasurementInput>,
) -> Result<(), String> {
    with_root(app, |root| {
        journal_db::with_connection(root, |conn| {
            let tx = conn
                .unchecked_transaction()
                .map_err(|e| format!("begin transaction: {e}"))?;
            ingest_garmin_batch(&tx, &dailies, &routines, &exercises, &series, &measurements)?;
            let now = journal_db::util::utc_now();
            set_garmin_sync_meta(
                &tx,
                &[
                    ("last_success_at", now.as_str()),
                    ("last_error", ""),
                    ("syncing", "0"),
                ],
            )?;
            if let (Some(first), Some(last)) = (dailies.first(), dailies.last()) {
                set_garmin_sync_meta(
                    &tx,
                    &[
                        ("earliest_local_date", first.date.as_str()),
                        ("latest_local_date", last.date.as_str()),
                    ],
                )?;
            }
            tx.commit().map_err(|e| format!("commit transaction: {e}"))?;
            Ok(())
        })
    })
}
