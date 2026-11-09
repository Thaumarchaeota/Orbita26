use crate::productivity_db::coordinator::{in_transaction, with_write};

use super::super::commands::{optional_trimmed, require_conn, require_non_empty_text, validate_time_range};
use super::super::error::JournalResult;
use super::super::repository::{self, EntryRow};
use super::super::types::{CreateNoteRequest, EntryResponse, UpdateNoteRequest};

pub fn create_note(data_dir: &str, req: CreateNoteRequest) -> JournalResult<EntryResponse> {
    validate_time_range(&req.started_at, req.ended_at.as_deref())?;
    let text = require_non_empty_text(&req.text)?;
    let id = repository::new_uuid();
    let now = repository::utc_now();

    Ok(with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let row = EntryRow {
                id: id.clone(),
                revision: 1,
                kind: "note".to_string(),
                title: optional_trimmed(req.title),
                started_at_utc: req.started_at,
                ended_at_utc: req.ended_at,
                mood: optional_trimmed(req.mood),
                text: Some(text),
                summary: None,
                detail_file_id: None,
                detail_sha256: None,
                created_at_utc: now.clone(),
                updated_at_utc: now,
                deleted_at_utc: None,
            };
            repository::insert_entry(tx, &row)?;
            let entry = repository::row_to_snapshot(data_dir, row, false)?;
            Ok(EntryResponse { entry })
        })
    })?)
}

pub fn update_note(data_dir: &str, req: UpdateNoteRequest) -> JournalResult<EntryResponse> {
    Ok(with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let existing = repository::require_live_entry(tx, &req.id)?;
            repository::require_note(&existing)?;
            repository::check_revision(&existing, req.expected_revision)?;

            let text = match req.text.as_deref() {
                Some(v) => Some(require_non_empty_text(v)?),
                None => existing.text.clone(),
            };
            let text = text.ok_or_else(|| {
                super::super::error::JournalError::new("TEXT_REQUIRED", "text is required")
            })?;

            let started_at = req
                .started_at
                .clone()
                .unwrap_or_else(|| existing.started_at_utc.clone());
            let ended_at = match req.ended_at {
                Some(v) => v,
                None => existing.ended_at_utc.clone(),
            };
            validate_time_range(&started_at, ended_at.as_deref())?;

            let row = EntryRow {
                id: existing.id,
                revision: existing.revision + 1,
                kind: existing.kind,
                title: match req.title {
                    Some(v) => v.and_then(|s| optional_trimmed(Some(s))),
                    None => existing.title,
                },
                started_at_utc: started_at,
                ended_at_utc: ended_at,
                mood: super::super::commands::apply_patch_option(existing.mood, req.mood),
                text: Some(text),
                summary: None,
                detail_file_id: None,
                detail_sha256: None,
                created_at_utc: existing.created_at_utc,
                updated_at_utc: repository::utc_now(),
                deleted_at_utc: None,
            };
            repository::update_entry_row(tx, &row)?;
            let entry = repository::row_to_snapshot(data_dir, row, false)?;
            Ok(EntryResponse { entry })
        })
    })?)
}
