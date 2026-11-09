use rusqlite::{params, Connection, Transaction};
use serde_json::{json, Map, Value};
use chrono::Datelike;
use std::collections::HashSet;

use super::{
    JournalDeleteRequest, JournalListRequest, JournalListResponse, JournalUpsertRequest,
    JournalUpsertResponse,
};

use super::util::{content_hash, dates_in_range, new_uuid, normalize_id, utc_now, year_from_date};
use super::with_connection;

pub fn journal_list(root: &str, req: JournalListRequest) -> Result<JournalListResponse, String> {
    with_connection(root, |conn| list_entries(conn, &req))
}

pub fn journal_upsert(root: &str, req: JournalUpsertRequest) -> Result<JournalUpsertResponse, String> {
    with_connection(root, |conn| {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("begin transaction: {e}"))?;
        let entry = upsert_entry(&tx, req.entry)?;
        tx.commit().map_err(|e| format!("commit transaction: {e}"))?;
        Ok(JournalUpsertResponse { entry })
    })
}

pub fn journal_delete(root: &str, req: JournalDeleteRequest) -> Result<(), String> {
    let id = normalize_id(&req.id);
    if id.is_empty() {
        return Err("id required".into());
    }
    with_connection(root, |conn| {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("begin transaction: {e}"))?;
        soft_delete_by_id(&tx, &id)?;
        tx.commit().map_err(|e| format!("commit transaction: {e}"))?;
        Ok(())
    })
}

fn list_entries(conn: &Connection, req: &JournalListRequest) -> Result<JournalListResponse, String> {
    let dates = resolve_query_dates(req)?;
    let mut out = Vec::new();
    for date in dates {
        out.extend(project_day(conn, &date)?);
    }
    Ok(JournalListResponse { entries: out })
}

fn resolve_query_dates(req: &JournalListRequest) -> Result<Vec<String>, String> {
    if let Some(ref d) = req.date {
        return Ok(vec![d.clone()]);
    }
    if let (Some(ref f), Some(ref t)) = (&req.from, &req.to) {
        return dates_in_range(f, t);
    }
    let tz = chrono::FixedOffset::east_opt(8 * 3600).ok_or("tz")?;
    let y = chrono::Utc::now()
        .with_timezone(&tz)
        .format("%Y")
        .to_string()
        .parse::<i32>()
        .map_err(|_| "invalid year")?;
    let mut dates = Vec::new();
    for m in 1..=12 {
        let days = days_in_month(y, m);
        for d in 1..=days {
            dates.push(format!("{y:04}-{m:02}-{d:02}"));
        }
    }
    Ok(dates)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    use chrono::NaiveDate;
    if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
            .and_then(|d| d.pred_opt())
            .map(|d| d.day())
            .unwrap_or(31)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
            .and_then(|d| d.pred_opt())
            .map(|d| d.day())
            .unwrap_or(30)
    }
}

