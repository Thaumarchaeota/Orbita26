use super::error::{DomainError, DomainResult};
use super::types::{ActionSnapshot, IntervalSnapshot};

pub fn derive_execution_state(ended: bool, intervals: &[IntervalSnapshot]) -> String {
    if ended {
        return "已结束".to_string();
    }
    if intervals.is_empty() {
        return "未开始".to_string();
    }
    if intervals.iter().any(|i| i.deleted_at_utc.is_none() && i.ended_at.is_none()) {
        return "进行中".to_string();
    }
    "暂停".to_string()
}

pub fn live_intervals(intervals: &[IntervalSnapshot]) -> Vec<&IntervalSnapshot> {
    intervals
        .iter()
        .filter(|i| i.deleted_at_utc.is_none())
        .collect()
}

pub fn has_open_interval(intervals: &[IntervalSnapshot]) -> bool {
    live_intervals(intervals)
        .iter()
        .any(|i| i.ended_at.is_none())
}

pub fn has_any_interval(intervals: &[IntervalSnapshot]) -> bool {
    !live_intervals(intervals).is_empty()
}

pub fn action_started(intervals: &[IntervalSnapshot]) -> bool {
    has_any_interval(intervals)
}

pub fn intervals_overlap(
    a_start: &str,
    a_end: Option<&str>,
    b_start: &str,
    b_end: Option<&str>,
) -> DomainResult<bool> {
    let a_end = a_end.unwrap_or(a_start);
    let b_end = b_end.unwrap_or(b_start);
    let a0 = chrono::DateTime::parse_from_rfc3339(a_start)
        .map_err(|_| DomainError::invalid_time("invalid interval start"))?;
    let a1 = chrono::DateTime::parse_from_rfc3339(a_end)
        .map_err(|_| DomainError::invalid_time("invalid interval end"))?;
    let b0 = chrono::DateTime::parse_from_rfc3339(b_start)
        .map_err(|_| DomainError::invalid_time("invalid interval start"))?;
    let b1 = chrono::DateTime::parse_from_rfc3339(b_end)
        .map_err(|_| DomainError::invalid_time("invalid interval end"))?;
    Ok(a0 < b1 && b0 < a1)
}

pub fn validate_interval_set(intervals: &[IntervalSnapshot]) -> DomainResult<bool> {
    let live = live_intervals(intervals);
    for (i, a) in live.iter().enumerate() {
        if let Some(end) = &a.ended_at {
            if a.started_at >= *end {
                return Ok(false);
            }
        }
        for b in live.iter().skip(i + 1) {
            if intervals_overlap(
                &a.started_at,
                a.ended_at.as_deref(),
                &b.started_at,
                b.ended_at.as_deref(),
            )? {
                return Ok(false);
            }
        }
    }
    Ok(live.iter().filter(|i| i.ended_at.is_none()).count() <= 1)
}

pub fn apply_execution_state(mut action: ActionSnapshot) -> ActionSnapshot {
    action.execution_state = derive_execution_state(action.ended, &action.intervals);
    action
}
