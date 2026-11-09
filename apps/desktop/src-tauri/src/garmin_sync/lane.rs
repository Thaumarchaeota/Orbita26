use std::fs::{File, OpenOptions};
use std::path::Path;
use std::sync::{Mutex, MutexGuard, TryLockError};

use super::types::LANE_LOCK_NAME;

/// Process-wide OS file lock. The Mutex only stores the held handle; it is not the global gate.
struct LaneHold {
    _file: File,
}

static LANE: Mutex<Option<LaneHold>> = Mutex::new(None);
static REQUEST: Mutex<()> = Mutex::new(());

/// Serializes each Garmin network operation inside the process that owns the OS lane.
/// The OS lane remains a process-ownership lock; this guard is per request and RAII released.
pub(crate) struct RequestGuard {
    _guard: MutexGuard<'static, ()>,
}

pub(crate) fn try_acquire_request() -> Option<RequestGuard> {
    match REQUEST.try_lock() {
        Ok(guard) => Some(RequestGuard { _guard: guard }),
        Err(TryLockError::WouldBlock) => None,
        // The mutex is only an exclusion primitive; unwinding releases its guard. Reuse the
        // recovered guard so one panic cannot permanently disable Garmin networking.
        Err(TryLockError::Poisoned(poisoned)) => Some(RequestGuard {
            _guard: poisoned.into_inner(),
        }),
    }
}

pub fn lane_lock_path(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join(LANE_LOCK_NAME)
}

pub fn lane_is_held() -> bool {
    LANE.lock().ok().map(|g| g.is_some()).unwrap_or(false)
}

/// Exclusive OS lock on `{dir}/garmin_request_lane.lock`. Fails closed if another process holds it.
/// Usable without Tauri: pass an explicit directory.
pub fn try_acquire_lane(app_data_dir: &Path) -> bool {
    let mut slot = match LANE.lock() {
        Ok(s) => s,
        Err(_) => return false,
    };
    if slot.is_some() {
        return true;
    }
    if let Err(_) = std::fs::create_dir_all(app_data_dir) {
        return false;
    }
    let path = lane_lock_path(app_data_dir);
    let file = match OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&path)
    {
        Ok(f) => f,
        Err(_) => return false,
    };
    if !lock_file_ex_exclusive_nb(&file) {
        return false;
    }
    *slot = Some(LaneHold { _file: file });
    true
}

#[cfg(windows)]
fn lock_file_ex_exclusive_nb(file: &File) -> bool {
    use std::os::windows::io::AsRawHandle;
    // windows 0.60 exposes LockFileEx only under Win32_System_IO (and CreateFileW under
    // Win32_Security). Those Cargo features are not enabled; call the same kernel32
    // LockFileEx and use LOCKFILE_* from Win32_Storage_FileSystem.
    use windows::Win32::Storage::FileSystem::{
        LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
    };

    #[repr(C)]
    struct Overlapped {
        internal: usize,
        internal_high: usize,
        offset: u32,
        offset_high: u32,
        h_event: *mut core::ffi::c_void,
    }

    extern "system" {
        fn LockFileEx(
            hfile: *mut core::ffi::c_void,
            dwflags: u32,
            dwreserved: u32,
            nnumberofbytestolocklow: u32,
            nnumberofbytestolockhigh: u32,
            lpoverlapped: *mut Overlapped,
        ) -> i32;
    }

    let flags = LOCKFILE_EXCLUSIVE_LOCK.0 | LOCKFILE_FAIL_IMMEDIATELY.0;
    let mut overlapped = Overlapped {
        internal: 0,
        internal_high: 0,
        offset: 0,
        offset_high: 0,
        h_event: std::ptr::null_mut(),
    };
    unsafe {
        LockFileEx(
            file.as_raw_handle() as *mut core::ffi::c_void,
            flags,
            0,
            1,
            0,
            &mut overlapped,
        ) != 0
    }
}

#[cfg(not(windows))]
fn lock_file_ex_exclusive_nb(_file: &File) -> bool {
    false
}

#[cfg(test)]
pub fn reset_lane_for_tests() {
    *LANE.lock().expect("lane mutex") = None;
}
