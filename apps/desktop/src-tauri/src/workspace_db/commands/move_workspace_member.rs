use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, move_member, now, require_live_member,
    require_member_container,
};
use super::super::types::{MoveWorkspaceMemberRequest, WorkspaceResponse};

pub fn move_workspace_member(data_dir: &str, req: MoveWorkspaceMemberRequest) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let source = require_member_container(tx, &req.source.id)?;
            let target = require_member_container(tx, &req.target.id)?;
            check_revision(req.source.expected_revision, source.revision)?;
            if req.source.id != req.target.id {
                check_revision(req.target.expected_revision, target.revision)?;
            }
            require_live_member(tx, &req.member_id)?;
            let now = now();
            move_member(tx, &req.member_id, &req.source.id, &req.target.id, req.position, &now)?;
            bump_container(tx, &req.source.id, &now)?;
            if req.source.id != req.target.id {
                bump_container(tx, &req.target.id, &now)?;
            }
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
