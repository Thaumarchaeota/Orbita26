use chrono::{DateTime, Duration, Utc};

use super::model::*;
use super::super::error::{DomainError, DomainResult};

pub fn validate_trip_plan(actions: &[TripActionView], checkpoints: &[super::super::types::CheckpointSnapshot]) -> DomainResult<()> {
    for action in actions {
        let start = parse_minute(&action.planned_start_at)?;
        let end = parse_minute(&action.planned_end_at)?;
        if start >= end {
            return Err(DomainError::invalid_plan("action interval must be positive"));
        }
    }
    let mut sorted = actions.to_vec();
    sorted.sort_by(|a, b| a.planned_start_at.cmp(&b.planned_start_at).then(a.id.cmp(&b.id)));
    for i in 0..sorted.len() {
        for j in (i + 1)..sorted.len() {
            let a = &sorted[i];
            let b = &sorted[j];
            let a_start = parse_minute(&a.planned_start_at)?;
            let a_end = parse_minute(&a.planned_end_at)?;
            let b_start = parse_minute(&b.planned_start_at)?;
            let b_end = parse_minute(&b.planned_end_at)?;
            if a_start < b_end && b_start < a_end {
                return Err(DomainError::action_overlap("actions must not overlap"));
            }
        }
    }
    for cp in checkpoints {
        if cp.planned_at_utc.is_none() {
            return Err(DomainError::invalid_plan("checkpoint planned time required"));
        }
        let cp_at = parse_minute(cp.planned_at_utc.as_ref().unwrap())?;
        for action in actions {
            let start = parse_minute(&action.planned_start_at)?;
            let end = parse_minute(&action.planned_end_at)?;
            if cp_at > start && cp_at < end {
                return Err(DomainError::checkpoint_inside_action(
                    "checkpoint cannot lie strictly inside an action",
                ));
            }
        }
    }
    Ok(())
}

pub fn parse_minute(value: &str) -> DomainResult<DateTime<Utc>> {
    let dt = DateTime::parse_from_rfc3339(value)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?
        .with_timezone(&Utc);
    if dt.timestamp_subsec_millis() != 0 || dt.timestamp() % 60 != 0 {
        return Err(DomainError::invalid_plan("planned times must be minute-aligned utc"));
    }
    Ok(dt)
}

