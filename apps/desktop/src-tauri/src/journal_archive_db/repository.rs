use std::collections::HashSet;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use uuid::Uuid;

use super::detail_files::{load_detail_markdown, verify_detail_hash};
use super::error::{JournalError, JournalResult};
use super::types::{EntrySnapshot, ListEntriesQuery};

#[derive(Debug, Clone)]
pub struct EntryRow {
    pub id: String,
    pub revision: i64,
    pub kind: String,
    pub title: Option<String>,
    pub started_at_utc: String,
    pub ended_at_utc: Option<String>,
    pub mood: Option<String>,
    pub text: Option<String>,
    pub summary: Option<String>,
    pub detail_file_id: Option<String>,
    pub detail_sha256: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub deleted_at_utc: Option<String>,
}

pub fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn new_uuid() -> String {
    Uuid::new_v4().to_string()
}

fn map_sqlite_err(e: rusqlite::Error) -> JournalError {
    JournalError::archive_lifecycle(e.to_string())
}

fn row_to_entry(row: &Row<'_>) -> Result<EntryRow, rusqlite::Error> {
    Ok(EntryRow {
        id: row.get("id")?,
        revision: row.get("revision")?,
        kind: row.get("kind")?,
        title: row.get("title")?,
        started_at_utc: row.get("started_at_utc")?,
        ended_at_utc: row.get("ended_at_utc")?,
        mood: row.get("mood")?,
        text: row.get("text")?,
        summary: row.get("summary")?,
        detail_file_id: row.get("detail_file_id")?,
        detail_sha256: row.get("detail_sha256")?,
        created_at_utc: row.get("created_at_utc")?,
        updated_at_utc: row.get("updated_at_utc")?,
        deleted_at_utc: row.get("deleted_at_utc")?,
    })
}

const SELECT_ENTRY: &str = r#"
SELECT
  id, revision, kind, title, started_at_utc, ended_at_utc, mood, text, summary,
  detail_file_id, detail_sha256, created_at_utc, updated_at_utc, deleted_at_utc
FROM journal_entry
"#;

pub fn get_entry_row(tx: &Transaction, id: &str) -> JournalResult<Option<EntryRow>> {
    let sql = format!("{SELECT_ENTRY} WHERE id = ?1");
    tx.query_row(&sql, [id], row_to_entry)
        .optional()
        .map_err(map_sqlite_err)
}

pub fn get_entry_row_conn(conn: &Connection, id: &str) -> JournalResult<Option<EntryRow>> {
    let sql = format!("{SELECT_ENTRY} WHERE id = ?1");
    conn.query_row(&sql, [id], row_to_entry)
        .optional()
        .map_err(map_sqlite_err)
}

pub fn require_live_entry(tx: &Transaction, id: &str) -> JournalResult<EntryRow> {
    match get_entry_row(tx, id)? {
        None => Err(JournalError::entry_not_found("journal entry not found")),
        Some(row) if row.deleted_at_utc.is_some() => {
            Err(JournalError::entry_deleted("journal entry is deleted"))
        }
        Some(row) => Ok(row),
    }
}

pub fn require_entry(tx: &Transaction, id: &str) -> JournalResult<EntryRow> {
    get_entry_row(tx, id)?
        .ok_or_else(|| JournalError::entry_not_found("journal entry not found"))
}

pub fn insert_entry(
    tx: &Transaction,
    row: &EntryRow,
) -> JournalResult<()> {
    tx.execute(
        r#"
INSERT INTO journal_entry (
  id, revision, kind, title, started_at_utc, ended_at_utc, mood, text, summary,
  detail_file_id, detail_sha256, created_at_utc, updated_at_utc, deleted_at_utc
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL)
        "#,
        params![
            row.id,
            row.revision,
            row.kind,
            row.title,
            row.started_at_utc,
            row.ended_at_utc,
            row.mood,
            row.text,
            row.summary,
            row.detail_file_id,
            row.detail_sha256,
            row.created_at_utc,
            row.updated_at_utc,
        ],
    )
    .map_err(map_sqlite_err)?;
    Ok(())
}

