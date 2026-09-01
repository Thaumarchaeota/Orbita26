use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde_json::json;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::journal_db::schema::ensure_schema;

pub fn temp_db_path() -> PathBuf {
    let mut dir = std::env::temp_dir();
    dir.push(format!("orbita-journal-db-test-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir.push("journal.sqlite");
    dir
}

pub fn open_fresh(path: &Path) -> Connection {
    if path.exists() {
        std::fs::remove_file(path).expect("remove stale db");
    }
    let conn = Connection::open(path).expect("open sqlite");
    ensure_schema(&conn, path).expect("ensure schema");
    conn
}

pub fn count_outbox(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM sync_outbox", [], |r| r.get(0))
        .expect("count outbox")
}

pub fn outbox_for_record(conn: &Connection, record_id: &str) -> Vec<(String, i64, String)> {
    let mut stmt = conn
        .prepare(
            "SELECT operation, revision, origin FROM sync_outbox WHERE record_id = ?1 ORDER BY created_at_utc",
        )
        .expect("prepare");
    let rows = stmt
        .query_map([record_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
        })
        .expect("query");
    rows.filter_map(|r| r.ok()).collect()
}

pub fn insert_manual_meal(
    tx: &rusqlite::Transaction<'_>,
    local_date: &str,
    text: &str,
    kcal: i64,
) -> String {
    let id = Uuid::new_v4().to_string();
    let now = "2026-01-01T12:00:00Z";
    let meal_json = json!({ "text": text, "kcal": kcal }).to_string();
    tx.execute(
        "INSERT INTO meals(id, local_date, source, revision, meal_json, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, 'manual', 1, ?3, ?4, ?4)",
        rusqlite::params![id, local_date, meal_json, now],
    )
    .expect("insert meal");
    let snapshot = format!(
        "{{\"id\":\"{}\",\"local_date\":\"{}\",\"text\":\"{}\",\"kcal\":{}}}",
        id, local_date, text, kcal
    );
    tx.execute(
        "INSERT INTO sync_outbox(op_id, domain, record_type, record_id, revision, operation, origin, snapshot_json, created_at_utc)
         VALUES (?1, 'health', 'meal', ?2, 1, 'upsert', 'manual', ?3, ?4)",
        rusqlite::params![Uuid::new_v4().to_string(), id, snapshot, now],
    )
    .expect("outbox meal");
    id
}

pub fn apply_garmin_daily_metrics(
    tx: &rusqlite::Transaction<'_>,
    local_date: &str,
    steps: i64,
    hydration_ml: i64,
) -> String {
    let data_json = json!({ "steps": steps, "hydrationMl": hydration_ml }).to_string();
    let hash = garmin_content_hash(&data_json);
    let existing = tx
        .query_row(
            "SELECT id, revision, content_hash FROM daily_metrics WHERE local_date = ?1 AND source = 'garmin'",
            [local_date],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)),
        )
        .optional()
        .expect("query daily");

    let now = "2026-01-01T12:00:00Z";
    if let Some((id, rev, old_hash)) = existing {
        if old_hash == hash {
            return id;
        }
        let new_rev = rev + 1;
        tx.execute(
            "UPDATE daily_metrics SET data_json = ?1, content_hash = ?2, revision = ?3, updated_at_utc = ?4 WHERE id = ?5",
            rusqlite::params![data_json, hash, new_rev, now, id],
        )
        .expect("update daily");
        let snapshot = format!(
            "{{\"id\":\"{}\",\"local_date\":\"{}\",\"steps\":{},\"hydration_ml\":{}}}",
            id, local_date, steps, hydration_ml
        );
        tx.execute(
            "INSERT INTO sync_outbox(op_id, domain, record_type, record_id, revision, operation, origin, snapshot_json, created_at_utc)
             VALUES (?1, 'health', 'daily_metrics', ?2, ?3, 'upsert', 'garmin', ?4, ?5)",
            rusqlite::params![Uuid::new_v4().to_string(), id, new_rev, snapshot, now],
        )
        .expect("outbox daily");
        id
    } else {
        let id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO daily_metrics(id, local_date, source, revision, data_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'garmin', 1, ?3, ?4, ?5, ?5)",
            rusqlite::params![id, local_date, data_json, hash, now],
        )
        .expect("insert daily");
        let snapshot = format!(
            "{{\"id\":\"{}\",\"local_date\":\"{}\",\"steps\":{},\"hydration_ml\":{}}}",
            id, local_date, steps, hydration_ml
        );
        tx.execute(
            "INSERT INTO sync_outbox(op_id, domain, record_type, record_id, revision, operation, origin, snapshot_json, created_at_utc)
             VALUES (?1, 'health', 'daily_metrics', ?2, 1, 'upsert', 'garmin', ?3, ?4)",
            rusqlite::params![Uuid::new_v4().to_string(), id, snapshot, now],
        )
        .expect("outbox daily");
        id
    }
}