fn project_day(conn: &Connection, date: &str) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    if let Some(daily) = project_daily(conn, date)? {
        out.push(daily);
    }
    if let Some(routine) = project_routine(conn, date)? {
        out.push(routine);
    }
    out.extend(project_rows(conn, "activities", date, "exercise", |row| {
        let id: String = row.get(0)?;
        let local_date: String = row.get(1)?;
        let source: String = row.get(2)?;
        let activity_json: String = row.get(3)?;
        let external_id: Option<String> = row.get(4)?;
        let data: Value = serde_json::from_str(&activity_json).unwrap_or(json!({}));
        let mut entry = json!({
            "id": id,
            "kind": "exercise",
            "date": local_date,
            "source": source,
            "data": data,
        });
        if let Some(ext) = external_id {
            entry["externalId"] = json!(ext);
        }
        if let Some(sport) = data.get("sport").cloned() {
            entry["data"]["sport"] = sport;
        }
        Ok(entry)
    })?);
    out.extend(project_rows(conn, "events", date, "event", |row| {
        let id: String = row.get(0)?;
        let local_date: String = row.get(1)?;
        let event_json: String = row.get(2)?;
        let payload: Value = serde_json::from_str(&event_json).unwrap_or(json!({}));
        Ok(json!({
            "id": id,
            "kind": "event",
            "date": local_date,
            "at": payload.get("at").cloned().unwrap_or(Value::Null),
            "remark": payload.get("remark").cloned().unwrap_or(Value::Null),
        }))
    })?);
    out.extend(project_rows(conn, "moods", date, "mood", |row| {
        let id: String = row.get(0)?;
        let local_date: String = row.get(1)?;
        let mood_json: String = row.get(2)?;
        let payload: Value = serde_json::from_str(&mood_json).unwrap_or(json!({}));
        Ok(json!({
            "id": id,
            "kind": "mood",
            "date": local_date,
            "primary": payload.get("primary").cloned().unwrap_or(json!(false)),
            "data": payload.get("data").cloned().unwrap_or(json!({})),
        }))
    })?);
    out.extend(project_rows(conn, "notes", date, "note", |row| {
        let id: String = row.get(0)?;
        let local_date: String = row.get(1)?;
        let note_json: String = row.get(2)?;
        let payload: Value = serde_json::from_str(&note_json).unwrap_or(json!({}));
        Ok(json!({
            "id": id,
            "kind": "note",
            "date": local_date,
            "title": payload.get("title").cloned().unwrap_or(Value::Null),
            "body": payload.get("body").cloned().unwrap_or(json!("")),
            "at": payload.get("at").cloned().unwrap_or(Value::Null),
        }))
    })?);
    Ok(out)
}

fn project_rows<F>(conn: &Connection, table: &str, date: &str, _kind: &str, map: F) -> Result<Vec<Value>, String>
where
    F: Fn(&rusqlite::Row<'_>) -> Result<Value, rusqlite::Error>,
{
    let sql = match table {
        "activities" => "SELECT id, local_date, source, activity_json, external_id FROM activities WHERE local_date = ?1 AND deleted_at_utc IS NULL",
        "events" => "SELECT id, local_date, event_json FROM events WHERE local_date = ?1 AND deleted_at_utc IS NULL",
        "moods" => "SELECT id, local_date, mood_json FROM moods WHERE local_date = ?1 AND deleted_at_utc IS NULL",
        "notes" => "SELECT id, local_date, note_json FROM notes WHERE local_date = ?1 AND deleted_at_utc IS NULL",
        _ => return Err(format!("unknown table {table}")),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![date], map)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn project_daily(conn: &Connection, date: &str) -> Result<Option<Value>, String> {
    let row = conn
        .query_row(
            "SELECT id, source, fetched_at, data_json FROM daily_metrics WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            params![date],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((id, source, fetched_at, data_json)) = row else {
        return Ok(None);
    };
    let mut data: Map<String, Value> = serde_json::from_str(&data_json).unwrap_or_default();
    data.remove("meals");
    let mut entry = json!({
        "id": id,
        "kind": "daily",
        "date": date,
        "data": Value::Object(data),
    });
    if source == "garmin" {
        entry["source"] = json!("garmin");
        if let Some(fa) = fetched_at {
            entry["fetchedAt"] = json!(fa);
        }
    }
    Ok(Some(entry))
}

fn project_routine(conn: &Connection, date: &str) -> Result<Option<Value>, String> {
    let night_row = conn
        .query_row(
            "SELECT id, night_json FROM sleep_nights WHERE wake_date = ?1 AND deleted_at_utc IS NULL",
            params![date],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let naps = load_naps(conn, date)?;
    if night_row.is_none() && naps.is_empty() {
        return Ok(None);
    }
    let (id, night_json) = night_row.unwrap_or_else(|| (String::new(), "{}".to_string()));
    let night: Value = serde_json::from_str(&night_json).unwrap_or(json!({}));
    let id = if id.is_empty() {
        naps_anchor_id(conn, date)?
    } else {
        id
    };
    Ok(Some(json!({
        "id": id,
        "kind": "routine",
        "date": date,
        "tz": "Asia/Shanghai",
        "data": {
            "night": night,
            "naps": naps,
        }
    })))
}

fn naps_anchor_id(conn: &Connection, date: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT id FROM naps WHERE local_date = ?1 AND deleted_at_utc IS NULL LIMIT 1",
        params![date],
        |row| row.get(0),
    )
    .map_err(|_| format!("no routine anchor for {date}"))
}

fn load_naps(conn: &Connection, date: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT nap_json FROM naps WHERE local_date = ?1 AND deleted_at_utc IS NULL ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![date], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let raw: String = row.map_err(|e| e.to_string())?;
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            out.push(v);
        }
    }
    Ok(out)
}

