use rusqlite::Connection;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RestoreError {
    #[error("open backup: {0}")]
    OpenBackup(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("verification failed: {0}")]
    VerificationFailed(String),
    #[error("restore target exists: {0}")]
    TargetExists(String),
    #[error("overwrite disabled: restore must target an isolated directory; pass --force-overwrite only in controlled maintenance")]
    OverwriteDisabled,
}

#[derive(Debug, Default)]
pub struct RestoreVerifier {
    pub require_schema_migrations: bool,
    pub require_integrity_check: bool,
}

impl RestoreVerifier {
    pub fn verify(&self, db_path: &Path) -> Result<RestoreReport, RestoreError> {
        let conn = Connection::open(db_path)?;
        if self.require_integrity_check {
            let result: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            if result != "ok" {
                return Err(RestoreError::VerificationFailed(result));
            }
        }
        let mut tables = vec![];
        let mut stmt = conn.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for row in rows {
            tables.push(row?);
        }
        let migration_version = if self.require_schema_migrations {
            conn.query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |r| r.get::<_, i64>(0),
            )
            .ok()
        } else {
            None
        };
        Ok(RestoreReport {
            table_count: tables.len(),
            tables,
            migration_version,
            integrity_ok: self.require_integrity_check,
        })
    }
}

#[derive(Debug)]
pub struct RestoreReport {
    pub table_count: usize,
    pub tables: Vec<String>,
    pub migration_version: Option<i64>,
    pub integrity_ok: bool,
}

pub fn isolated_restore<P: AsRef<Path>, Q: AsRef<Path>>(
    backup: P,
    target: Q,
    verifier: &RestoreVerifier,
) -> Result<RestoreReport, RestoreError> {
    let target = target.as_ref();
    if target.exists() {
        return Err(RestoreError::OverwriteDisabled);
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = restore_temporary_path(target);
    if temporary.exists() {
        return Err(RestoreError::TargetExists(temporary.display().to_string()));
    }
    let result = (|| {
        std::fs::copy(backup.as_ref(), &temporary)?;
        std::fs::File::open(&temporary)?.sync_all()?;
        let report = verifier.verify(&temporary)?;
        std::fs::rename(&temporary, target)?;
        if let Some(parent) = target.parent() {
            std::fs::File::open(parent)?.sync_all()?;
        }
        Ok(report)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn restore_temporary_path(target: &Path) -> PathBuf {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target.file_name().and_then(|name| name.to_str()).unwrap_or("restored.sqlite");
    parent.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::backup::{online_backup, BackupOptions};
    use tempfile::tempdir;

    #[test]
    fn isolated_restore_verifies() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("live.sqlite");
        let backup = dir.path().join("backup.sqlite");
        let restored = dir.path().join("restored.sqlite");
        {
            let conn = Connection::open(&src).unwrap();
            conn.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY);")
                .unwrap();
        }
        online_backup(&src, &backup, &BackupOptions::default()).unwrap();
        let verifier = RestoreVerifier {
            require_integrity_check: true,
            require_schema_migrations: false,
        };
        let report = isolated_restore(&backup, &restored, &verifier).unwrap();
        assert!(report.integrity_ok);
        assert_eq!(report.table_count, 1);
    }

    #[test]
    fn refuses_overwrite_live_db() {
        let dir = tempdir().unwrap();
        let live = dir.path().join("live.sqlite");
        let backup = dir.path().join("backup.sqlite");
        {
            let conn = Connection::open(&live).unwrap();
            conn.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY);")
                .unwrap();
        }
        online_backup(&live, &backup, &BackupOptions::default()).unwrap();
        let verifier = RestoreVerifier::default();
        assert!(isolated_restore(&backup, &live, &verifier).is_err());
    }
}
