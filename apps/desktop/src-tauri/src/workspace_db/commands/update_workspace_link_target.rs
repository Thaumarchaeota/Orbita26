use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, now, require_live_member, require_member_container,
    validate_local_link_inputs,
};
use super::super::types::{UpdateWorkspaceLinkTargetRequest, WorkspaceResponse};

pub fn update_workspace_link_target(
    data_dir: &str,
    req: UpdateWorkspaceLinkTargetRequest,
) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let member = require_live_member(tx, &req.member.id)?;
            if member.container_id != req.container.id || member.member_kind != "link" {
                return Err(WorkspaceError::invalid_patch("member is not a link in this container").into());
            }
            let link_kind = member
                .link_kind
                .as_deref()
                .ok_or_else(|| WorkspaceError::invalid_patch("link kind missing"))?;
            check_revision(req.member_expected_revision, member.revision)?;
            let now = now();
            if link_kind == "bookmark" {
                let url = req
                    .link_url
                    .as_deref()
                    .ok_or_else(|| WorkspaceError::invalid_patch("linkUrl is required for bookmark"))?;
                if url.trim().is_empty() {
                    return Err(WorkspaceError::invalid_patch("linkUrl is required for bookmark").into());
                }
                if req.local_path.is_some() || req.device_id.is_some() {
                    return Err(WorkspaceError::invalid_patch("local path is not used for bookmark").into());
                }
                tx.execute(
                    "UPDATE workspace_member SET link_url = ?1, updated_at_utc = ?2, revision = revision + 1 WHERE id = ?3",
                    params![url.trim(), now, req.member.id],
                )
                .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            } else {
                validate_local_link_inputs(
                    link_kind,
                    None,
                    req.local_path.as_deref(),
                    req.device_id.as_deref(),
                )?;
                tx.execute(
                    "INSERT INTO workspace_device_binding (link_member_id, device_id, local_path)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(link_member_id, device_id) DO UPDATE SET local_path = excluded.local_path",
                    params![req.member.id, req.device_id.as_deref(), req.local_path.as_deref()],
                )
                .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
                tx.execute(
                    "UPDATE workspace_member SET updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2",
                    params![now, req.member.id],
                )
                .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            }
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, req.device_id.as_deref()).map_err(Into::into)
        })
    })
}
