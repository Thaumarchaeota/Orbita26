use super::projection::{ProjectProjection, TaskProjection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReconciliationReport {
    pub account_id: String,
    pub projects_matched: u32,
    pub projects_diverged: u32,
    pub tasks_matched: u32,
    pub tasks_diverged: u32,
    pub divergences: Vec<ReconciliationDivergence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReconciliationDivergence {
    pub entity_type: EntityType,
    pub entity_id: String,
    pub local_hash: String,
    pub remote_hash: String,
    pub resolution: DivergenceResolution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntityType {
    Project,
    Task,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DivergenceResolution {
    Pending,
    AcceptRemote,
    AcceptLocal,
    ManualReview,
}

pub fn reconcile_tasks(
    local: &[TaskProjection],
    remote: &[TaskProjection],
) -> ReconciliationReport {
    let mut matched = 0u32;
    let mut diverged = 0u32;
    let mut divergences = Vec::new();

    let remote_map: std::collections::HashMap<_, _> =
        remote.iter().map(|t| (t.task_id.as_str(), t)).collect();

    for lt in local {
        match remote_map.get(lt.task_id.as_str()) {
            Some(rt) if lt.content_hash == rt.content_hash => matched += 1,
            Some(rt) => {
                diverged += 1;
                divergences.push(ReconciliationDivergence {
                    entity_type: EntityType::Task,
                    entity_id: lt.task_id.clone(),
                    local_hash: lt.content_hash.clone(),
                    remote_hash: rt.content_hash.clone(),
                    resolution: DivergenceResolution::Pending,
                });
            }
            None => {
                diverged += 1;
                divergences.push(ReconciliationDivergence {
                    entity_type: EntityType::Task,
                    entity_id: lt.task_id.clone(),
                    local_hash: lt.content_hash.clone(),
                    remote_hash: String::new(),
                    resolution: DivergenceResolution::ManualReview,
                });
            }
        }
    }

    ReconciliationReport {
        account_id: String::new(),
        projects_matched: 0,
        projects_diverged: 0,
        tasks_matched: matched,
        tasks_diverged: diverged,
        divergences,
    }
}

pub fn reconcile_projects(
    local: &[ProjectProjection],
    remote: &[ProjectProjection],
) -> (u32, u32) {
    let remote_map: std::collections::HashMap<_, _> =
        remote.iter().map(|p| (p.project_id.as_str(), p)).collect();
    let mut matched = 0u32;
    let mut diverged = 0u32;
    for lp in local {
        match remote_map.get(lp.project_id.as_str()) {
            Some(rp) if lp.content_hash == rp.content_hash => matched += 1,
            Some(_) | None => diverged += 1,
        }
    }
    (matched, diverged)
}
