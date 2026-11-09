use crate::productivity_db::coordinator::{in_transaction, with_read, with_write};

use super::super::commands::{optional_trimmed, require_conn, require_title, validate_time_range};
use super::super::detail_files;
use super::super::error::JournalResult;
use super::super::repository::{self, EntryRow};
use super::super::types::{ConvertNoteToDocumentRequest, EntryResponse};

pub fn convert_note_to_document(
    data_dir: &str,
    req: ConvertNoteToDocumentRequest,
) -> JournalResult<EntryResponse> {
    let existing = with_read(data_dir, |conn| {
        let conn = require_conn(conn)?;
        Ok(repository::get_entry_row_conn(conn, &req.id)?
            .ok_or_else(|| super::super::error::JournalError::entry_not_found("journal entry not found"))?)
    })?;

    if existing.deleted_at_utc.is_some() {
        return Err(super::super::error::JournalError::entry_deleted(
            "journal entry is deleted",
        ));
    }
    repository::require_note(&existing)?;
    repository::check_revision(&existing, req.expected_revision)?;

    let title = require_title(&req.title)?;
    let markdown = existing.text.clone().unwrap_or_default();
    let (version_id, sha) =
        detail_files::prepare_detail_version(data_dir, &existing.id, &markdown)?;

    let result = with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let current = repository::require_live_entry(tx, &req.id)?;
            repository::require_note(&current)?;
            repository::check_revision(&current, req.expected_revision)?;

            let started_at = current.started_at_utc.clone();
            let ended_at = match req.ended_at {
                Some(v) => v,
                None => current.ended_at_utc.clone(),
            };
            validate_time_range(&started_at, ended_at.as_deref())?;

            let row = EntryRow {
                id: current.id,
                revision: current.revision + 1,
                kind: "document".to_string(),
                title: Some(title),
                started_at_utc: started_at,
                ended_at_utc: ended_at,
                mood: super::super::commands::apply_patch_option(current.mood, req.mood),
                text: None,
                summary: optional_trimmed(req.summary),
                detail_file_id: Some(version_id.clone()),
                detail_sha256: Some(sha),
                created_at_utc: current.created_at_utc,
                updated_at_utc: repository::utc_now(),
                deleted_at_utc: None,
            };
            repository::update_entry_row(tx, &row)?;
            let entry = repository::row_to_snapshot(data_dir, row, true)?;
            Ok(EntryResponse { entry })
        })
    })
    .map_err(super::super::error::JournalError::from);
    if result.is_err() {
        detail_files::remove_prepared_detail_version(data_dir, &existing.id, &version_id);
    }
    result
}
