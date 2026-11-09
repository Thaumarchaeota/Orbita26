// Archive SQLite lifecycle per docs/adr/0018-local-archive-sqlite-lifecycle.md
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use super::error::{DomainError, DomainResult};
use super::schema::{ensure_schema, integrity_check, read_schema_version, CURRENT_SCHEMA_VERSION};

struct CoordinatorState {
    data_dir: Option<String>,
    conn: Option<Connection>,
    switching: bool,
    active_ops: u32,
    // ADR 0018: integrity latch is scoped to the data_dir that failed, not global.
    failed_data_dir: Option<String>,
    // Runtime-only token/version: snapshots and Panel writes reject stale A→B→A views without schema changes (SPEC-0008 §5).
    data_dir_epoch: u64,
    change_version: u64,
}

static COORDINATOR: Mutex<CoordinatorState> = Mutex::new(CoordinatorState {
    data_dir: None,
    conn: None,
    switching: false,
    active_ops: 0,
    failed_data_dir: None,
    data_dir_epoch: 0,
    change_version: 0,
});
static COORDINATOR_CV: Condvar = Condvar::new();
static INVALIDATION_APP: Mutex<Option<AppHandle>> = Mutex::new(None);
thread_local! { static PANEL_WRITE_TOKEN: std::cell::RefCell<Option<(String, u64)>> = const { std::cell::RefCell::new(None) }; }
struct PanelTokenReset(Option<(String, u64)>);
impl Drop for PanelTokenReset {
    fn drop(&mut self) { PANEL_WRITE_TOKEN.with(|slot| { slot.replace(self.0.take()); }); }
}

pub fn set_invalidation_app(app: AppHandle) {
    if let Ok(mut current) = INVALIDATION_APP.lock() { *current = Some(app); }
}

pub fn with_panel_write_token<T>(root: &str, epoch: u64, f: impl FnOnce() -> DomainResult<T>) -> DomainResult<T> {
    // Existing domain handlers acquire this coordinator lock themselves; thread-local context binds their actual writer lock without nesting it.
    PANEL_WRITE_TOKEN.with(|slot| {
        let previous = slot.replace(Some((root.to_string(), epoch)));
        let _reset = PanelTokenReset(previous);
        let out = f();
        out
    })
}

fn validate_panel_token(state: &CoordinatorState, root: &str) -> DomainResult<()> {
    PANEL_WRITE_TOKEN.with(|slot| {
        if let Some((expected_root, expected_epoch)) = slot.borrow().as_ref() {
            if expected_root != root || state.data_dir_epoch != *expected_epoch || state.data_dir.as_deref().is_some_and(|active| active != root) {
                return Err(DomainError::archive_lifecycle("dataDir changed while Panel request was pending"));
            }
        }
        Ok(())
    })
}

fn publish_change(root: String, epoch: u64, version: u64) {
    // Notify after the coordinator lock is released; the event carries invalidation metadata only (SPEC-0008 §5).
    if let Ok(app) = INVALIDATION_APP.lock() {
        if let Some(app) = app.as_ref() {
            let _ = app.emit("productivity-data-invalidated", serde_json::json!({"dataDir":root,"dataDirEpoch":epoch,"changeVersion":version,"changedKinds":["productivity"]}));
        }
    }
}

const SWITCH_WAIT: Duration = Duration::from_secs(30);

pub fn archive_root(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("archive")
}

pub fn db_path(data_dir: &str) -> PathBuf {
    archive_root(data_dir).join("archive.sqlite")
}

fn apply_conn_pragmas(conn: &Connection) -> DomainResult<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 0;")
        .map_err(map_sqlite_err)
}

fn map_sqlite_err(e: rusqlite::Error) -> DomainError {
    let msg = e.to_string();
    if msg.contains("database is locked") || msg.contains("SQLITE_BUSY") {
        DomainError::archive_lifecycle(format!("archive database locked by another process: {msg}"))
    } else {
        DomainError::archive_lifecycle(msg)
    }
}

fn latch_integrity_failure(state: &mut CoordinatorState) {
    state.failed_data_dir = state.data_dir.clone();
    state.conn = None;
}

