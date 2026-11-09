use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct HealthError {
    pub code: String,
    pub message: String,
}

impl HealthError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn revision_conflict(msg: impl Into<String>) -> Self {
        Self::new("REVISION_CONFLICT", msg)
    }

    pub fn root_not_found(msg: impl Into<String>) -> Self {
        Self::new("ROOT_NOT_FOUND", msg)
    }

    pub fn root_deleted(msg: impl Into<String>) -> Self {
        Self::new("ROOT_DELETED", msg)
    }

    pub fn unknown_field_blocked() -> Self {
        Self::new("UNKNOWN_FIELD_WRITE_BLOCKED", "aggregate contains unknown stored fields")
    }

    pub fn invalid_patch(msg: impl Into<String>) -> Self {
        Self::new("INVALID_PATCH", msg)
    }

    pub fn invalid_time(msg: impl Into<String>) -> Self {
        Self::new("INVALID_TIME_VALUE", msg)
    }

    pub fn garmin_source_readonly() -> Self {
        Self::new("GARMIN_SOURCE_READONLY", "garmin-sourced health facts are read-only")
    }

    pub fn meal_slot_invalid() -> Self {
        Self::new("MEAL_SLOT_INVALID", "slot must be null or one of the eight supported meal categories")
    }

    pub fn archive_lifecycle(msg: impl Into<String>) -> Self {
        Self::new("ARCHIVE_LIFECYCLE", msg)
    }

    pub fn garmin_apply_invalid_batch(msg: impl Into<String>) -> Self {
        Self::new("GARMIN_APPLY_INVALID_BATCH", msg)
    }

    pub fn garmin_sync_in_progress() -> Self {
        Self::new("GARMIN_SYNC_IN_PROGRESS", "garmin sync already in progress")
    }
}

impl std::fmt::Display for HealthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl From<HealthError> for String {
    fn from(e: HealthError) -> String {
        serde_json::to_string(&e).unwrap_or(e.message)
    }
}

impl From<HealthError> for crate::productivity_db::DomainError {
    fn from(e: HealthError) -> Self {
        Self::new(e.code, e.message)
    }
}

pub type HealthResult<T> = Result<T, HealthError>;
