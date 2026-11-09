use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminSyncError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_until_utc: Option<String>,
}

impl GarminSyncError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            cooldown_until_utc: None,
        }
    }

    pub fn with_cooldown(mut self, until: Option<String>) -> Self {
        self.cooldown_until_utc = until;
        self
    }
}

impl std::fmt::Display for GarminSyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl From<GarminSyncError> for String {
    fn from(e: GarminSyncError) -> String {
        serde_json::to_string(&e).unwrap_or(e.message)
    }
}

impl From<crate::productivity_db::DomainError> for GarminSyncError {
    fn from(e: crate::productivity_db::DomainError) -> Self {
        Self::new(e.code, e.message)
    }
}

impl From<GarminSyncError> for crate::productivity_db::DomainError {
    fn from(e: GarminSyncError) -> Self {
        Self::new(e.code, e.message)
    }
}

impl From<rusqlite::Error> for GarminSyncError {
    fn from(e: rusqlite::Error) -> Self {
        Self::new("ARCHIVE_LIFECYCLE_ERROR", e.to_string())
    }
}

pub type GarminSyncResult<T> = Result<T, GarminSyncError>;

pub const GARMIN_RATE_LIMIT_LATCHED: &str = "GARMIN_RATE_LIMIT_LATCHED";
pub const GARMIN_RATE_LIMIT_COOLDOWN_ACTIVE: &str = "GARMIN_RATE_LIMIT_COOLDOWN_ACTIVE";
pub const GARMIN_RATE_LIMIT_RESTORE_STALE: &str = "GARMIN_RATE_LIMIT_RESTORE_STALE";
pub const GARMIN_RATE_LIMIT_UNKNOWN: &str = "GARMIN_RATE_LIMIT_UNKNOWN";
pub const GARMIN_RATE_LIMIT_RESTORE_NOT_USER: &str = "GARMIN_RATE_LIMIT_RESTORE_NOT_USER";
pub const GARMIN_DATA_DIR_CHANGED: &str = "GARMIN_DATA_DIR_CHANGED";
pub const GARMIN_SCAN_INCOMPLETE: &str = "GARMIN_SCAN_INCOMPLETE";
pub const GARMIN_SCAN_STALE: &str = "GARMIN_SCAN_STALE";
pub const GARMIN_RANGE_INVALID: &str = "GARMIN_RANGE_INVALID";
pub const GARMIN_RANGE_TOO_LARGE: &str = "GARMIN_RANGE_TOO_LARGE";
pub const GARMIN_JOB_ACTIVE: &str = "GARMIN_JOB_ACTIVE";
pub const GARMIN_JOB_STATE_INVALID: &str = "GARMIN_JOB_STATE_INVALID";
pub const GARMIN_JOB_NOT_FOUND: &str = "GARMIN_JOB_NOT_FOUND";
pub const GARMIN_SCAN_NOT_FOUND: &str = "GARMIN_SCAN_NOT_FOUND";
pub const REVISION_CONFLICT: &str = "REVISION_CONFLICT";
