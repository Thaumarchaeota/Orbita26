use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, now, reorder_container_members,
    require_member_container,
};
use super::super::types::{ReorderWorkspaceContainerRequest, WorkspaceResponse};

pub fn reorder_workspace_container(
    data_dir: &str,
    req: ReorderWorkspaceContainerRequest,
) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let now = now();
            reorder_container_members(tx, &req.container.id, &req.member_ids, &now)?;
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
