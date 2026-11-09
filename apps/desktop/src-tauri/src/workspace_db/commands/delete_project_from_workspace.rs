use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::util::new_uuid;
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, ensure_no_active_interval_for_project_tasks, now,
    require_live_member, require_live_project, require_member_container, soft_delete_member,
};
use super::super::types::{DeleteProjectFromWorkspaceRequest, WorkspaceResponse};

pub fn delete_project_from_workspace(
    data_dir: &str,
    req: DeleteProjectFromWorkspaceRequest,
) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let revision = require_live_project(tx, &req.project.id)?;
            check_revision(req.project.expected_revision, revision)?;
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let member = require_live_member(tx, &req.member.id)?;
            if member.container_id != req.container.id
                || member.member_kind != "project"
                || member.object_id.as_deref() != Some(req.project.id.as_str())
            {
                return Err(WorkspaceError::invalid_patch("member does not reference project").into());
            }
            ensure_no_active_interval_for_project_tasks(tx, &req.project.id)?;
            let now = now();
            let batch = new_uuid();
            tx.execute(
                "UPDATE productivity_project SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3",
                params![now, batch, req.project.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            tx.execute(
                "UPDATE productivity_task SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2
                 WHERE project_id = ?3 AND deleted_at_utc IS NULL",
                params![now, batch, req.project.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            tx.execute(
                "UPDATE productivity_project SET revision = revision + 1, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.project.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            soft_delete_member(tx, &req.member.id, &req.container.id, &now)?;
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
