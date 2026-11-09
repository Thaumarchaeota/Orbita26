mod batch;
mod convert;
mod document;
mod entry;
mod note;

pub use batch::{apply_journal_ai_batch, ApplyJournalAiBatchRequest, ApplyJournalAiBatchResponse};
pub use convert::convert_note_to_document;
pub use document::{create_document, save_document};
pub use entry::{delete_entry, get_entry, list_entries};
pub use note::{create_note, update_note};

pub(crate) fn parse_utc_rfc3339(value: &str, label: &str) -> super::error::JournalResult<()> {
    chrono::DateTime::parse_from_rfc3339(value).map_err(|_| {
        super::error::JournalError::invalid_time(format!("{label} must be UTC RFC3339"))
    })?;
    Ok(())
}

pub(crate) fn validate_time_range(
    started_at: &str,
    ended_at: Option<&str>,
) -> super::error::JournalResult<()> {
    parse_utc_rfc3339(started_at, "startedAt")?;
    if let Some(ended) = ended_at {
        parse_utc_rfc3339(ended, "endedAt")?;
        let started = chrono::DateTime::parse_from_rfc3339(started_at).unwrap();
        let ended = chrono::DateTime::parse_from_rfc3339(ended).unwrap();
        if ended < started {
            return Err(super::error::JournalError::invalid_time(
                "endedAt must not be before startedAt",
            ));
        }
    }
    Ok(())
}

pub(crate) fn require_non_empty_text(text: &str) -> super::error::JournalResult<String> {
    if text.trim().is_empty() {
        return Err(super::error::JournalError::new(
            "TEXT_REQUIRED",
            "text is required",
        ));
    }
    Ok(text.to_string())
}

pub(crate) fn require_title(title: &str) -> super::error::JournalResult<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(super::error::JournalError::title_required(
            "title is required",
        ));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn optional_trimmed(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let t = v.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

pub(crate) fn apply_patch_option(
    current: Option<String>,
    patch: Option<Option<String>>,
) -> Option<String> {
    match patch {
        None => current,
        Some(v) => v.and_then(|s| {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }),
    }
}

pub(crate) fn require_conn<'a>(
    conn: Option<&'a rusqlite::Connection>,
) -> super::error::JournalResult<&'a rusqlite::Connection> {
    conn.ok_or_else(|| super::error::JournalError::archive_lifecycle("archive not initialized"))
}
