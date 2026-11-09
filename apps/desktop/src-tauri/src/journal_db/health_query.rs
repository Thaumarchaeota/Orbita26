use chrono::{Duration, NaiveDate, TimeZone};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::open_db;

fn json_to_i64(v: &Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_f64().map(|n| n as i64))
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn deserialize_unix_ts<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = Value::deserialize(deserializer)?;
    json_to_i64(&v).ok_or_else(|| serde::de::Error::custom("expected unix timestamp"))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthOverviewRequest {
    pub selected_date: String,
    #[serde(deserialize_with = "deserialize_unix_ts")]
    pub track_from_utc: i64,
    #[serde(deserialize_with = "deserialize_unix_ts")]
    pub track_to_utc: i64,
    pub trend_days: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSample {
    pub t: i64,
    pub v: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepStageSegment {
    pub start_utc: i64,
    pub end_utc: i64,
    pub stage: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepStageTotals {
    pub deep: i64,
    pub light: i64,
    pub rem: i64,
    pub awake: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepBlock {
    pub id: String,
    pub start_utc: i64,
    pub end_utc: i64,
    pub is_nap: bool,
    pub score: Option<i32>,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segments: Option<Vec<SleepStageSegment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_totals: Option<SleepStageTotals>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    pub id: String,
    pub start_utc: i64,
    pub end_utc: Option<i64>,
    pub activity_type: Option<String>,
    pub name: Option<String>,
    pub distance_m: Option<f64>,
    pub duration_sec: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MealEvent {
    pub id: String,
    pub occurred_at_utc: i64,
    pub meal_type: Option<String>,
    pub icon_key: Option<String>,
    pub description: Option<String>,
    pub kcal: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSeries {
    pub metric: String,
    pub samples: Vec<TimeSample>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthTrackData {
    pub sleep_blocks: Vec<SleepBlock>,
    pub series: Vec<TrackSeries>,
    pub activities: Vec<ActivityEvent>,
    pub meals: Vec<MealEvent>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendDayPoint {
    pub date: String,
    pub value: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepStagePoint {
    pub date: String,
    pub deep: Option<f64>,
    pub light: Option<f64>,
    pub rem: Option<f64>,
    pub awake: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendSeries {
    pub metric: String,
    pub label: String,
    pub unit: String,
    pub chart_type: String,
    pub points: Vec<TrendDayPoint>,
    pub window_avg: Option<f64>,
    pub prev_window_avg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stages: Option<Vec<SleepStagePoint>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendPanel {
    pub id: String,
    pub title: String,
    pub series: Vec<TrendSeries>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnergySummary {
    pub meal_count: u32,
    pub intake_kcal: Option<f64>,
    pub burn_kcal: Option<i32>,
    pub delta_kcal: Option<f64>,
    pub days_with_meals: u32,
    pub days_in_window: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaySummaryCard {
    pub id: String,
    pub label: String,
    pub value: Option<String>,
    pub unit: Option<String>,
    pub ever_seen: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthDaySummary {
    pub date: String,
    pub cards: Vec<DaySummaryCard>,
    pub energy: EnergySummary,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthOverviewResponse {
    pub track: HealthTrackData,
    pub trends: Vec<TrendPanel>,
    pub day_summary: HealthDaySummary,
    pub local_date_range: Option<LocalDateRange>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDateRange {
    pub earliest: String,
    pub latest: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSyncStatus {
    pub last_success_at: Option<String>,
    pub syncing: bool,
    pub last_error: Option<String>,
    pub earliest_local_date: Option<String>,
    pub latest_local_date: Option<String>,
}

pub fn health_sync_status(app: &AppHandle) -> Result<HealthSyncStatus, String> {
    let conn = open_db(app)?;
    Ok(read_sync_status(&conn)?)
}

pub fn health_overview_query(
    app: &AppHandle,
    req: HealthOverviewRequest,
) -> Result<HealthOverviewResponse, String> {
    let conn = open_db(app)?;
    let (from_utc, to_utc) = if req.track_from_utc > req.track_to_utc {
        (req.track_to_utc, req.track_from_utc)
    } else {
        (req.track_from_utc, req.track_to_utc)
    };
    let track = read_track(&conn, from_utc, to_utc)?;
    let trends = read_trends(&conn, &req.selected_date, req.trend_days)?;
    let day_summary = read_day_summary(&conn, &req.selected_date, req.trend_days)?;
    let local_date_range = read_local_date_range(&conn)?;
    Ok(HealthOverviewResponse {
        track,
        trends,
        day_summary,
        local_date_range,
    })
}

fn read_sync_status(conn: &Connection) -> Result<HealthSyncStatus, String> {
    let mut last_success_at = None;
    let mut syncing = false;
    let mut last_error = None;
    let mut earliest_local_date = None;
    let mut latest_local_date = None;

    let mut stmt = conn
        .prepare("SELECT key, value FROM garmin_sync_meta")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        match k.as_str() {
            "last_success_at" => last_success_at = Some(v),
            "syncing" => syncing = v == "1" || v == "true",
            "last_error" => last_error = Some(v),
            "earliest_local_date" => earliest_local_date = Some(v),
            "latest_local_date" => latest_local_date = Some(v),
            _ => {}
        }
    }

    if earliest_local_date.is_none() || latest_local_date.is_none() {
        if let Ok((min_d, max_d)) = conn
            .query_row(
                "SELECT MIN(local_date), MAX(local_date) FROM daily_metrics WHERE deleted_at_utc IS NULL",
                [],
                |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?)),
            )
        {
            if earliest_local_date.is_none() {
                earliest_local_date = min_d;
            }
            if latest_local_date.is_none() {
                latest_local_date = max_d;
            }
        }
    }

    Ok(HealthSyncStatus {
        last_success_at,
        syncing,
        last_error,
        earliest_local_date,
        latest_local_date,
    })
}

fn read_local_date_range(conn: &Connection) -> Result<Option<LocalDateRange>, String> {
    Ok(conn
        .query_row(
            "SELECT MIN(local_date), MAX(local_date) FROM daily_metrics WHERE deleted_at_utc IS NULL",
            [],
            |row| {
                let min_d: Option<String> = row.get(0)?;
                let max_d: Option<String> = row.get(1)?;
                Ok(match (min_d, max_d) {
                    (Some(earliest), Some(latest)) => Some(LocalDateRange { earliest, latest }),
                    _ => None,
                })
            },
        )
        .unwrap_or(None))
}

fn sanitize_sample_value(metric: &str, v: Option<f64>) -> Option<f64> {
    let v = v?;
    if !v.is_finite() {
        return None;
    }
    let ok = match metric {
        "stress" => (0.0..=100.0).contains(&v),
        "respiration" => v > 0.0 && v < 80.0,
        "spo2" => (50.0..=100.0).contains(&v),
        "hr" => v > 20.0 && v < 250.0,
        "hrv" => v > 0.0 && v < 300.0,
        "body_battery" => (0.0..=100.0).contains(&v),
        "steps_cumulative" => v >= 0.0,
        _ => true,
    };
    if ok { Some(v) } else { None }
}

fn json_to_f64(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_i64().map(|n| n as f64))
}

fn activity_start_utc(activity: &Value) -> Option<i64> {
    activity
        .get("metrics")
        .and_then(|m| m.get("startTime").or_else(|| m.get("start")))
        .and_then(json_to_i64)
        .or_else(|| activity.get("start").and_then(json_to_i64))
}

fn parse_samples(json: &str) -> Vec<TimeSample> {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return vec![];
    };
    let arr = if let Some(samples) = v.get("samples").and_then(|s| s.as_array()) {
        samples
    } else if let Some(arr) = v.as_array() {
        arr
    } else {
        return vec![];
    };
    arr.iter()
        .filter_map(|item| {
            if let Some(obj) = item.as_object() {
                let t = obj.get("t")?.as_i64()?;
                let val = obj.get("v");
                let v = match val {
                    None => None,
                    Some(Value::Null) => None,
                    Some(n) => json_to_f64(n),
                };
                let src = obj
                    .get("src")
                    .and_then(|s| s.as_str())
                    .map(|s| s.to_string());
                return Some(TimeSample { t, v, src });
            }
            let pair = item.as_array()?;
            let t = pair.first()?.as_i64()?;
            let v = match pair.get(1) {
                None | Some(Value::Null) => None,
                Some(n) => json_to_f64(n),
            };
            Some(TimeSample {
                t,
                v,
                src: None,
            })
        })
        .collect()
}

fn json_path_key(metric: &str) -> String {
    match metric {
        "sleep_duration_sec" => "sleepDurationSec".to_string(),
        "hrv_nightly" => "hrvNightly".to_string(),
        "spo2_avg" => "spo2Avg".to_string(),
        "weight_kg" => "weightKg".to_string(),
        "calories_burned" => "totalCalories".to_string(),
        "water_ml" => "hydrationMl".to_string(),
        "avg_stress" => "avgStress".to_string(),
        "steps" => "steps".to_string(),
        "resting_hr" => "restingHr".to_string(),
        other => other.to_string(),
    }
}

fn read_json_f64(conn: &Connection, date: &str, key: &str) -> Option<f64> {
    let sql = format!(
        "SELECT json_extract(data_json, '$.{}') FROM daily_metrics WHERE local_date = ?1 AND deleted_at_utc IS NULL",
        key
    );
    conn.query_row(&sql, params![date], |row| row.get::<_, Option<f64>>(0))
        .ok()
        .flatten()
}

fn read_json_i64(conn: &Connection, date: &str, key: &str) -> Option<i64> {
    read_json_f64(conn, date, key).map(|v| v as i64)
}

fn parse_sleep_stage_totals(v: &Value) -> Option<SleepStageTotals> {
    let obj = v.as_object()?;
    let secs = |key: &str| -> i64 {
        obj.get(key)
            .and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
            .unwrap_or(0)
    };
    Some(SleepStageTotals {
        deep: secs("deep"),
        light: secs("light"),
        rem: secs("rem"),
        awake: secs("awake"),
    })
}

fn parse_sleep_level_segments(v: &Value) -> Option<Vec<SleepStageSegment>> {
    let arr = v.as_array()?;
    let mut out = Vec::new();
    for item in arr {
        let Some(start) = item
            .get("start")
            .and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
        else {
            continue;
        };
        let Some(end) = item
            .get("end")
            .and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
        else {
            continue;
        };
        let Some(stage) = item.get("stage").and_then(|x| x.as_str()) else {
            continue;
        };
        if end > start {
            out.push(SleepStageSegment {
                start_utc: start,
                end_utc: end,
                stage: stage.to_string(),
            });
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn metric_ever_seen(conn: &Connection, key: &str) -> bool {
    let sql = format!(
        "SELECT 1 FROM daily_metrics WHERE json_extract(data_json, '$.{}') IS NOT NULL AND deleted_at_utc IS NULL LIMIT 1",
        key
    );
    conn.query_row(&sql, [], |_| Ok(true)).unwrap_or(false)
}
fn read_track(conn: &Connection, from_utc: i64, to_utc: i64) -> Result<HealthTrackData, String> {
    let from_date = utc_to_local_date(from_utc);
    let to_date = utc_to_local_date(to_utc);

    let mut sleep_blocks = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, night_json, source FROM sleep_nights
             WHERE deleted_at_utc IS NULL AND wake_date >= ?1 AND wake_date <= ?2",
        )
        .map_err(|e| e.to_string())?;
    let sleep_rows = stmt
        .query_map(params![from_date, to_date], |row| {
            let id: String = row.get(0)?;
            let night_json: String = row.get(1)?;
            let source: String = row.get(2)?;
            Ok((id, night_json, source))
        })
        .map_err(|e| e.to_string())?;
    for row in sleep_rows {
        let (id, night_json, source) = row.map_err(|e| e.to_string())?;
        let night: Value = serde_json::from_str(&night_json).unwrap_or(json!({}));
        let start = night.get("sleep").and_then(|v| v.as_i64()).unwrap_or(0);
        let end = night.get("wake").and_then(|v| v.as_i64()).unwrap_or(0);
        if end > from_utc && start < to_utc {
            sleep_blocks.push(SleepBlock {
                id,
                start_utc: start,
                end_utc: end,
                is_nap: false,
                score: night.get("score").and_then(|v| v.as_i64()).map(|v| v as i32),
                source,
                segments: night
                    .get("levelSegments")
                    .and_then(parse_sleep_level_segments),
                stage_totals: night.get("stages").and_then(parse_sleep_stage_totals),
            });
        }
    }
    let mut nap_stmt = conn
        .prepare(
            "SELECT id, nap_json, source FROM naps
             WHERE deleted_at_utc IS NULL AND local_date >= ?1 AND local_date <= ?2",
        )
        .map_err(|e| e.to_string())?;
    let nap_rows = nap_stmt
        .query_map(params![from_date, to_date], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })
        .map_err(|e| e.to_string())?;
    for row in nap_rows {
        let (id, nap_json, source) = row.map_err(|e| e.to_string())?;
        let nap: Value = serde_json::from_str(&nap_json).unwrap_or(json!({}));
        let (start, end) = if let (Some(s), Some(e)) = (nap.get("start").and_then(|v| v.as_i64()), nap.get("end").and_then(|v| v.as_i64())) {
            (s, e)
        } else {
            continue;
        };
        if end > from_utc && start < to_utc {
            sleep_blocks.push(SleepBlock {
                id,
                start_utc: start,
                end_utc: end,
                is_nap: true,
                score: None,
                source,
                segments: None,
                stage_totals: None,
            });
        }
    }

    let metric_names = [
        "hr",
        "hrv",
        "spo2",
        "respiration",
        "stress",
        "body_battery",
        "steps_cumulative",
    ];
    let mut series = Vec::new();
    for metric in metric_names {
        let mut samples = Vec::new();
        let mut snap_stmt = conn
            .prepare(
                "SELECT snapshot_json FROM metric_day_snapshots
                 WHERE metric_name = ?1 AND local_date >= ?2 AND local_date <= ?3 AND deleted_at_utc IS NULL",
            )
            .map_err(|e| e.to_string())?;
        let snap_rows = snap_stmt
            .query_map(params![metric, from_date, to_date], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in snap_rows {
            let json: String = row.map_err(|e| e.to_string())?;
            for s in parse_samples(&json) {
                if s.t >= from_utc && s.t < to_utc {
                    samples.push(TimeSample {
                        t: s.t,
                        v: sanitize_sample_value(metric, s.v),
                        src: s.src.clone(),
                    });
                }
            }
        }
        samples.sort_by_key(|s| s.t);
        series.push(TrackSeries {
            metric: metric.to_string(),
            samples,
        });
    }

    let mut activities = Vec::new();
    let mut act_stmt = conn
        .prepare(
            "SELECT id, activity_json FROM activities
             WHERE deleted_at_utc IS NULL AND local_date >= ?1 AND local_date <= ?2",
        )
        .map_err(|e| e.to_string())?;
    let act_rows = act_stmt
        .query_map(params![from_date, to_date], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in act_rows {
        let (id, activity_json) = row.map_err(|e| e.to_string())?;
        let activity: Value = serde_json::from_str(&activity_json).unwrap_or(json!({}));
        let duration = activity
            .get("duration")
            .and_then(json_to_i64)
            .unwrap_or(0)
            .max(0);
        let Some(start) = activity_start_utc(&activity) else {
            continue;
        };
        let end = start + duration;
        activities.push(ActivityEvent {
            id,
            start_utc: start,
            end_utc: Some(end),
            activity_type: activity.get("sport").and_then(|v| v.as_str()).map(str::to_string),
            name: None,
            distance_m: activity
                .get("metrics")
                .and_then(|m| m.get("distance"))
                .and_then(|v| v.as_f64()),
            duration_sec: Some(duration as i32),
        });
    }

    let mut meals = Vec::new();
    let mut meal_stmt = conn
        .prepare(
            "SELECT id, meal_json, local_date FROM meals
             WHERE deleted_at_utc IS NULL AND local_date >= ?1 AND local_date <= ?2",
        )
        .map_err(|e| e.to_string())?;
    let meal_rows = meal_stmt
        .query_map(params![from_date, to_date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in meal_rows {
        let (id, meal_json, local_date) = row.map_err(|e| e.to_string())?;
        let meal: Value = serde_json::from_str(&meal_json).unwrap_or(json!({}));
        let Some(occurred) = meal
            .get("at")
            .and_then(|v| v.as_str())
            .and_then(|hm| parse_meal_time(&local_date, hm))
        else {
            continue;
        };
        if occurred >= from_utc && occurred < to_utc {
            meals.push(MealEvent {
                id,
                occurred_at_utc: occurred,
                meal_type: meal.get("slot").and_then(|v| v.as_str()).map(str::to_string),
                icon_key: None,
                description: meal.get("text").and_then(|v| v.as_str()).map(str::to_string),
                kcal: meal.get("kcal").and_then(|v| v.as_f64()),
            });
        }
    }

    Ok(HealthTrackData {
        sleep_blocks,
        series,
        activities,
        meals,
    })
}

fn shift_date(date: &str, days: i64) -> Option<String> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    Some((d + Duration::days(days)).format("%Y-%m-%d").to_string())
}

fn date_range(end: &str, days: u32) -> Vec<String> {
    let Some(end_d) = NaiveDate::parse_from_str(end, "%Y-%m-%d").ok() else {
        return vec![];
    };
    let count = days as i64;
    (0..count)
        .filter_map(|i| {
            let d = end_d - Duration::days(count - 1 - i);
            Some(d.format("%Y-%m-%d").to_string())
        })
        .collect()
}

fn parse_meal_time(local_date: &str, hm: &str) -> Option<i64> {
    crate::journal::datetime_to_unix_beijing(local_date, hm).ok()
}

fn read_daily_metric(
    conn: &Connection,
    dates: &[String],
    column: &str,
) -> Result<Vec<TrendDayPoint>, String> {
    let key = json_path_key(column);
    let mut points = Vec::new();
    for date in dates {
        let value = read_json_f64(conn, date, &key);
        points.push(TrendDayPoint {
            date: date.clone(),
            value,
        });
    }
    Ok(points)
}

fn stage_hours(night: &Value, key: &str) -> Option<f64> {
    let v = night.get("stages")?.get(key)?;
    let secs = v.as_f64().or_else(|| v.as_i64().map(|x| x as f64))?;
    let h = secs / 3600.0;
    if h > 0.0 { Some(h) } else { None }
}

fn read_sleep_stages_trend(conn: &Connection, dates: &[String]) -> Result<Vec<SleepStagePoint>, String> {
    let mut stages = Vec::new();
    for date in dates {
        let night: Option<Value> = conn
            .query_row(
                "SELECT night_json FROM sleep_nights WHERE wake_date = ?1 AND deleted_at_utc IS NULL LIMIT 1",
                params![date],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|night_json| serde_json::from_str(&night_json).ok());
        let point = if let Some(night) = night {
            SleepStagePoint {
                date: date.clone(),
                deep: stage_hours(&night, "deep"),
                light: stage_hours(&night, "light"),
                rem: stage_hours(&night, "rem"),
                awake: stage_hours(&night, "awake"),
            }
        } else {
            SleepStagePoint {
                date: date.clone(),
                deep: None,
                light: None,
                rem: None,
                awake: None,
            }
        };
        stages.push(point);
    }
    Ok(stages)
}

fn read_sleep_duration_trend(conn: &Connection, dates: &[String]) -> Result<Vec<TrendDayPoint>, String> {
    let mut points = Vec::new();
    for date in dates {
        let value = conn
            .query_row(
                "SELECT night_json FROM sleep_nights WHERE wake_date = ?1 AND deleted_at_utc IS NULL LIMIT 1",
                params![date],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|night_json| {
                let night: Value = serde_json::from_str(&night_json).ok()?;
                let start = night.get("sleep")?.as_i64()?;
                let end = night.get("wake")?.as_i64()?;
                Some((end - start).max(0) as f64)
            });
        points.push(TrendDayPoint {
            date: date.clone(),
            value,
        });
    }
    Ok(points)
}

fn read_snapshot_metric_avg(conn: &Connection, date: &str, metric: &str) -> Option<f64> {
    let json: String = conn
        .query_row(
            "SELECT snapshot_json FROM metric_day_snapshots
             WHERE local_date = ?1 AND metric_name = ?2 AND deleted_at_utc IS NULL",
            params![date, metric],
            |row| row.get(0),
        )
        .ok()?;
    let vals: Vec<f64> = parse_samples(&json)
        .iter()
        .filter_map(|s| sanitize_sample_value(metric, s.v))
        .collect();
    if vals.is_empty() {
        None
    } else {
        Some(vals.iter().sum::<f64>() / vals.len() as f64)
    }
}

fn read_snapshot_metric_trend(
    conn: &Connection,
    dates: &[String],
    metric: &str,
) -> Result<Vec<TrendDayPoint>, String> {
    let mut points = Vec::new();
    for date in dates {
        points.push(TrendDayPoint {
            date: date.clone(),
            value: read_snapshot_metric_avg(conn, date, metric),
        });
    }
    Ok(points)
}

fn read_weight_for_date(conn: &Connection, date: &str) -> Option<f64> {
    conn.query_row(
        "SELECT measurement_json FROM body_measurements
         WHERE local_date = ?1 AND deleted_at_utc IS NULL
         ORDER BY updated_at_utc DESC LIMIT 1",
        params![date],
        |row| {
            let json: String = row.get(0)?;
            let v: Value = serde_json::from_str(&json).unwrap_or(json!({}));
            Ok(v.get("weightKg").and_then(|x| x.as_f64()))
        },
    )
    .ok()
    .flatten()
}

fn read_weight_trend(conn: &Connection, dates: &[String]) -> Result<Vec<TrendDayPoint>, String> {
    let mut points = Vec::new();
    for date in dates {
        points.push(TrendDayPoint {
            date: date.clone(),
            value: read_weight_for_date(conn, date),
        });
    }
    Ok(points)
}

fn read_meal_kcal_for_date(conn: &Connection, date: &str) -> Option<f64> {
    let (count, sum): (i32, f64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(CAST(json_extract(meal_json, '$.kcal') AS REAL)), 0)
             FROM meals WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            params![date],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((0, 0.0));
    if count > 0 && sum > 0.0 {
        Some(sum)
    } else if count > 0 {
        Some(0.0)
    } else {
        None
    }
}

fn read_meal_energy_trend(conn: &Connection, dates: &[String]) -> Result<Vec<TrendDayPoint>, String> {
    let mut points = Vec::new();
    for date in dates {
        points.push(TrendDayPoint {
            date: date.clone(),
            value: read_meal_kcal_for_date(conn, date),
        });
    }
    Ok(points)
}

fn body_weight_ever_seen(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM body_measurements WHERE deleted_at_utc IS NULL LIMIT 1",
        [],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

fn avg_points(points: &[TrendDayPoint]) -> Option<f64> {
    let vals: Vec<f64> = points.iter().filter_map(|p| p.value).collect();
    if vals.is_empty() {
        None
    } else {
        Some(vals.iter().sum::<f64>() / vals.len() as f64)
    }
}

fn latest_point(points: &[TrendDayPoint]) -> Option<f64> {
    points.iter().rev().find_map(|p| p.value)
}

fn read_trends(conn: &Connection, selected_date: &str, trend_days: u32) -> Result<Vec<TrendPanel>, String> {
    let dates = date_range(selected_date, trend_days);
    let window_start = shift_date(selected_date, -(trend_days as i64 - 1)).unwrap_or_default();
    let prev_end = shift_date(&window_start, -1).unwrap_or_default();
    let prev_dates = date_range(&prev_end, trend_days);

    let sleep_pts = read_sleep_duration_trend(conn, &dates)?;
    let sleep_stages = read_sleep_stages_trend(conn, &dates)?;
    let hrv_pts = read_snapshot_metric_trend(conn, &dates, "hrv")?;
    let spo2_pts = read_snapshot_metric_trend(conn, &dates, "spo2")?;
    let prev_sleep = read_sleep_duration_trend(conn, &prev_dates)?;
    let prev_hrv = read_snapshot_metric_trend(conn, &prev_dates, "hrv")?;
    let prev_spo2 = read_snapshot_metric_trend(conn, &prev_dates, "spo2")?;

    let recovery = TrendPanel {
        id: "recovery".into(),
        title: "恢复".into(),
        series: vec![
            TrendSeries {
                metric: "sleep".into(),
                label: "睡眠".into(),
                unit: "h".into(),
                chart_type: "stack_sleep".into(),
                window_avg: avg_points(&sleep_pts).map(|s| s / 3600.0),
                prev_window_avg: avg_points(&prev_sleep).map(|s| s / 3600.0),
                points: sleep_pts
                    .into_iter()
                    .map(|p| TrendDayPoint {
                        date: p.date,
                        value: p.value.map(|v| v / 3600.0),
                    })
                    .collect(),
                stages: Some(sleep_stages),
            },
            TrendSeries {
                metric: "hrv".into(),
                label: "HRV".into(),
                unit: "ms".into(),
                chart_type: "smooth_line".into(),
                window_avg: avg_points(&hrv_pts),
                prev_window_avg: avg_points(&prev_hrv),
                points: hrv_pts,
                stages: None,
            },
            TrendSeries {
                metric: "spo2".into(),
                label: "SpO2".into(),
                unit: "%".into(),
                chart_type: "smooth_line".into(),
                window_avg: avg_points(&spo2_pts),
                prev_window_avg: avg_points(&prev_spo2),
                points: spo2_pts,
                stages: None,
            },
        ],
    };

    let weight_pts = read_weight_trend(conn, &dates)?;
    let burn_pts = read_daily_metric(conn, &dates, "calories_burned")?;
    let energy_pts = read_meal_energy_trend(conn, &dates)?;
    let prev_weight = read_weight_trend(conn, &prev_dates)?;
    let prev_burn = read_daily_metric(conn, &prev_dates, "calories_burned")?;
    let prev_energy = read_meal_energy_trend(conn, &prev_dates)?;

    let body_energy = TrendPanel {
        id: "body_energy".into(),
        title: "身体与能量".into(),
        series: vec![
            TrendSeries {
                metric: "weight".into(),
                label: "体重".into(),
                unit: "kg".into(),
                chart_type: "smooth_line".into(),
                window_avg: latest_point(&weight_pts),
                prev_window_avg: latest_point(&prev_weight),
                points: weight_pts,
                stages: None,
            },
            TrendSeries {
                metric: "energy".into(),
                label: "记录能量".into(),
                unit: "kcal".into(),
                chart_type: "smooth_line".into(),
                window_avg: avg_points(&energy_pts),
                prev_window_avg: avg_points(&prev_energy),
                points: energy_pts,
                stages: None,
            },
            TrendSeries {
                metric: "burn".into(),
                label: "消耗".into(),
                unit: "kcal".into(),
                chart_type: "smooth_line".into(),
                window_avg: avg_points(&burn_pts),
                prev_window_avg: avg_points(&prev_burn),
                points: burn_pts,
                stages: None,
            },
        ],
    };

    let water_pts = read_daily_metric(conn, &dates, "water_ml")?;
    let prev_water = read_daily_metric(conn, &prev_dates, "water_ml")?;
    let water = TrendPanel {
        id: "water".into(),
        title: "喝水".into(),
        series: vec![TrendSeries {
            metric: "water".into(),
            label: "饮水".into(),
            unit: "ml".into(),
            chart_type: "bar".into(),
            window_avg: avg_points(&water_pts),
            prev_window_avg: avg_points(&prev_water),
            points: water_pts,
            stages: None,
        }],
    };

    let stress_pts = read_snapshot_metric_trend(conn, &dates, "stress")?;
    let prev_stress = read_snapshot_metric_trend(conn, &prev_dates, "stress")?;
    let stress = TrendPanel {
        id: "stress".into(),
        title: "Stress".into(),
        series: vec![TrendSeries {
            metric: "stress".into(),
            label: "平均压力".into(),
            unit: "".into(),
            chart_type: "line".into(),
            window_avg: avg_points(&stress_pts),
            prev_window_avg: avg_points(&prev_stress),
            points: stress_pts,
            stages: None,
        }],
    };

    Ok(vec![recovery, body_energy, water, stress])
}

fn read_day_summary(
    conn: &Connection,
    selected_date: &str,
    trend_days: u32,
) -> Result<HealthDaySummary, String> {
    let steps = read_json_i64(conn, selected_date, "steps");
    let rhr = read_json_i64(conn, selected_date, "restingHr");
    let water = read_json_i64(conn, selected_date, "hydrationMl");
    let burn = read_json_i64(conn, selected_date, "totalCalories");
    let data_json: Option<String> = conn
        .query_row(
            "SELECT data_json FROM daily_metrics WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            params![selected_date],
            |row| row.get(0),
        )
        .ok();
    let data: Value = data_json
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or(json!({}));
    let bb_low = data
        .get("bodyBattery")
        .and_then(|b| b.get("low"))
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let bb_high = data
        .get("bodyBattery")
        .and_then(|b| b.get("high"))
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let weight = read_weight_for_date(conn, selected_date)
        .or_else(|| data.get("weightKg").and_then(|v| v.as_f64()));
    let spo2 = data.get("spo2Avg").and_then(|v| v.as_f64());
    let sleep_score = data.get("sleepScore").and_then(|v| v.as_i64()).map(|v| v as i32);

    let sleep_night: Option<(i64, i64, Option<i32>)> = conn
        .query_row(
            "SELECT night_json FROM sleep_nights WHERE wake_date = ?1 AND deleted_at_utc IS NULL LIMIT 1",
            params![selected_date],
            |row| {
                let night_json: String = row.get(0)?;
                let night: Value = serde_json::from_str(&night_json).unwrap_or(json!({}));
                let start = night.get("sleep").and_then(|v| v.as_i64()).unwrap_or(0);
                let end = night.get("wake").and_then(|v| v.as_i64()).unwrap_or(0);
                let score = night.get("score").and_then(|v| v.as_i64()).map(|v| v as i32);
                Ok((start, end, score))
            },
        )
        .ok();
    let sleep_sec = sleep_night.map(|(s, e, _)| (e - s).max(0) as i32);

    let mut cards = vec![
        DaySummaryCard {
            id: "steps".into(),
            label: "步数".into(),
            value: steps.map(|v| v.to_string()),
            unit: None,
            ever_seen: metric_ever_seen(conn, "steps"),
        },
        DaySummaryCard {
            id: "sleep".into(),
            label: "睡眠".into(),
            value: sleep_sec.map(|s| format_sleep(s, sleep_night.as_ref())),
            unit: None,
            ever_seen: conn
                .query_row(
                    "SELECT 1 FROM sleep_nights WHERE deleted_at_utc IS NULL LIMIT 1",
                    [],
                    |_| Ok(true),
                )
                .unwrap_or(false),
        },
        DaySummaryCard {
            id: "rhr".into(),
            label: "静息心率".into(),
            value: rhr.map(|v| v.to_string()),
            unit: Some("bpm".into()),
            ever_seen: metric_ever_seen(conn, "restingHr"),
        },
        DaySummaryCard {
            id: "body_battery".into(),
            label: "Body Battery".into(),
            value: match (bb_low, bb_high) {
                (Some(lo), Some(hi)) => Some(format!("{lo}–{hi}")),
                (lo, hi) => lo.or(hi).map(|v| v.to_string()),
            },
            unit: None,
            ever_seen: metric_ever_seen(conn, "bodyBattery"),
        },
        DaySummaryCard {
            id: "water".into(),
            label: "喝水".into(),
            value: water.map(|v| v.to_string()),
            unit: Some("ml".into()),
            ever_seen: metric_ever_seen(conn, "hydrationMl"),
        },
        DaySummaryCard {
            id: "weight".into(),
            label: "体重".into(),
            value: weight.map(|v| format!("{v:.1}")),
            unit: Some("kg".into()),
            ever_seen: body_weight_ever_seen(conn) || metric_ever_seen(conn, "weightKg"),
        },
        DaySummaryCard {
            id: "spo2".into(),
            label: "SpO2".into(),
            value: spo2.map(|v| format!("{v:.0}")),
            unit: Some("%".into()),
            ever_seen: metric_ever_seen(conn, "spo2Avg"),
        },
    ];

    if let Some((_, _, Some(score))) = sleep_night {
        if let Some(card) = cards.iter_mut().find(|c| c.id == "sleep") {
            if let Some(ref mut val) = card.value {
                val.push_str(&format!(" · {score}分"));
            }
        }
    }
    let _ = sleep_score;

    let dates = date_range(selected_date, trend_days);
    let mut days_with_meals = 0u32;
    for date in &dates {
        let mut stmt = conn
            .prepare(
                "SELECT meal_json FROM meals
                 WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![date], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut day_count = 0u32;
        for row in rows {
            let _meal_json: String = row.map_err(|e| e.to_string())?;
            day_count += 1;
        }
        if day_count > 0 {
            days_with_meals += 1;
        }
    }

    let (meal_count, intake_kcal): (u32, Option<f64>) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(
                CAST(json_extract(meal_json, '$.kcal') AS REAL)
             ), 0)
             FROM meals WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            params![selected_date],
            |row| Ok((row.get::<_, i32>(0)? as u32, {
                let sum: f64 = row.get(1)?;
                if sum > 0.0 { Some(sum) } else { None }
            })),
        )
        .unwrap_or((0, None));

    let energy = EnergySummary {
        meal_count,
        intake_kcal,
        burn_kcal: burn.map(|v| v as i32),
        delta_kcal: match (intake_kcal, burn) {
            (Some(i), Some(b)) => Some(i - b as f64),
            _ => None,
        },
        days_with_meals,
        days_in_window: trend_days,
    };

    Ok(HealthDaySummary {
        date: selected_date.to_string(),
        cards,
        energy,
    })
}

fn format_sleep(sec: i32, night: Option<&(i64, i64, Option<i32>)>) -> String {
    let h = sec / 3600;
    let m = (sec % 3600) / 60;
    let mut s = format!("{h}h{m:02}m");
    if let Some((start, end, _)) = night {
        let st = utc_to_local_time(*start);
        let en = utc_to_local_time(*end);
        s.push_str(&format!(" · {st}–{en}"));
    }
    s
}

fn utc_to_local_date(ts: i64) -> String {
    let offset = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let dt = offset.timestamp_opt(ts, 0).single().unwrap_or_else(|| offset.timestamp(0, 0));
    dt.format("%Y-%m-%d").to_string()
}

fn utc_to_local_time(ts: i64) -> String {
    let offset = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let dt = offset.timestamp_opt(ts, 0).single().unwrap_or_else(|| offset.timestamp(0, 0));
    dt.format("%H:%M").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal_db::schema::ensure_schema;
    use rusqlite::Connection;
    use std::path::Path;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("memory db");
        ensure_schema(&conn, Path::new(":memory:")).expect("schema");
        conn
    }

    #[test]
    fn read_track_includes_overlapping_activity() {
        let conn = mem_conn();
        let start = 1_787_624_216_i64;
        let activity_json = format!(
            r#"{{"duration":10360,"metrics":{{"startTime":{start}}},"sport":"strength"}}"#
        );
        conn.execute(
            "INSERT INTO activities(id, local_date, source, revision, activity_json, content_hash, created_at_utc, updated_at_utc)
             VALUES ('a1', '2026-08-25', 'garmin', 1, ?1, 'h', 't', 't')",
            rusqlite::params![activity_json],
        )
        .expect("insert activity");
        let from = 1_787_580_000_i64;
        let to = 1_787_673_600_i64;
        let track = read_track(&conn, from, to).expect("read_track");
        assert_eq!(track.activities.len(), 1);
        assert_eq!(track.activities[0].start_utc, start);
        assert_eq!(track.activities[0].end_utc, Some(start + 10360));
        assert_eq!(track.activities[0].activity_type.as_deref(), Some("strength"));
    }

    #[test]
    fn read_track_includes_activity_starting_before_window() {
        let conn = mem_conn();
        let start = 1_787_580_000_i64;
        let activity_json = format!(
            r#"{{"duration":7200,"metrics":{{"startTime":{start}}},"sport":"running"}}"#
        );
        conn.execute(
            "INSERT INTO activities(id, local_date, source, revision, activity_json, content_hash, created_at_utc, updated_at_utc)
             VALUES ('a2', '2026-08-25', 'garmin', 1, ?1, 'h', 't', 't')",
            rusqlite::params![activity_json],
        )
        .expect("insert activity");
        let from = start + 3600;
        let to = start + 10_800;
        let track = read_track(&conn, from, to).expect("read_track");
        assert_eq!(track.activities.len(), 1);
    }

    #[test]
    fn read_track_includes_activity_by_local_date_without_utc_overlap() {
        let conn = mem_conn();
        let start = 1_787_624_216_i64;
        let activity_json = format!(
            r#"{{"duration":10360,"metrics":{{"startTime":{start}}},"sport":"strength"}}"#
        );
        conn.execute(
            "INSERT INTO activities(id, local_date, source, revision, activity_json, content_hash, created_at_utc, updated_at_utc)
             VALUES ('a3', '2026-08-25', 'garmin', 1, ?1, 'h', 't', 't')",
            rusqlite::params![activity_json],
        )
        .expect("insert activity");
        let from = start + 20_000;
        let to = start + 86_400;
        let track = read_track(&conn, from, to).expect("read_track");
        assert_eq!(track.activities.len(), 1);
    }

    #[test]
    fn overview_query_parts_on_empty_db() {
        let conn = mem_conn();
        let from = 1_738_339_200_i64;
        let to = from + 86400 * 5;
        read_track(&conn, from, to).expect("read_track");
        read_trends(&conn, "2026-01-02", 7).expect("read_trends");
        read_day_summary(&conn, "2026-01-02", 7).expect("read_day_summary");
        assert!(read_local_date_range(&conn).expect("range").is_none());
    }

    #[test]
    fn user_db_spo2_samples_have_values() {
        let path = Path::new(r"D:\data_orbita\journal.sqlite");
        if !path.exists() {
            return;
        }
        let conn = Connection::open(path).expect("open user journal");
        let from = crate::journal::datetime_to_unix_beijing("2026-08-29", "22:00").expect("from");
        let to = crate::journal::datetime_to_unix_beijing("2026-08-31", "00:00").expect("to");
        let track = read_track(&conn, from, to).expect("read_track");
        let spo2 = track
            .series
            .iter()
            .find(|s| s.metric == "spo2")
            .expect("spo2 series");
        assert!(
            !spo2.samples.is_empty(),
            "expected spo2 samples in track window"
        );
        let with_v = spo2.samples.iter().filter(|s| s.v.is_some()).count();
        assert!(
            with_v > 0,
            "expected numeric spo2 values, got {} nulls",
            spo2.samples.len() - with_v
        );
    }

    #[test]
    fn sleep_block_parses_level_segments() {
        let conn = mem_conn();
        let sleep_start = 1_738_339_200_i64;
        let sleep_end = 1_738_368_000_i64;
        let wake_date = utc_to_local_date(sleep_end);
        let night_json = format!(
            r#"{{"sleep":{sleep_start},"wake":{sleep_end},"stages":{{"deep":3600,"light":7200,"rem":1800,"awake":300}},"levelSegments":[{{"start":{sleep_start},"end":{},"stage":"light"}},{{"start":{},"end":{sleep_end},"stage":"deep"}}]}}"#,
            sleep_start + 3600,
            sleep_start + 3600,
        );
        conn.execute(
            "INSERT INTO sleep_nights(id, wake_date, source, revision, night_json, content_hash, created_at_utc, updated_at_utc)
             VALUES ('id1', ?1, 'garmin', 1, ?2, 'h', 't', 't')",
            rusqlite::params![wake_date, night_json],
        )
        .expect("insert sleep");
        let track = read_track(&conn, sleep_start - 3600, sleep_end + 3600).expect("read_track");
        assert_eq!(track.sleep_blocks.len(), 1);
        let block = &track.sleep_blocks[0];
        assert_eq!(block.segments.as_ref().map(|s| s.len()), Some(2));
        assert!(block.stage_totals.is_some());
    }
}
