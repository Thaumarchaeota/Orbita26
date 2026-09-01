use std::net::IpAddr;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::Deserialize;

const DEFAULT_LISTEN: &str = "127.0.0.1:8787";
const DEFAULT_STATE_DIR: &str = "./state";
const DEFAULT_BACKUP_DIR: &str = "./backup";
const DEFAULT_LOG_LEVEL: &str = "info";
const MIN_DISK_FREE_BYTES: u64 = 64 * 1024 * 1024;
const BACKUP_MAX_AGE_SECS: i64 = 48 * 3600;
const DEFAULT_DB_ADMISSION_CAPACITY: usize = 8;
const DEFAULT_DB_ADMISSION_TIMEOUT_MS: u64 = 500;

#[derive(Debug, Clone)]
pub struct SecretRef {
    pub name: &'static str,
    pub path_env: &'static str,
}

pub const SECRET_ENROLLMENT_PEPPER: SecretRef = SecretRef {
    name: "enrollment_pepper",
    path_env: "ORBITA_SYNC_SECRET_ENROLLMENT_PEPPER_FILE",
};

pub const SECRET_TOKEN_PEPPER: SecretRef = SecretRef {
    name: "token_pepper",
    path_env: "ORBITA_SYNC_SECRET_TOKEN_PEPPER_FILE",
};

pub const SECRET_METRICS_TOKEN: SecretRef = SecretRef {
    name: "metrics_token",
    path_env: "ORBITA_SYNC_SECRET_METRICS_TOKEN_FILE",
};

#[derive(Debug, Clone)]
pub struct Config {
    pub listen_addr: String,
    pub state_dir: PathBuf,
    pub backup_dir: PathBuf,
    pub log_level: String,
    pub db_path: PathBuf,
    pub migration_lock_path: PathBuf,
    pub backup_max_age_secs: i64,
    pub min_disk_free_bytes: u64,
    pub db_admission_capacity: usize,
    pub db_admission_timeout_ms: u64,
    pub allow_non_loopback_bind: bool,
}

#[derive(Debug, Deserialize)]
struct FileConfig {
    #[serde(default)]
    server: ServerSection,
    #[serde(default)]
    database: DatabaseSection,
    #[serde(default)]
    backup: BackupSection,
    #[serde(default)]
    observability: ObservabilitySection,
}

#[derive(Debug, Deserialize, Default)]
struct ServerSection {
    bind: Option<String>,
    #[serde(default)]
    allow_non_loopback_bind: bool,
}

#[derive(Debug, Deserialize, Default)]
struct DatabaseSection {
    path: Option<String>,
    admission_capacity: Option<usize>,
    admission_timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize, Default)]
struct BackupSection {
    directory: Option<String>,
    #[serde(default)]
    max_age_hours: Option<u64>,
}

#[derive(Debug, Deserialize, Default)]
struct ObservabilitySection {
    log_level: Option<String>,
}

impl Config {
    pub fn load() -> Result<Self> {
        if let Ok(path) = std::env::var("ORBITA_SYNC_CONFIG") {
            Self::from_file(Path::new(&path))
        } else {
            Self::from_env()
        }
    }

    pub fn from_env() -> Result<Self> {
        let state_dir = env_path("ORBITA_SYNC_STATE_DIR", DEFAULT_STATE_DIR)?;
        let backup_dir = env_path("ORBITA_SYNC_BACKUP_DIR", DEFAULT_BACKUP_DIR)?;
        Ok(Self {
            listen_addr: std::env::var("ORBITA_SYNC_LISTEN_ADDR")
                .unwrap_or_else(|_| DEFAULT_LISTEN.to_string()),
            state_dir: state_dir.clone(),
            backup_dir,
            log_level: std::env::var("ORBITA_SYNC_LOG_LEVEL")
                .unwrap_or_else(|_| DEFAULT_LOG_LEVEL.to_string()),
            db_path: state_dir.join("server.sqlite"),
            migration_lock_path: state_dir.join("migration.lock"),
            backup_max_age_secs: BACKUP_MAX_AGE_SECS,
            min_disk_free_bytes: MIN_DISK_FREE_BYTES,
            db_admission_capacity: DEFAULT_DB_ADMISSION_CAPACITY,
            db_admission_timeout_ms: DEFAULT_DB_ADMISSION_TIMEOUT_MS,
            allow_non_loopback_bind: false,
        })
    }