fn upsert_entry(tx: &Transaction<'_>, mut entry: Value) -> Result<Value, String> {
    let kind = entry
        .get("kind")
        .and_then(|k| k.as_str())
        .ok_or("entry.kind required")?
        .to_string();
    let date = entry
        .get("date")
        .and_then(|d| d.as_str())
        .ok_or("entry.date required")?
        .to_string();
    year_from_date(&date)?;

    match kind.as_str() {
        "daily" => upsert_daily(tx, &date, &mut entry),
        "routine" => upsert_routine(tx, &date, &mut entry),
        "exercise" => upsert_exercise(tx, &date, &mut entry),
        "event" => upsert_simple(tx, "events", "event", &date, &mut entry, |e| {
            json!({
                "at": e.get("at").cloned().unwrap_or(Value::Null),
                "remark": e.get("remark").cloned().unwrap_or(Value::Null),
            })
        }),
        "mood" => {
            let primary = entry.get("primary").and_then(|p| p.as_bool()).unwrap_or(false);
            if primary {
                clear_primary_mood(tx, &date)?;
            } else if let Some(obj) = entry.as_object_mut() {
                obj.insert("primary".into(), Value::Bool(false));
            }
            upsert_simple(tx, "moods", "mood", &date, &mut entry, |e| {
                json!({
                    "primary": e.get("primary").cloned().unwrap_or(json!(false)),
                    "data": e.get("data").cloned().unwrap_or(json!({})),
                })
            })
        }
        "note" => upsert_simple(tx, "notes", "note", &date, &mut entry, |e| {
            json!({
                "title": e.get("title").cloned().unwrap_or(Value::Null),
                "body": e.get("body").cloned().unwrap_or(json!("")),
                "at": e.get("at").cloned().unwrap_or(Value::Null),
            })
        }),
        _ => Err(format!("unsupported kind: {kind}")),
    }
}

fn upsert_daily(tx: &Transaction<'_>, date: &str, entry: &mut Value) -> Result<Value, String> {
    let data = entry
        .get("data")
        .and_then(|d| d.as_object())
        .cloned()
        .unwrap_or_default();
    if data.contains_key("meals") {
        let meals = data
            .get("meals")
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default();
        sync_meals(tx, date, &meals)?;
    }

    let projected = project_daily(tx, date)?
        .ok_or_else(|| "daily projection failed".to_string())?;
    *entry = projected.clone();
    Ok(projected)
}

