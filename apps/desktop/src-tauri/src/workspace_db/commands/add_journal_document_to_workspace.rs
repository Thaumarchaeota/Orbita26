use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, check_revision, insert_domain_member, now,
    require_live_journal_document, require_member_container, DOMAIN_JOURNAL, TYPE_ENTRY,
};
use super::super::types::{AddJournalDocumentToWorkspaceRequest, WorkspaceResponse};

pub fn add_journal_document_to_workspace(
    data_dir: &str,
    req: AddJournalDocumentToWorkspaceRequest,
) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let revision = require_live_journal_document(tx, &req.entry.id)?;
            check_revision(req.entry.expected_revision, revision)?;
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let now = now();
            insert_domain_member(
                tx,
                &req.container.id,
                "journal_document",
                DOMAIN_JOURNAL,
                TYPE_ENTRY,
                &req.entry.id,
                req.position,
                &now,
            )?;
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
