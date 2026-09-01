use super::outbox::{CommandKind, CommandStatus, WorkCommand};
use super::projection::{ProjectProjection, TaskProjection, WorkMirror};
use chrono::Utc;
use std::collections::HashMap;

pub struct MockTickTickProvider {
    mirror: WorkMirror,
    undo_window_secs: u64,
    last_completed: Option<(String, chrono::DateTime<Utc>)>,
}

impl MockTickTickProvider {
    pub fn new(account_id: impl Into<String>) -> Self {
        Self {
            mirror: WorkMirror {
                account_id: account_id.into(),
                projects: vec![],
                tasks: vec![],
                mirror_version: 0,
            },
            undo_window_secs: 3,
            last_completed: None,
        }
    }

    pub fn with_task(mut self, task: TaskProjection) -> Self {
        self.mirror.tasks.push(task);
        self
    }

    pub fn with_project(mut self, project: ProjectProjection) -> Self {
        self.mirror.projects.push(project);
        self
    }

    pub fn mirror(&self) -> &WorkMirror {
        &self.mirror
    }

    pub fn execute_command(&mut self, cmd: &mut WorkCommand) -> Result<(), MockProviderError> {
        cmd.mark_in_flight();
        match &cmd.kind {
            CommandKind::CompleteTask { task_id } => {
                let task = self
                    .find_task_mut(task_id)
                    .ok_or(MockProviderError::TaskNotFound)?;
                task.completed = true;
                task.synced_at = Utc::now();
                self.last_completed = Some((task_id.clone(), Utc::now()));
                cmd.mark_succeeded("completed", Some(task_id.clone()));
            }
            CommandKind::UndoComplete { task_id } => {
                if let Some((last_id, at)) = &self.last_completed {
                    let elapsed = (Utc::now() - *at).num_seconds() as u64;
                    if last_id == task_id && elapsed <= self.undo_window_secs {
                        let task = self
                            .find_task_mut(task_id)
                            .ok_or(MockProviderError::TaskNotFound)?;
                        task.completed = false;
                        task.synced_at = Utc::now();
                        self.last_completed = None;
                        cmd.mark_succeeded("undo complete", Some(task_id.clone()));
                    } else {
                        cmd.status = CommandStatus::Failed;
                        cmd.result_summary = Some("undo window expired".into());
                    }
                } else {
                    cmd.status = CommandStatus::Failed;
                    cmd.result_summary = Some("nothing to undo".into());
                }
            }
            CommandKind::ShiftDue { task_id, new_due } => {
                let task = self
                    .find_task_mut(task_id)
                    .ok_or(MockProviderError::TaskNotFound)?;
                task.due_date = *new_due;
                task.synced_at = Utc::now();
                cmd.mark_succeeded("due shifted", Some(task_id.clone()));
            }
            CommandKind::ShiftStart { task_id, new_start } => {
                let task = self
                    .find_task_mut(task_id)
                    .ok_or(MockProviderError::TaskNotFound)?;
                task.start_date = *new_start;
                task.synced_at = Utc::now();
                cmd.mark_succeeded("start shifted", Some(task_id.clone()));
            }
            CommandKind::CreateTask { title, project_id } => {
                if title == "Ambiguous" {
                    cmd.mark_awaiting_confirmation("create timeout — manual confirmation required");
                    return Ok(());
                }
                let id = format!("tt-{}", self.mirror.tasks.len() + 1);
                self.mirror.tasks.push(TaskProjection {
                    task_id: id.clone(),
                    project_id: project_id.clone(),
                    title: title.clone(),
                    content: None,
                    completed: false,
                    due_date: None,
                    start_date: None,
                    priority: 0,
                    content_hash: format!("hash-{}", title),
                    synced_at: Utc::now(),
                    external_etag: None,
                });
                self.mirror.mirror_version += 1;
                cmd.mark_succeeded("created", Some(id));
            }
            CommandKind::UpdateTask { task_id } => {
                let local = self.find_task(task_id);
                if let Some(expected) = &cmd.expected_content_hash {
                    if local.map(|t| t.content_hash.as_str()) != Some(expected.as_str()) {
                        cmd.status = CommandStatus::Conflict;
                        cmd.result_summary = Some("expected content hash mismatch".into());
                        return Ok(());
                    }
                }
                if let Some(expected_etag) = &cmd.expected_external_etag {
                    if local.and_then(|t| t.external_etag.as_deref()) != Some(expected_etag.as_str())
                    {
                        cmd.status = CommandStatus::Conflict;
                        cmd.result_summary = Some("expected etag mismatch".into());
                        return Ok(());
                    }
                }
                let remote_etag = local.and_then(|t| t.external_etag.clone());
                if remote_etag.as_deref() == Some("stale") {
                    cmd.status = CommandStatus::Conflict;
                    cmd.result_summary = Some("external edit conflict".into());
                } else if let Some(task) = self.find_task_mut(task_id) {
                    task.synced_at = Utc::now();
                    cmd.mark_succeeded("updated", Some(task_id.clone()));
                } else {
                    return Err(MockProviderError::TaskNotFound);
                }
            }
            CommandKind::DeleteTask { task_id } => {
                let before = self.mirror.tasks.len();
                self.mirror.tasks.retain(|t| t.task_id != *task_id);
                if self.mirror.tasks.len() == before {
                    return Err(MockProviderError::TaskNotFound);
                }
                cmd.mark_succeeded("deleted", Some(task_id.clone()));
            }
        }
        Ok(())
    }

    pub fn simulate_external_edit(&mut self, task_id: &str, new_hash: &str) {
        if let Some(task) = self.find_task_mut(task_id) {
            task.content_hash = new_hash.to_string();
            task.external_etag = Some("stale".into());
            task.synced_at = Utc::now();
        }
    }

    fn find_task(&self, id: &str) -> Option<&TaskProjection> {
        self.mirror.tasks.iter().find(|t| t.task_id == id)
    }

    fn find_task_mut(&mut self, id: &str) -> Option<&mut TaskProjection> {
        self.mirror.tasks.iter_mut().find(|t| t.task_id == id)
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MockProviderError {
    #[error("task not found")]
    TaskNotFound,
}

pub struct OfflineConflictDetector {
    pending: HashMap<String, WorkCommand>,
}

impl OfflineConflictDetector {
    pub fn new() -> Self {
        Self {
            pending: HashMap::new(),
        }
    }

    pub fn enqueue(&mut self, cmd: WorkCommand) -> Result<(), String> {
        let key = match &cmd.kind {
            CommandKind::UpdateTask { task_id }
            | CommandKind::CompleteTask { task_id }
            | CommandKind::DeleteTask { task_id } => task_id.clone(),
            _ => cmd.command_id.to_string(),
        };
        if self.pending.contains_key(&key) {
            return Err(format!("offline conflict on {key}"));
        }
        self.pending.insert(key, cmd);
        Ok(())
    }
}

impl Default for OfflineConflictDetector {
    fn default() -> Self {
        Self::new()
    }
}
