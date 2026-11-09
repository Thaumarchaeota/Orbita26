use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceError {
    pub code: String,
    pub message: String,
}

impl WorkspaceError {
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

    pub fn invalid_patch(msg: impl Into<String>) -> Self {
        Self::new("INVALID_PATCH", msg)
    }

    pub fn active_action_blocks() -> Self {
        Self::new(
            "ACTIVE_ACTION_BLOCKS_THING",
            "associated started unended action blocks this operation",
        )
    }

    pub fn archive_lifecycle(msg: impl Into<String>) -> Self {
        Self::new("ARCHIVE_LIFECYCLE_ERROR", msg)
    }
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl From<WorkspaceError> for String {
    fn from(e: WorkspaceError) -> String {
        serde_json::to_string(&e).unwrap_or(e.message)
    }
}

impl From<WorkspaceError> for crate::productivity_db::DomainError {
    fn from(e: WorkspaceError) -> Self {
        Self::new(e.code, e.message)
    }
}

pub type WorkspaceResult<T> = Result<T, WorkspaceError>;
