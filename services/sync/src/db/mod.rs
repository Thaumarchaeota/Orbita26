pub mod migrations;
pub mod repository;
pub mod schema;

use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use rusqlite::Connection;

use crate::config::Config;

const BUSY_TIMEOUT_MS: i64 = 5000;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(config: &Config) -> Result<Arc<Self>> {
        config.ensure_dirs()?;
        let conn = Connection::open(&config.db_path)
            .with_context(|| format!("open sqlite {}", config.db_path.display()))?;
        conn.busy_timeout(std::time::Duration::from_millis(BUSY_TIMEOUT_MS as u64))?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
        )?;
        let db = Arc::new(Self {
            conn: Mutex::new(conn),
        });
        migrations::run_migrations(&db, &config.migration_lock_path)?;
        Ok(db)
    }

    pub fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|e| anyhow::anyhow!("db lock poisoned: {e}"))
    }

    pub fn in_memory() -> Result<Arc<Self>> {
        #[cfg(test)]
        crate::auth::secrets::install_test_secrets();
        let conn = Connection::open_in_memory()?;
        conn.busy_timeout(std::time::Duration::from_millis(BUSY_TIMEOUT_MS as u64))?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let db = Arc::new(Self {
            conn: Mutex::new(conn),
        });
        let lock = std::env::temp_dir().join(format!(
            "orbita-sync-test-migration-{}.lock",
            uuid::Uuid::new_v4()
        ));
        migrations::run_migrations(&db, &lock)?;
        Ok(db)
    }
}

pub fn utc_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
pub fn test_db() -> Arc<Database> {
    Database::in_memory().expect("test db")
}
