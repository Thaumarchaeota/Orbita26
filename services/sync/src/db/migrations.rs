use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use fs2::FileExt;
use rusqlite::params;

use super::schema::{MIGRATION_V1, MIGRATION_V2, MIGRATION_V3, MIGRATION_V4};
use super::{utc_now, Database};

const CURRENT_VERSION: i64 = 4;
const MAX_KNOWN_VERSION: i64 = 4;

pub fn run_migrations(db: &Arc<Database>, lock_path: &Path) -> Result<()> {
    let _guard = MigrationLock::acquire(lock_path)?;
    let conn = db.conn()?;
    let applied: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if applied > MAX_KNOWN_VERSION {
        return Err(anyhow!(
            "unknown future schema version {applied}; refuse to start"
        ));
    }

    if applied < 1 {
        apply_version(&conn, 1, MIGRATION_V1)?;
    }
    if applied < 2 {
        apply_version(&conn, 2, MIGRATION_V2)?;
    }
    if applied < 3 {
        apply_version(&conn, 3, MIGRATION_V3)?;
    }
    if applied < 4 {
        apply_version(&conn, 4, MIGRATION_V4)?;
    }
    Ok(())
}

fn apply_version(conn: &rusqlite::Connection, version: i64, sql: &str) -> Result<()> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<()> {
        conn.execute_batch(sql)?;
        conn.execute(
            "INSERT INTO schema_migrations(version, applied_at_utc) VALUES (?1, ?2)",
            params![version, utc_now()],
        )?;
        Ok(())
    })();
    if result.is_err() {
        let _ = conn.execute_batch("ROLLBACK;");
        result?;
    } else {
        conn.execute_batch("COMMIT;")?;
    }
    Ok(())
}

pub fn migration_version(db: &Database) -> Result<i64> {
    let conn = db.conn()?;
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )
    .context("read migration version")
}

struct MigrationLock {
    _file: File,
}

impl MigrationLock {
    fn acquire(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(path)
            .with_context(|| format!("open migration lock {}", path.display()))?;
        file.try_lock_exclusive()
            .map_err(|e| anyhow!("migration lock held by another process: {e}"))?;
        writeln!(&file, "pid={}", std::process::id())?;
        file.sync_all()?;
        Ok(Self { _file: file })
    }
}

impl Drop for MigrationLock {
    fn drop(&mut self) {
        let _ = self._file.unlock();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::secrets::install_test_secrets;
    use crate::db::test_db;
    use tempfile::tempdir;

    #[test]
    fn migration_lock_exclusive() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("migration.lock");
        let _a = MigrationLock::acquire(&path).unwrap();
        assert!(MigrationLock::acquire(&path).is_err());
    }

    #[test]
    fn rejects_unknown_future_version() {
        install_test_secrets();
        let db = test_db();
        {
            let conn = db.conn().unwrap();
            conn.execute(
                "INSERT INTO schema_migrations(version, applied_at_utc) VALUES (99, 'now')",
                [],
            )
            .unwrap();
        }
        let dir = tempdir().unwrap();
        let lock = dir.path().join("migration.lock");
        assert!(run_migrations(&db, &lock).is_err());
    }

    #[test]
    fn applies_v2_tables() {
        install_test_secrets();
        let db = test_db();
        assert_eq!(migration_version(&db).unwrap(), CURRENT_VERSION);
        let conn = db.conn().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='work_commands'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn applies_v3_operation_events() {
        install_test_secrets();
        let db = test_db();
        assert_eq!(migration_version(&db).unwrap(), CURRENT_VERSION);
        let conn = db.conn().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='operation_events'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let has_col: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('operations') WHERE name='correlation_id'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_col, 1);
    }
}
