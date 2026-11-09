use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write, with_write_expected};
use crate::productivity_db::error::{DomainError, DomainResult};
use crate::productivity_db::point::{point_to_json, validate_point};
use crate::productivity_db::repository::*;
use crate::productivity_db::types::*;
use crate::productivity_db::util::{new_uuid, utc_now};
use crate::productivity_db::validation::*;

fn project_write<T>(data_dir:&str,expected:Option<&str>,f:impl FnOnce(&rusqlite::Connection)->DomainResult<T>)->DomainResult<T>{
    if let Some(expected)=expected { if std::path::Path::new(expected)!=std::path::Path::new(data_dir){return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消"));} with_write_expected(expected,f) } else { with_write(data_dir,f) }
}

pub fn create_project(data_dir: &str, req: CreateProjectRequest) -> DomainResult<ProjectResponse> {
    create_project_expected(data_dir, req, None)
}

pub fn create_project_expected(data_dir: &str, req: CreateProjectRequest, expected: Option<&str>) -> DomainResult<ProjectResponse> {
    validate_project_status(&req.status)?;
    if let Some(p) = &req.planned_point {
        validate_point(p)?;
    }
    if let Some(p) = &req.due_point {
        validate_point(p)?;
    }
    project_write(data_dir, expected, |conn| {
        in_transaction(conn, |tx| {
            let id = new_uuid();
            let now = utc_now();
            insert_project(
                tx,
                &id,
                &req.title,
                req.description.as_deref(),
                &req.status,
                point_to_json(&req.planned_point).as_deref(),
                point_to_json(&req.due_point).as_deref(),
                &now,
            )?;
            crate::workspace_db::repository::insert_domain_member(
                tx,
                crate::workspace_db::repository::ROOT_CONTAINER_ID,
                "project",
                crate::workspace_db::repository::DOMAIN_PRODUCTIVITY,
                crate::workspace_db::repository::TYPE_PROJECT,
                &id,
                None,
                &now,
            )?;
            crate::workspace_db::repository::bump_container(
                tx,
                crate::workspace_db::repository::ROOT_CONTAINER_ID,
                &now,
            )?;
            Ok(ProjectResponse {
                project: project_snapshot(tx, &id, true)?,
                restore_summary: None,
            })
        })
    })
}

pub fn create_task(data_dir: &str, req: CreateTaskRequest) -> DomainResult<ProjectResponse> {
    validate_task_status(&req.status)?;
    if let Some(p) = &req.planned_point {
        validate_point(p)?;
    }
    if let Some(p) = &req.due_point {
        validate_point(p)?;
    }
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (project, extra) = load_project_row(tx, &req.project.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            guard_project_members(tx, &req.project.id)?;
            if let Some(parent) = &req.parent_task_id {
                let tasks = load_tasks_for_project(tx, &req.project.id, true)?;
                if !tasks.iter().any(|t| t.id == *parent) {
                    return Err(DomainError::root_not_found("parent task not found"));
                }
            }
            let now = utc_now();
            let id = new_uuid();
            insert_task(
                tx,
                &id,
                &req.project.id,
                req.parent_task_id.as_deref(),
                &req.title,
                req.description.as_deref(),
                &req.status,
                point_to_json(&req.planned_point).as_deref(),
                point_to_json(&req.due_point).as_deref(),
                &now,
            )?;
            super::super::classification::set_task_classification(tx, &id, req.item_type_id.as_deref(), req.classification_expected.as_ref())?;
            bump_project(tx, &req.project.id, &now)?;
            Ok(ProjectResponse {
                project: project_snapshot(tx, &req.project.id, true)?,
                restore_summary: None,
            })
        })
    })
}

