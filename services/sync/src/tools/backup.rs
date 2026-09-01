use rusqlite::{backup::Backup, Connection, OpenFlags};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("open source: {0}")]
    OpenSource(#[from] rusqlite::Error),
    #[error("create destination: {0}")]
    CreateDest(std::io::Error),
    #[error("integrity check failed: {0}")]
    IntegrityFailed(String),
    #[error("backup step failed: {0}")]
    StepFailed(rusqlite::Error),
    #[error("destination not writable: {0}")]
    NotWritable(String),
    #[error("publish backup: {0}")]
    Publish(std::io::Error),
}

pub struct BackupOptions {
    pub pages_per_step: i32,
}

impl Default for BackupOptions {
    fn default() -> Self {
        Self { pages_per_step: 100 }
    }
}

pub fn backup_filename(prefix: &str) -> String {
    let ts = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    format!("{prefix}-{ts}.sqlite")
}

pub fn online_backup<P: AsRef<Path>, Q: AsRef<Path>>(
    source: P,
    dest: Q,
    opts: &BackupOptions,
) -> Result<(), BackupError> {
    let src = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    src.execute_batch("PRAGMA foreign_keys = ON;")?;

    if let Some(parent) = dest.as_ref().parent() {
        std::fs::create_dir_all(parent).map_err(BackupError::CreateDest)?;
    }

    let dest = dest.as_ref();
    let temp = temporary_backup_path(dest);
    let result = write_and_verify_backup(&src, &temp, opts);
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }
    // The temp file lives in the final directory, so Linux rename publishes a
    // complete, verified SQLite image atomically to readers and retention jobs.
    std::fs::rename(&temp, dest).map_err(BackupError::Publish)?;
    sync_parent_directory(dest).map_err(BackupError::Publish)?;
    Ok(())
}

fn temporary_backup_path(dest: &Path) -> PathBuf {
    let parent = dest.parent().unwrap_or_else(|| Path::new("."));
    let name = dest.file_name().and_then(|name| name.to_str()).unwrap_or("backup.sqlite");
    parent.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()))
}

fn write_and_verify_backup(src: &Connection, temp: &Path, opts: &BackupOptions) -> Result<(), BackupError> {
    let mut dst = Connection::open(temp).map_err(BackupError::OpenSource)?;
    {
        let backup = Backup::new(src, &mut dst)?;
        backup.run_to_completion(opts.pages_per_step, std::time::Duration::from_millis(100), None)
            .map_err(BackupError::StepFailed)?;
    }
    let result: String = dst.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if result != "ok" {
        return Err(BackupError::IntegrityFailed(result));
    }
    dst.close().map_err(|(_, error)| BackupError::OpenSource(error))?;
    std::fs::File::open(temp)
        .and_then(|file| file.sync_all())
        .map_err(BackupError::Publish)
}

fn sync_parent_directory(dest: &Path) -> std::io::Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn init_db(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
             INSERT INTO meta VALUES ('version', '1');",
        )
        .unwrap();
    }

    #[test]
    fn backup_roundtrip() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("source.sqlite");
        let dst = dir.path().join("backup.sqlite");
        init_db(&src);
        online_backup(&src, &dst, &BackupOptions::default()).unwrap();
        let conn = Connection::open(&dst).unwrap();
        let v: String = conn
            .query_row("SELECT value FROM meta WHERE key='version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "1");
    }
}
