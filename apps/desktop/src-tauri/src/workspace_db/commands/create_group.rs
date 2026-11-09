use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::repository::{build_workspace_snapshot, create_group_row, now};
use super::super::types::{CreateGroupRequest, WorkspaceResponse};

pub fn create_group(data_dir: &str, req: CreateGroupRequest) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let now = now();
            create_group_row(tx, &req.title, req.root.expected_revision, req.root_position, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