fn integrity_latched_for(state: &CoordinatorState, data_dir: &str) -> bool {
    state.failed_data_dir.as_deref() == Some(data_dir)
}

fn validate_expected_data_dir(state: &CoordinatorState, expected_data_dir: &str) -> DomainResult<()> {
    if state
        .data_dir
        .as_deref()
        .is_some_and(|active| active != expected_data_dir)
    {
        return Err(DomainError::archive_lifecycle(
            "dataDir changed while request was running",
        ));
    }
    Ok(())
}

fn validate_for_read(conn: &Connection) -> DomainResult<()> {
    integrity_check(conn)?;
    match read_schema_version(conn)? {
        None => Err(DomainError::archive_lifecycle(
            "archive file exists but is not initialized (failed or orphan artifact)",
        )),
        Some(v) if v > CURRENT_SCHEMA_VERSION => Err(DomainError::archive_lifecycle(
            "archive schema is newer than this application supports",
        )),
        Some(_) => Ok(()),
    }
}

fn open_existing_for_read(path: &Path) -> DomainResult<Connection> {
    let conn = Connection::open(path).map_err(map_sqlite_err)?;
    apply_conn_pragmas(&conn)?;
    if let Err(e) = validate_for_read(&conn) {
        return Err(e);
    }
    Ok(conn)
}

fn open_for_write(path: &Path) -> DomainResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    let existed = path.exists();
    let conn = Connection::open(path).map_err(map_sqlite_err)?;
    apply_conn_pragmas(&conn)?;
    if !existed {
        if let Err(e) = super::schema::initialize_fresh(&conn) {
            let _ = std::fs::remove_file(path);
            return Err(e);
        }
    } else {
        integrity_check(&conn)?;
        match read_schema_version(&conn)? {
            None => {
                return Err(DomainError::archive_lifecycle(
                    "archive file exists but is not initialized (failed or orphan artifact)",
                ))
            }
            Some(v) if v > CURRENT_SCHEMA_VERSION => {
                return Err(DomainError::archive_lifecycle(
                    "archive schema is newer than this application supports",
                ))
            }
            Some(v) if v < CURRENT_SCHEMA_VERSION => ensure_schema(&conn, path)?,
            Some(_) => {}
        }
    }
    Ok(conn)
}

struct ActiveOpGuard;

impl ActiveOpGuard {
    fn enter() -> DomainResult<Self> {
        let mut state = COORDINATOR
            .lock()
            .map_err(|_| DomainError::archive_busy())?;
        if state.switching {
            return Err(DomainError::archive_busy());
        }
        state.active_ops += 1;
        Ok(ActiveOpGuard)
    }
}

impl Drop for ActiveOpGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = COORDINATOR.lock() {
            state.active_ops = state.active_ops.saturating_sub(1);
            COORDINATOR_CV.notify_all();
        }
    }
}

fn sync_conn(state: &mut CoordinatorState, data_dir: &str, write: bool) -> DomainResult<Option<()>> {
    if state.data_dir.as_deref() != Some(data_dir) {
        if state.data_dir.is_some() { state.data_dir_epoch = state.data_dir_epoch.wrapping_add(1); }
        state.conn = None;
        state.data_dir = Some(data_dir.to_string());
    }
    let path = db_path(data_dir);
    if write {
        if let Some(conn) = state.conn.as_ref() {
            match read_schema_version(conn)? {
                Some(v) if v < CURRENT_SCHEMA_VERSION => state.conn = None,
                _ => {}
            }
        }
        if state.conn.is_some() {
            return Ok(Some(()));
        }
        match open_for_write(&path) {
            Ok(conn) => {
                state.conn = Some(conn);
                Ok(Some(()))
            }
            Err(e) => {
                if path.exists() {
                    latch_integrity_failure(state);
                }
                Err(e)
            }
        }
    } else {
        // A newer binary's first Health read must apply pending migrations.
        // Otherwise list queries select columns that only exist after V5.
        if let Some(conn) = state.conn.as_ref() {
            match read_schema_version(conn)? {
                Some(v) if v < CURRENT_SCHEMA_VERSION => state.conn = None,
                _ => {}
            }
        }
        if state.conn.is_some() {
            return Ok(Some(()));
        }
        if !path.exists() {
            return Ok(None);
        }
        let needs_migrate = {
            let probe = Connection::open(&path).map_err(map_sqlite_err)?;
            apply_conn_pragmas(&probe)?;
            match read_schema_version(&probe)? {
                Some(v) if v < CURRENT_SCHEMA_VERSION => true,
                _ => false,
            }
        };
        let opened = if needs_migrate {
            open_for_write(&path)
        } else {
            open_existing_for_read(&path)
        };
        match opened {
            Ok(conn) => {
                state.conn = Some(conn);
                Ok(Some(()))
            }
            Err(e) => {
                latch_integrity_failure(state);
                Err(e)
            }
        }
    }
}

