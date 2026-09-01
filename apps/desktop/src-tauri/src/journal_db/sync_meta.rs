use rusqlite::{params, Connection};
use tauri::AppHandle;

use super::open_db;

pub fn set_garmin_sync_meta(conn: &Connection, updates: &[(&str, &str)]) -> Result<(), String> {
    for (key, value) in updates {
        conn.execute(
            "INSERT INTO garmin_sync_meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn set_garmin_sync_meta_app(app: &AppHandle, updates: &[(&str, &str)]) -> Result<(), String> {
    let conn = open_db(app)?;
    set_garmin_sync_meta(&conn, updates)
}
