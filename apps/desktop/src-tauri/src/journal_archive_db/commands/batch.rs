use crate::productivity_db::coordinator::{in_transaction, with_read, with_write};

use super::super::commands::{
    apply_patch_option, optional_trimmed, require_conn, require_non_empty_text, require_title,
    validate_time_range,
};
use super::super::detail_files;
use super::super::error::{JournalError, JournalResult};
use super::super::repository::{self, EntryRow};
use super::super::types::{
    ConvertNoteToDocumentRequest, CreateDocumentRequest, CreateNoteRequest, EntrySnapshot,
    SaveDocumentRequest, UpdateNoteRequest,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct JournalAiBatchOp {
    pub create_note: Option<CreateNoteRequest>,
    pub update_note: Option<UpdateNoteRequest>,
    pub create_document: Option<CreateDocumentRequest>,
    pub save_document: Option<SaveDocumentRequest>,
    pub convert_note_to_document: Option<ConvertNoteToDocumentRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ApplyJournalAiBatchRequest {
    pub ops: Vec<JournalAiBatchOp>,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyJournalAiBatchResponse {
    pub entries: Vec<EntrySnapshot>,
}

enum OpPrep {
    CreateNote { id: String },
    CreateDocument {
        id: String,
        version_id: String,
        sha: String,
    },
    SaveDocument {
        version_id: Option<String>,
        sha: Option<String>,
    },
    ConvertNote {
        version_id: String,
        sha: String,
    },
}

fn invalid_patch(msg: impl Into<String>) -> JournalError {
    JournalError::new("INVALID_PATCH", msg)
}

fn prep_detail_rollback(prep: &OpPrep, op: &JournalAiBatchOp) -> Option<(String, String)> {
    match prep {
        OpPrep::CreateDocument { id, version_id, .. } => Some((id.clone(), version_id.clone())),
        OpPrep::SaveDocument {
            version_id: Some(version_id),
            ..
        } => {
            let req = op.save_document.as_ref().unwrap();
            Some((req.id.clone(), version_id.clone()))
        }
        OpPrep::ConvertNote { version_id, .. } => {
            let req = op.convert_note_to_document.as_ref().unwrap();
            Some((req.id.clone(), version_id.clone()))
        }
        _ => None,
    }
}

fn batch_op_kind(op: &JournalAiBatchOp) -> JournalResult<&'static str> {
    let count = [
        op.create_note.is_some(),
        op.update_note.is_some(),
        op.create_document.is_some(),
        op.save_document.is_some(),
        op.convert_note_to_document.is_some(),
    ]
    .into_iter()
    .filter(|v| *v)
    .count();
    if count != 1 {
        return Err(invalid_patch("batch op must have exactly one change"));
    }
    if op.create_note.is_some() {
        Ok("createNote")
    } else if op.update_note.is_some() {
        Ok("updateNote")
    } else if op.create_document.is_some() {
        Ok("createDocument")
    } else if op.save_document.is_some() {
        Ok("saveDocument")
    } else {
        Ok("convertNoteToDocument")
    }
}

fn prepare_op(data_dir: &str, op: &JournalAiBatchOp) -> JournalResult<Option<OpPrep>> {
    match batch_op_kind(op)? {
        "createNote" => {
            let req = op.create_note.as_ref().unwrap();
            validate_time_range(&req.started_at, req.ended_at.as_deref())?;
            require_non_empty_text(&req.text)?;
            Ok(Some(OpPrep::CreateNote {
                id: repository::new_uuid(),
            }))
        }
        "updateNote" => {
            let req = op.update_note.as_ref().unwrap();
            if let Some(v) = req.text.as_deref() {
                require_non_empty_text(v)?;
            }
            if let Some(started_at) = req.started_at.as_deref() {
                let ended_at = req.ended_at.as_ref().and_then(|v| v.as_deref());
                validate_time_range(started_at, ended_at)?;
            } else if let Some(Some(ended_at)) = req.ended_at.as_ref() {
                return Err(invalid_patch("updateNote endedAt requires startedAt"));
            }
            Ok(None)
        }
        "createDocument" => {
            let req = op.create_document.as_ref().unwrap();
            require_title(&req.title)?;
            validate_time_range(&req.started_at, req.ended_at.as_deref())?;
            let id = repository::new_uuid();
            let markdown = req.markdown.clone().unwrap_or_default();
            let (version_id, sha) = detail_files::prepare_detail_version(data_dir, &id, &markdown)?;
            Ok(Some(OpPrep::CreateDocument {
                id,
                version_id,
                sha,
            }))
        }
        "saveDocument" => {
            let req = op.save_document.as_ref().unwrap();
            if let Some(title) = req.title.as_deref() {
                require_title(title)?;
            }
            if let Some(started_at) = req.started_at.as_deref() {
                let ended_at = req.ended_at.as_ref().and_then(|v| v.as_deref());
                validate_time_range(started_at, ended_at)?;
            } else if let Some(Some(ended_at)) = req.ended_at.as_ref() {
                return Err(invalid_patch("saveDocument endedAt requires startedAt"));
            }
            let canonical_id = with_read(data_dir, |conn| {
                let conn = require_conn(conn)?;
                let existing = repository::get_entry_row_conn(conn, &req.id)?.ok_or_else(|| {
                    JournalError::entry_not_found("journal entry not found")
                })?;
                if existing.deleted_at_utc.is_some() {
                    return Err(JournalError::entry_deleted("journal entry is deleted").into());
                }
                repository::require_document(&existing)?;
                Ok(existing.id)
            })?;
            let prep = if let Some(markdown) = req.markdown.as_ref() {
                let (version_id, sha) =
                    detail_files::prepare_detail_version(data_dir, &canonical_id, markdown)?;
                OpPrep::SaveDocument {
                    version_id: Some(version_id),
                    sha: Some(sha),
                }
            } else {
                OpPrep::SaveDocument {
                    version_id: None,
                    sha: None,
                }
            };
            Ok(Some(prep))
        }
        "convertNoteToDocument" => {
            let req = op.convert_note_to_document.as_ref().unwrap();
            require_title(&req.title)?;
            let existing = with_read(data_dir, |conn| {
                let conn = require_conn(conn)?;
                let row = repository::get_entry_row_conn(conn, &req.id)?.ok_or_else(|| {
                    JournalError::entry_not_found("journal entry not found")
                })?;
                if row.deleted_at_utc.is_some() {
                    return Err(JournalError::entry_deleted("journal entry is deleted").into());
                }
                repository::require_note(&row)?;
                Ok(row)
            })?;
            let markdown = existing.text.clone().unwrap_or_default();
            let (version_id, sha) =
                detail_files::prepare_detail_version(data_dir, &existing.id, &markdown)?;
            Ok(Some(OpPrep::ConvertNote { version_id, sha }))
        }
        _ => Err(invalid_patch("unsupported batch op")),
    }
}

fn apply_create_note(
    data_dir: &str,
    tx: &rusqlite::Transaction,
    req: &CreateNoteRequest,
    id: &str,
) -> JournalResult<EntrySnapshot> {
    let text = require_non_empty_text(&req.text)?;
    let now = repository::utc_now();
    let row = EntryRow {
        id: id.to_string(),
        revision: 1,
        kind: "note".to_string(),
        title: optional_trimmed(req.title.clone()),
        started_at_utc: req.started_at.clone(),
        ended_at_utc: req.ended_at.clone(),
        mood: optional_trimmed(req.mood.clone()),
        text: Some(text),
        summary: None,
        detail_file_id: None,
        detail_sha256: None,
        created_at_utc: now.clone(),
        updated_at_utc: now,
        deleted_at_utc: None,
    };
    repository::insert_entry(tx, &row)?;
    repository::row_to_snapshot(data_dir, row, false)
}

fn apply_update_note(
    data_dir: &str,
    tx: &rusqlite::Transaction,
    req: &UpdateNoteRequest,
) -> JournalResult<EntrySnapshot> {
    let existing = repository::require_live_entry(tx, &req.id)?;
    repository::require_note(&existing)?;
    repository::check_revision(&existing, req.expected_revision)?;

    let text = match req.text.as_deref() {
        Some(v) => Some(require_non_empty_text(v)?),
        None => existing.text.clone(),
    };
    let text = text.ok_or_else(|| JournalError::new("TEXT_REQUIRED", "text is required"))?;

    let started_at = req
        .started_at
        .clone()
        .unwrap_or_else(|| existing.started_at_utc.clone());
    let ended_at = match req.ended_at.clone() {
        Some(v) => v,
        None => existing.ended_at_utc.clone(),
    };
    validate_time_range(&started_at, ended_at.as_deref())?;

    let row = EntryRow {
        id: existing.id,
        revision: existing.revision + 1,
        kind: existing.kind,
        title: match req.title.clone() {
            Some(v) => v.and_then(|s| optional_trimmed(Some(s))),
            None => existing.title.clone(),
        },
        started_at_utc: started_at,
        ended_at_utc: ended_at,
        mood: apply_patch_option(existing.mood, req.mood.clone()),
        text: Some(text),
        summary: None,
        detail_file_id: None,
        detail_sha256: None,
        created_at_utc: existing.created_at_utc,
        updated_at_utc: repository::utc_now(),
        deleted_at_utc: None,
    };
    repository::update_entry_row(tx, &row)?;
    repository::row_to_snapshot(data_dir, row, false)
}

fn apply_create_document(
    data_dir: &str,
    tx: &rusqlite::Transaction,
    req: &CreateDocumentRequest,
    id: &str,
    version_id: &str,
    sha: &str,
) -> JournalResult<EntrySnapshot> {
    let title = require_title(&req.title)?;
    let now = repository::utc_now();
    let row = EntryRow {
        id: id.to_string(),
        revision: 1,
        kind: "document".to_string(),
        title: Some(title),
        started_at_utc: req.started_at.clone(),
        ended_at_utc: req.ended_at.clone(),
        mood: optional_trimmed(req.mood.clone()),
        text: None,
        summary: optional_trimmed(req.summary.clone()),
        detail_file_id: Some(version_id.to_string()),
        detail_sha256: Some(sha.to_string()),
        created_at_utc: now.clone(),
        updated_at_utc: now,
        deleted_at_utc: None,
    };
    repository::insert_entry(tx, &row)?;
    repository::row_to_snapshot(data_dir, row, true)
}

fn apply_save_document(
    data_dir: &str,
    tx: &rusqlite::Transaction,
    req: &SaveDocumentRequest,
    version_id: Option<&str>,
    sha: Option<&str>,
) -> JournalResult<EntrySnapshot> {
    let existing = repository::require_live_entry(tx, &req.id)?;
    repository::require_document(&existing)?;
    repository::check_revision(&existing, req.expected_revision)?;

    let title = match req.title.as_deref() {
        Some(v) => Some(require_title(v)?),
        None => existing.title.clone(),
    };
    let title = title.ok_or_else(|| JournalError::title_required("title is required"))?;

    let started_at = req
        .started_at
        .clone()
        .unwrap_or_else(|| existing.started_at_utc.clone());
    let ended_at = match req.ended_at.clone() {
        Some(v) => v,
        None => existing.ended_at_utc.clone(),
    };
    validate_time_range(&started_at, ended_at.as_deref())?;

    let (detail_file_id, detail_sha256) = if let (Some(version_id), Some(sha)) = (version_id, sha) {
        (Some(version_id.to_string()), Some(sha.to_string()))
    } else {
        (
            existing.detail_file_id.clone(),
            existing.detail_sha256.clone(),
        )
    };

    let row = EntryRow {
        id: existing.id,
        revision: existing.revision + 1,
        kind: existing.kind,
        title: Some(title),
        started_at_utc: started_at,
        ended_at_utc: ended_at,
        mood: apply_patch_option(existing.mood, req.mood.clone()),
        text: None,
        summary: apply_patch_option(existing.summary, req.summary.clone()),
        detail_file_id,
        detail_sha256,
        created_at_utc: existing.created_at_utc,
        updated_at_utc: repository::utc_now(),
        deleted_at_utc: None,
    };
    repository::update_entry_row(tx, &row)?;
    repository::row_to_snapshot(data_dir, row, true)
}

fn apply_convert_note_to_document(
    data_dir: &str,
    tx: &rusqlite::Transaction,
    req: &ConvertNoteToDocumentRequest,
    version_id: &str,
    sha: &str,
) -> JournalResult<EntrySnapshot> {
    let current = repository::require_live_entry(tx, &req.id)?;
    repository::require_note(&current)?;
    repository::check_revision(&current, req.expected_revision)?;

    let title = require_title(&req.title)?;
    let started_at = current.started_at_utc.clone();
    let ended_at = match req.ended_at.clone() {
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
        mood: apply_patch_option(current.mood, req.mood.clone()),
        text: None,
        summary: optional_trimmed(req.summary.clone()),
        detail_file_id: Some(version_id.to_string()),
        detail_sha256: Some(sha.to_string()),
        created_at_utc: current.created_at_utc,
        updated_at_utc: repository::utc_now(),
        deleted_at_utc: None,
    };
    repository::update_entry_row(tx, &row)?;
    repository::row_to_snapshot(data_dir, row, true)
}

pub fn apply_journal_ai_batch(
    data_dir: &str,
    req: ApplyJournalAiBatchRequest,
) -> JournalResult<ApplyJournalAiBatchResponse> {
    if req.ops.is_empty() {
        return Err(invalid_patch("ops must not be empty"));
    }

    let mut preps = Vec::with_capacity(req.ops.len());
    for op in &req.ops {
        match prepare_op(data_dir, op) {
            Ok(prep) => preps.push(prep),
            Err(error) => {
                for (prepared_op, prep) in req.ops.iter().zip(preps.iter()) {
                    if let Some(prep) = prep {
                        if let Some((entry_id, version_id)) =
                            prep_detail_rollback(prep, prepared_op)
                        {
                            detail_files::remove_prepared_detail_version(
                                data_dir,
                                &entry_id,
                                &version_id,
                            );
                        }
                    }
                }
                return Err(error);
            }
        }
    }

    let rollback_details: Vec<(String, String)> = req
        .ops
        .iter()
        .zip(preps.iter())
        .filter_map(|(op, prep)| prep.as_ref().and_then(|p| prep_detail_rollback(p, op)))
        .collect();

    let result = with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let mut entries = Vec::with_capacity(req.ops.len());
            for (op, prep) in req.ops.iter().zip(preps.iter()) {
                let entry = match batch_op_kind(op)? {
                    "createNote" => {
                        let req = op.create_note.as_ref().unwrap();
                        let OpPrep::CreateNote { id } = prep.as_ref().unwrap() else {
                            return Err(invalid_patch("createNote prep mismatch").into());
                        };
                        apply_create_note(data_dir, tx, req, id)?
                    }
                    "updateNote" => {
                        apply_update_note(data_dir, tx, op.update_note.as_ref().unwrap())?
                    }
                    "createDocument" => {
                        let req = op.create_document.as_ref().unwrap();
                        let OpPrep::CreateDocument {
                            id,
                            version_id,
                            sha,
                        } = prep.as_ref().unwrap()
                        else {
                            return Err(invalid_patch("createDocument prep mismatch").into());
                        };
                        apply_create_document(data_dir, tx, req, id, version_id, sha)?
                    }
                    "saveDocument" => {
                        let req = op.save_document.as_ref().unwrap();
                        let OpPrep::SaveDocument { version_id, sha } = prep.as_ref().unwrap()
                        else {
                            return Err(invalid_patch("saveDocument prep mismatch").into());
                        };
                        apply_save_document(
                            data_dir,
                            tx,
                            req,
                            version_id.as_deref(),
                            sha.as_deref(),
                        )?
                    }
                    "convertNoteToDocument" => {
                        let req = op.convert_note_to_document.as_ref().unwrap();
                        let OpPrep::ConvertNote { version_id, sha } = prep.as_ref().unwrap()
                        else {
                            return Err(invalid_patch("convertNoteToDocument prep mismatch").into());
                        };
                        apply_convert_note_to_document(data_dir, tx, req, version_id, sha)?
                    }
                    _ => return Err(invalid_patch("unsupported batch op").into()),
                };
                entries.push(entry);
            }
            Ok(ApplyJournalAiBatchResponse { entries })
        })
    })
    .map_err(JournalError::from);
    if result.is_err() {
        for (entry_id, version_id) in &rollback_details {
            detail_files::remove_prepared_detail_version(data_dir, entry_id, version_id);
        }
    }
    result
}
