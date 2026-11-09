use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DomainError {
    pub code: String,
    pub message: String,
}

impl DomainError {
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
        Self::new(
            "UNKNOWN_FIELD_WRITE_BLOCKED",
            "aggregate contains unknown stored fields",
        )
    }

    pub fn invalid_patch(msg: impl Into<String>) -> Self {
        Self::new("INVALID_PATCH", msg)
    }

    pub fn invalid_status(msg: impl Into<String>) -> Self {
        Self::new("INVALID_STATUS", msg)
    }

    pub fn invalid_time(msg: impl Into<String>) -> Self {
        Self::new("INVALID_TIME_VALUE", msg)
    }

    pub fn action_execution_invalid(msg: impl Into<String>) -> Self {
        Self::new("ACTION_EXECUTION_STATE_INVALID", msg)
    }

    pub fn active_action_blocks() -> Self {
        Self::new(
            "ACTIVE_ACTION_BLOCKS_THING",
            "associated started unended action blocks this operation",
        )
    }

    pub fn target_not_startable(msg: impl Into<String>) -> Self {
        Self::new("TARGET_NOT_STARTABLE", msg)
    }

    pub fn session_interval_conflict(msg: impl Into<String>) -> Self {
        Self::new("SESSION_INTERVAL_CONFLICT", msg)
    }

    pub fn action_outside_session(msg: impl Into<String>) -> Self {
        Self::new("ACTION_OUTSIDE_SESSION", msg)
    }

    pub fn tree_cycle() -> Self {
        Self::new("TREE_CYCLE", "task parent would create a cycle")
    }

    pub fn cross_project_move() -> Self {
        Self::new("CROSS_PROJECT_MOVE_FORBIDDEN", "task cannot leave its project")
    }

    pub fn delete_batch_mismatch() -> Self {
        Self::new("DELETE_BATCH_MISMATCH", "deletion batch does not match")
    }

    pub fn archived_list_readonly() -> Self {
        Self::new(
            "ARCHIVED_LIST_READONLY",
            "archived list is read-only for item and related action mutations",
        )
    }

    pub fn archive_lifecycle(msg: impl Into<String>) -> Self {
        Self::new("ARCHIVE_LIFECYCLE_ERROR", msg)
    }

    pub fn archive_busy() -> Self {
        Self::new("ARCHIVE_BUSY", "archive coordinator is busy")
    }

    pub fn travel_command_required(msg: impl Into<String>) -> Self {
        Self::new("travel_command_required", msg)
    }

    pub fn membership_conflict(msg: impl Into<String>) -> Self {
        Self::new("membership_conflict", msg)
    }

    pub fn invalid_plan(msg: impl Into<String>) -> Self {
        Self::new("invalid_plan", msg)
    }

    pub fn action_overlap(msg: impl Into<String>) -> Self {
        Self::new("action_overlap", msg)
    }

    pub fn checkpoint_inside_action(msg: impl Into<String>) -> Self {
        Self::new("checkpoint_inside_action", msg)
    }

    pub fn point_merge_required(msg: impl Into<String>) -> Self {
        Self::new("point_merge_required", msg)
    }

    pub fn protected_structure(msg: impl Into<String>) -> Self {
        Self::new("protected_structure", msg)
    }

    pub fn cross_item_reference(msg: impl Into<String>) -> Self {
        Self::new("cross_item_reference", msg)
    }

    pub fn actual_invalid(msg: impl Into<String>) -> Self {
        Self::new("actual_invalid", msg)
    }

    pub fn unknown_format_readonly(msg: impl Into<String>) -> Self {
        Self::new("unknown_format_readonly", msg)
    }

    pub fn restore_conflict(msg: impl Into<String>) -> Self {
        Self::new("restore_conflict", msg)
    }

    pub fn query_context_expired(msg: impl Into<String>) -> Self {
        Self::new("query_context_expired", msg)
    }

    pub fn request_id_reused(msg: impl Into<String>) -> Self {
        Self::new("request_id_reused", msg)
    }
}

impl std::fmt::Display for DomainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl From<DomainError> for String {
    fn from(e: DomainError) -> String {
        serde_json::to_string(&e).unwrap_or(e.message)
    }
}

impl From<rusqlite::Error> for DomainError {
    fn from(e: rusqlite::Error) -> Self {
        Self::archive_lifecycle(e.to_string())
    }
}

pub type DomainResult<T> = Result<T, DomainError>;
