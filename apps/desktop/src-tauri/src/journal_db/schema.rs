use rusqlite::Connection;
use std::path::Path;

use super::util::utc_now;

pub(crate) const SCHEMA_VERSION: i32 = 1;

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS garmin_sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  fetched_at INTEGER,
  data_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS metric_day_snapshots (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  UNIQUE(local_date, metric_name)
);

CREATE TABLE IF NOT EXISTS sleep_nights (
  id TEXT PRIMARY KEY,
  wake_date TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  night_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS naps (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  external_key TEXT,
  nap_json TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS meals (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  revision INTEGER NOT NULL DEFAULT 1,
  meal_json TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  external_id TEXT,
  activity_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS body_measurements (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  measurement_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  revision INTEGER NOT NULL DEFAULT 1,
  event_json TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS moods (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  revision INTEGER NOT NULL DEFAULT 1,
  mood_json TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  revision INTEGER NOT NULL DEFAULT 1,
  note_json TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  op_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation TEXT NOT NULL,
  origin TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(local_date);
CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(local_date);
CREATE INDEX IF NOT EXISTS idx_naps_date ON naps(local_date);
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(local_date);
CREATE INDEX IF NOT EXISTS idx_activities_external ON activities(external_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(local_date);
CREATE INDEX IF NOT EXISTS idx_moods_date ON moods(local_date);
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(local_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_naps_garmin_key ON naps(source, external_key) WHERE external_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_external_unique ON activities(external_id) WHERE external_id IS NOT NULL;
"#;

fn current_version(conn: &Connection) -> Result<i32, String> {
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            |row| row.get::<_, i64>(0).map(|n| n > 0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Ok(0);
    }
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn snapshot_before_migrate(db_path: &Path, target_version: i32) -> Result<(), String> {
    if !db_path.is_file() {
        return Ok(());
    }
    let parent = db_path.parent().unwrap_or(Path::new("."));
    let file_name = db_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("journal.sqlite");
    let snap = parent.join(format!("{file_name}.pre-migrate-{target_version}"));
    if snap.exists() {
        return Ok(());
    }
    std::fs::copy(db_path, &snap).map_err(|e| format!("migration snapshot failed: {e}"))?;
    Ok(())
}

pub fn ensure_schema(conn: &Connection, db_path: &Path) -> Result<(), String> {
    let current = current_version(conn)?;
    if current >= SCHEMA_VERSION {
        return Ok(());
    }
    for version in (current + 1)..=SCHEMA_VERSION {
        snapshot_before_migrate(db_path, version)?;
        match version {
            1 => conn
                .execute_batch(MIGRATION_V1)
                .map_err(|e| format!("schema migration v1: {e}"))?,
            _ => return Err(format!("unknown schema migration {version}")),
        }
        let now = utc_now();
        conn.execute(
            "INSERT INTO schema_migrations(version, applied_at_utc) VALUES (?1, ?2)",
            rusqlite::params![version, now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
