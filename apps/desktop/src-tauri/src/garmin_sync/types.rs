use serde::{Deserialize, Serialize};

pub const PRIORITY_DRAIN_COMMIT: i64 = 0;
pub const PRIORITY_DAILY_CORE: i64 = 1;
#[allow(dead_code)]
pub const PRIORITY_ADVANCED_CORE: i64 = 2;
#[allow(dead_code)]
pub const PRIORITY_DETAIL: i64 = 3;
#[allow(dead_code)]
pub const PRIORITY_ORIGINAL: i64 = 4;

pub const KIND_DAILY: &str = "daily";
pub const KIND_ADVANCED: &str = "advanced";
pub const KIND_FETCH_DAILY_CLASS: &str = "fetch_daily_class";

pub const JOB_QUEUED: &str = "queued";
pub const JOB_RUNNING: &str = "running";
pub const JOB_PAUSING: &str = "pausing";
pub const JOB_PAUSED: &str = "paused";
pub const JOB_CANCELLING: &str = "cancelling";
pub const JOB_CANCELLED: &str = "cancelled";
pub const JOB_COMPLETED: &str = "completed";
pub const JOB_PARTIAL: &str = "partial";
pub const JOB_FAILED: &str = "failed";
pub const JOB_CORE_SUCCESS: &str = "core_success";
pub const JOB_CORE_PARTIAL: &str = "core_partial";
pub const JOB_BLOCKED_RATE_LIMIT: &str = "blocked_rate_limit";

pub const SCAN_SCANNING: &str = "scanning";
pub const SCAN_READY: &str = "ready";
pub const SCAN_INCOMPLETE: &str = "incomplete";
pub const SCAN_CANCELLED: &str = "cancelled";

pub const ITEM_PENDING: &str = "pending";
pub const ITEM_FETCHING: &str = "fetching";
pub const ITEM_STAGED: &str = "staged";
pub const ITEM_COMMITTING: &str = "committing";
pub const ITEM_SUCCEEDED: &str = "succeeded";
pub const ITEM_SKIPPED_SAME_HASH: &str = "skipped_same_hash";

pub const PAUSE_APP_EXIT: &str = "app_exit";
pub const PAUSE_USER: &str = "user";

pub const GATE_FILE_NAME: &str = "garmin_rate_limit_gate.v1";
pub const LANE_LOCK_NAME: &str = "garmin_request_lane.lock";
pub const GATE_LOCK_NAME: &str = "garmin_rate_limit_gate.lock";
pub const GATE_INITIALIZED_NAME: &str = "garmin_rate_limit_gate.initialized";

/// Same 12 class ids as `health_db` garmin_apply `VALID_CLASSES`.
pub const DAILY_CLASS_IDS: &[&str] = &[
    "health_day_summary",
    "health_day_sample_hr",
    "health_day_sample_stress",
    "health_day_sample_body_battery",
    "health_day_sample_spo2",
    "health_day_sample_respiration",
    "health_day_sample_hrv",
    "health_day_sample_steps",
    "sleep_night",
    "nap",
    "body_comp_on_day",
];

pub fn job_is_terminal(state: &str) -> bool {
    matches!(
        state,
        JOB_COMPLETED | JOB_PARTIAL | JOB_CANCELLED | JOB_FAILED | JOB_CORE_SUCCESS | JOB_CORE_PARTIAL
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateSnapshot {
    pub schema_version: i32,
    pub state: String,
    pub generation: i64,
    pub latched_at_utc: Option<String>,
    pub cooldown_until_utc: Option<String>,
    pub last_status: Option<i64>,
    pub released_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub job_id: String,
    pub data_dir_key: String,
    pub kind: String,
    pub from_date: String,
    pub to_date: String,
    pub timezone_policy: String,
    pub intent: String,
    pub force_details: bool,
    pub force_original: bool,
    pub scan_id: Option<String>,
    pub manifest_hash: Option<String>,
    pub state: String,
    pub pause_reason: Option<String>,
    pub revision: i64,
    pub phase_stats_json: String,
    pub error_code: Option<String>,
    pub error_summary: Option<String>,
    pub request_id: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub started_at_utc: Option<String>,
    pub finished_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSnapshot {
    pub scan_id: String,
    pub request_id: String,
    pub data_dir_key: String,
    pub from_date: String,
    pub to_date: String,
    pub timezone_policy: String,
    pub mode: String,
    pub force_details: bool,
    pub force_original: bool,
    pub state: String,
    pub page_cursor: Option<String>,
    pub page_evidence_json: String,
    pub manifest_hash: Option<String>,
    pub revision: i64,
    pub error_code: Option<String>,
    pub error_summary: Option<String>,
    pub created_at_utc: String,
    pub finished_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemSnapshot {
    pub work_item_id: String,
    pub job_id: String,
    pub kind: String,
    pub target_key: String,
    pub priority: i64,
    pub state: String,
    pub attempt_count: i64,
    pub attempt_generation: i64,
    pub next_attempt_at_utc: Option<String>,
    pub idempotency_key: String,
    pub input_hash: Option<String>,
    pub committed_hash: Option<String>,
    pub asset_version_id: Option<String>,
    pub revision: i64,
    pub error_code: Option<String>,
    pub result_code: Option<String>,
}

/// Hint payload only. Phase 2 does not emit this to the UI.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminSyncStateChanged {
    pub event_id: String,
    pub event_schema_version: i32,
    pub latch_revision: i64,
    pub data_dir_key: Option<String>,
    pub job_id: Option<String>,
    pub scan_id: Option<String>,
    pub entity_revision: Option<i64>,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyStartRequest {
    pub request_id: String,
    pub expected_data_dir_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyStartResponse {
    pub job: JobSnapshot,
    pub accepted: bool,
    pub coalesced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStartRequest {
    pub request_id: String,
    pub expected_data_dir_key: String,
    pub from_date: String,
    pub to_date: String,
    pub mode: String,
    #[serde(default)]
    pub force_details: bool,
    #[serde(default)]
    pub force_original: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStartResponse {
    pub scan: ScanSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCancelRequest {
    pub request_id: String,
    pub expected_data_dir_key: String,
    pub scan_id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStartRequest {
    pub request_id: String,
    pub expected_data_dir_key: String,
    pub scan_id: String,
    pub expected_revision: i64,
    pub manifest_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobIdRevisionRequest {
    pub request_id: String,
    pub expected_data_dir_key: String,
    pub job_id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobGetRequest {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanGetRequest {
    pub scan_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRequest {
    pub request_id: String,
    pub expected_latch_revision: i64,
    pub user_initiated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResponse {
    pub latch: GateSnapshot,
    pub restored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitStatusResponse {
    pub latch: GateSnapshot,
    pub eligible_tasks: Vec<EligibleTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EligibleTask {
    pub job_id: String,
    pub kind: String,
    pub state: String,
    pub pause_reason: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobGetResponse {
    pub job: JobSnapshot,
    pub phase_counts: serde_json::Value,
    pub recent_items: Vec<WorkItemSnapshot>,
    pub failures: Vec<WorkItemSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanGetResponse {
    pub scan: ScanSnapshot,
    pub preview: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobMutationResponse {
    pub job: JobSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanMutationResponse {
    pub scan: ScanSnapshot,
}
