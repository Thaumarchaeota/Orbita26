use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, now, require_live_member, soft_delete_member,
    require_member_container,
};
use super::super::types::{RemoveListFromWorkspaceRequest, WorkspaceResponse};

pub fn remove_list_from_workspace(
    data_dir: &str,
    req: RemoveListFromWorkspaceRequest,
) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let member = require_live_member(tx, &req.member.id)?;
            if member.container_id != req.container.id {
                return Err(WorkspaceError::invalid_patch("member not in container").into());
            }
            if member.member_kind != "list" {
                return Err(WorkspaceError::invalid_patch("member is not a list").into());
            }
            let now = now();
            soft_delete_member(tx, &req.member.id, &req.container.id, &now)?;
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
