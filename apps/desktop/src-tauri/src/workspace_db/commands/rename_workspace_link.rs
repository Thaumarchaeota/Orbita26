use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, now, require_live_member, require_member_container,
};
use super::super::types::{RenameWorkspaceLinkRequest, WorkspaceResponse};

pub fn rename_workspace_link(data_dir: &str, req: RenameWorkspaceLinkRequest) -> DomainResult<WorkspaceResponse> {
    if req.link_title.trim().is_empty() {
        return Err(WorkspaceError::invalid_patch("linkTitle is required").into());
    }
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let member = require_live_member(tx, &req.member.id)?;
            if member.container_id != req.container.id || member.member_kind != "link" {
                return Err(WorkspaceError::invalid_patch("member is not a link in this container").into());
            }
            check_revision(req.member_expected_revision, member.revision)?;
            let now = now();
            tx.execute(
                "UPDATE workspace_member SET link_title = ?1, updated_at_utc = ?2, revision = revision + 1 WHERE id = ?3",
                params![req.link_title.trim(), now, req.member.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
