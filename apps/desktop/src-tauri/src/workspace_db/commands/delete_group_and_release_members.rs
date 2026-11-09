use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_member_ids, check_revision, load_live_members, now,
    reorder_container_members, require_live_container, require_live_group, ROOT_CONTAINER_ID,
};
use super::super::types::{DeleteGroupAndReleaseMembersRequest, WorkspaceResponse};

pub fn delete_group_and_release_members(
    data_dir: &str,
    req: DeleteGroupAndReleaseMembersRequest,
) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let group = require_live_group(tx, &req.group.id)?;
            let root = require_live_container(tx, ROOT_CONTAINER_ID)?;
            check_revision(req.group.expected_revision, group.revision)?;
            check_revision(req.root.expected_revision, root.revision)?;
            let members = load_live_members(tx, &req.group.id)?;
            check_member_ids(&req.expected_members, &members)?;
            let now = now();
            let root_members = load_live_members(tx, ROOT_CONTAINER_ID)?;
            let mut root_ids = root_members.iter().map(|m| m.id.clone()).collect::<Vec<_>>();
            for m in &members {
                tx.execute(
                    "UPDATE workspace_member SET container_id = ?1, updated_at_utc = ?2 WHERE id = ?3",
                    params![ROOT_CONTAINER_ID, now, m.id],
                )
                .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
                root_ids.push(m.id.clone());
            }
            reorder_container_members(tx, ROOT_CONTAINER_ID, &root_ids, &now)?;
            tx.execute(
                "UPDATE workspace_container SET deleted_at_utc = ?1, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2",
                params![now, req.group.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            bump_container(tx, ROOT_CONTAINER_ID, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