pub fn garmin_content_hash(samples: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    samples.hash(&mut h);
    format!("{:016x}", h.finish())
}

pub fn apply_metric_snapshot(
    tx: &rusqlite::Transaction<'_>,
    local_date: &str,
    metric: &str,
    samples_json: &str,
) -> bool {
    let hash = garmin_content_hash(samples_json);
    let existing = tx
        .query_row(
            "SELECT id, revision, content_hash FROM metric_day_snapshots WHERE local_date = ?1 AND metric_name = ?2 AND source = 'garmin'",
            rusqlite::params![local_date, metric],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)),
        )
        .optional()
        .expect("query snapshot");

    let now = "2026-01-01T12:00:00Z";
    if let Some((id, rev, old_hash)) = existing {
        if old_hash == hash {
            return false;
        }
        let new_rev = rev + 1;
        tx.execute(
            "UPDATE metric_day_snapshots SET content_hash = ?1, snapshot_json = ?2, revision = ?3, updated_at_utc = ?4 WHERE id = ?5",
            rusqlite::params![hash, samples_json, new_rev, now, id],
        )
        .expect("update snapshot");
        let snapshot = format!(
            "{{\"id\":\"{}\",\"content_hash\":\"{}\",\"samples\":{}}}",
            id, hash, samples_json
        );
        tx.execute(
            "INSERT INTO sync_outbox(op_id, domain, record_type, record_id, revision, operation, origin, snapshot_json, created_at_utc)
             VALUES (?1, 'health', 'metric_day_snapshot', ?2, ?3, 'upsert', 'garmin', ?4, ?5)",
            rusqlite::params![Uuid::new_v4().to_string(), id, new_rev, snapshot, now],
        )
        .expect("outbox snapshot");
        true
    } else {
        let id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO metric_day_snapshots(id, local_date, metric_name, source, revision, snapshot_json, content_hash, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, ?3, 'garmin', 1, ?4, ?5, ?6, ?6)",
            rusqlite::params![id, local_date, metric, samples_json, hash, now],
        )
        .expect("insert snapshot");
        let snapshot = format!(
            "{{\"id\":\"{}\",\"content_hash\":\"{}\",\"samples\":{}}}",
            id, hash, samples_json
        );
        tx.execute(
            "INSERT INTO sync_outbox(op_id, domain, record_type, record_id, revision, operation, origin, snapshot_json, created_at_utc)
             VALUES (?1, 'health', 'metric_day_snapshot', ?2, 1, 'upsert', 'garmin', ?3, ?4)",
            rusqlite::params![Uuid::new_v4().to_string(), id, snapshot, now],
        )
        .expect("outbox snapshot");
        true
    }
}

