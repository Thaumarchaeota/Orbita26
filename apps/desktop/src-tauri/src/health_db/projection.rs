use chrono::{Duration, NaiveDate, TimeZone};
use rusqlite::{params, Connection};

use crate::journal_db::health_query::{
    ActivityEvent, DaySummaryCard, EnergySummary, HealthDaySummary, HealthOverviewRequest,
    HealthOverviewResponse, HealthTrackData, LocalDateRange, MealEvent,
    SleepBlock, SleepStageSegment, SleepStagePoint, SleepStageTotals, TimeSample, TrackSeries,
    TrendDayPoint, TrendPanel, TrendSeries,
};
use crate::journal_db::HealthSyncStatus;
use serde_json::{json, Value};

use super::host_lock;
use super::sync_run::read_sync_meta;
use super::util::instant_to_unix;

pub fn health_sync_status(conn: &Connection) -> Result<HealthSyncStatus, String> {
    let meta = read_sync_meta(conn).map_err(|e| e.to_string())?;
    let last_success_at = meta.get("last_success_at").and_then(|v| v.as_str()).map(str::to_string);
    let syncing = host_lock::is_active()
        || meta
            .get("syncing")
            .and_then(|v| v.as_str())
            .map(|s| s == "1" || s == "true")
            .unwrap_or(false);
    let last_error = meta.get("last_error").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_string);
    let mut earliest_local_date = meta.get("earliest_local_date").and_then(|v| v.as_str()).map(str::to_string);
    let mut latest_local_date = meta.get("latest_local_date").and_then(|v| v.as_str()).map(str::to_string);
    if earliest_local_date.is_none() || latest_local_date.is_none() {
        if let Ok((min_d, max_d)) = conn.query_row(
            "SELECT MIN(local_date), MAX(local_date) FROM health_day WHERE deleted_at_utc IS NULL",
            [],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?)),
        ) {
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

pub fn health_overview_query(conn: &Connection, req: HealthOverviewRequest) -> Result<HealthOverviewResponse, String> {
    let (from_utc, to_utc) = if req.track_from_utc > req.track_to_utc {
        (req.track_to_utc, req.track_from_utc)
    } else {
        (req.track_from_utc, req.track_to_utc)
    };
    let track = read_track(conn, from_utc, to_utc)?;
    let trends = read_trends(conn, &req.selected_date, req.trend_days)?;
    let day_summary = read_day_summary(conn, &req.selected_date, req.trend_days)?;
    let local_date_range = read_local_date_range(conn)?;
    Ok(HealthOverviewResponse {
        track,
        trends,
        day_summary,
        local_date_range,
    })
}

fn json_to_i64(v: &Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_f64().map(|n| n as i64))
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn json_to_unix_seconds(v: &Value) -> Option<i64> {
    if let Some(s) = v.as_str() {
        instant_to_unix(s).ok()
    } else {
        json_to_i64(v)
    }
}

fn json_to_f64(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_i64().map(|n| n as f64))
}

fn utc_to_local_date(ts: i64) -> String {
    let offset = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let dt = offset.timestamp_opt(ts, 0).single().unwrap_or_else(|| offset.timestamp(0, 0));
    dt.format("%Y-%m-%d").to_string()
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

fn projection_metric_to_archive(metric: &str) -> &str {
    match metric {
        "hr" => "heartRate",
        "body_battery" => "bodyBattery",
        "steps_cumulative" => "steps",
        other => other,
    }
}

fn projection_sample_series(
    conn: &Connection,
    metric: &str,
    archive_metric: &str,
    local_date: &str,
) -> Option<String> {
    match metric {
        "spo2" => {
            for candidate in ["daytime", "sleep", "default"] {
                let exists = conn
                    .query_row(
                        "SELECT 1 FROM health_sample
                         WHERE local_date = ?1 AND metric = ?2 AND series = ?3 AND deleted_at_utc IS NULL LIMIT 1",
                        params![local_date, archive_metric, candidate],
                        |_| Ok(true),
                    )
                    .unwrap_or(false);
                if exists {
                    return Some(candidate.to_string());
                }
            }
            None
        }
        _ => Some("default".to_string()),
    }
}

fn parse_samples(json_str: &str) -> Vec<TimeSample> {
    let Ok(v) = serde_json::from_str::<Value>(json_str) else {
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
                let t = obj.get("t").or_else(|| obj.get("at")).and_then(json_to_unix_seconds)?;
                let val = obj.get("v").or_else(|| obj.get("value"));
                let v = match val {
                    None | Some(Value::Null) => None,
                    Some(n) => json_to_f64(n),
                };
                let src = obj.get("src").and_then(|s| s.as_str()).map(str::to_string);
                return Some(TimeSample { t, v, src });
            }
            let pair = item.as_array()?;
            let t = pair.first().and_then(json_to_unix_seconds)?;
            let v = match pair.get(1) {
                None | Some(Value::Null) => None,
                Some(n) => json_to_f64(n),
            };
            Some(TimeSample { t, v, src: None })
        })
        .collect()
}