pub fn update_project(data_dir: &str, req: UpdateProjectRequest) -> DomainResult<ProjectResponse> {
    project_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (project, extra) = load_project_row(tx, &req.project.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            guard_project_members(tx, &req.project.id)?;
            let (planned, due) = apply_point_patch(
                &project.planned_point,
                &project.due_point,
                &req.patch.planned_point,
                &req.patch.due_point,
            )?;
            let title = req.patch.title.as_deref().unwrap_or(&project.title);
            let description = if req.patch.description.is_some() {
                req.patch.description.clone().flatten()
            } else {
                project.description.clone()
            };
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_project SET title = ?1, description = ?2, planned_point_json = ?3, due_point_json = ?4, updated_at_utc = ?5 WHERE id = ?6",
                params![
                    title,
                    description,
                    point_to_json(&planned),
                    point_to_json(&due),
                    now,
                    req.project.id
                ],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_project(tx, &req.project.id, &now)?;
            Ok(ProjectResponse {
                project: project_snapshot(tx, &req.project.id, true)?,
                restore_summary: None,
            })
        })
    })
}

pub fn update_task(data_dir: &str, req: UpdateTaskRequest) -> DomainResult<ProjectResponse> {
    project_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (project, extra) = load_project_row(tx, &req.project.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            guard_project_members(tx, &req.project.id)?;
            let tasks = load_tasks_for_project(tx, &req.project.id, true)?;
            let task = tasks
                .iter()
                .find(|t| t.id == req.task_id)
                .ok_or_else(|| DomainError::root_not_found("task not found"))?;
            let (planned, due) = apply_point_patch(
                &task.planned_point,
                &task.due_point,
                &req.patch.planned_point,
                &req.patch.due_point,
            )?;
            let title = req.patch.title.as_deref().unwrap_or(&task.title);
            let description = if req.patch.description.is_some() {
                req.patch.description.clone().flatten()
            } else {
                task.description.clone()
            };
            if let Some(target) = &req.patch.item_type_id {
                super::super::classification::set_task_classification(tx, &req.task_id, target.as_deref(), req.patch.classification_expected.as_ref())?;
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_task SET title = ?1, description = ?2, planned_point_json = ?3, due_point_json = ?4, updated_at_utc = ?5 WHERE id = ?6",
                params![
                    title,
                    description,
                    point_to_json(&planned),
                    point_to_json(&due),
                    now,
                    req.task_id
                ],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_project(tx, &req.project.id, &now)?;
            Ok(ProjectResponse {
                project: project_snapshot(tx, &req.project.id, true)?,
                restore_summary: None,
            })
        })
    })
}

