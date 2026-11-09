use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::error::{
    GarminSyncError, GarminSyncResult, GARMIN_RATE_LIMIT_COOLDOWN_ACTIVE,
    GARMIN_RATE_LIMIT_LATCHED, GARMIN_RATE_LIMIT_RESTORE_NOT_USER, GARMIN_RATE_LIMIT_RESTORE_STALE,
    GARMIN_RATE_LIMIT_UNKNOWN,
};
use super::types::{GateSnapshot, GATE_FILE_NAME, GATE_INITIALIZED_NAME, GATE_LOCK_NAME};

pub const STATE_OPEN: &str = "open";
pub const STATE_CLOSED: &str = "closed";
pub const STATE_CLOSED_UNKNOWN: &str = "closed_unknown";
pub const GATE_SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GateFileJson {
    schema_version: i32,
    state: String,
    generation: i64,
    latched_at_utc: Option<String>,
    cooldown_until_utc: Option<String>,
    last_status: Option<i64>,
    released_at_utc: Option<String>,
}

impl From<GateFileJson> for GateSnapshot {
    fn from(v: GateFileJson) -> Self {
        Self {
            schema_version: v.schema_version,
            state: v.state,
            generation: v.generation,
            latched_at_utc: v.latched_at_utc,
            cooldown_until_utc: v.cooldown_until_utc,
            last_status: v.last_status,
            released_at_utc: v.released_at_utc,
        }
    }
}

impl From<&GateSnapshot> for GateFileJson {
    fn from(v: &GateSnapshot) -> Self {
        Self {
            schema_version: v.schema_version,
            state: v.state.clone(),
            generation: v.generation,
            latched_at_utc: v.latched_at_utc.clone(),
            cooldown_until_utc: v.cooldown_until_utc.clone(),
            last_status: v.last_status,
            released_at_utc: v.released_at_utc.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct GateStore {
    dir: PathBuf,
    /// True after a successful parse of an existing file. A later disappearance is closed_unknown.
    file_seen: bool,
    snapshot: GateSnapshot,
}

pub fn closed_unknown_snapshot() -> GateSnapshot {
    GateSnapshot {
        schema_version: GATE_SCHEMA_VERSION,
        state: STATE_CLOSED_UNKNOWN.to_string(),
        generation: 0,
        latched_at_utc: None,
        cooldown_until_utc: None,
        last_status: None,
        released_at_utc: None,
    }
}

fn closed_unknown(generation: i64) -> GateSnapshot {
    let mut snapshot = closed_unknown_snapshot();
    snapshot.generation = generation;
    snapshot
}

fn open_initial() -> GateSnapshot {
    GateSnapshot {
        schema_version: GATE_SCHEMA_VERSION,
        state: STATE_OPEN.to_string(),
        generation: 1,
        latched_at_utc: None,
        cooldown_until_utc: None,
        last_status: None,
        released_at_utc: None,
    }
}

fn utc_now() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

pub fn gate_path(app_data_dir: &Path) -> PathBuf {
    // App-global next to bootstrap.json, not dataDir and not the token directory.
    // docs/specs/garmin-sync-workflow.proposed.md §20
    app_data_dir.join(GATE_FILE_NAME)
}

static GATE_MUTEX: Mutex<()> = Mutex::new(());

struct GateFileLock {
    file: File,
    _process_guard: MutexGuard<'static, ()>,
}
impl GateFileLock {
    fn acquire(dir: &Path) -> Result<Self, String> {
        let process_guard = GATE_MUTEX.lock().map_err(|_| "Garmin gate mutex poisoned".to_string())?;
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let file = OpenOptions::new().read(true).write(true).create(true)
            .open(dir.join(GATE_LOCK_NAME)).map_err(|e| e.to_string())?;
        if !lock_gate_file(&file) { return Err("could not lock Garmin gate".into()); }
        Ok(Self { file, _process_guard: process_guard })
    }
}
impl Drop for GateFileLock {
    fn drop(&mut self) { unlock_gate_file(&self.file); }
}

#[cfg(windows)]
fn lock_gate_file(file: &File) -> bool {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)] struct Overlapped { internal: usize, internal_high: usize, offset: u32, offset_high: u32, h_event: *mut core::ffi::c_void }
    extern "system" { fn LockFileEx(hfile: *mut core::ffi::c_void, flags: u32, reserved: u32, low: u32, high: u32, overlapped: *mut Overlapped) -> i32; }
    let mut ov = Overlapped { internal:0, internal_high:0, offset:0, offset_high:0, h_event:std::ptr::null_mut() };
    unsafe { LockFileEx(file.as_raw_handle() as *mut _, 2, 0, 1, 0, &mut ov) != 0 }
}
#[cfg(not(windows))]
fn lock_gate_file(_file: &File) -> bool { false }
#[cfg(windows)]
fn unlock_gate_file(file: &File) {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)] struct Overlapped { internal: usize, internal_high: usize, offset: u32, offset_high: u32, h_event: *mut core::ffi::c_void }
    extern "system" { fn UnlockFileEx(hfile: *mut core::ffi::c_void, reserved: u32, low: u32, high: u32, overlapped: *mut Overlapped) -> i32; }
    let mut ov = Overlapped { internal:0, internal_high:0, offset:0, offset_high:0, h_event:std::ptr::null_mut() };
    unsafe { let _ = UnlockFileEx(file.as_raw_handle() as *mut _, 0, 1, 0, &mut ov); }
}
#[cfg(not(windows))]
fn unlock_gate_file(_file: &File) {}

