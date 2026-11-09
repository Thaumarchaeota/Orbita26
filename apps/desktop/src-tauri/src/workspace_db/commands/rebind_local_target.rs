use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, now, require_live_member, require_member_container,
};
use super::super::types::{RebindLocalTargetRequest, WorkspaceResponse};

pub fn rebind_local_target(data_dir: &str, req: RebindLocalTargetRequest) -> DomainResult<WorkspaceResponse> {
    if req.device_id.trim().is_empty() || req.local_path.trim().is_empty() {
        return Err(WorkspaceError::invalid_patch("deviceId and localPath are required").into());
    }
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let member = require_live_member(tx, &req.member.id)?;
            if member.container_id != req.container.id || member.member_kind != "link" {
                return Err(WorkspaceError::invalid_patch("member is not a link in this container").into());
            }
            let link_kind = member.link_kind.as_deref().unwrap_or("");
            if link_kind == "bookmark" {
                return Err(WorkspaceError::invalid_patch("bookmark links do not use local binding").into());
            }
            check_revision(req.member_expected_revision, member.revision)?;
            let now = now();
            tx.execute(
                "INSERT INTO workspace_device_binding (link_member_id, device_id, local_path)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(link_member_id, device_id) DO UPDATE SET local_path = excluded.local_path",
                params![req.member.id, req.device_id.trim(), req.local_path.trim()],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            tx.execute(
                "UPDATE workspace_member SET updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2",
                params![now, req.member.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, Some(req.device_id.trim())).map_err(Into::into)
        })
    })
}