fn read_json_f64(conn: &Connection, date: &str, key: &str) -> Option<f64> {
    conn.query_row(
        "SELECT json_extract(data_json, ?1) FROM health_day WHERE local_date = ?2 AND deleted_at_utc IS NULL",
        params![format!("$.{key}"), date],
        |row| row.get::<_, Option<f64>>(0),
    )
    .ok()
    .flatten()
}

fn read_json_i64(conn: &Connection, date: &str, key: &str) -> Option<i64> {
    read_json_f64(conn, date, key).map(|v| v as i64)
}

fn read_local_date_range(conn: &Connection) -> Result<Option<LocalDateRange>, String> {
    Ok(conn
        .query_row(
            "SELECT MIN(local_date), MAX(local_date) FROM health_day WHERE deleted_at_utc IS NULL",
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

fn read_track(conn: &Connection, from_utc: i64, to_utc: i64) -> Result<HealthTrackData, String> {
    let from_date = utc_to_local_date(from_utc);
    let to_date = utc_to_local_date(to_utc);
    let mut sleep_blocks = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, night_json, source FROM health_sleep_night
             WHERE deleted_at_utc IS NULL AND wake_local_date >= ?1 AND wake_local_date <= ?2",
        )
        .map_err(|e| e.to_string())?;
    for row in stmt
        .query_map(params![from_date, to_date], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })
        .map_err(|e| e.to_string())?
    {
        let (id, night_json, source) = row.map_err(|e| e.to_string())?;
        let night: Value = serde_json::from_str(&night_json).unwrap_or(json!({}));
        let start = night.get("sleep").and_then(json_to_i64).unwrap_or(0);
        let end = night.get("wake").and_then(json_to_i64).unwrap_or(0);
        if end > from_utc && start < to_utc {
            sleep_blocks.push(SleepBlock {
                id,
                start_utc: start,
                end_utc: end,
                is_nap: false,
                score: night.get("score").and_then(json_to_i64).map(|v| v as i32),
                source,
                segments: night.get("levelSegments").and_then(parse_sleep_level_segments),
                stage_totals: night.get("stages").and_then(parse_sleep_stage_totals),
            });
        }
    }
    let mut nap_stmt = conn
        .prepare(
            "SELECT id, nap_json, source FROM health_nap
             WHERE deleted_at_utc IS NULL AND wake_local_date >= ?1 AND wake_local_date <= ?2",
        )
        .map_err(|e| e.to_string())?;
    for row in nap_stmt
        .query_map(params![from_date, to_date], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })
        .map_err(|e| e.to_string())?
    {
        let (id, nap_json, source) = row.map_err(|e| e.to_string())?;
        let nap: Value = serde_json::from_str(&nap_json).unwrap_or(json!({}));
        let start = nap.get("start").and_then(json_to_i64).unwrap_or(0);
        let end = nap.get("end").and_then(json_to_i64).unwrap_or(0);
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
    let metric_names = ["hr", "hrv", "spo2", "respiration", "stress", "body_battery", "steps_cumulative"];
    let mut series = Vec::new();
    for metric in metric_names {
        let archive_metric = projection_metric_to_archive(metric);
        let mut samples = Vec::new();
        let mut snap_stmt = conn
            .prepare(
                "SELECT local_date, series, snapshot_json FROM health_sample
                 WHERE metric = ?1 AND local_date >= ?2 AND local_date <= ?3 AND deleted_at_utc IS NULL",
            )
            .map_err(|e| e.to_string())?;
        for row in snap_stmt
            .query_map(params![archive_metric, from_date, to_date], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
        {
            let (local_date, series, json_str) = row.map_err(|e| e.to_string())?;
            let expected = projection_sample_series(conn, metric, archive_metric, &local_date);
            if expected.as_deref() != Some(series.as_str()) {
                continue;
            }
            for s in parse_samples(&json_str) {
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
            "SELECT id, started_at_utc, ended_at_utc, type_key, title, duration_seconds,
                    distance_meters
             FROM health_activity
             WHERE deleted_at_utc IS NULL AND local_date >= ?1 AND local_date <= ?2",
        )
        .map_err(|e| e.to_string())?;
    for row in act_stmt
        .query_map(params![from_date, to_date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<f64>>(5)?,
                row.get::<_, Option<f64>>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?
    {
        let (id, started_at, ended_at, type_key, title, duration_seconds, distance_meters) =
            row.map_err(|e| e.to_string())?;
        if type_key.as_deref() == Some("e_bike_fitness") {
            continue;
        }
        let start = started_at
            .as_deref()
            .and_then(|s| instant_to_unix(s).ok())
            .unwrap_or(0);
        let end_utc = ended_at
            .as_deref()
            .and_then(|s| instant_to_unix(s).ok());
        let duration_sec = duration_seconds.map(|d| d.round() as i32);
        activities.push(ActivityEvent {
            id,
            start_utc: start,
            end_utc,
            activity_type: type_key,
            name: title,
            distance_m: distance_meters,
            duration_sec,
        });
    }
    let mut meals = Vec::new();
    let meal_snapshots = crate::health_db::repository::list_meals(conn, Some(&from_date), Some(&to_date), false)
        .map_err(|e| e.to_string())?;
    for m in meal_snapshots {
        let local_date = crate::health_db::util::local_date_from_instant(&m.started_at).unwrap_or_default();
        // SPEC-0009: the legacy startedAt date anchor does not assert an exact
        // meal time. Date-only meals remain in lists, outside all hour tracks.
        let occurred = m.at_hm.as_deref().filter(|hm|!hm.trim().is_empty())
            .and_then(|hm|crate::journal::datetime_to_unix_beijing(&local_date,hm).ok());
        if let Some(occurred) = occurred {
            if occurred >= from_utc && occurred < to_utc {
                let description = m
                    .title
                    .or(m.text)
                    .filter(|s| !s.trim().is_empty());
                meals.push(MealEvent {
                    id: m.id,
                    occurred_at_utc: occurred,
                    meal_type: m.slot,
                    icon_key: m.icon_key,
                    description,
                    kcal: m.meal_kcal,
                });
            }
        }
    }
    Ok(HealthTrackData {
        sleep_blocks,
        series,
        activities,
        meals,
    })
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
        let start = item.get("start").and_then(json_to_i64)?;
        let end = item.get("end").and_then(json_to_i64)?;
        let stage = item.get("stage").and_then(|x| x.as_str())?;
        if end > start {
            out.push(SleepStageSegment {
                start_utc: start,
                end_utc: end,
                stage: stage.to_string(),
            });
        }
    }
    if out.is_empty() { None } else { Some(out) }
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

fn read_daily_metric(conn: &Connection, dates: &[String], key: &str) -> Result<Vec<TrendDayPoint>, String> {
    let mut points = Vec::new();
    for date in dates {
        points.push(TrendDayPoint {
            date: date.clone(),
            value: read_json_f64(conn, date, key),
        });
    }
    Ok(points)
}

fn read_snapshot_metric_avg(conn: &Connection, date: &str, metric: &str) -> Option<f64> {
    let archive_metric = projection_metric_to_archive(metric);
    let series = projection_sample_series(conn, metric, archive_metric, date)?;
    let json: String = conn
        .query_row(
            "SELECT snapshot_json FROM health_sample
             WHERE local_date = ?1 AND metric = ?2 AND series = ?3 AND deleted_at_utc IS NULL",
            params![date, archive_metric, series],
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

fn read_snapshot_metric_trend(conn: &Connection, dates: &[String], metric: &str) -> Result<Vec<TrendDayPoint>, String> {
    let mut points = Vec::new();
    for date in dates {
        points.push(TrendDayPoint {
            date: date.clone(),
            value: read_snapshot_metric_avg(conn, date, metric),
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
                "SELECT night_json FROM health_sleep_night WHERE wake_local_date = ?1 AND deleted_at_utc IS NULL LIMIT 1",
                params![date],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|night_json| serde_json::from_str(&night_json).ok());
        stages.push(if let Some(night) = night {
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
        });
    }
    Ok(stages)
}

fn read_sleep_duration_trend(conn: &Connection, dates: &[String]) -> Result<Vec<TrendDayPoint>, String> {
    let mut points = Vec::new();
    for date in dates {
        let value = conn
            .query_row(
                "SELECT night_json FROM health_sleep_night WHERE wake_local_date = ?1 AND deleted_at_utc IS NULL LIMIT 1",
                params![date],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|night_json| {
                let night: Value = serde_json::from_str(&night_json).ok()?;
                let start = night.get("sleep").and_then(json_to_i64)?;
                let end = night.get("wake").and_then(json_to_i64)?;
                Some((end - start).max(0) as f64)
            });
        points.push(TrendDayPoint { date: date.clone(), value });
    }
    Ok(points)
}

fn read_weight_for_date(conn: &Connection, date: &str) -> Option<f64> {
    read_json_f64(conn, date, "weightKg")
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
    crate::health_db::repository::sum_meal_kcal_for_date(conn, date)
        .ok()
        .and_then(|(count, sum)| if count > 0 { sum } else { None })
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

fn metric_ever_seen(conn: &Connection, key: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM health_day WHERE json_extract(data_json, ?1) IS NOT NULL AND deleted_at_utc IS NULL LIMIT 1",
        params![format!("$.{key}")],
        |_| Ok(true),
    )
    .unwrap_or(false)
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
    let burn_pts = read_daily_metric(conn, &dates, "totalCalories")?;
    let energy_pts = read_meal_energy_trend(conn, &dates)?;
    let prev_weight = read_weight_trend(conn, &prev_dates)?;
    let prev_burn = read_daily_metric(conn, &prev_dates, "totalCalories")?;
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
    let water_pts = read_daily_metric(conn, &dates, "hydrationMl")?;
    let prev_water = read_daily_metric(conn, &prev_dates, "hydrationMl")?;
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

fn read_day_summary(conn: &Connection, selected_date: &str, trend_days: u32) -> Result<HealthDaySummary, String> {
    let steps = read_json_i64(conn, selected_date, "steps");
    let rhr = read_json_i64(conn, selected_date, "restingHr");
    let water = read_json_i64(conn, selected_date, "hydrationMl");
    let burn = read_json_i64(conn, selected_date, "totalCalories");
    let data: Value = conn
        .query_row(
            "SELECT data_json FROM health_day WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            params![selected_date],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or(json!({}));
    let bb_low = data.get("bodyBattery").and_then(|b| b.get("low")).and_then(json_to_i64).map(|v| v as i32);
    let bb_high = data.get("bodyBattery").and_then(|b| b.get("high")).and_then(json_to_i64).map(|v| v as i32);
    let weight = read_weight_for_date(conn, selected_date);
    let spo2 = data.get("spo2Avg").and_then(json_to_f64);
    let sleep_night: Option<(i64, i64, Option<i32>)> = conn
        .query_row(
            "SELECT night_json FROM health_sleep_night WHERE wake_local_date = ?1 AND deleted_at_utc IS NULL LIMIT 1",
            params![selected_date],
            |row| {
                let night_json: String = row.get(0)?;
                let night: Value = serde_json::from_str(&night_json).unwrap_or(json!({}));
                let start = night.get("sleep").and_then(json_to_i64).unwrap_or(0);
                let end = night.get("wake").and_then(json_to_i64).unwrap_or(0);
                let score = night.get("score").and_then(json_to_i64).map(|v| v as i32);
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
                .query_row("SELECT 1 FROM health_sleep_night WHERE deleted_at_utc IS NULL LIMIT 1", [], |_| Ok(true))
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
            ever_seen: metric_ever_seen(conn, "weightKg"),
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
    let dates = date_range(selected_date, trend_days);
    let mut days_with_meals = 0u32;
    for date in &dates {
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM health_meal WHERE local_date = ?1 AND deleted_at_utc IS NULL",
                params![date],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if count > 0 {
            days_with_meals += 1;
        }
    }
    let (meal_count, intake_kcal) =
        crate::health_db::repository::sum_meal_kcal_for_date(conn, selected_date).unwrap_or((0, None));
    let meal_count = meal_count as u32;
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

fn utc_to_local_time(ts: i64) -> String {
    let offset = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let dt = offset.timestamp_opt(ts, 0).single().unwrap_or_else(|| offset.timestamp(0, 0));
    dt.format("%H:%M").to_string()
}