fn parse_gate_bytes(bytes: &[u8]) -> Result<GateSnapshot, ()> {
    let json: GateFileJson = serde_json::from_slice(bytes).map_err(|_| ())?;
    if json.schema_version != GATE_SCHEMA_VERSION {
        return Err(());
    }
    if json.state != STATE_OPEN && json.state != STATE_CLOSED && json.state != STATE_CLOSED_UNKNOWN {
        return Err(());
    }
    Ok(json.into())
}

fn atomic_write(path: &Path, snapshot: &GateSnapshot) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "gate path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(
        "{}.{}.{}.tmp",
        GATE_FILE_NAME,
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let payload = serde_json::to_vec_pretty(&GateFileJson::from(snapshot)).map_err(|e| e.to_string())?;
    {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        file.write_all(&payload).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

impl GateStore {
    pub fn snapshot(&self) -> GateSnapshot {
        self.snapshot.clone()
    }

    pub fn is_open(&self) -> bool {
        self.snapshot.state == STATE_OPEN
    }

    /// Load from app-config. First open is allowed only when a durable marker proves this
    /// installation has never initialized its gate; deleting the gate alone cannot reopen it.
    pub fn load(app_data_dir: &Path, create_open_if_missing: bool) -> Self {
        let Ok(_lock) = GateFileLock::acquire(app_data_dir) else { return Self { dir: app_data_dir.to_path_buf(), file_seen: false, snapshot: closed_unknown(0) }; };
        let path = gate_path(app_data_dir);
        match fs::read(&path) {
            Ok(bytes) => match parse_gate_bytes(&bytes) {
                Ok(snapshot) => Self {
                    dir: app_data_dir.to_path_buf(),
                    file_seen: true,
                    snapshot,
                },
                Err(()) => Self {
                    dir: app_data_dir.to_path_buf(),
                    file_seen: true,
                    snapshot: closed_unknown(0),
                },
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let marker = app_data_dir.join(GATE_INITIALIZED_NAME);
                if create_open_if_missing && !marker.exists() {
                    let snapshot = open_initial();
                    // Persist the gate before the completion marker. A crash can then leave
                    // either a valid gate, or no marker and a safely retryable first install;
                    // it cannot leave a marker that permanently blocks initialization retry.
                    let initialized = atomic_write(&path, &snapshot).map(|_| {
                        if let Ok(mut f) = OpenOptions::new().write(true).create_new(true).open(&marker) {
                            let _ = f.write_all(b"initialized\n").and_then(|_| f.sync_all());
                        }
                    });
                    match initialized {
                        Ok(()) => Self {
                            dir: app_data_dir.to_path_buf(),
                            file_seen: true,
                            snapshot,
                        },
                        Err(_) => Self {
                            dir: app_data_dir.to_path_buf(),
                            file_seen: false,
                            snapshot: closed_unknown(0),
                        },
                    }
                } else {
                    Self {
                        dir: app_data_dir.to_path_buf(),
                        file_seen: false,
                        snapshot: closed_unknown(0),
                    }
                }
            }
            Err(_) => Self {
                dir: app_data_dir.to_path_buf(),
                file_seen: false,
                snapshot: closed_unknown(0),
            },
        }
    }

    pub fn refresh(&mut self) {
        let path = gate_path(&self.dir);
        match fs::read(&path) {
            Ok(bytes) => match parse_gate_bytes(&bytes) {
                Ok(snapshot) => {
                    self.file_seen = true;
                    self.snapshot = snapshot;
                }
                Err(()) => {
                    self.file_seen = true;
                    self.snapshot = closed_unknown(self.snapshot.generation);
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if self.file_seen {
                    // Previously readable file disappeared: fail closed and do not recreate open.
                    self.snapshot = closed_unknown(self.snapshot.generation);
                } else {
                    self.snapshot = closed_unknown(self.snapshot.generation);
                }
            }
            Err(_) => {
                self.snapshot = closed_unknown(self.snapshot.generation);
            }
        }
    }

    /// Persist closed first, then return so the caller can block the queue.
    pub fn observe_429(&mut self, cooldown_until_utc: Option<String>) -> GarminSyncResult<GateSnapshot> {
        let _lock = GateFileLock::acquire(&self.dir).map_err(|_| GarminSyncError::new(GARMIN_RATE_LIMIT_UNKNOWN, "failed to lock gate"))?;
        self.refresh();
        let previous = self.snapshot.generation;
        let next = GateSnapshot {
            schema_version: GATE_SCHEMA_VERSION,
            state: STATE_CLOSED.to_string(),
            generation: previous + 1,
            latched_at_utc: Some(utc_now()),
            cooldown_until_utc,
            last_status: Some(429),
            released_at_utc: None,
        };
        if let Err(_) = atomic_write(&gate_path(&self.dir), &next) {
            self.snapshot = closed_unknown(previous);
            return Err(GarminSyncError::new(
                GARMIN_RATE_LIMIT_LATCHED,
                "failed to persist 429 gate",
            ));
        }
        self.file_seen = true;
        self.snapshot = next;
        Ok(self.snapshot.clone())
    }

    pub fn restore(
        &mut self,
        expected_generation: i64,
        user_initiated: bool,
    ) -> GarminSyncResult<GateSnapshot> {
        if !user_initiated {
            return Err(GarminSyncError::new(
                GARMIN_RATE_LIMIT_RESTORE_NOT_USER,
                "restore requires userInitiated true",
            ));
        }
        let _lock = GateFileLock::acquire(&self.dir).map_err(|_| GarminSyncError::new(GARMIN_RATE_LIMIT_UNKNOWN, "failed to lock gate"))?;
        self.refresh();
        if self.snapshot.generation != expected_generation {
            return Err(GarminSyncError::new(
                GARMIN_RATE_LIMIT_RESTORE_STALE,
                "latch generation changed",
            ));
        }
        if self.snapshot.state == STATE_CLOSED_UNKNOWN {
            return Err(GarminSyncError::new(
                GARMIN_RATE_LIMIT_UNKNOWN,
                "closed_unknown cannot be unlocked",
            ));
        }
        if self.snapshot.state == STATE_OPEN {
            return Ok(self.snapshot.clone());
        }
        if self.snapshot.state == STATE_CLOSED {
            if self.snapshot.cooldown_until_utc.is_none() {
                return Err(GarminSyncError::new(
                    GARMIN_RATE_LIMIT_COOLDOWN_ACTIVE,
                    "closed 429 latch has no trustworthy expiry",
                ));
            }
            if cooldown_in_future(self.snapshot.cooldown_until_utc.as_deref()) {
                return Err(GarminSyncError::new(
                    GARMIN_RATE_LIMIT_COOLDOWN_ACTIVE,
                    "cooldown is still active",
                )
                .with_cooldown(self.snapshot.cooldown_until_utc.clone()));
            }
        }
        let mut next = self.snapshot.clone();
        next.state = STATE_OPEN.to_string();
        next.released_at_utc = Some(utc_now());
        if let Err(_) = atomic_write(&gate_path(&self.dir), &next) {
            self.snapshot = closed_unknown(self.snapshot.generation);
            return Err(GarminSyncError::new(
                GARMIN_RATE_LIMIT_UNKNOWN,
                "failed to persist restore",
            ));
        }
        self.file_seen = true;
        self.snapshot = next;
        Ok(self.snapshot.clone())
    }
}

fn cooldown_in_future(iso: Option<&str>) -> bool {
    let Some(iso) = iso else {
        return false;
    };
    let parsed = DateTime::parse_from_rfc3339(iso)
        .ok()
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%SZ")
                .ok()
                .map(|n| chrono::TimeZone::from_utc_datetime(&Utc, &n).fixed_offset())
        });
    match parsed {
        Some(dt) => dt.with_timezone(&Utc) > Utc::now(),
        None => true,
    }
}

static PROCESS_GATE: Mutex<Option<GateStore>> = Mutex::new(None);

pub fn install_process_gate(store: GateStore) {
    *PROCESS_GATE.lock().expect("gate mutex") = Some(store);
}

pub fn process_gate_snapshot() -> GateSnapshot {
    PROCESS_GATE
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.snapshot()))
        .unwrap_or_else(|| closed_unknown(0))
}

pub fn with_process_gate<T>(f: impl FnOnce(&mut GateStore) -> T) -> Option<T> {
    let mut g = PROCESS_GATE.lock().ok()?;
    g.as_mut().map(f)
}

pub fn process_gate_is_open() -> bool {
    with_process_gate(|g| {
        g.refresh();
        g.is_open()
    })
    .unwrap_or(false)
}

#[allow(dead_code)]
pub fn request_would_be_allowed() -> bool {
    process_gate_is_open() && super::lane::lane_is_held()
}
