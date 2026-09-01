use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::{json, Map, Value};

use super::project::{
    self, snapshot_activity, snapshot_daily, snapshot_sleep, upsert_nap_row, write_outbox,
};
use super::util::{content_hash, new_uuid, utc_now};

#[derive(Debug)]
pub struct GarminSeriesInput {
    pub local_date: String,
    pub metric: String,
    pub samples: Vec<Value>,
    pub coverage: Option<f64>,
}

#[derive(Debug)]
pub struct GarminDailyInput {
    pub date: String,
    pub fetched_at: i64,
    pub data: Map<String, Value>,
}

#[derive(Debug)]
pub struct GarminRoutineInput {
    pub date: String,
    pub night: Map<String, Value>,
    pub naps: Option<Vec<Map<String, Value>>>,
}

#[derive(Debug)]
pub struct GarminExerciseInput {
    pub date: String,
    pub external_id: String,
    pub sport: String,
    pub duration: i64,
    pub metrics: Map<String, Value>,
}

#[derive(Debug)]
pub struct GarminBodyMeasurementInput {
    pub date: String,
    pub external_id: String,
    pub weight_kg: f64,
}

pub fn ingest_garmin_batch(
    tx: &Transaction<'_>,
    dailies: &[GarminDailyInput],
    routines: &[GarminRoutineInput],
    exercises: &[GarminExerciseInput],
    series: &[GarminSeriesInput],
    measurements: &[GarminBodyMeasurementInput],
) -> Result<(), String> {
    for daily in dailies {
        upsert_garmin_daily(tx, daily)?;
    }
    for routine in routines {
        upsert_garmin_routine(tx, routine)?;
    }
    for exercise in exercises {
        upsert_garmin_exercise(tx, exercise)?;
    }
    for snap in series {
        upsert_metric_snapshot(tx, snap)?;
    }
    for measurement in measurements {
        upsert_garmin_body_measurement(tx, measurement)?;
    }
    Ok(())
}

