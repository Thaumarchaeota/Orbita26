use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::util::new_uuid;
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, load_live_members, now, require_member_container,
    validate_link_kind, validate_local_link_inputs,
};
use super::super::types::{CreateWorkspaceLinkRequest, WorkspaceResponse};

pub fn create_workspace_link(data_dir: &str, req: CreateWorkspaceLinkRequest) -> DomainResult<WorkspaceResponse> {
    validate_link_kind(&req.link_kind)?;
    validate_local_link_inputs(
        &req.link_kind,
        req.link_url.as_deref(),
        req.local_path.as_deref(),
        req.device_id.as_deref(),
    )?;
    if req.link_title.trim().is_empty() {
        return Err(WorkspaceError::invalid_patch("linkTitle is required").into());
    }
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let members = load_live_members(tx, &req.container.id)?;
            let pos = req.position.unwrap_or(members.len() as i32);
            if pos < 0 || pos > members.len() as i32 {
                return Err(WorkspaceError::invalid_patch("position out of range").into());
            }
            let now = now();
            tx.execute(
                "UPDATE workspace_member SET position = position + 1, updated_at_utc = ?1
                 WHERE container_id = ?2 AND deleted_at_utc IS NULL AND position >= ?3",
                params![now, req.container.id, pos],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            let id = new_uuid();
            let link_url = if req.link_kind == "bookmark" {
                req.link_url.as_deref()
            } else {
                None
            };
            tx.execute(
                "INSERT INTO workspace_member (id, container_id, position, member_kind, link_kind, link_title, link_url, created_at_utc, updated_at_utc)
                 VALUES (?1, ?2, ?3, 'link', ?4, ?5, ?6, ?7, ?7)",
                params![id, req.container.id, pos, req.link_kind, req.link_title.trim(), link_url, now],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            if req.link_kind != "bookmark" {
                tx.execute(
                    "INSERT INTO workspace_device_binding (link_member_id, device_id, local_path) VALUES (?1, ?2, ?3)",
                    params![id, req.device_id.as_deref(), req.local_path.as_deref()],
                )
                .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            }
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, req.device_id.as_deref()).map_err(Into::into)
        })
    })
}