pub fn update_entry_row(tx: &Transaction, row: &EntryRow) -> JournalResult<()> {
    let n = tx
        .execute(
            r#"
UPDATE journal_entry SET
  revision = ?2,
  kind = ?3,
  title = ?4,
  started_at_utc = ?5,
  ended_at_utc = ?6,
  mood = ?7,
  text = ?8,
  summary = ?9,
  detail_file_id = ?10,
  detail_sha256 = ?11,
  updated_at_utc = ?12,
  deleted_at_utc = ?13
WHERE id = ?1
            "#,
            params![
                row.id,
                row.revision,
                row.kind,
                row.title,
                row.started_at_utc,
                row.ended_at_utc,
                row.mood,
                row.text,
                row.summary,
                row.detail_file_id,
                row.detail_sha256,
                row.updated_at_utc,
                row.deleted_at_utc,
            ],
        )
        .map_err(map_sqlite_err)?;
    if n == 0 {
        return Err(JournalError::entry_not_found("journal entry not found"));
    }
    Ok(())
}

pub fn soft_delete_entry(
    tx: &Transaction,
    id: &str,
    revision: i64,
    updated_at: &str,
    deleted_at: &str,
) -> JournalResult<()> {
    let n = tx
        .execute(
            r#"
UPDATE journal_entry
SET revision = ?2, updated_at_utc = ?3, deleted_at_utc = ?4
WHERE id = ?1 AND deleted_at_utc IS NULL
            "#,
            params![id, revision, updated_at, deleted_at],
        )
        .map_err(map_sqlite_err)?;
    if n == 0 {
        return Err(JournalError::entry_not_found("journal entry not found"));
    }
    Ok(())
}

pub fn list_entry_rows(
    conn: &Connection,
    query: &ListEntriesQuery,
) -> JournalResult<Vec<EntryRow>> {
    let mut sql = String::from(SELECT_ENTRY);
    if !query.include_deleted {
        sql.push_str(" WHERE deleted_at_utc IS NULL");
    }
    sql.push_str(" ORDER BY started_at_utc DESC, id ASC");
    if let Some(limit) = query.limit {
        if limit > 0 {
            sql.push_str(&format!(" LIMIT {limit}"));
        }
    }

    let mut stmt = conn.prepare(&sql).map_err(map_sqlite_err)?;
    let rows = stmt
        .query_map([], row_to_entry)
        .map_err(map_sqlite_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_err)?;
    Ok(rows)
}

pub fn collect_detail_file_ids(conn: &Connection) -> JournalResult<HashSet<String>> {
    let mut stmt = conn
        .prepare("SELECT detail_file_id FROM journal_entry WHERE detail_file_id IS NOT NULL")
        .map_err(map_sqlite_err)?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(map_sqlite_err)?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(map_sqlite_err)?;
    Ok(ids)
}

pub fn row_to_snapshot(
    data_dir: &str,
    row: EntryRow,
    load_markdown: bool,
) -> JournalResult<EntrySnapshot> {
    let has_detail = row.kind == "document";
    let mut markdown = None;

    if has_detail {
        let file_id = row.detail_file_id.as_deref().ok_or_else(|| {
            JournalError::detail_version_mismatch("document entry missing detail_file_id")
        })?;
        let sha = row.detail_sha256.as_deref().ok_or_else(|| {
            JournalError::detail_version_mismatch("document entry missing detail_sha256")
        })?;
        if load_markdown {
            markdown = Some(load_detail_markdown(
                data_dir,
                &row.id,
                file_id,
                sha,
            )?);
        } else {
            verify_detail_hash(data_dir, &row.id, file_id, sha)?;
        }
    }

    Ok(EntrySnapshot {
        id: row.id,
        revision: row.revision,
        kind: row.kind,
        title: row.title,
        started_at: row.started_at_utc,
        ended_at: row.ended_at_utc,
        mood: row.mood,
        text: row.text,
        summary: row.summary,
        markdown,
        has_detail,
        detail_file_id: row.detail_file_id,
        detail_sha256: row.detail_sha256,
        created_at: row.created_at_utc,
        updated_at: row.updated_at_utc,
        deleted_at: row.deleted_at_utc,
    })
}

pub fn check_revision(existing: &EntryRow, expected: i64) -> JournalResult<()> {
    if existing.revision != expected {
        return Err(JournalError::revision_conflict("entry revision mismatch"));
    }
    Ok(())
}

pub fn require_note(row: &EntryRow) -> JournalResult<()> {
    if row.kind != "note" {
        return Err(JournalError::invalid_kind("entry is not a note"));
    }
    Ok(())
}

pub fn require_document(row: &EntryRow) -> JournalResult<()> {
    if row.kind != "document" {
        return Err(JournalError::invalid_kind("entry is not a document"));
    }
    Ok(())
}