fn upsert_garmin_daily(tx: &Transaction<'_>, daily: &GarminDailyInput) -> Result<(), String> {
    let data_json = serde_json::to_string(&daily.data).map_err(|e| e.to_string())?;
    let hash = content_hash(&Value::Object(daily.data.clone()));
    let now = utc_now();
    let existing = tx
        .query_row(
            "SELECT id, content_hash, revision FROM daily_metrics WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            params![daily.date],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((id, old_hash, revision)) = existing {
        if old_hash == hash {
            tx.execute(
                "UPDATE daily_metrics SET fetched_at = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![daily.fetched_at, now, id],
            )
            .map_err(|e| e.to_string())?;
            return Ok(());
        }
        let revision = revision + 1;
        tx.execute(
            "UPDATE daily_metrics SET data_json = ?1, content_hash = ?2, revision = ?3, fetched_at = ?4, updated_at_utc = ?5, source = 'garmin' WHERE id = ?6",
            params![data_json, hash, revision, daily.fetched_at, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "daily_metrics", &id, revision, "upsert", "garmin", &snapshot_daily(tx, &id)?)?;
    } else {
        let id = new_uuid();
        tx.execute(
            "INSERT INTO daily_metrics(id, local_date, source, revision, fetched_at, data_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'garmin', 1, ?3, ?4, ?5, ?6, ?6)",
            params![id, daily.date, daily.fetched_at, data_json, hash, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "daily_metrics", &id, 1, "upsert", "garmin", &snapshot_daily(tx, &id)?)?;
    }
    Ok(())
}

fn upsert_garmin_routine(tx: &Transaction<'_>, routine: &GarminRoutineInput) -> Result<(), String> {
    let night_value = Value::Object(routine.night.clone());
    let night_json = serde_json::to_string(&night_value).map_err(|e| e.to_string())?;
    let hash = content_hash(&night_value);
    let now = utc_now();
    let existing = tx
        .query_row(
            "SELECT id, content_hash, revision FROM sleep_nights WHERE wake_date = ?1 AND deleted_at_utc IS NULL",
            params![routine.date],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let sleep_id = if let Some((id, old_hash, revision)) = existing {
        if old_hash != hash {
            let revision = revision + 1;
            tx.execute(
                "UPDATE sleep_nights SET night_json = ?1, content_hash = ?2, revision = ?3, updated_at_utc = ?4, source = 'garmin' WHERE id = ?5",
                params![night_json, hash, revision, now, id],
            )
            .map_err(|e| e.to_string())?;
            write_outbox(tx, "health", "sleep_night", &id, revision, "upsert", "garmin", &snapshot_sleep(tx, &id)?)?;
        }
        id
    } else {
        let id = new_uuid();
        tx.execute(
            "INSERT INTO sleep_nights(id, wake_date, source, revision, night_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'garmin', 1, ?3, ?4, ?5, ?5)",
            params![id, routine.date, night_json, hash, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "sleep_night", &id, 1, "upsert", "garmin", &snapshot_sleep(tx, &id)?)?;
        id
    };
    let _ = sleep_id;

    if let Some(naps) = &routine.naps {
        let mut stmt = tx
            .prepare("SELECT id FROM naps WHERE local_date = ?1 AND source = 'garmin' AND deleted_at_utc IS NULL")
            .map_err(|e| e.to_string())?;
        let old_ids: Vec<String> = stmt
            .query_map(params![routine.date], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let mut seen_keys = std::collections::HashSet::new();
        for nap_map in naps {
            let nap_value = Value::Object(nap_map.clone());
            let key = nap_external_key(&nap_value);
            seen_keys.insert(key.clone());
            let existing_id = tx
                .query_row(
                    "SELECT id, revision FROM naps WHERE local_date = ?1 AND source = 'garmin' AND external_key = ?2 AND deleted_at_utc IS NULL",
                    params![routine.date, key],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some((id, revision)) = existing_id {
                let nap_json = serde_json::to_string(&nap_value).map_err(|e| e.to_string())?;
                let old_json: String = tx
                    .query_row("SELECT nap_json FROM naps WHERE id = ?1", params![id], |row| row.get(0))
                    .map_err(|e| e.to_string())?;
                if old_json == nap_json {
                    continue;
                }
                let revision = revision + 1;
                tx.execute(
                    "UPDATE naps SET nap_json = ?1, revision = ?2, updated_at_utc = ?3 WHERE id = ?4",
                    params![nap_json, revision, now, id],
                )
                .map_err(|e| e.to_string())?;
                write_outbox(tx, "health", "nap", &id, revision, "upsert", "garmin", &project::snapshot_row(tx, "naps", "nap_json", &id)?)?;
            } else {
                let id = new_uuid();
                upsert_nap_row(tx, &id, &routine.date, &nap_value, Some(&key))?;
            }
        }
        for old_id in old_ids {
            let key: Option<String> = tx
                .query_row("SELECT external_key FROM naps WHERE id = ?1", params![old_id], |row| row.get(0))
                .optional()
                .map_err(|e| e.to_string())?;
            if key.map(|k| seen_keys.contains(&k)).unwrap_or(false) {
                continue;
            }
            project::soft_delete_row(tx, "naps", "nap", &old_id, "garmin")?;
        }
    }
    Ok(())
}

fn nap_external_key(nap: &Value) -> String {
    let start = nap.get("start").and_then(|v| v.as_i64()).unwrap_or(0);
    let end = nap.get("end").and_then(|v| v.as_i64()).unwrap_or(0);
    let dur = nap.get("duration").and_then(|v| v.as_i64()).unwrap_or(0);
    format!("garmin:{start}:{end}:{dur}")
}

fn upsert_garmin_exercise(tx: &Transaction<'_>, exercise: &GarminExerciseInput) -> Result<(), String> {
    let activity = json!({
        "sport": exercise.sport,
        "duration": exercise.duration,
        "metrics": Value::Object(exercise.metrics.clone()),
    });
    let activity_json = serde_json::to_string(&activity).map_err(|e| e.to_string())?;
    let hash = content_hash(&activity);
    let now = utc_now();
    let existing = tx
        .query_row(
            "SELECT id, content_hash, revision FROM activities WHERE external_id = ?1 AND deleted_at_utc IS NULL",
            params![exercise.external_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((id, old_hash, revision)) = existing {
        if old_hash == hash {
            return Ok(());
        }
        let revision = revision + 1;
        tx.execute(
            "UPDATE activities SET local_date = ?1, activity_json = ?2, content_hash = ?3, revision = ?4, updated_at_utc = ?5, source = 'garmin' WHERE id = ?6",
            params![exercise.date, activity_json, hash, revision, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "activity", &id, revision, "upsert", "garmin", &snapshot_activity(tx, &id)?)?;
    } else {
        let id = new_uuid();
        tx.execute(
            "INSERT INTO activities(id, local_date, source, revision, external_id, activity_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'garmin', 1, ?3, ?4, ?5, ?6, ?6)",
            params![id, exercise.date, exercise.external_id, activity_json, hash, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "activity", &id, 1, "upsert", "garmin", &snapshot_activity(tx, &id)?)?;
    }
    Ok(())
}

fn upsert_metric_snapshot(tx: &Transaction<'_>, snap: &GarminSeriesInput) -> Result<(), String> {
    const SPO2_PARSER_REV: i64 = 5;
    let payload = if snap.metric == "spo2" {
        json!({
            "samples": snap.samples,
            "coverage": snap.coverage,
            "parserRev": SPO2_PARSER_REV,
        })
    } else {
        json!({
            "samples": snap.samples,
            "coverage": snap.coverage,
        })
    };
    let snapshot_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let hash = content_hash(&payload);
    let now = utc_now();
    let existing = tx
        .query_row(
            "SELECT id, content_hash, revision FROM metric_day_snapshots WHERE local_date = ?1 AND metric_name = ?2 AND deleted_at_utc IS NULL",
            params![snap.local_date, snap.metric],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((id, old_hash, revision)) = existing {
        if old_hash == hash {
            return Ok(());
        }
        let revision = revision + 1;
        tx.execute(
            "UPDATE metric_day_snapshots SET snapshot_json = ?1, content_hash = ?2, revision = ?3, updated_at_utc = ?4, source = 'garmin' WHERE id = ?5",
            params![snapshot_json, hash, revision, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(
            tx,
            "health",
            "metric_day_snapshot",
            &id,
            revision,
            "upsert",
            "garmin",
            &project::snapshot_row(tx, "metric_day_snapshots", "snapshot_json", &id)?,
        )?;
    } else {
        let id = new_uuid();
        tx.execute(
            "INSERT INTO metric_day_snapshots(id, local_date, metric_name, source, revision, snapshot_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, ?3, 'garmin', 1, ?4, ?5, ?6, ?6)",
            params![id, snap.local_date, snap.metric, snapshot_json, hash, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(
            tx,
            "health",
            "metric_day_snapshot",
            &id,
            1,
            "upsert",
            "garmin",
            &project::snapshot_row(tx, "metric_day_snapshots", "snapshot_json", &id)?,
        )?;
    }
    Ok(())
}

fn upsert_garmin_body_measurement(
    tx: &Transaction<'_>,
    measurement: &GarminBodyMeasurementInput,
) -> Result<(), String> {
    let payload = json!({
        "weightKg": measurement.weight_kg,
        "source": "garmin",
        "externalId": measurement.external_id,
    });
    let measurement_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let hash = content_hash(&payload);
    let now = utc_now();
    let existing = tx
        .query_row(
            "SELECT id, content_hash, revision FROM body_measurements
             WHERE local_date = ?1 AND source = 'garmin' AND deleted_at_utc IS NULL",
            params![measurement.date],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((id, old_hash, revision)) = existing {
        if old_hash == hash {
            return Ok(());
        }
        let revision = revision + 1;
        tx.execute(
            "UPDATE body_measurements SET measurement_json = ?1, content_hash = ?2, revision = ?3, updated_at_utc = ?4 WHERE id = ?5",
            params![measurement_json, hash, revision, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(
            tx,
            "health",
            "body_measurement",
            &id,
            revision,
            "upsert",
            "garmin",
            &project::snapshot_row(tx, "body_measurements", "measurement_json", &id)?,
        )?;
    } else {
        let id = new_uuid();
        tx.execute(
            "INSERT INTO body_measurements(id, local_date, source, revision, measurement_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'garmin', 1, ?3, ?4, ?5, ?5)",
            params![id, measurement.date, measurement_json, hash, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(
            tx,
            "health",
            "body_measurement",
            &id,
            1,
            "upsert",
            "garmin",
            &project::snapshot_row(tx, "body_measurements", "measurement_json", &id)?,
        )?;
    }
    Ok(())
}
