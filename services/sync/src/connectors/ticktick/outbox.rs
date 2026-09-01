use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkCommand {
    pub command_id: Uuid,
    pub account_id: String,
    pub origin_device_id: String,
    pub kind: CommandKind,
    pub payload_hash: String,
    pub expected_content_hash: Option<String>,
    pub expected_external_etag: Option<String>,
    pub status: CommandStatus,
    pub attempts: u32,
    pub max_attempts: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub result_summary: Option<String>,
    pub external_task_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommandKind {
    CreateTask { title: String, project_id: String },
    UpdateTask { task_id: String },
    CompleteTask { task_id: String },
    UndoComplete { task_id: String },
    DeleteTask { task_id: String },
    ShiftDue { task_id: String, new_due: Option<chrono::NaiveDate> },
    ShiftStart { task_id: String, new_start: Option<chrono::NaiveDate> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommandStatus {
    Pending,
    InFlight,
    Succeeded,
    Failed,
    Conflict,
    AwaitingManualConfirmation,
    DeadLetter,
}

impl WorkCommand {
    pub fn new(
        account_id: impl Into<String>,
        origin_device_id: impl Into<String>,
        kind: CommandKind,
        payload_hash: impl Into<String>,
    ) -> Self {
        Self::with_expectations(account_id, origin_device_id, kind, payload_hash, None, None)
    }

    pub fn with_expectations(
        account_id: impl Into<String>,
        origin_device_id: impl Into<String>,
        kind: CommandKind,
        payload_hash: impl Into<String>,
        expected_content_hash: Option<String>,
        expected_external_etag: Option<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            command_id: Uuid::new_v4(),
            account_id: account_id.into(),
            origin_device_id: origin_device_id.into(),
            kind,
            payload_hash: payload_hash.into(),
            expected_content_hash,
            expected_external_etag,
            status: CommandStatus::Pending,
            attempts: 0,
            max_attempts: 3,
            created_at: now,
            updated_at: now,
            result_summary: None,
            external_task_id: None,
        }
    }

    pub fn can_retry(&self) -> bool {
        matches!(self.status, CommandStatus::Pending | CommandStatus::Failed)
            && self.attempts < self.max_attempts
    }

    pub fn mark_in_flight(&mut self) {
        self.status = CommandStatus::InFlight;
        self.attempts += 1;
        self.updated_at = Utc::now();
    }

    pub fn mark_succeeded(&mut self, summary: impl Into<String>, external_id: Option<String>) {
        self.status = CommandStatus::Succeeded;
        self.result_summary = Some(summary.into());
        self.external_task_id = external_id;
        self.updated_at = Utc::now();
    }

    pub fn mark_awaiting_confirmation(&mut self, summary: impl Into<String>) {
        self.status = CommandStatus::AwaitingManualConfirmation;
        self.result_summary = Some(summary.into());
        self.updated_at = Utc::now();
    }
}
