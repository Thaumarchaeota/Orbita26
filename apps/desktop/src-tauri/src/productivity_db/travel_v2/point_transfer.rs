use std::collections::HashMap;

use super::model::*;
use super::super::error::{DomainError, DomainResult};
use super::super::types::CheckpointSnapshot;

pub fn build_canonical_points(
    actions: &[TripActionView],
    checkpoints: &[CheckpointSnapshot],
    points: &[TravelPointDto],
    flight_action_ids: &std::collections::HashSet<String>,
) -> DomainResult<Vec<CanonicalPointDto>> {
    let mut minute_groups: HashMap<String, Vec<CanonicalCandidate>> = HashMap::new();
    for action in actions {
        minute_groups
            .entry(action.planned_start_at.clone())
            .or_default()
            .push(CanonicalCandidate::ActionStart(action.id.clone()));
        minute_groups
            .entry(action.planned_end_at.clone())
            .or_default()
            .push(CanonicalCandidate::ActionEnd(action.id.clone()));
    }
    for cp in checkpoints {
        if let Some(at) = &cp.planned_at_utc {
            minute_groups
                .entry(at.clone())
                .or_default()
                .push(CanonicalCandidate::Checkpoint(cp.id.clone()));
        }
    }
    let point_by_action: HashMap<(String, String), &TravelPointDto> = points
        .iter()
        .filter_map(|p| {
            p.action_id
                .as_ref()
                .map(|aid| ((aid.clone(), p.role.clone()), p))
        })
        .collect();
    let point_by_cp: HashMap<String, &TravelPointDto> = points
        .iter()
        .filter_map(|p| p.checkpoint_id.as_ref().map(|id| (id.clone(), p)))
        .collect();
    let mut canonical = Vec::new();
    let mut keys: Vec<_> = minute_groups.keys().cloned().collect();
    keys.sort();
    for minute in keys {
        let group = minute_groups.get(&minute).unwrap();
        let (isolated, rest): (Vec<_>, Vec<_>) = group.iter().cloned().partition(|candidate| {
            flight_endpoint(candidate, flight_action_ids)
        });
        for candidate in isolated {
            canonical.push(canonical_from_owner(
                &owner_from_candidate(&candidate),
                &minute,
                actions,
                checkpoints,
                &point_by_action,
                &point_by_cp,
                false,
            ));
        }
        if !rest.is_empty() {
            let owner = pick_owner(&rest)?;
            canonical.push(canonical_from_owner(
                &owner,
                &minute,
                actions,
                checkpoints,
                &point_by_action,
                &point_by_cp,
                true,
            ));
        }
    }
    Ok(canonical)
}

fn flight_endpoint(candidate: &CanonicalCandidate, flight_action_ids: &std::collections::HashSet<String>) -> bool {
    match candidate {
        CanonicalCandidate::ActionStart(id) | CanonicalCandidate::ActionEnd(id) => flight_action_ids.contains(id),
        CanonicalCandidate::Checkpoint(_) => false,
    }
}

fn owner_from_candidate(candidate: &CanonicalCandidate) -> CanonicalOwner {
    match candidate {
        CanonicalCandidate::ActionStart(id) => CanonicalOwner::ActionStart(id.clone()),
        CanonicalCandidate::ActionEnd(id) => CanonicalOwner::ActionEnd(id.clone()),
        CanonicalCandidate::Checkpoint(id) => CanonicalOwner::Checkpoint(id.clone()),
    }
}

fn canonical_from_owner(
    owner: &CanonicalOwner,
    minute: &str,
    actions: &[TripActionView],
    checkpoints: &[CheckpointSnapshot],
    point_by_action: &HashMap<(String, String), &TravelPointDto>,
    point_by_cp: &HashMap<String, &TravelPointDto>,
    shared: bool,
) -> CanonicalPointDto {
    let (front_end, rear_start) = if shared {
        shared_boundary_actuals(minute, actions)
    } else {
        match owner {
            CanonicalOwner::ActionStart(id) => (
                None,
                actions.iter().find(|a| a.id == *id).and_then(action_start_actual),
            ),
            CanonicalOwner::ActionEnd(id) => (
                actions.iter().find(|a| a.id == *id).and_then(action_end_actual),
                None,
            ),
            CanonicalOwner::Checkpoint(_) => (None, None),
        }
    };
    let (owner_kind, owner_id, action_label, location, note, actual, point_id) = match owner {
        CanonicalOwner::ActionStart(id) => {
            let p = point_by_action.get(&(id.clone(), "start".into()));
            let point_id = p.map(|x| x.id.clone()).unwrap_or_else(|| id.clone());
            (
                "action".into(),
                id.clone(),
                p.and_then(|x| x.action_label.clone()),
                p.and_then(|x| x.location.clone()),
                p.and_then(|x| x.note.clone()),
                None,
                point_id,
            )
        }
        CanonicalOwner::ActionEnd(id) => {
            let p = point_by_action.get(&(id.clone(), "end".into()));
            let point_id = p.map(|x| x.id.clone()).unwrap_or_else(|| id.clone());
            (
                "action".into(),
                id.clone(),
                p.and_then(|x| x.action_label.clone()),
                p.and_then(|x| x.location.clone()),
                p.and_then(|x| x.note.clone()),
                None,
                point_id,
            )
        }
        CanonicalOwner::Checkpoint(id) => {
            let cp = checkpoints.iter().find(|c| c.id == *id).unwrap();
            let p = point_by_cp.get(id);
            let point_id = p.map(|x| x.id.clone()).unwrap_or_else(|| id.clone());
            (
                "checkpoint".into(),
                id.clone(),
                Some(cp.title.clone()),
                p.and_then(|x| x.location.clone()),
                cp.description.clone(),
                cp.actual_at_utc.clone(),
                point_id,
            )
        }
    };
    CanonicalPointDto {
        point_id,
        planned_at_utc: minute.to_string(),
        owner_kind,
        owner_id,
        action_label,
        location,
        note,
        actual_at_utc: actual,
        front_actual_end_utc: front_end,
        rear_actual_start_utc: rear_start,
    }
}