pub fn move_task(data_dir: &str, req: MoveTaskRequest) -> DomainResult<ProjectResponse> {
    project_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (project, extra) = load_project_row(tx, &req.project.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            guard_project_members(tx, &req.project.id)?;
            let tasks = load_tasks_for_project(tx, &req.project.id, true)?;
            let task = tasks
                .iter()
                .find(|t| t.id == req.task_id)
                .ok_or_else(|| DomainError::root_not_found("task not found"))?;
            let affected = task_descendants(tx, &req.project.id, &req.task_id)?;
            let edges = crate::productivity_db::commands::live_edges_for_move(tx, &req.project.id)?;
            if edges.iter().any(|e| affected.contains(&e.source_task_id) || affected.contains(&e.target_task_id)) {
                return Err(DomainError::new("TASK_MOVE_HAS_SEQUENCE_EDGES", "请先解除受移动影响的顺序关系"));
            }
            let new_parent = match &req.parent_task_id {
                Some(parent) => Some(parent.as_str()),
                None => task.parent_task_id.as_deref(),
            };
            if let Some(parent) = new_parent {
                if parent == req.task_id {
                    return Err(DomainError::tree_cycle());
                }
                if !tasks.iter().any(|t| t.id == parent) {
                    return Err(DomainError::root_not_found("parent task not found"));
                }
            }
            if would_create_cycle(&tasks, &req.task_id, new_parent) {
                return Err(DomainError::tree_cycle());
            }
            let depth_of = |id: &str| -> Option<usize> {
                let mut depth = 0usize;
                let mut current = Some(id);
                while let Some(current_id) = current {
                    depth += 1;
                    current = tasks.iter().find(|candidate| candidate.id == current_id)?.parent_task_id.as_deref();
                    if depth > tasks.len() { return None; }
                }
                Some(depth)
            };
            let old_depth = depth_of(&req.task_id).ok_or_else(|| DomainError::tree_cycle())?;
            let new_depth = new_parent.map_or(Some(1), |parent| depth_of(parent).map(|depth| depth + 1)).ok_or_else(|| DomainError::tree_cycle())?;
            let depth_delta = new_depth as isize - old_depth as isize;
            let mut position_stmt = tx.prepare("SELECT task_id,parent_task_id FROM productivity_task_card_position WHERE project_id=?1 AND deleted_at_utc IS NULL").map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let positions = position_stmt.query_map([&req.project.id], |row| Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?))).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            for position in positions {
                let (positioned_task_id, recorded_parent) = position.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                if !affected.contains(&positioned_task_id) { continue; }
                let positioned = tasks.iter().find(|candidate| candidate.id == positioned_task_id).ok_or_else(|| DomainError::new("TASK_POSITION_INCONSISTENT", "任务卡片位置指向不存在的任务"))?;
                let predicted_parent = if positioned_task_id == req.task_id { new_parent } else { positioned.parent_task_id.as_deref() };
                let predicted_depth = depth_of(&positioned_task_id).map(|depth| depth as isize + depth_delta);
                if predicted_depth != Some(2) || predicted_parent != Some(recorded_parent.as_str()) {
                    return Err(DomainError::new("TASK_MOVE_HAS_CARD_POSITION", "此移动会使任务卡片位置脱离第二层父级，请使用同层移动或先移除卡片位置"));
                }
            }
            let actual_siblings = sibling_ids_for_parent(&tasks, new_parent, Some(&req.task_id));
            check_sibling_ids(&req.expected_siblings, &actual_siblings)?;
            let insert_at = req
                .insert_index
                .unwrap_or(actual_siblings.len() as i32)
                .clamp(0, actual_siblings.len() as i32) as usize;
            let mut ordered = actual_siblings;
            ordered.insert(insert_at, req.task_id.clone());
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_task SET parent_task_id = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![new_parent, now, req.task_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            write_sibling_positions(tx, &ordered, &now)?;
            let old_parent = task.parent_task_id.as_deref();
            if old_parent != new_parent {
                let old_siblings = sibling_ids_for_parent(&tasks, old_parent, Some(&req.task_id));
                write_sibling_positions(tx, &old_siblings, &now)?;
            }
            bump_project(tx, &req.project.id, &now)?;
            Ok(ProjectResponse {
                project: project_snapshot(tx, &req.project.id, true)?,
                restore_summary: None,
            })
        })
    })
}

pub fn set_project_status(data_dir: &str, req: SetProjectStatusRequest) -> DomainResult<ProjectResponse> {
    set_project_status_expected(data_dir, req, None)
}