    pub fn from_file(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("read config {}", path.display()))?;
        let file: FileConfig = toml::from_str(&raw).context("parse config toml")?;
        let mut cfg = Self::from_env()?;
        if let Some(bind) = file.server.bind {
            cfg.listen_addr = bind;
        }
        cfg.allow_non_loopback_bind = file.server.allow_non_loopback_bind;
        if let Some(db) = file.database.path {
            cfg.db_path = PathBuf::from(db);
            if let Some(parent) = cfg.db_path.parent() {
                cfg.state_dir = parent.to_path_buf();
            }
        }
        if let Some(capacity) = file.database.admission_capacity {
            cfg.db_admission_capacity = capacity;
        }
        if let Some(timeout_ms) = file.database.admission_timeout_ms {
            cfg.db_admission_timeout_ms = timeout_ms;
        }
        if let Some(dir) = file.backup.directory {
            cfg.backup_dir = PathBuf::from(dir);
        }
        if let Some(hours) = file.backup.max_age_hours {
            cfg.backup_max_age_secs = (hours as i64) * 3600;
        }
        if let Some(level) = file.observability.log_level {
            cfg.log_level = level;
        }
        cfg.migration_lock_path = cfg.state_dir.join("migration.lock");
        Ok(cfg)
    }

    pub fn ensure_dirs(&self) -> Result<()> {
        std::fs::create_dir_all(&self.state_dir)
            .with_context(|| format!("create state dir {}", self.state_dir.display()))?;
        std::fs::create_dir_all(&self.backup_dir)
            .with_context(|| format!("create backup dir {}", self.backup_dir.display()))?;
        Ok(())
    }

    pub fn validate_startup(&self) -> Result<()> {
        self.ensure_dirs()?;
        crate::auth::secrets::validate_required_secrets()?;
        let listen: std::net::SocketAddr = self.listen_addr.parse()
            .with_context(|| format!("invalid listen address {}", self.listen_addr))?;
        if !listen.ip().is_loopback() && !self.allow_non_loopback_bind {
            bail!("refusing non-loopback bind without server.allow_non_loopback_bind = true");
        }
        if self.db_admission_capacity == 0 || self.db_admission_timeout_ms == 0 {
            bail!("database admission capacity and timeout must be greater than zero");
        }
        for path in [&self.state_dir, &self.backup_dir] {
            if !path.is_dir() {
                bail!("required directory missing: {}", path.display());
            }
        }
        Ok(())
    }

    pub fn metrics_allowed(token_header: Option<&str>) -> bool {
        match Self::read_secret(&SECRET_METRICS_TOKEN) {
            Ok(Some(expected)) if !expected.is_empty() => token_header == Some(expected.as_str()),
            _ => false,
        }
    }

    pub fn metrics_allowed_from(&self, _ip: IpAddr) -> bool {
        false
    }

    pub fn read_secret(ref_spec: &SecretRef) -> Result<Option<String>> {
        match std::env::var(ref_spec.path_env) {
            Ok(path) => {
                let content = std::fs::read_to_string(&path)
                    .with_context(|| format!("read secret file for {}", ref_spec.name))?;
                let trimmed = content.trim().to_string();
                if trimmed.is_empty() {
                    bail!("secret {} is empty", ref_spec.name);
                }
                Ok(Some(trimmed))
            }
            Err(_) => Ok(None),
        }
    }

    pub fn disk_free_ok(&self) -> bool {
        free_bytes_on_path(&self.state_dir).unwrap_or(0) >= self.min_disk_free_bytes
    }

    pub fn backup_fresh(&self) -> bool {
        match self.backup_age_secs() {
            Some(age) => age <= self.backup_max_age_secs.max(0) as u64,
            None => self.fresh_install_without_backup(),
        }
    }

    pub fn backup_age_secs(&self) -> Option<u64> {
        backup_age_secs_at(&self.backup_dir)
    }

    fn fresh_install_without_backup(&self) -> bool {
        let Ok(meta) = std::fs::metadata(&self.db_path) else {
            return false;
        };
        let Ok(age) = meta.modified().and_then(|t| t.elapsed().map_err(|_| std::io::Error::other("clock"))) else {
            return false;
        };
        age.as_secs() < 48 * 3600
    }
}