pub fn with_read<T>(data_dir: &str, f: impl FnOnce(Option<&Connection>) -> DomainResult<T>) -> DomainResult<T> {
    let _guard = ActiveOpGuard::enter()?;
    let mut state = COORDINATOR
        .lock()
        .map_err(|_| DomainError::archive_busy())?;
    if integrity_latched_for(&state, data_dir) {
        return Err(DomainError::archive_lifecycle(
            "archive integrity failure latched; reads and writes refused",
        ));
    }
    if state.switching {
        return Err(DomainError::archive_busy());
    }
    let ready = sync_conn(&mut state, data_dir, false)?;
    let out = match ready {
        None => f(None),
        Some(()) => f(Some(state.conn.as_ref().unwrap())),
    };
    drop(state);
    out
}

pub fn with_snapshot<T>(data_dir: &str, f: impl FnOnce(Option<&Connection>, u64, u64) -> DomainResult<T>) -> DomainResult<T> {
    let _guard = ActiveOpGuard::enter()?;
    let mut state = COORDINATOR.lock().map_err(|_| DomainError::archive_busy())?;
    if integrity_latched_for(&state, data_dir) { return Err(DomainError::archive_lifecycle("archive integrity failure latched; reads and writes refused")); }
    if state.switching { return Err(DomainError::archive_busy()); }
    if state.data_dir.as_deref().is_some_and(|active| active != data_dir) { return Err(DomainError::archive_lifecycle("dataDir changed while snapshot was pending")); }
    let ready = sync_conn(&mut state, data_dir, false)?;
    f(if ready.is_some() { state.conn.as_ref() } else { None }, state.data_dir_epoch, state.change_version)
}

pub fn with_write<T>(data_dir: &str, f: impl FnOnce(&Connection) -> DomainResult<T>) -> DomainResult<T> {
    let _guard = ActiveOpGuard::enter()?;
    let mut state = COORDINATOR
        .lock()
        .map_err(|_| DomainError::archive_busy())?;
    if integrity_latched_for(&state, data_dir) {
        return Err(DomainError::archive_lifecycle(
            "archive integrity failure latched; reads and writes refused",
        ));
    }
    if state.switching {
        return Err(DomainError::archive_busy());
    }
    validate_panel_token(&state, data_dir)?;
    sync_conn(&mut state, data_dir, true)?;
    let conn = state.conn.as_ref().unwrap();
    validate_panel_token(&state, data_dir)?;
    let out = f(conn);
    let changed = if out.is_ok() { state.change_version = state.change_version.wrapping_add(1); Some((state.data_dir.clone().unwrap_or_else(|| data_dir.to_string()), state.data_dir_epoch, state.change_version)) } else { None };
    drop(state);
    if let Some((root, epoch, version)) = changed { publish_change(root, epoch, version); }
    out
}

