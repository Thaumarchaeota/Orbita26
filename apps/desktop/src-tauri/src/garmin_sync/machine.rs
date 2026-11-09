use super::error::{
    GarminSyncError, GarminSyncResult, GARMIN_JOB_STATE_INVALID, GARMIN_RATE_LIMIT_LATCHED,
};
use super::types::{
    job_is_terminal, JobSnapshot, WorkItemSnapshot, ITEM_COMMITTING, ITEM_FETCHING, ITEM_PENDING,
    ITEM_SKIPPED_SAME_HASH, ITEM_STAGED, ITEM_SUCCEEDED, JOB_BLOCKED_RATE_LIMIT, JOB_CANCELLED,
    JOB_CANCELLING, JOB_PAUSED, JOB_PAUSING, JOB_QUEUED, JOB_RUNNING, PAUSE_APP_EXIT, PAUSE_USER,
    SCAN_CANCELLED, SCAN_SCANNING,
};

pub fn can_pause(state: &str) -> bool {
    matches!(
        state,
        JOB_QUEUED | JOB_RUNNING | JOB_PAUSING | JOB_BLOCKED_RATE_LIMIT
    )
}

pub fn can_cancel(state: &str) -> bool {
    !job_is_terminal(state)
}

pub fn apply_pause(job: &JobSnapshot) -> GarminSyncResult<JobSnapshot> {
    if !can_pause(&job.state) {
        return Err(GarminSyncError::new(
            GARMIN_JOB_STATE_INVALID,
            format!("cannot pause from {}", job.state),
        ));
    }
    let mut next = job.clone();
    next.state = JOB_PAUSED.to_string();
    next.pause_reason = Some(PAUSE_USER.to_string());
    next.revision += 1;
    Ok(next)
}

pub fn apply_cancel(job: &JobSnapshot) -> GarminSyncResult<JobSnapshot> {
    if !can_cancel(&job.state) {
        return Err(GarminSyncError::new(
            GARMIN_JOB_STATE_INVALID,
            format!("cannot cancel from {}", job.state),
        ));
    }
    let mut next = job.clone();
    next.state = JOB_CANCELLED.to_string();
    next.pause_reason = None;
    next.revision += 1;
    next.finished_at_utc = Some(super::utc_now());
    Ok(next)
}

pub fn apply_continue(job: &JobSnapshot, gate_open: bool) -> GarminSyncResult<JobSnapshot> {
    if job.state != JOB_PAUSED {
        return Err(GarminSyncError::new(
            GARMIN_JOB_STATE_INVALID,
            "continue is allowed only from paused",
        ));
    }
    if !gate_open {
        return Err(GarminSyncError::new(
            GARMIN_RATE_LIMIT_LATCHED,
            "global rate-limit gate is not open",
        ));
    }
    let mut next = job.clone();
    // Phase 2 does not dispatch HTTP/Python; `running` records eligibility after Continue.
    next.state = JOB_RUNNING.to_string();
    next.pause_reason = None;
    next.revision += 1;
    Ok(next)
}

pub fn can_cancel_scan(state: &str) -> bool {
    matches!(state, SCAN_SCANNING | "incomplete" | "ready" | "stale")
}

pub fn apply_scan_cancel_state(state: &str) -> GarminSyncResult<&'static str> {
    if !can_cancel_scan(state) {
        return Err(GarminSyncError::new(
            GARMIN_JOB_STATE_INVALID,
            format!("cannot cancel scan from {state}"),
        ));
    }
    Ok(SCAN_CANCELLED)
}

/// Pure startup reconcile. Does not imply network.
pub fn reconcile_jobs_on_startup(jobs: Vec<JobSnapshot>) -> Vec<JobSnapshot> {
    jobs.into_iter()
        .map(|mut job| {
            if !job_is_terminal(&job.state) {
                job.state = JOB_PAUSED.to_string();
                job.pause_reason = Some(PAUSE_APP_EXIT.to_string());
                job.revision += 1;
            }
            job
        })
        .collect()
}

pub fn reconcile_items_on_startup(items: Vec<WorkItemSnapshot>) -> Vec<WorkItemSnapshot> {
    items
        .into_iter()
        .map(|mut item| {
            if matches!(
                item.state.as_str(),
                ITEM_FETCHING | ITEM_STAGED | ITEM_COMMITTING
            ) {
                let committed = item
                    .committed_hash
                    .as_deref()
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
                if committed {
                    let skipped = item.result_code.as_deref() == Some(ITEM_SKIPPED_SAME_HASH);
                    item.state = if skipped {
                        ITEM_SKIPPED_SAME_HASH.to_string()
                    } else {
                        ITEM_SUCCEEDED.to_string()
                    };
                } else {
                    item.state = ITEM_PENDING.to_string();
                    item.error_code = None;
                }
            }
            item
        })
        .collect()
}