fn env_path(key: &str, default: &str) -> Result<PathBuf> {
    let raw = std::env::var(key).unwrap_or_else(|_| default.to_string());
    Ok(PathBuf::from(raw))
}

pub fn state_dir_from(path: &Path) -> Config {
    Config {
        listen_addr: DEFAULT_LISTEN.to_string(),
        state_dir: path.to_path_buf(),
        backup_dir: path.join("backup"),
        log_level: DEFAULT_LOG_LEVEL.to_string(),
        db_path: path.join("server.sqlite"),
        migration_lock_path: path.join("migration.lock"),
        backup_max_age_secs: BACKUP_MAX_AGE_SECS,
        min_disk_free_bytes: MIN_DISK_FREE_BYTES,
        db_admission_capacity: DEFAULT_DB_ADMISSION_CAPACITY,
        db_admission_timeout_ms: DEFAULT_DB_ADMISSION_TIMEOUT_MS,
        allow_non_loopback_bind: false,
    }
}

fn free_bytes_on_path(path: &Path) -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        use std::ffi::CString;
        use std::mem::MaybeUninit;
        let c_path = CString::new(path.to_string_lossy().as_bytes()).ok()?;
        let mut stat: MaybeUninit<libc::statvfs> = MaybeUninit::uninit();
        let rc = unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) };
        if rc != 0 {
            return None;
        }
        let stat = unsafe { stat.assume_init() };
        Some(stat.f_bavail as u64 * stat.f_frsize as u64)
    }
    #[cfg(not(target_os = "linux"))]
    {
        path.exists().then_some(u64::MAX)
    }
}

pub fn backup_age_secs_at(dir: &Path) -> Option<u64> {
    let mut latest: Option<std::time::SystemTime> = None;
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let ok = name == "latest.sqlite" || (name.starts_with("server-") && name.ends_with(".sqlite"));
        if !ok {
            continue;
        }
        let modified = entry.metadata().ok()?.modified().ok()?;
        latest = Some(match latest {
            Some(prev) if modified > prev => modified,
            Some(prev) => prev,
            None => modified,
        });
    }
    let latest = latest?;
    let age = latest.elapsed().ok()?;
    Some(age.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn loads_config_toml() {
        let dir = tempdir().unwrap();
        let cfg_path = dir.path().join("config.toml");
        std::fs::write(
            &cfg_path,
            r#"
[server]
bind = "0.0.0.0:9999"
[database]
path = "/tmp/custom/server.sqlite"
[backup]
directory = "/tmp/custom/backup"
max_age_hours = 12
[observability]
log_level = "debug"
"#,
        )
        .unwrap();
        std::env::set_var("ORBITA_SYNC_CONFIG", cfg_path.to_str().unwrap());
        let cfg = Config::load().unwrap();
        assert_eq!(cfg.listen_addr, "0.0.0.0:9999");
        assert_eq!(cfg.db_path, PathBuf::from("/tmp/custom/server.sqlite"));
        assert_eq!(cfg.backup_dir, PathBuf::from("/tmp/custom/backup"));
        assert_eq!(cfg.log_level, "debug");
        assert_eq!(cfg.backup_max_age_secs, 12 * 3600);
    }
}
