use rusqlite::{params, Transaction};

use super::super::error::{DomainError, DomainResult};

pub fn ensure_live_action_of_item(tx: &Transaction<'_>, item_id: &str, action_id: &str) -> DomainResult<()> {
    let ok: bool = tx
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM productivity_action
                WHERE id = ?1 AND target_kind = 'item' AND target_id = ?2 AND deleted_at_utc IS NULL
            )",
            params![action_id, item_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if !ok {
        return Err(DomainError::cross_item_reference("action is not a live member of this item"));
    }
    Ok(())
}

pub fn ensure_live_checkpoint_of_item(tx: &Transaction<'_>, item_id: &str, checkpoint_id: &str) -> DomainResult<()> {
    let ok: bool = tx
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM productivity_checkpoint
                WHERE id = ?1 AND target_kind = 'item' AND target_id = ?2 AND deleted_at_utc IS NULL
            )",
            params![checkpoint_id, item_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if !ok {
        return Err(DomainError::cross_item_reference("checkpoint is not a live member of this item"));
    }
    Ok(())
}

pub fn ensure_live_transportation_of_item(
    tx: &Transaction<'_>,
    item_id: &str,
    transportation_id: &str,
) -> DomainResult<()> {
    let ok: bool = tx
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM productivity_transportation
                WHERE id = ?1 AND item_id = ?2 AND deleted_at_utc IS NULL
            )",
            params![transportation_id, item_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if !ok {
        return Err(DomainError::cross_item_reference("transportation is not a live member of this item"));
    }
    Ok(())
}

pub fn ensure_live_point_of_item(tx: &Transaction<'_>, item_id: &str, point_id: &str) -> DomainResult<()> {
    let ok: bool = tx
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM productivity_item_travel_point
                WHERE id = ?1 AND item_id = ?2 AND deleted_at_utc IS NULL
            )",
            params![point_id, item_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if !ok {
        return Err(DomainError::cross_item_reference("point is not a live member of this item"));
    }
    Ok(())
}

/// Join pair must be adjacent actions sharing this item's planned boundary minute.
pub fn ensure_adjacent_join_pair(
    tx: &Transaction<'_>,
    item_id: &str,
    front_action_id: &str,
    rear_action_id: &str,
) -> DomainResult<()> {
    ensure_live_action_of_item(tx, item_id, front_action_id)?;
    ensure_live_action_of_item(tx, item_id, rear_action_id)?;
    if front_action_id == rear_action_id {
        return Err(DomainError::invalid_patch("join actions must be distinct"));
    }
    let front_end: String = tx
        .query_row(
            "SELECT planned_end_at FROM productivity_action WHERE id = ?1",
            [front_action_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rear_start: String = tx
        .query_row(
            "SELECT planned_start_at FROM productivity_action WHERE id = ?1",
            [rear_action_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if front_end != rear_start {
        return Err(DomainError::invalid_patch("join actions do not share a planned endpoint"));
    }
    let actions = load_item_actions_ordered(tx, item_id)?;
    let front_idx = actions
        .iter()
        .position(|a| a.0 == front_action_id)
        .ok_or_else(|| DomainError::cross_item_reference("front action not in trip"))?;
    let rear_idx = actions
        .iter()
        .position(|a| a.0 == rear_action_id)
        .ok_or_else(|| DomainError::cross_item_reference("rear action not in trip"))?;
    if rear_idx != front_idx + 1 {
        return Err(DomainError::invalid_patch("join actions are not adjacent in plan order"));
    }
    Ok(())
}

fn load_item_actions_ordered(tx: &Transaction<'_>, item_id: &str) -> DomainResult<Vec<(String, String, String)>> {
    let mut stmt = tx
        .prepare(
            "SELECT id, planned_start_at, planned_end_at
             FROM productivity_action
             WHERE target_kind = 'item' AND target_id = ?1 AND deleted_at_utc IS NULL
             ORDER BY planned_start_at, id",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([item_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
    }
    Ok(out)
}
