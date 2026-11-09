use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, now, require_live_group, validate_group_title,
};
use super::super::types::{RenameGroupRequest, WorkspaceResponse};

pub fn rename_group(data_dir: &str, req: RenameGroupRequest) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let group = require_live_group(tx, &req.group.id)?;
            check_revision(req.group.expected_revision, group.revision)?;
            validate_group_title(&req.title)?;
            let now = now();
            tx.execute(
                "UPDATE workspace_container SET title = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![req.title.trim(), now, req.group.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            bump_container(tx, &req.group.id, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