pub fn soft_delete_meal(tx: &rusqlite::Transaction<'_>, id: &str) -> i64 {
    let rev: i64 = tx
        .query_row("SELECT revision FROM meals WHERE id = ?1", [id], |r| r.get(0))
        .expect("meal revision");
    let new_rev = rev + 1;
    let now = "2026-01-01T12:00:00Z";
    tx.execute(
        "UPDATE meals SET deleted_at_utc = ?1, revision = ?2, updated_at_utc = ?1 WHERE id = ?3",
        rusqlite::params![now, new_rev, id],
    )
    .expect("soft delete");
    tx.execute(
        "INSERT INTO sync_outbox(op_id, domain, record_type, record_id, revision, operation, origin, snapshot_json, created_at_utc)
         VALUES (?1, 'health', 'meal', ?2, ?3, 'delete', 'manual', '{}', ?4)",
        rusqlite::params![Uuid::new_v4().to_string(), id, new_rev, now],
    )
    .expect("outbox delete");
    new_rev
}

pub fn undo_soft_delete_meal(tx: &rusqlite::Transaction<'_>, id: &str) -> i64 {
    let (rev, local_date, meal_json) = tx
        .query_row(
            "SELECT revision, local_date, meal_json FROM meals WHERE id = ?1",
            [id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .expect("meal row");
    let new_rev = rev + 1;
    let now = "2026-01-01T12:00:05Z";
    tx.execute(
        "UPDATE meals SET deleted_at_utc = NULL, revision = ?1, updated_at_utc = ?2 WHERE id = ?3",
        rusqlite::params![new_rev, now, id],
    )
    .expect("undo delete");
    tx.execute(
        "INSERT INTO sync_outbox(op_id, domain, record_type, record_id, revision, operation, origin, snapshot_json, created_at_utc)
         VALUES (?1, 'health', 'meal', ?2, ?3, 'upsert', 'manual', ?4, ?5)",
        rusqlite::params![Uuid::new_v4().to_string(), id, new_rev, meal_json, now],
    )
    .expect("outbox undo");
    new_rev
}

pub fn visible_meals(conn: &Connection, local_date: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(
            "SELECT meal_json FROM meals WHERE local_date = ?1 AND deleted_at_utc IS NULL",
        )
        .expect("prepare");
    let rows = stmt
        .query_map([local_date], |r| r.get::<_, String>(0))
        .expect("query");
    rows.filter_map(|r| r.ok())
        .filter_map(|json| {
            serde_json::from_str::<serde_json::Value>(&json)
                .ok()
                .and_then(|v| v.get("text").and_then(|t| t.as_str()).map(str::to_string))
        })
        .collect()
}

pub fn project_daily_steps(conn: &Connection, local_date: &str) -> Option<i64> {
    let json: Option<String> = conn
        .query_row(
            "SELECT data_json FROM daily_metrics WHERE local_date = ?1 AND source = 'garmin' AND deleted_at_utc IS NULL",
            [local_date],
            |r| r.get(0),
        )
        .optional()
        .expect("project daily");
    json.and_then(|s| {
        serde_json::from_str::<serde_json::Value>(&s)
            .ok()
            .and_then(|v| v.get("steps").and_then(|n| n.as_i64()))
    })
}

pub fn project_routine_wake(conn: &Connection, wake_date: &str) -> Option<(i64, i64)> {
    let json: Option<String> = conn
        .query_row(
            "SELECT night_json FROM sleep_nights WHERE wake_date = ?1 AND source = 'garmin' AND deleted_at_utc IS NULL",
            [wake_date],
            |r| r.get(0),
        )
        .optional()
        .expect("project routine");
    json.and_then(|s| {
        let v: serde_json::Value = serde_json::from_str(&s).ok()?;
        let start = v.get("sleep")?.as_i64()?;
        let end = v.get("wake")?.as_i64()?;
        Some((start, end))
    })
}

pub fn has_daily_or_routine_tables(conn: &Connection) -> bool {
    let count = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('daily', 'routine')",
            [],
            |r| r.get::<_, i64>(0),
        )
        .expect("sqlite_master");
    count > 0
}

pub fn begin_tx(conn: &mut Connection) -> rusqlite::Transaction<'_> {
    conn.transaction_with_behavior(TransactionBehavior::Immediate).expect("tx")
}

pub fn cleanup(path: &Path) {
    if path.exists() {
        std::fs::remove_file(path).ok();
    }
    if let Some(parent) = path.parent() {
        std::fs::remove_dir(parent).ok();
    }
}