pub fn set_project_status_expected(data_dir: &str, req: SetProjectStatusRequest, expected: Option<&str>) -> DomainResult<ProjectResponse> {
    validate_project_status(&req.status)?;
    project_write(data_dir, expected, |conn| {
        in_transaction(conn, |tx| {
            let (project, extra) = load_project_row(tx, &req.project.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            guard_project_members(tx, &req.project.id)?;
            let targets = collect_project_scope_targets(tx, &req.project.id)?;
            ensure_no_active_actions(tx, &targets)?;
            if !crate::productivity_db::checkpoint::pending_refs_for_target(tx, "project", &req.project.id)?.is_empty() {
                return Err(DomainError::revision_conflict("Project 存在未完成 Checkpoint，需通过确认式生命周期命令处理"));
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_project SET status = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![req.status, now, req.project.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_project(tx, &req.project.id, &now)?;
            Ok(ProjectResponse {
                project: project_snapshot(tx, &req.project.id, true)?,
                restore_summary: None,
            })
        })
    })
}

pub fn set_task_status(data_dir: &str, req: SetTaskStatusRequest) -> DomainResult<ProjectResponse> {
    validate_task_status(&req.status)?;
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (project, extra) = load_project_row(tx, &req.project.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            guard_project_members(tx, &req.project.id)?;
            require_live_task_in_project(tx, &req.project.id, &req.task_id)?;
            let targets = collect_task_subtree_targets(tx, &req.project.id, &req.task_id)?;
            ensure_no_active_actions(tx, &targets)?;
            if !crate::productivity_db::checkpoint::pending_refs_for_target(tx, "task", &req.task_id)?.is_empty() {
                return Err(DomainError::new("TASK_PENDING_CHECKPOINT_BLOCKS_STATUS", "所选任务存在未完成检查点，需先处理"));
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_task SET status = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![req.status, now, req.task_id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_project(tx, &req.project.id, &now)?;
            Ok(ProjectResponse {
                project: project_snapshot(tx, &req.project.id, true)?,
                restore_summary: None,
            })
        })
    })
}

pub fn delete_project(data_dir: &str, req: DeleteProjectRequest) -> DomainResult<ProjectResponse> {
    project_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (project, extra) = load_project_row(tx, &req.project.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            guard_project_members(tx, &req.project.id)?;
            let targets = collect_project_scope_targets(tx, &req.project.id)?;
            ensure_no_active_actions(tx, &targets)?;
            let now = utc_now();
            let batch = new_uuid();
            soft_delete_project_tree(tx, &req.project.id, &batch, &now)?;
            crate::workspace_db::repository::hide_live_domain_member(
                tx,
                crate::workspace_db::repository::DOMAIN_PRODUCTIVITY,
                crate::workspace_db::repository::TYPE_PROJECT,
                &req.project.id,
                &now,
            )?;
            bump_project(tx, &req.project.id, &now)?;
            Ok(ProjectResponse {
                project: project_snapshot(tx, &req.project.id, false)?,
                restore_summary: None,
            })
        })
    })
}

pub fn restore_project(data_dir: &str, req: RestoreProjectRequest) -> DomainResult<ProjectResponse> {
    project_write(data_dir, req.expected_data_dir.as_deref(), |conn| {
        in_transaction(conn, |tx| {
            let (project, extra) = load_project_row(tx, &req.project.id, false)?;
            guard_unknown(&extra)?;
            check_revision(req.project.expected_revision, project.revision)?;
            guard_project_members(tx, &req.project.id)?;
            if project.deleted_at_utc.is_none() {
                return Err(DomainError::invalid_patch("project is not deleted"));
            }
            let batch: String = tx
                .query_row(
                    "SELECT deletion_batch_id FROM productivity_project WHERE id = ?1",
                    [&req.project.id],
                    |row| row.get(0),
                )
                .map_err(|_| DomainError::delete_batch_mismatch())?;
            let now = utc_now();
            restore_project_tree(tx, &req.project.id, &batch, &now)?;
            bump_project(tx, &req.project.id, &now)?;
            Ok(ProjectResponse {
                project: project_snapshot(tx, &req.project.id, true)?,
                restore_summary: None,
            })
        })
    })
}

pub fn delete_task_subtree(data_dir: &str, req: DeleteTaskSubtreeRequest) -> DomainResult<ProjectResponse> {
    super::project_task_mvp::delete_task_subtree_exact(data_dir, req)
}

pub fn restore_task_subtree(data_dir: &str, req: RestoreTaskSubtreeRequest) -> DomainResult<ProjectResponse> {
    super::project_task_mvp::restore_task_subtree_exact(data_dir, req)
}