fn upsert_manual_daily_metrics(
    tx: &Transaction<'_>,
    id: &str,
    date: &str,
    data: &Map<String, Value>,
) -> Result<(), String> {
    let now = utc_now();
    let data_json = serde_json::to_string(data).map_err(|e| e.to_string())?;
    let hash = content_hash(&Value::Object(data.clone()));
    let existing = tx
        .query_row(
            "SELECT revision, deleted_at_utc FROM daily_metrics WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((revision, deleted)) = existing {
        let revision = revision + 1;
        let deleted_clause = if deleted.is_some() { ", deleted_at_utc = NULL" } else { "" };
        tx.execute(
            &format!(
                "UPDATE daily_metrics SET data_json = ?1, content_hash = ?2, revision = ?3, updated_at_utc = ?4, source = 'manual'{deleted_clause} WHERE id = ?5"
            ),
            params![data_json, hash, revision, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "daily_metrics", id, revision, "upsert", "manual", &snapshot_daily(tx, id)?)?;
    } else {
        tx.execute(
            "INSERT INTO daily_metrics(id, local_date, source, revision, fetched_at, data_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'manual', 1, NULL, ?3, ?4, ?5, ?5)",
            params![id, date, data_json, hash, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "daily_metrics", id, 1, "upsert", "manual", &snapshot_daily(tx, id)?)?;
    }
    Ok(())
}

fn ensure_daily_anchor(tx: &Transaction<'_>, date: &str) -> Result<String, String> {
    if let Some(id) = tx
        .query_row(
            "SELECT id FROM daily_metrics WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            params![date],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        return Ok(id);
    }
    let id = new_uuid();
    let now = utc_now();
    let data_json = "{}";
    let hash = content_hash(&json!({}));
    tx.execute(
        "INSERT INTO daily_metrics(id, local_date, source, revision, fetched_at, data_json, content_hash, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, 'manual', 1, NULL, ?3, ?4, ?5, ?5)",
        params![id, date, data_json, hash, now],
    )
    .map_err(|e| e.to_string())?;
    write_outbox(tx, "health", "daily_metrics", &id, 1, "upsert", "manual", &snapshot_daily(tx, &id)?)?;
    Ok(id)
}

fn sync_meals(tx: &Transaction<'_>, date: &str, meals: &[Value]) -> Result<(), String> {
    if !meals.is_empty() {
        ensure_daily_anchor(tx, date)?;
    }
    let mut keep = HashSet::new();
    for meal in meals {
        let meal_id = meal
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(normalize_id)
            .unwrap_or_else(new_uuid);
        keep.insert(meal_id.clone());
        upsert_meal_row(tx, &meal_id, date, meal)?;
    }
    let mut stmt = tx
        .prepare("SELECT id FROM meals WHERE local_date = ?1 AND source = 'manual' AND deleted_at_utc IS NULL")
        .map_err(|e| e.to_string())?;
    let existing: Vec<String> = stmt
        .query_map(params![date], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for id in existing {
        if !keep.contains(&id) {
            soft_delete_row(tx, "meals", "meal", &id, "manual")?;
        }
    }
    Ok(())
}

fn upsert_meal_row(tx: &Transaction<'_>, id: &str, date: &str, meal: &Value) -> Result<(), String> {
    let now = utc_now();
    let meal_json = serde_json::to_string(meal).map_err(|e| e.to_string())?;
    let existing = tx
        .query_row(
            "SELECT revision, deleted_at_utc FROM meals WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((revision, deleted)) = existing {
        let revision = revision + 1;
        let deleted_clause = if deleted.is_some() { ", deleted_at_utc = NULL" } else { "" };
        tx.execute(
            &format!(
                "UPDATE meals SET meal_json = ?1, local_date = ?2, revision = ?3, updated_at_utc = ?4{deleted_clause} WHERE id = ?5"
            ),
            params![meal_json, date, revision, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "meal", id, revision, "upsert", "manual", &snapshot_row(tx, "meals", "meal_json", id)?)?;
    } else {
        tx.execute(
            "INSERT INTO meals(id, local_date, source, revision, meal_json, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'manual', 1, ?3, ?4, ?4)",
            params![id, date, meal_json, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "meal", id, 1, "upsert", "manual", &snapshot_row(tx, "meals", "meal_json", id)?)?;
    }
    Ok(())
}

fn upsert_routine(tx: &Transaction<'_>, date: &str, entry: &mut Value) -> Result<Value, String> {
    let data = entry.get("data").and_then(|d| d.as_object()).cloned().unwrap_or_default();
    if let Some(night) = data.get("night") {
        upsert_sleep_night_manual(tx, date, entry, night)?;
    }
    if let Some(naps) = data.get("naps").and_then(|n| n.as_array()) {
        sync_manual_naps(tx, date, naps)?;
    }
    let projected = project_routine(tx, date)?
        .ok_or_else(|| "routine projection failed".to_string())?;
    *entry = projected.clone();
    Ok(projected)
}

fn upsert_sleep_night_manual(tx: &Transaction<'_>, date: &str, entry: &mut Value, night: &Value) -> Result<(), String> {
    if night.get("source").and_then(|s| s.as_str()) == Some("garmin") {
        return Err("cannot overwrite garmin night sleep".into());
    }
    let now = utc_now();
    let night_json = serde_json::to_string(night).map_err(|e| e.to_string())?;
    let hash = content_hash(night);
    let existing = tx
        .query_row(
            "SELECT id, source, revision, deleted_at_utc FROM sleep_nights WHERE wake_date = ?1 AND deleted_at_utc IS NULL",
            params![date],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let id = if let Some((id, source, revision, deleted)) = existing {
        if source == "garmin" {
            return Err("cannot overwrite garmin night sleep".into());
        }
        let revision = revision + 1;
        let deleted_clause = if deleted.is_some() { ", deleted_at_utc = NULL" } else { "" };
        tx.execute(
            &format!(
                "UPDATE sleep_nights SET night_json = ?1, content_hash = ?2, revision = ?3, updated_at_utc = ?4{deleted_clause} WHERE id = ?5"
            ),
            params![night_json, hash, revision, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "sleep_night", &id, revision, "upsert", "manual", &snapshot_sleep(tx, &id)?)?;
        id
    } else {
        let id = entry
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(normalize_id)
            .unwrap_or_else(new_uuid);
        tx.execute(
            "INSERT INTO sleep_nights(id, wake_date, source, revision, night_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'manual', 1, ?3, ?4, ?5, ?5)",
            params![id, date, night_json, hash, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "sleep_night", &id, 1, "upsert", "manual", &snapshot_sleep(tx, &id)?)?;
        id
    };
    entry["id"] = json!(id);
    Ok(())
}

fn sync_manual_naps(tx: &Transaction<'_>, date: &str, naps: &[Value]) -> Result<(), String> {
    let mut keep = HashSet::new();
    for nap in naps {
        if nap.get("source").and_then(|s| s.as_str()) == Some("garmin") {
            continue;
        }
        let nap_id = nap
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(normalize_id)
            .unwrap_or_else(new_uuid);
        keep.insert(nap_id.clone());
        upsert_nap_row(tx, &nap_id, date, nap, None)?;
    }
    let mut stmt = tx
        .prepare("SELECT id FROM naps WHERE local_date = ?1 AND source = 'manual' AND deleted_at_utc IS NULL")
        .map_err(|e| e.to_string())?;
    let existing: Vec<String> = stmt
        .query_map(params![date], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for id in existing {
        if !keep.contains(&id) {
            soft_delete_row(tx, "naps", "nap", &id, "manual")?;
        }
    }
    Ok(())
}

pub(crate) fn upsert_nap_row(
    tx: &Transaction<'_>,
    id: &str,
    date: &str,
    nap: &Value,
    external_key: Option<&str>,
) -> Result<(), String> {
    let now = utc_now();
    let source = nap.get("source").and_then(|s| s.as_str()).unwrap_or("manual");
    let nap_json = serde_json::to_string(nap).map_err(|e| e.to_string())?;
    let existing = tx
        .query_row(
            "SELECT revision, deleted_at_utc FROM naps WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((revision, deleted)) = existing {
        let revision = revision + 1;
        let deleted_clause = if deleted.is_some() { ", deleted_at_utc = NULL" } else { "" };
        tx.execute(
            &format!(
                "UPDATE naps SET nap_json = ?1, local_date = ?2, source = ?3, external_key = ?4, revision = ?5, updated_at_utc = ?6{deleted_clause} WHERE id = ?7"
            ),
            params![nap_json, date, source, external_key, revision, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "nap", id, revision, "upsert", source, &snapshot_row(tx, "naps", "nap_json", id)?)?;
    } else {
        tx.execute(
            "INSERT INTO naps(id, local_date, source, revision, external_key, nap_json, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?6)",
            params![id, date, source, external_key, nap_json, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "nap", id, 1, "upsert", source, &snapshot_row(tx, "naps", "nap_json", id)?)?;
    }
    Ok(())
}

fn upsert_exercise(tx: &Transaction<'_>, date: &str, entry: &mut Value) -> Result<Value, String> {
    if entry.get("source").and_then(|s| s.as_str()) == Some("garmin") {
        return Err("garmin exercise must use garmin ingest".into());
    }
    let id = ensure_entry_id(entry);
    let data = entry.get("data").cloned().unwrap_or(json!({}));
    let external_id = entry.get("externalId").and_then(|v| v.as_str()).map(str::to_string);
    let activity_json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    let hash = content_hash(&data);
    let now = utc_now();
    let existing = tx
        .query_row(
            "SELECT revision, deleted_at_utc, source FROM activities WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((revision, deleted, source)) = existing {
        if source == "garmin" {
            return Err("cannot overwrite garmin activity".into());
        }
        let revision = revision + 1;
        let deleted_clause = if deleted.is_some() { ", deleted_at_utc = NULL" } else { "" };
        tx.execute(
            &format!(
                "UPDATE activities SET local_date = ?1, external_id = ?2, activity_json = ?3, content_hash = ?4, revision = ?5, updated_at_utc = ?6{deleted_clause} WHERE id = ?7"
            ),
            params![date, external_id, activity_json, hash, revision, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "activity", &id, revision, "upsert", "manual", &snapshot_activity(tx, &id)?)?;
    } else if let Some(ext) = external_id.as_deref() {
        let by_ext = tx
            .query_row(
                "SELECT id, revision, deleted_at_utc, source FROM activities WHERE external_id = ?1 AND deleted_at_utc IS NULL",
                params![ext],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((existing_id, revision, deleted, source)) = by_ext {
            if source == "garmin" {
                return Err("cannot overwrite garmin activity".into());
            }
            entry["id"] = json!(existing_id);
            let revision = revision + 1;
            let deleted_clause = if deleted.is_some() { ", deleted_at_utc = NULL" } else { "" };
            tx.execute(
                &format!(
                    "UPDATE activities SET local_date = ?1, activity_json = ?2, content_hash = ?3, revision = ?4, updated_at_utc = ?5{deleted_clause} WHERE id = ?6"
                ),
                params![date, activity_json, hash, revision, now, existing_id],
            )
            .map_err(|e| e.to_string())?;
            write_outbox(tx, "health", "activity", &existing_id, revision, "upsert", "manual", &snapshot_activity(tx, &existing_id)?)?;
            return Ok(entry.clone());
        }
        tx.execute(
            "INSERT INTO activities(id, local_date, source, revision, external_id, activity_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'manual', 1, ?3, ?4, ?5, ?6, ?6)",
            params![id, date, ext, activity_json, hash, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "activity", &id, 1, "upsert", "manual", &snapshot_activity(tx, &id)?)?;
    } else {
        tx.execute(
            "INSERT INTO activities(id, local_date, source, revision, external_id, activity_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'manual', 1, NULL, ?3, ?4, ?5, ?5)",
            params![id, date, activity_json, hash, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "health", "activity", &id, 1, "upsert", "manual", &snapshot_activity(tx, &id)?)?;
    }
    Ok(entry.clone())
}

fn upsert_simple<F>(
    tx: &Transaction<'_>,
    table: &str,
    record_type: &str,
    date: &str,
    entry: &mut Value,
    payload_fn: F,
) -> Result<Value, String>
where
    F: Fn(&Value) -> Value,
{
    let id = ensure_entry_id(entry);
    let payload = payload_fn(entry);
    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let now = utc_now();
    let json_col = match table {
        "events" => "event_json",
        "moods" => "mood_json",
        "notes" => "note_json",
        _ => return Err(format!("unknown table {table}")),
    };
    let existing = tx
        .query_row(
            &format!("SELECT revision, deleted_at_utc FROM {table} WHERE id = ?1"),
            params![id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let domain = if table == "events" || table == "moods" || table == "notes" {
        "journal"
    } else {
        "health"
    };
    if let Some((revision, deleted)) = existing {
        let revision = revision + 1;
        let deleted_clause = if deleted.is_some() { ", deleted_at_utc = NULL" } else { "" };
        tx.execute(
            &format!(
                "UPDATE {table} SET {json_col} = ?1, local_date = ?2, revision = ?3, updated_at_utc = ?4{deleted_clause} WHERE id = ?5"
            ),
            params![payload_json, date, revision, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, domain, record_type, &id, revision, "upsert", "manual", &snapshot_row(tx, table, json_col, &id)?)?;
    } else {
        tx.execute(
            &format!(
                "INSERT INTO {table}(id, local_date, source, revision, {json_col}, created_at_utc, updated_at_utc)
                 VALUES (?1, ?2, 'manual', 1, ?3, ?4, ?4)"
            ),
            params![id, date, payload_json, now],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, domain, record_type, &id, 1, "upsert", "manual", &snapshot_row(tx, table, json_col, &id)?)?;
    }
    entry["id"] = json!(id);
    Ok(entry.clone())
}

fn ensure_entry_id(entry: &mut Value) -> String {
    let id = entry
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(normalize_id)
        .unwrap_or_else(new_uuid);
    entry["id"] = json!(id);
    id
}

fn clear_primary_mood(tx: &Transaction<'_>, date: &str) -> Result<(), String> {
    let mut stmt = tx
        .prepare("SELECT id, mood_json FROM moods WHERE local_date = ?1 AND deleted_at_utc IS NULL")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![date], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, mood_json) = row.map_err(|e| e.to_string())?;
        let mut payload: Value = serde_json::from_str(&mood_json).unwrap_or(json!({}));
        if payload.get("primary").and_then(|p| p.as_bool()) != Some(true) {
            continue;
        }
        payload["primary"] = json!(false);
        let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        let now = utc_now();
        let revision: i64 = tx
            .query_row("SELECT revision FROM moods WHERE id = ?1", params![id], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|e| e.to_string())?
            + 1;
        tx.execute(
            "UPDATE moods SET mood_json = ?1, revision = ?2, updated_at_utc = ?3 WHERE id = ?4",
            params![payload_json, revision, now, id],
        )
        .map_err(|e| e.to_string())?;
        write_outbox(tx, "journal", "mood", &id, revision, "upsert", "manual", &snapshot_row(tx, "moods", "mood_json", &id)?)?;
    }
    Ok(())
}

fn soft_delete_by_id(tx: &Transaction<'_>, id: &str) -> Result<(), String> {
    let tables: [(&str, &str, &str); 9] = [
        ("daily_metrics", "daily_metrics", "health"),
        ("sleep_nights", "sleep_night", "health"),
        ("meals", "meal", "health"),
        ("naps", "nap", "health"),
        ("activities", "activity", "health"),
        ("body_measurements", "body_measurement", "health"),
        ("events", "event", "journal"),
        ("moods", "mood", "journal"),
        ("notes", "note", "journal"),
    ];
    for (table, record_type, domain) in tables {
        if soft_delete_row_if_exists(tx, table, record_type, domain, id)? {
            return Ok(());
        }
    }
    Err("entry not found".into())
}

fn soft_delete_row_if_exists(
    tx: &Transaction<'_>,
    table: &str,
    record_type: &str,
    domain: &str,
    id: &str,
) -> Result<bool, String> {
    let source: Option<String> = tx
        .query_row(
            &format!("SELECT source FROM {table} WHERE id = ?1 AND deleted_at_utc IS NULL"),
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(source) = source else {
        return Ok(false);
    };
    if source == "garmin" {
        return Err("cannot delete garmin record".into());
    }
    soft_delete_row(tx, table, record_type, id, &source)?;
    let _ = domain;
    Ok(true)
}

pub(crate) fn soft_delete_row(
    tx: &Transaction<'_>,
    table: &str,
    record_type: &str,
    id: &str,
    origin: &str,
) -> Result<(), String> {
    let now = utc_now();
    let revision: i64 = tx
        .query_row(
            &format!("SELECT revision FROM {table} WHERE id = ?1"),
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        + 1;
    tx.execute(
        &format!(
            "UPDATE {table} SET deleted_at_utc = ?1, revision = ?2, updated_at_utc = ?1 WHERE id = ?3"
        ),
        params![now, revision, id],
    )
    .map_err(|e| e.to_string())?;
    let json_col = match table {
        "meals" => "meal_json",
        "naps" => "nap_json",
        "activities" => "activity_json",
        "events" => "event_json",
        "moods" => "mood_json",
        "notes" => "note_json",
        "daily_metrics" => "data_json",
        "sleep_nights" => "night_json",
        "body_measurements" => "measurement_json",
        _ => return Err(format!("unknown table {table}")),
    };
    let domain = if table == "events" || table == "moods" || table == "notes" {
        "journal"
    } else {
        "health"
    };
    let snapshot = snapshot_row(tx, table, json_col, id)?;
    write_outbox(tx, domain, record_type, id, revision, "delete", origin, &snapshot)?;
    Ok(())
}

pub(crate) fn write_outbox(
    tx: &Transaction<'_>,
    domain: &str,
    record_type: &str,
    record_id: &str,
    revision: i64,
    operation: &str,
    origin: &str,
    snapshot: &Value,
) -> Result<(), String> {
    let op_id = new_uuid();
    let now = utc_now();
    let snapshot_json = serde_json::to_string(snapshot).map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO sync_outbox(op_id, domain, record_type, record_id, revision, operation, origin, snapshot_json, created_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            op_id,
            domain,
            record_type,
            record_id,
            revision,
            operation,
            origin,
            snapshot_json,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn snapshot_row(tx: &Transaction<'_>, table: &str, json_col: &str, id: &str) -> Result<Value, String> {
    let sql = format!(
        "SELECT id, local_date, source, revision, {json_col}, created_at_utc, updated_at_utc, deleted_at_utc FROM {table} WHERE id = ?1"
    );
    tx.query_row(&sql, params![id], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "localDate": row.get::<_, String>(1)?,
            "source": row.get::<_, String>(2)?,
            "revision": row.get::<_, i64>(3)?,
            "payload": serde_json::from_str::<Value>(&row.get::<_, String>(4)?).unwrap_or(json!({})),
            "createdAtUtc": row.get::<_, String>(5)?,
            "updatedAtUtc": row.get::<_, String>(6)?,
            "deletedAtUtc": row.get::<_, Option<String>>(7)?,
        }))
    })
    .map_err(|e| e.to_string())
}

pub(crate) fn snapshot_daily(tx: &Transaction<'_>, id: &str) -> Result<Value, String> {
    tx.query_row(
        "SELECT id, local_date, source, revision, fetched_at, data_json, created_at_utc, updated_at_utc, deleted_at_utc
         FROM daily_metrics WHERE id = ?1",
        params![id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "localDate": row.get::<_, String>(1)?,
                "source": row.get::<_, String>(2)?,
                "revision": row.get::<_, i64>(3)?,
                "fetchedAt": row.get::<_, Option<i64>>(4)?,
                "data": serde_json::from_str::<Value>(&row.get::<_, String>(5)?).unwrap_or(json!({})),
                "createdAtUtc": row.get::<_, String>(6)?,
                "updatedAtUtc": row.get::<_, String>(7)?,
                "deletedAtUtc": row.get::<_, Option<String>>(8)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

pub(crate) fn snapshot_sleep(tx: &Transaction<'_>, id: &str) -> Result<Value, String> {
    tx.query_row(
        "SELECT id, wake_date, source, revision, night_json, created_at_utc, updated_at_utc, deleted_at_utc
         FROM sleep_nights WHERE id = ?1",
        params![id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "wakeDate": row.get::<_, String>(1)?,
                "source": row.get::<_, String>(2)?,
                "revision": row.get::<_, i64>(3)?,
                "night": serde_json::from_str::<Value>(&row.get::<_, String>(4)?).unwrap_or(json!({})),
                "createdAtUtc": row.get::<_, String>(5)?,
                "updatedAtUtc": row.get::<_, String>(6)?,
                "deletedAtUtc": row.get::<_, Option<String>>(7)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

pub(crate) fn snapshot_activity(tx: &Transaction<'_>, id: &str) -> Result<Value, String> {
    tx.query_row(
        "SELECT id, local_date, source, revision, external_id, activity_json, created_at_utc, updated_at_utc, deleted_at_utc
         FROM activities WHERE id = ?1",
        params![id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "localDate": row.get::<_, String>(1)?,
                "source": row.get::<_, String>(2)?,
                "revision": row.get::<_, i64>(3)?,
                "externalId": row.get::<_, Option<String>>(4)?,
                "activity": serde_json::from_str::<Value>(&row.get::<_, String>(5)?).unwrap_or(json!({})),
                "createdAtUtc": row.get::<_, String>(6)?,
                "updatedAtUtc": row.get::<_, String>(7)?,
                "deletedAtUtc": row.get::<_, Option<String>>(8)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

use rusqlite::OptionalExtension;
