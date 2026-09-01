use axum::http::StatusCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncErrorCode {
    UnsupportedContract,
    UnsupportedSchema,
    UnknownField,
    InvalidCombination,
    ValidationFailed,
    NaturalKeyCollision,
    VersionConflict,
    ContentConflict,
    ConflictNotFound,
    ConflictClosed,
    ConflictMismatch,
    OpIdReuse,
    UnauthorizedGarmin,
    FinanceRejected,
    NotFound,
    Internal,
}

impl SyncErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnsupportedContract => "UNSUPPORTED_CONTRACT",
            Self::UnsupportedSchema => "UNSUPPORTED_SCHEMA",
            Self::UnknownField => "UNKNOWN_FIELD",
            Self::InvalidCombination => "INVALID_COMBINATION",
            Self::ValidationFailed => "VALIDATION_FAILED",
            Self::NaturalKeyCollision => "NATURAL_KEY_COLLISION",
            Self::VersionConflict => "VERSION_CONFLICT",
            Self::ContentConflict => "CONTENT_CONFLICT",
            Self::ConflictNotFound => "CONFLICT_NOT_FOUND",
            Self::ConflictClosed => "CONFLICT_CLOSED",
            Self::ConflictMismatch => "CONFLICT_MISMATCH",
            Self::OpIdReuse => "OP_ID_REUSE",
            Self::UnauthorizedGarmin => "UNAUTHORIZED_GARMIN",
            Self::FinanceRejected => "FINANCE_REJECTED",
            Self::NotFound => "NOT_FOUND",
            Self::Internal => "INTERNAL_ERROR",
        }
    }

    pub fn retryable(self) -> bool {
        matches!(self, Self::Internal)
    }

    pub fn client_action(self) -> &'static str {
        match self {
            Self::UnauthorizedGarmin | Self::UnsupportedSchema => "re_enroll_device",
            Self::VersionConflict | Self::ContentConflict | Self::ConflictNotFound
            | Self::ConflictClosed | Self::ConflictMismatch | Self::NaturalKeyCollision => {
                "surface_conflict"
            }
            Self::Internal => "exponential_backoff",
            Self::ValidationFailed | Self::InvalidCombination | Self::UnknownField
            | Self::UnsupportedContract | Self::FinanceRejected | Self::OpIdReuse => {
                "reject_op_and_log"
            }
            Self::NotFound => "reject_op_and_log",
        }
    }

    pub fn http_status(self) -> StatusCode {
        match self {
            Self::UnsupportedContract | Self::UnsupportedSchema | Self::UnknownField
            | Self::InvalidCombination | Self::ValidationFailed | Self::FinanceRejected => {
                StatusCode::BAD_REQUEST
            }
            Self::UnauthorizedGarmin => StatusCode::FORBIDDEN,
            Self::NotFound | Self::ConflictNotFound => StatusCode::NOT_FOUND,
            Self::ConflictClosed | Self::ConflictMismatch | Self::OpIdReuse
            | Self::NaturalKeyCollision | Self::VersionConflict | Self::ContentConflict => {
                StatusCode::CONFLICT
            }
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

#[derive(Debug)]
pub struct ApiError {
    pub code: SyncErrorCode,
    pub message: String,
}

impl ApiError {
    pub fn new(code: SyncErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(_e: anyhow::Error) -> Self {
        Self::new(SyncErrorCode::Internal, "internal error")
    }
}