pub fn format_minute(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn shift_minute(value: &str, delta_minutes: i64) -> DomainResult<String> {
    let dt = parse_minute(value)?;
    Ok(format_minute(dt + Duration::minutes(delta_minutes)))
}

pub fn action_frozen(action: &TripActionView, item_completed: bool, item_cancelled: bool) -> bool {
    item_completed
        || item_cancelled
        || action.ended
        || action.actual.interval_id.is_some()
        || action.actual.pending_start_at_utc.is_some()
        || action.actual.pending_end_at_utc.is_some()
        || action.actual.start_at_utc.is_some()
        || action.actual.end_at_utc.is_some()
}

pub fn checkpoint_frozen(cp: &super::super::types::CheckpointSnapshot, item_completed: bool, item_cancelled: bool) -> bool {
    item_completed || item_cancelled || cp.completed || cp.actual_at_utc.is_some()
}

pub fn compute_capabilities(
    completed: bool,
    cancelled: bool,
    actions: &[TripActionView],
    checkpoints: &[super::super::types::CheckpointSnapshot],
    canonical_points: &[CanonicalPointDto],
) -> TripCapabilities {
    let item_locked = completed || cancelled;
    let any_unfrozen_action = actions
        .iter()
        .any(|a| !action_frozen(a, completed, cancelled));
    let any_unfrozen_checkpoint = checkpoints
        .iter()
        .any(|c| !checkpoint_frozen(c, completed, cancelled));
    let can_edit_plan = !item_locked && (any_unfrozen_action || any_unfrozen_checkpoint);
    let can_edit_structure = !item_locked && any_unfrozen_action;
    let can_change_transportation_type = !cancelled
        && actions.iter().all(|a| !action_frozen(a, completed, cancelled));
    TripCapabilities {
        can_edit_plan,
        can_edit_structure,
        // Text describes the saved trip and remains editable after plan freeze.
        can_edit_text: true,
        can_record_actual: true,
        can_change_transportation_type,
        can_finish: !completed && !cancelled && canonical_actuals_complete(actions, checkpoints, canonical_points),
        can_cancel: !cancelled,
        can_append: true,
    }
}

pub fn validate_finish_actuals(snapshot: &TripSnapshot) -> DomainResult<()> {
    for point in &snapshot.canonical_points {
        let checkpoints: Vec<_> = snapshot.checkpoints.iter()
            .filter(|cp| cp.planned_at_utc.as_deref() == Some(point.planned_at_utc.as_str()))
            .collect();
        for checkpoint in checkpoints {
            if checkpoint.actual_at_utc.is_none() {
                return Err(DomainError::actual_invalid(format!(
                    "cannot finish: checkpoint actual is required at {}",
                    point.planned_at_utc
                )));
            }
        }

        let fronts: Vec<_> = snapshot.actions.iter()
            .filter(|action| action.planned_end_at == point.planned_at_utc)
            .collect();
        for action in fronts {
            if action.actual.end_at_utc.is_none() && action.actual.pending_end_at_utc.is_none() {
                return Err(DomainError::actual_invalid(format!(
                    "cannot finish: action end actual is required at {}",
                    point.planned_at_utc
                )));
            }
        }

        let rears: Vec<_> = snapshot.actions.iter()
            .filter(|action| action.planned_start_at == point.planned_at_utc)
            .collect();
        for action in rears {
            if action.actual.start_at_utc.is_none() && action.actual.pending_start_at_utc.is_none() {
                return Err(DomainError::actual_invalid(format!(
                    "cannot finish: action start actual is required at {}",
                    point.planned_at_utc
                )));
            }
        }
    }
    Ok(())
}

fn canonical_actuals_complete(
    actions: &[TripActionView],
    checkpoints: &[super::super::types::CheckpointSnapshot],
    canonical_points: &[CanonicalPointDto],
) -> bool {
    canonical_points.iter().all(|point| {
        checkpoints.iter()
            .filter(|cp| cp.planned_at_utc.as_deref() == Some(point.planned_at_utc.as_str()))
            .all(|cp| cp.actual_at_utc.is_some())
            && actions.iter()
                .filter(|action| action.planned_end_at == point.planned_at_utc)
                .all(|action| action.actual.end_at_utc.is_some() || action.actual.pending_end_at_utc.is_some())
            && actions.iter()
                .filter(|action| action.planned_start_at == point.planned_at_utc)
                .all(|action| action.actual.start_at_utc.is_some() || action.actual.pending_start_at_utc.is_some())
    })
}

/// Validates cancel after-state when ending the current action at `now` (RFC3339 UTC).
/// On failure the caller must not write cancelledAt or actual end.
pub fn validate_cancel_with_end_action(
    snapshot: &TripSnapshot,
    action_id: &str,
    now_rfc3339: &str,
) -> DomainResult<()> {
    let now = chrono::DateTime::parse_from_rfc3339(now_rfc3339)
        .map_err(|_| DomainError::actual_invalid("invalid cancel instant"))?
        .with_timezone(&Utc);
    let action = snapshot
        .actions
        .iter()
        .find(|a| a.id == action_id)
        .ok_or_else(|| DomainError::root_not_found("action not found"))?;
    let start_boundary = action
        .actual
        .start_at_utc
        .as_deref()
        .or(action.actual.pending_start_at_utc.as_deref())
        .unwrap_or(action.planned_start_at.as_str());
    let start = chrono::DateTime::parse_from_rfc3339(start_boundary)
        .map_err(|_| DomainError::actual_invalid("invalid action start boundary"))?
        .with_timezone(&Utc);
    if start >= now {
        return Err(DomainError::actual_invalid("cancel end must be after action start"));
    }
    let mut sorted = snapshot.actions.clone();
    sorted.sort_by(|a, b| a.planned_start_at.cmp(&b.planned_start_at).then(a.id.cmp(&b.id)));
    let idx = sorted
        .iter()
        .position(|a| a.id == action_id)
        .ok_or_else(|| DomainError::root_not_found("action not found"))?;
    for later in sorted.iter().skip(idx + 1) {
        if let Some(later_start) = later
            .actual
            .start_at_utc
            .as_deref()
            .or(later.actual.pending_start_at_utc.as_deref())
        {
            let ls = chrono::DateTime::parse_from_rfc3339(later_start)
                .map_err(|_| DomainError::actual_invalid("invalid later actual start"))?
                .with_timezone(&Utc);
            if now > ls {
                return Err(DomainError::actual_invalid(
                    "cancel end cannot be after a later segment actual start",
                ));
            }
        }
    }
    validate_cross_action_actual_order(&sorted, action_id, Some(now_rfc3339))?;
    Ok(())
}

fn boundary_end(action: &TripActionView, projected_end: Option<&str>) -> Option<String> {
    if let Some(end) = projected_end {
        return Some(end.to_string());
    }
    action
        .actual
        .end_at_utc
        .clone()
        .or(action.actual.pending_end_at_utc.clone())
}

fn boundary_start(action: &TripActionView) -> Option<String> {
    action
        .actual
        .start_at_utc
        .clone()
        .or(action.actual.pending_start_at_utc.clone())
}

pub fn validate_cross_action_actual_order(
    actions: &[TripActionView],
    end_action_id: &str,
    projected_end_at: Option<&str>,
) -> DomainResult<()> {
    let mut sorted = actions.to_vec();
    sorted.sort_by(|a, b| a.planned_start_at.cmp(&b.planned_start_at).then(a.id.cmp(&b.id)));
    let mut known_ends: Vec<(usize, chrono::DateTime<Utc>)> = Vec::new();
    let mut known_starts: Vec<(usize, chrono::DateTime<Utc>)> = Vec::new();
    for (i, action) in sorted.iter().enumerate() {
        if let Some(start) = boundary_start(action) {
            let dt = chrono::DateTime::parse_from_rfc3339(&start)
                .map_err(|_| DomainError::actual_invalid("invalid actual start"))?
                .with_timezone(&Utc);
            known_starts.push((i, dt));
        }
        let end_raw = if action.id == end_action_id {
            projected_end_at.map(|s| s.to_string()).or_else(|| boundary_end(action, None))
        } else {
            boundary_end(action, None)
        };
        if let Some(end) = end_raw {
            let dt = chrono::DateTime::parse_from_rfc3339(&end)
                .map_err(|_| DomainError::actual_invalid("invalid actual end"))?
                .with_timezone(&Utc);
            known_ends.push((i, dt));
        }
    }
    for (li, left_end) in &known_ends {
        for (ri, right_start) in &known_starts {
            if *ri > *li && left_end > right_start {
                return Err(DomainError::actual_invalid("cross-segment actual boundaries out of order"));
            }
        }
    }
    Ok(())
}

pub const KNOWN_TRANSPORTATION_TYPES: &[&str] = &[
    "walk",
    "bike",
    "bus",
    "taxi",
    "metro",
    "car",
    "motorbike",
    "train",
    "flight",
    "tram",
    "ferry",
    "cable_car",
    "helicopter",
    "other",
];

pub fn transportation_type_writable(value: Option<&str>) -> bool {
    match value {
        None => true,
        Some(t) if t.trim().is_empty() => true,
        Some(t) => KNOWN_TRANSPORTATION_TYPES.contains(&t),
    }
}

pub fn ensure_actual_not_future(value: &str, now: &DateTime<Utc>, cancelled_at: Option<&str>) -> DomainResult<()> {
    let actual = DateTime::parse_from_rfc3339(value)
        .map_err(|_| DomainError::actual_invalid("invalid actual instant"))?
        .with_timezone(&Utc);
    if actual > *now {
        return Err(DomainError::actual_invalid("actual cannot be in the future"));
    }
    if let Some(cancelled) = cancelled_at {
        let cap = DateTime::parse_from_rfc3339(cancelled)
            .map_err(|_| DomainError::actual_invalid("invalid cancelledAt"))?
            .with_timezone(&Utc);
        if actual > cap {
            return Err(DomainError::actual_invalid("actual cannot be after cancellation"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod capability_tests {
    use super::compute_capabilities;

    #[test]
    fn text_remains_editable_when_plan_is_frozen() {
        for (completed, cancelled) in [(true, false), (false, true)] {
            let caps = compute_capabilities(completed, cancelled, &[], &[], &[]);
            assert!(!caps.can_edit_plan);
            assert!(caps.can_edit_text);
            assert!(caps.can_record_actual);
            assert!(!caps.can_edit_structure);
        }
    }
}
