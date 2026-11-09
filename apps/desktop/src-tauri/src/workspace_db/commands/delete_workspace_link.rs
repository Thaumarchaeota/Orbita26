use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, now, require_live_member, require_member_container,
    soft_delete_versioned_member,
};
use super::super::types::{DeleteWorkspaceLinkRequest, WorkspaceResponse};

pub fn delete_workspace_link(data_dir: &str, req: DeleteWorkspaceLinkRequest) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let member = require_live_member(tx, &req.member.id)?;
            if member.container_id != req.container.id || member.member_kind != "link" {
                return Err(WorkspaceError::invalid_patch("member is not a link in this container").into());
            }
            let now = now();
            soft_delete_versioned_member(
                tx,
                &req.member.id,
                &req.container.id,
                req.member_expected_revision,
                &now,
            )?;
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
