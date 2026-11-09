use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct JournalError {
    pub code: String,
    pub message: String,
}

impl JournalError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn revision_conflict(msg: impl Into<String>) -> Self {
        Self::new("REVISION_CONFLICT", msg)
    }

    pub fn entry_not_found(msg: impl Into<String>) -> Self {
        Self::new("ENTRY_NOT_FOUND", msg)
    }

    pub fn entry_deleted(msg: impl Into<String>) -> Self {
        Self::new("ENTRY_DELETED", msg)
    }

    pub fn invalid_kind(msg: impl Into<String>) -> Self {
        Self::new("INVALID_KIND", msg)
    }

    pub fn title_required(msg: impl Into<String>) -> Self {
        Self::new("TITLE_REQUIRED", msg)
    }

    pub fn invalid_time(msg: impl Into<String>) -> Self {
        Self::new("INVALID_TIME_VALUE", msg)
    }

    pub fn detail_prepare_failed(msg: impl Into<String>) -> Self {
        Self::new("DETAIL_PREPARE_FAILED", msg)
    }

    pub fn detail_version_mismatch(msg: impl Into<String>) -> Self {
        Self::new("DETAIL_VERSION_MISMATCH", msg)
    }

    pub fn archive_lifecycle(msg: impl Into<String>) -> Self {
        Self::new("ARCHIVE_LIFECYCLE", msg)
    }
}

impl std::fmt::Display for JournalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl From<JournalError> for String {
    fn from(e: JournalError) -> String {
        serde_json::to_string(&e).unwrap_or(e.message)
    }
}

impl From<JournalError> for crate::productivity_db::DomainError {
    fn from(e: JournalError) -> Self {
        Self::new(e.code, e.message)
    }
}

impl From<crate::productivity_db::DomainError> for JournalError {
    fn from(e: crate::productivity_db::DomainError) -> Self {
        Self::new(e.code, e.message)
    }
}

pub type JournalResult<T> = Result<T, JournalError>;
