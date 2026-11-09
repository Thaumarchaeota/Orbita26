use rusqlite::{OptionalExtension, Transaction};

use super::super::error::{DomainError, DomainResult};

pub fn item_has_v2_profile(tx: &Transaction<'_>, item_id: &str) -> DomainResult<bool> {
    tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM productivity_item_travel_profile WHERE item_id = ?1 AND deleted_at_utc IS NULL)",
        [item_id],
        |row| row.get(0),
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))
}

pub fn action_requires_travel_command(tx: &Transaction<'_>, action_id: &str) -> DomainResult<bool> {
    let target: Option<(Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT target_kind, target_id FROM productivity_action WHERE id = ?1",
            [action_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    match target {
        Some((Some(kind), Some(id))) if kind == "item" => item_has_v2_profile(tx, &id),
        _ => Ok(false),
    }
}

pub fn checkpoint_requires_travel_command(tx: &Transaction<'_>, checkpoint_id: &str) -> DomainResult<bool> {
    let target: Option<(Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT target_kind, target_id FROM productivity_checkpoint WHERE id = ?1",
            [checkpoint_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    match target {
        Some((Some(kind), Some(id))) if kind == "item" => item_has_v2_profile(tx, &id),
        _ => Ok(false),
    }
}
