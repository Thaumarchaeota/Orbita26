use crate::productivity_db::coordinator::{in_transaction, with_read, with_write};

use super::super::commands::{optional_trimmed, require_conn, require_title, validate_time_range};
use super::super::detail_files;
use super::super::error::JournalResult;
use super::super::repository::{self, EntryRow};
use super::super::types::{CreateDocumentRequest, EntryResponse, SaveDocumentRequest};

pub fn create_document(data_dir: &str, req: CreateDocumentRequest) -> JournalResult<EntryResponse> {
    let title = require_title(&req.title)?;
    validate_time_range(&req.started_at, req.ended_at.as_deref())?;
    let id = repository::new_uuid();
    let markdown = req.markdown.unwrap_or_default();
    let (version_id, sha) = detail_files::prepare_detail_version(data_dir, &id, &markdown)?;
    let now = repository::utc_now();

    let result = with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let row = EntryRow {
                id: id.clone(),
                revision: 1,
                kind: "document".to_string(),
                title: Some(title),
                started_at_utc: req.started_at,
                ended_at_utc: req.ended_at,
                mood: optional_trimmed(req.mood),
                text: None,
                summary: optional_trimmed(req.summary),
                detail_file_id: Some(version_id.clone()),
                detail_sha256: Some(sha),
                created_at_utc: now.clone(),
                updated_at_utc: now,
                deleted_at_utc: None,
            };
            repository::insert_entry(tx, &row)?;
            let entry = repository::row_to_snapshot(data_dir, row, true)?;
            Ok(EntryResponse { entry })
        })
    })
    .map_err(super::super::error::JournalError::from);
    if result.is_err() {
        detail_files::remove_prepared_detail_version(data_dir, &id, &version_id);
    }
    result
}

pub fn save_document(data_dir: &str, req: SaveDocumentRequest) -> JournalResult<EntryResponse> {
    let canonical_id = if req.markdown.is_some() {
        Some(with_read(data_dir, |conn| {
            let conn = require_conn(conn)?;
            let existing = repository::get_entry_row_conn(conn, &req.id)?
                .ok_or_else(|| super::super::error::JournalError::entry_not_found("journal entry not found"))?;
            if existing.deleted_at_utc.is_some() {
                return Err(super::super::error::JournalError::entry_deleted(
                    "journal entry is deleted",
                )
                .into());
            }
            repository::require_document(&existing)?;
            Ok(existing.id)
        })?)
    } else {
        None
    };

    let prepared_detail = if let (Some(markdown), Some(canonical_id)) =
        (req.markdown.as_ref(), canonical_id.as_deref())
    {
        Some(detail_files::prepare_detail_version(
            data_dir,
            canonical_id,
            markdown,
        )?)
    } else {
        None
    };

    let rollback_version = prepared_detail.as_ref().map(|(version_id, _)| version_id.clone());

    let result = with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let existing = repository::require_live_entry(tx, &req.id)?;
            repository::require_document(&existing)?;
            repository::check_revision(&existing, req.expected_revision)?;

            let title = match req.title.as_deref() {
                Some(v) => Some(require_title(v)?),
                None => existing.title.clone(),
            };
            let title = title.ok_or_else(|| {
                super::super::error::JournalError::title_required("title is required")
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

            let (detail_file_id, detail_sha256) = if let Some((version_id, sha)) = &prepared_detail {
                (Some(version_id.clone()), Some(sha.clone()))
            } else {
                (existing.detail_file_id.clone(), existing.detail_sha256.clone())
            };

            let row = EntryRow {
                id: existing.id,
                revision: existing.revision + 1,
                kind: existing.kind,
                title: Some(title),
                started_at_utc: started_at,
                ended_at_utc: ended_at,
                mood: super::super::commands::apply_patch_option(existing.mood, req.mood),
                text: None,
                summary: super::super::commands::apply_patch_option(existing.summary, req.summary),
                detail_file_id,
                detail_sha256,
                created_at_utc: existing.created_at_utc,
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
        if let Some(version_id) = &rollback_version {
            if let Some(canonical_id) = canonical_id.as_deref() {
                detail_files::remove_prepared_detail_version(data_dir, canonical_id, version_id);
            }
        }
    }
    result
}
