use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, now, require_live_journal_document, require_live_member,
    require_member_container, soft_delete_member,
};
use super::super::types::{DeleteJournalDocumentFromWorkspaceRequest, WorkspaceResponse};

pub fn delete_journal_document_from_workspace(
    data_dir: &str,
    req: DeleteJournalDocumentFromWorkspaceRequest,
) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let revision = require_live_journal_document(tx, &req.entry.id)?;
            check_revision(req.entry.expected_revision, revision)?;
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let member = require_live_member(tx, &req.member.id)?;
            if member.container_id != req.container.id
                || member.member_kind != "journal_document"
                || member.object_id.as_deref() != Some(req.entry.id.as_str())
            {
                return Err(WorkspaceError::invalid_patch("member does not reference journal document").into());
            }
            let now = now();
            tx.execute(
                "UPDATE journal_entry SET deleted_at_utc = ?1, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2",
                params![now, req.entry.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            soft_delete_member(tx, &req.member.id, &req.container.id, &now)?;
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
