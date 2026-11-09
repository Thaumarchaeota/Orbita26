use std::collections::HashSet;

use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write_expected};
use crate::productivity_db::error::{DomainError, DomainResult};
use crate::productivity_db::repository::*;
use crate::productivity_db::types::*;
use crate::productivity_db::util::{new_uuid, utc_now};
use crate::productivity_db::validation::{ensure_item_writable, ensure_list_writable, ensure_no_active_actions};
use crate::productivity_db::travel::{delete_travel_in_transaction, validate_travel_delete_in_transaction};

fn validate_refs(items: &[RevisionRef]) -> DomainResult<()> {
    if items.is_empty() { return Err(DomainError::invalid_patch("items must not be empty")); }
    let mut ids = HashSet::with_capacity(items.len());
    for item in items {
        if item.id.trim().is_empty() || !ids.insert(item.id.as_str()) {
            return Err(DomainError::invalid_patch("duplicate item reference"));
        }
    }
    Ok(())
}

pub fn batch_move_items_to_list(_data_dir: &str, req: BatchMoveItemsToListRequest) -> DomainResult<ItemsBatchResponse> {
    validate_refs(&req.items)?;
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        for item_ref in &req.items {
            let (item, extra) = load_item_row(tx, &item_ref.id, true)?;
            guard_unknown(&extra)?;
            check_revision(item_ref.expected_revision, item.revision)?;
            ensure_item_writable(tx, &item_ref.id)?;
            crate::productivity_db::health_plan::guard_item(tx, &item_ref.id)?;
            crate::productivity_db::validation::ensure_not_travel_v2_item(tx, &item_ref.id)?;
        }
        let target_id = if let Some(list_ref) = &req.list {
            let (list, extra) = load_list_row(tx, &list_ref.id, true)?;
            guard_unknown(&extra)?;
            check_revision(list_ref.expected_revision, list.revision)?;
            ensure_list_writable(tx, Some(&list_ref.id))?;
            Some(list_ref.id.clone())
        } else { None };
        let now = utc_now();
        for item_ref in &req.items {
            tx.execute("UPDATE productivity_item SET list_id = ?1, updated_at_utc = ?2 WHERE id = ?3", params![target_id, now, item_ref.id])
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_item(tx, &item_ref.id, &now)?;
        }
        let mut items = Vec::with_capacity(req.items.len());
        for item_ref in &req.items { items.push(item_snapshot(tx, &item_ref.id, true)?); }
        Ok(ItemsBatchResponse { items, item_order: Some(item_order_snapshot(tx)?) })
    }))
}

pub fn batch_delete_items(_data_dir: &str, req: BatchDeleteItemsRequest) -> DomainResult<ItemsBatchResponse> {
    let refs: Vec<RevisionRef> = req.items.iter().map(|entry| entry.item.clone()).collect();
    validate_refs(&refs)?;
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        let now = utc_now();
        let batch = new_uuid();
        // Validate every aggregate before mutating any row. Travel entries use
        // the same exact member and execution-lock checks as delete_travel.
        for entry in &req.items {
            let item_ref = &entry.item;
            let (item, extra) = load_item_row(tx, &item_ref.id, true)?;
            guard_unknown(&extra)?;
            check_revision(item_ref.expected_revision, item.revision)?;
            ensure_item_writable(tx, &item_ref.id)?;
            crate::productivity_db::health_plan::guard_item(tx, &item_ref.id)?;
            crate::productivity_db::validation::ensure_not_travel_v2_item(tx, &item_ref.id)?;
            ensure_no_active_actions(tx, &[item_ref.id.clone()])?;
            let is_travel: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_travel_detail WHERE item_id=?1 AND deleted_at_utc IS NULL)", [&item_ref.id], |row| row.get(0))
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            if is_travel {
                let travel_req = DeleteTravelRequest { expected_data_dir: req.expected_data_dir.clone(), item: item_ref.clone(), expected_actions: entry.expected_actions.clone() };
                validate_travel_delete_in_transaction(tx, &travel_req)?;
            } else if !entry.expected_actions.is_empty() {
                return Err(DomainError::invalid_patch("non-travel item cannot carry action members"));
            }
        }
        let mut items = Vec::with_capacity(req.items.len());
        for entry in &req.items {
            let item_ref = &entry.item;
            let is_travel: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_travel_detail WHERE item_id=?1 AND deleted_at_utc IS NULL)", [&item_ref.id], |row| row.get(0))
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            if is_travel {
                let travel_req = DeleteTravelRequest { expected_data_dir: req.expected_data_dir.clone(), item: item_ref.clone(), expected_actions: entry.expected_actions.clone() };
                let travel = delete_travel_in_transaction(tx, &travel_req, Some(&batch))?;
                items.push(travel.item);
            } else {
                tx.execute("UPDATE productivity_item SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3", params![now, batch, item_ref.id])
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                remove_item_from_order(tx, &item_ref.id, &now)?;
                bump_item(tx, &item_ref.id, &now)?;
                items.push(item_snapshot(tx, &item_ref.id, false)?);
            }
        }
        Ok(ItemsBatchResponse { items, item_order: Some(item_order_snapshot(tx)?) })
    }))
}
