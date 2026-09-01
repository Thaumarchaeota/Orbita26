use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use thiserror::Error;

use fs2::FileExt;

#[derive(Debug, Error)]
pub enum LockError {
    #[error("lock already held: {0}")]
    AlreadyHeld(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug)]
pub struct MigrationLock {
    _file: File,
}

impl MigrationLock {
    pub fn acquire<P: AsRef<Path>>(lock_path: P) -> Result<Self, LockError> {
        let path = lock_path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(LockError::Io)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(path)
            .map_err(LockError::Io)?;
        file.try_lock_exclusive()
            .map_err(|e| LockError::AlreadyHeld(e.to_string()))?;
        writeln!(&file, "pid={}", std::process::id()).map_err(LockError::Io)?;
        file.sync_all().map_err(LockError::Io)?;
        Ok(Self { _file: file })
    }
}

impl Drop for MigrationLock {
    fn drop(&mut self) {
        let _ = self._file.unlock();
    }
}
