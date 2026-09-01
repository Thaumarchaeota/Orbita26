use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::schema::ensure_schema;

static DB_CONN: Mutex<Option<Connection>> = Mutex::new(None);
static DB_ROOT: Mutex<Option<String>> = Mutex::new(None);

pub fn db_path_for_root(root: &str) -> PathBuf {
    Path::new(root).join("journal.sqlite")
}

pub fn with_connection<T>(root: &str, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let mut stored_root = DB_ROOT.lock().map_err(|e| e.to_string())?;
    let mut stored_conn = DB_CONN.lock().map_err(|e| e.to_string())?;
    if stored_root.as_deref() != Some(root) {
        *stored_conn = None;
        *stored_root = Some(root.to_string());
    }
    if stored_conn.is_none() {
        let path = db_path_for_root(root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&path).map_err(|e| format!("open journal.sqlite: {e}"))?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(|e| e.to_string())?;
        ensure_schema(&conn, &path)?;
        *stored_conn = Some(conn);
    }
    f(stored_conn.as_ref().unwrap())
}

pub fn invalidate_connection() {
    if let Ok(mut conn) = DB_CONN.lock() {
        *conn = None;
    }
    if let Ok(mut root) = DB_ROOT.lock() {
        *root = None;
    }
}
