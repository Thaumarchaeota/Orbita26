use crate::productivity_db::coordinator::{in_transaction, with_read, with_write};

use super::super::commands::require_conn;
use super::super::error::JournalResult;
use super::super::repository;
use super::super::types::{
    DeleteEntryRequest, EntriesListResponse, EntryResponse, ListEntriesQuery,
};

pub fn get_entry(data_dir: &str, id: &str) -> JournalResult<EntryResponse> {
    Ok(with_read(data_dir, |conn| {
        let conn = require_conn(conn)?;
        let row = repository::get_entry_row_conn(conn, id)?
            .ok_or_else(|| super::super::error::JournalError::entry_not_found("journal entry not found"))?;
        let entry = repository::row_to_snapshot(data_dir, row, true)?;
        Ok(EntryResponse { entry })
    })?)
}

pub fn list_entries(data_dir: &str, query: ListEntriesQuery) -> JournalResult<EntriesListResponse> {
    Ok(with_read(data_dir, |conn| {
        let conn = require_conn(conn)?;
        let rows = repository::list_entry_rows(conn, &query)?;
        let mut entries = Vec::with_capacity(rows.len());
        for row in rows {
            entries.push(repository::row_to_snapshot(data_dir, row, false)?);
        }
        Ok(EntriesListResponse { entries })
    })?)
}

pub fn delete_entry(data_dir: &str, req: DeleteEntryRequest) -> JournalResult<EntryResponse> {
    Ok(with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let existing = repository::require_live_entry(tx, &req.id)?;
            repository::check_revision(&existing, req.expected_revision)?;
            let now = repository::utc_now();
            repository::soft_delete_entry(
                tx,
                &req.id,
                existing.revision + 1,
                &now,
                &now,
            )?;
            crate::workspace_db::repository::hide_live_domain_member(
                tx,
                crate::workspace_db::repository::DOMAIN_JOURNAL,
                crate::workspace_db::repository::TYPE_ENTRY,
                &req.id,
                &now,
            )
            .map_err(|e| super::super::error::JournalError::archive_lifecycle(e.to_string()))?;
            let row = repository::require_entry(tx, &req.id)?;
            let entry = repository::row_to_snapshot(data_dir, row, false)?;
            Ok(EntryResponse { entry })
        })
    })?)
}