/// Run a write only if the coordinator is still bound to the root captured by
/// the request. The check and callback share the coordinator lock, so a
/// dataDir switch cannot slip between validation and commit (ADR 0018).
pub fn with_write_expected<T>(
    expected_data_dir: &str,
    f: impl FnOnce(&Connection) -> DomainResult<T>,
) -> DomainResult<T> {
    let _guard = ActiveOpGuard::enter()?;
    let mut state = COORDINATOR
        .lock()
        .map_err(|_| DomainError::archive_busy())?;
    if integrity_latched_for(&state, expected_data_dir) {
        return Err(DomainError::archive_lifecycle(
            "archive integrity failure latched; reads and writes refused",
        ));
    }
    if state.switching {
        return Err(DomainError::archive_busy());
    }
    validate_expected_data_dir(&state, expected_data_dir)?;
    validate_panel_token(&state, expected_data_dir)?;
    sync_conn(&mut state, expected_data_dir, true)?;
    let conn = state.conn.as_ref().unwrap();
    let out = f(conn);
    let changed = if out.is_ok() { state.change_version = state.change_version.wrapping_add(1); Some((state.data_dir.clone().unwrap_or_else(|| expected_data_dir.to_string()), state.data_dir_epoch, state.change_version)) } else { None };
    drop(state);
    if let Some((root, epoch, version)) = changed { publish_change(root, epoch, version); }
    out
}

/// SPEC-0009 browse path: never creates files, changes journal mode or upgrades.
/// The coordinator lock and operation guard keep this snapshot inside one root lifecycle.
pub fn with_strict_read<T>(data_dir: &str, f: impl FnOnce(Option<&Connection>) -> DomainResult<T>) -> DomainResult<T> {
    let _guard = ActiveOpGuard::enter()?;
    let state = COORDINATOR.lock().map_err(|_| DomainError::archive_busy())?;
    validate_expected_data_dir(&state, data_dir)?;
    if state.switching { return Err(DomainError::archive_busy()); }
    if integrity_latched_for(&state, data_dir) { return Err(DomainError::archive_lifecycle("archive integrity failure latched")); }
    let path = db_path(data_dir);
    if !path.exists() { return f(None); }
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(map_sqlite_err)?;
    integrity_check(&conn)?;
    if read_schema_version(&conn)? != Some(CURRENT_SCHEMA_VERSION) {
        return Err(DomainError::archive_lifecycle("请显式启用健康事件以初始化或升级 Archive"));
    }
    f(Some(&conn))
}

pub fn switch_data_dir(new_data_dir: &str) -> DomainResult<()> {
    // ADR 0018: switching away from a latched root is allowed; latch stays on the old data_dir only.
    let mut state = COORDINATOR
        .lock()
        .map_err(|_| DomainError::archive_busy())?;
    if state.switching {
        return Err(DomainError::archive_busy());
    }
    state.switching = true;
    let deadline = Instant::now() + SWITCH_WAIT;
    loop {
        if state.active_ops == 0 {
            break;
        }
        if Instant::now() >= deadline {
            state.switching = false;
            return Err(DomainError::archive_busy());
        }
        state = COORDINATOR_CV
            .wait_timeout(state, Duration::from_millis(50))
            .map_err(|_| {
                if let Ok(mut s) = COORDINATOR.lock() {
                    s.switching = false;
                }
                DomainError::archive_busy()
            })?
            .0;
    }
    state.conn = None;
    if state.data_dir.as_deref() != Some(new_data_dir) { state.data_dir_epoch = state.data_dir_epoch.wrapping_add(1); }
    state.data_dir = Some(new_data_dir.to_string());
    state.switching = false;
    Ok(())
}

#[cfg(test)]
mod expected_root_tests {
    use super::{validate_expected_data_dir, CoordinatorState};

    fn state_at(root: Option<&str>) -> CoordinatorState {
        CoordinatorState {
            data_dir: root.map(str::to_owned),
            conn: None,
            switching: false,
            active_ops: 0,
            failed_data_dir: None,
            data_dir_epoch: 0,
            change_version: 0,
        }
    }

    #[test]
    fn stale_request_root_is_rejected_after_switch() {
        assert!(validate_expected_data_dir(&state_at(Some("B")), "A").is_err());
        assert!(validate_expected_data_dir(&state_at(Some("B")), "B").is_ok());
        assert!(validate_expected_data_dir(&state_at(None), "A").is_ok());
    }
}

pub fn in_transaction<T>(
    conn: &Connection,
    f: impl FnOnce(&rusqlite::Transaction) -> DomainResult<T>,
) -> DomainResult<T> {
    let tx = conn
        .unchecked_transaction()
        .map_err(map_sqlite_err)?;
    let out = f(&tx)?;
    tx.commit().map_err(map_sqlite_err)?;
    Ok(out)
}
