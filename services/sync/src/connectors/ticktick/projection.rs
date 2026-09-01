use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectProjection {
    pub project_id: String,
    pub name: String,
    pub color: Option<String>,
    pub sort_order: i32,
    pub closed: bool,
    pub content_hash: String,
    pub synced_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskProjection {
    pub task_id: String,
    pub project_id: String,
    pub title: String,
    pub content: Option<String>,
    pub completed: bool,
    pub due_date: Option<NaiveDate>,
    pub start_date: Option<NaiveDate>,
    pub priority: u8,
    pub content_hash: String,
    pub synced_at: DateTime<Utc>,
    pub external_etag: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkMirror {
    pub account_id: String,
    pub projects: Vec<ProjectProjection>,
    pub tasks: Vec<TaskProjection>,
    pub mirror_version: u64,
}