fn shared_boundary_actuals(minute: &str, actions: &[TripActionView]) -> (Option<String>, Option<String>) {
    let front_end = actions
        .iter()
        .find(|a| a.planned_end_at == minute)
        .and_then(action_end_actual);
    let rear_start = actions
        .iter()
        .find(|a| a.planned_start_at == minute)
        .and_then(action_start_actual);
    (front_end, rear_start)
}

fn action_end_actual(action: &TripActionView) -> Option<String> {
    action
        .actual
        .end_at_utc
        .clone()
        .or_else(|| action.actual.pending_end_at_utc.clone())
}

fn action_start_actual(action: &TripActionView) -> Option<String> {
    action
        .actual
        .start_at_utc
        .clone()
        .or_else(|| action.actual.pending_start_at_utc.clone())
}

enum CanonicalCandidate {
    ActionStart(String),
    ActionEnd(String),
    Checkpoint(String),
}

impl Clone for CanonicalCandidate {
    fn clone(&self) -> Self {
        match self {
            Self::ActionStart(id) => Self::ActionStart(id.clone()),
            Self::ActionEnd(id) => Self::ActionEnd(id.clone()),
            Self::Checkpoint(id) => Self::Checkpoint(id.clone()),
        }
    }
}

enum CanonicalOwner {
    ActionStart(String),
    ActionEnd(String),
    Checkpoint(String),
}

/// Minute-level owners excluding one action (used when that action is being deleted).
pub fn remaining_users_at_minute(
    minute: &str,
    excluded_action_id: &str,
    actions: &[TripActionView],
    checkpoints: &[CheckpointSnapshot],
) -> Vec<MinuteUser> {
    let mut users = Vec::new();
    for action in actions {
        if action.id == excluded_action_id {
            continue;
        }
        if action.planned_start_at == minute {
            users.push(MinuteUser::ActionStart(action.id.clone()));
        }
        if action.planned_end_at == minute {
            users.push(MinuteUser::ActionEnd(action.id.clone()));
        }
    }
    for cp in checkpoints {
        if cp.planned_at_utc.as_deref() == Some(minute) {
            users.push(MinuteUser::Checkpoint(cp.id.clone()));
        }
    }
    users
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MinuteUser {
    ActionStart(String),
    ActionEnd(String),
    Checkpoint(String),
}

pub fn pick_canonical_user(users: &[MinuteUser]) -> Option<MinuteUser> {
    if users.is_empty() {
        return None;
    }
    let group: Vec<CanonicalCandidate> = users
        .iter()
        .map(|u| match u {
            MinuteUser::ActionStart(id) => CanonicalCandidate::ActionStart(id.clone()),
            MinuteUser::ActionEnd(id) => CanonicalCandidate::ActionEnd(id.clone()),
            MinuteUser::Checkpoint(id) => CanonicalCandidate::Checkpoint(id.clone()),
        })
        .collect();
    match pick_owner(&group) {
        Ok(CanonicalOwner::ActionStart(id)) => Some(MinuteUser::ActionStart(id)),
        Ok(CanonicalOwner::ActionEnd(id)) => Some(MinuteUser::ActionEnd(id)),
        Ok(CanonicalOwner::Checkpoint(id)) => Some(MinuteUser::Checkpoint(id)),
        Err(_) => None,
    }
}

fn pick_owner(group: &[CanonicalCandidate]) -> DomainResult<CanonicalOwner> {
    if group.iter().any(|c| matches!(c, CanonicalCandidate::ActionStart(_))) {
        let id = group
            .iter()
            .find_map(|c| match c {
                CanonicalCandidate::ActionStart(id) => Some(id.clone()),
                _ => None,
            })
            .unwrap();
        return Ok(CanonicalOwner::ActionStart(id));
    }
    if group.iter().any(|c| matches!(c, CanonicalCandidate::ActionEnd(_))) {
        let id = group
            .iter()
            .find_map(|c| match c {
                CanonicalCandidate::ActionEnd(id) => Some(id.clone()),
                _ => None,
            })
            .unwrap();
        return Ok(CanonicalOwner::ActionEnd(id));
    }
    if let Some(CanonicalCandidate::Checkpoint(id)) = group.first() {
        return Ok(CanonicalOwner::Checkpoint(id.clone()));
    }
    Err(DomainError::invalid_plan("empty canonical minute group"))
}
