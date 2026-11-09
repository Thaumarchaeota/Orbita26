use chrono::{Datelike, FixedOffset, TimeZone, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::AppHandle;

use crate::data;
use crate::health_db::{
    list_activities, list_meals, ListActivitiesQuery, ListMealsQuery,
};
use crate::journal_archive_db::{self, ListEntriesQuery};
use crate::journal_db::{
    GarminBodyMeasurementInput, GarminDailyInput, GarminExerciseInput, GarminRoutineInput,
    GarminSeriesInput,
};

pub use crate::journal_db::{
    JournalDeleteRequest, JournalListRequest, JournalListResponse, JournalUpsertRequest,
    JournalUpsertResponse,
};

const JOURNAL_WRITE_DISABLED: &str = "旧 Journal 写入已停用";

pub fn journal_root(app: &AppHandle) -> Result<String, String> {
    let settings = data::read_settings(app)?;
    let root = settings.integrations.journal.data_root.trim();
    if root.is_empty() {
        return Ok(data::get_data_dir(app)?);
    }
    Ok(root.to_string())
}

pub fn journal_list(app: &AppHandle, req: JournalListRequest) -> Result<JournalListResponse, String> {
    let data_dir = data::get_data_dir(app)?;
    journal_list_in(&data_dir, req)
}

pub fn journal_list_in(data_dir: &str, req: JournalListRequest) -> Result<JournalListResponse, String> {
    let (from, to) = resolve_query_range(&req)?;
    let mut entries = Vec::new();

    let archive = journal_archive_db::list_entries(data_dir, ListEntriesQuery::default())?;
    for entry in archive.entries {
        if entry.deleted_at.is_some() {
            continue;
        }
        let local_date = crate::health_db::util::local_date_from_instant(&entry.started_at)?;
        if local_date < from || local_date > to {
            continue;
        }
        let mut value = serde_json::to_value(&entry).map_err(|e| e.to_string())?;
        if let Some(obj) = value.as_object_mut() {
            obj.insert("date".into(), json!(local_date));
        }
        entries.push(value);
    }

    let meals = list_meals(
        data_dir,
        ListMealsQuery {
            local_date_from: Some(from.clone()),
            local_date_to: Some(to.clone()),
            include_deleted: false,
        },
    )?;
    for meal in meals.meals {
        let date = crate::health_db::util::local_date_from_instant(&meal.started_at)?;
        let mut value = serde_json::to_value(&meal).map_err(|e| e.to_string())?;
        if let Some(obj) = value.as_object_mut() {
            obj.insert("kind".into(), json!("meal"));
            obj.insert("date".into(), json!(date));
        }
        entries.push(value);
    }

    for night in crate::health_db::read::list_sleep_nights(data_dir, &from, &to)? {
        let sleep_hours = sleep_hours_from_night(&night.night);
        let mut value = json!({
            "kind": "sleep",
            "id": night.id,
            "date": night.wake_local_date,
            "wakeLocalDate": night.wake_local_date,
            "source": night.source,
            "night": night.night,
        });
        if let Some(hours) = sleep_hours {
            value["sleepHours"] = json!(hours);
        }
        entries.push(value);
    }

    let activities = list_activities(
        data_dir,
        ListActivitiesQuery {
            local_date_from: Some(from.clone()),
            local_date_to: Some(to.clone()),
            limit: 500,
            offset: 0,
        },
    )?;
    for activity in activities.activities {
        let mut value = json!({
            "kind": "activity",
            "id": activity.id,
            "date": activity.local_date,
        });
        if let Some(name) = activity.title {
            value["name"] = json!(name);
        }
        if let Some(elapsed) = activity.elapsed_duration_seconds {
            value["elapsedDuration"] = json!(elapsed);
        }
        entries.push(value);
    }

    for nap in crate::health_db::read::list_naps(data_dir, &from, &to)? {
        entries.push(json!({
            "kind": "nap",
            "id": nap.id,
            "date": nap.wake_local_date,
            "wakeLocalDate": nap.wake_local_date,
            "source": nap.source,
            "startedAt": nap.started_at,
            "endedAt": nap.ended_at,
            "nap": nap.nap,
        }));
    }

    Ok(JournalListResponse { entries })
}

pub fn journal_upsert(
    _app: &AppHandle,
    _req: JournalUpsertRequest,
) -> Result<JournalUpsertResponse, String> {
    Err(JOURNAL_WRITE_DISABLED.into())
}

pub fn journal_delete(_app: &AppHandle, _req: JournalDeleteRequest) -> Result<(), String> {
    Err(JOURNAL_WRITE_DISABLED.into())
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

fn resolve_query_range(req: &JournalListRequest) -> Result<(String, String), String> {
    if let Some(ref d) = req.date {
        return Ok((d.clone(), d.clone()));
    }
    if let (Some(ref f), Some(ref t)) = (&req.from, &req.to) {
        return Ok((f.clone(), t.clone()));
    }
    let tz = FixedOffset::east_opt(8 * 3600).ok_or("tz")?;
    let y = Utc::now()
        .with_timezone(&tz)
        .format("%Y")
        .to_string()
        .parse::<i32>()
        .map_err(|_| "invalid year")?;
    Ok((format!("{y:04}-01-01"), format!("{y:04}-12-31")))
}

fn sleep_hours_from_night(night: &Value) -> Option<f64> {
    if let Some(stages) = night.get("stages") {
        let deep = stages.get("deep").and_then(|v| v.as_i64()).unwrap_or(0);
        let light = stages.get("light").and_then(|v| v.as_i64()).unwrap_or(0);
        let rem = stages.get("rem").and_then(|v| v.as_i64()).unwrap_or(0);
        let total = deep + light + rem;
        if total > 0 {
            return Some(total as f64 / 3600.0);
        }
    }
    let sleep = night.get("sleep").and_then(|v| v.as_i64())?;
    let wake = night.get("wake").and_then(|v| v.as_i64())?;
    if wake > sleep {
        Some((wake - sleep) as f64 / 3600.0)
    } else {
        None
    }
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
    let data_dir = data::get_data_dir(app)?;
    build_journal_snapshot_in(&data_dir, date)
}

pub fn build_journal_snapshot_in(
    data_dir: &str,
    date: Option<&str>,
) -> Result<JournalSnapshot, String> {
    let date = date
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(beijing_today);
    let configured = !data_dir.trim().is_empty();

    let nights = crate::health_db::read::list_sleep_nights(data_dir, &date, &date)?;
    let sleep_hours = nights.first().and_then(|n| sleep_hours_from_night(&n.night));

    let hydration_ml = crate::health_db::read::hydration_ml_for_date(data_dir, &date)?;

    let week_start = week_start_beijing(&date)?;
    let week_activities = list_activities(
        data_dir,
        ListActivitiesQuery {
            local_date_from: Some(week_start),
            local_date_to: Some(date.clone()),
            limit: 500,
            offset: 0,
        },
    )?;
    let week_exercise_days = week_activities
        .activities
        .iter()
        .map(|a| a.local_date.as_str())
        .collect::<HashSet<_>>()
        .len() as u32;

    let archive = journal_archive_db::list_entries(data_dir, ListEntriesQuery::default())?;
    let mut moods = Vec::new();
    for entry in archive.entries.iter().filter(|e| e.deleted_at.is_none()) {
        let local_date = crate::health_db::util::local_date_from_instant(&entry.started_at)?;
        if local_date != date {
            continue;
        }
        let mood = entry.mood.as_deref().unwrap_or("").trim();
        if !mood.is_empty() {
            moods.push(mood.to_string());
        }
    }

    let mut intake_kcal: u32 = 0;
    let mut meals_summary: Vec<String> = Vec::new();
    if configured {
        let resp = list_meals(
            data_dir,
            ListMealsQuery {
                local_date_from: Some(date.clone()),
                local_date_to: Some(date.clone()),
                include_deleted: false,
            },
        )?;
        for m in resp.meals {
            let kcal = m.kcal.map(|v| v.round() as u32).unwrap_or(0);
            if kcal > 0 {
                intake_kcal += kcal;
            }
            let slot_label = match m.slot.as_deref().unwrap_or("other") {
                "breakfast" => "早餐",
                "lunch" => "午餐",
                "dinner" => "晚餐",
                _ => "其他",
            };
            let text = m.text.as_deref().unwrap_or("");
            meals_summary.push(format!("{slot_label} {kcal}kcal {text}").trim().to_string());
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
        event_count: 0,
        mood_count: moods.len() as u32,
        intake_kcal,
        meal_count,
        meals_summary,
        events: Vec::new(),
        moods,
    })
}

pub fn ingest_garmin_sync(
    _app: &AppHandle,
    _dailies: Vec<GarminDailyInput>,
    _routines: Vec<GarminRoutineInput>,
    _exercises: Vec<GarminExerciseInput>,
    _series: Vec<GarminSeriesInput>,
    _measurements: Vec<GarminBodyMeasurementInput>,
) -> Result<(), String> {
    Err(JOURNAL_WRITE_DISABLED.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn temp_data_dir() -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("orbita-journal-list-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn journal_list_in_without_archive_errors_and_skips_journal_sqlite() {
        crate::health_db::host_lock::release();
        let data_dir = temp_data_dir();
        let journal_path = data_dir.join("journal.sqlite");
        assert!(!journal_path.exists());

        let err = journal_list_in(
            &data_dir.to_string_lossy(),
            JournalListRequest {
                date: Some("2026-01-01".into()),
                from: None,
                to: None,
            },
        );
        assert!(err.is_err(), "expected archive-not-initialized error");
        assert!(!journal_path.exists(), "journal.sqlite must not be created");
        fs::remove_dir_all(&data_dir).ok();
    }

    #[test]
    fn journal_legacy_write_returns_disabled_without_opening_db() {
        assert_eq!(JOURNAL_WRITE_DISABLED, "旧 Journal 写入已停用");
    }
}
