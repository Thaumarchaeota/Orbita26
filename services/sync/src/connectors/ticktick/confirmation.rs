use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManualConfirmation {
    pub confirmation_id: Uuid,
    pub command_id: Uuid,
    pub account_id: String,
    pub reason: ConfirmationReason,
    pub correlation_marker: Option<String>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolution: Option<ConfirmationResolution>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConfirmationReason {
    CreateTimeoutNoIdempotencyProof,
    AmbiguousExternalResponse,
    DuplicateCandidateDetected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConfirmationResolution {
    ConfirmCreated { external_task_id: String },
    RetryOnce,
    Abort,
}

impl ManualConfirmation {
    pub fn for_create_timeout(command_id: Uuid, account_id: impl Into<String>) -> Self {
        Self {
            confirmation_id: Uuid::new_v4(),
            command_id,
            account_id: account_id.into(),
            reason: ConfirmationReason::CreateTimeoutNoIdempotencyProof,
            correlation_marker: None,
            created_at: Utc::now(),
            resolved_at: None,
            resolution: None,
        }
    }

    pub fn resolve(&mut self, resolution: ConfirmationResolution) {
        self.resolution = Some(resolution);
        self.resolved_at = Some(Utc::now());
    }
}
