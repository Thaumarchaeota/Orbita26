use std::collections::HashMap;

use rusqlite::params;
use rusqlite::OptionalExtension;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::error::{DomainError, DomainResult};
use crate::productivity_db::repository::*;
use crate::productivity_db::types::*;
use crate::productivity_db::util::utc_now;
use crate::productivity_db::validation::{ensure_item_writable, ensure_list_writable};

pub fn reorder_items(data_dir: &str, req: ReorderItemsRequest) -> DomainResult<ReorderItemsResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (revision, _) = load_item_order_row(tx)?;
            check_revision(req.item_order.expected_revision, revision)?;
            if req.item_order.id != ITEM_ORDER_ROOT_ID {
                return Err(DomainError::invalid_patch("invalid item order id"));
            }
            let actual_members = live_item_order_member_refs(tx)?;
            check_members(&req.expected_members, &actual_members)?;
            if req.ordered_item_ids.len() != actual_members.len() {
                return Err(DomainError::revision_conflict("ordered item set mismatch"));
            }
            let mut expected_ids: Vec<String> = actual_members.iter().map(|m| m.id.clone()).collect();
            expected_ids.sort();
            let mut got: Vec<String> = req.ordered_item_ids.clone();
            got.sort();
            if expected_ids != got {
                return Err(DomainError::revision_conflict("ordered item set mismatch"));
            }
            let current_order = item_order_snapshot(tx)?;
            let current_indices: HashMap<&str, usize> = current_order
                .ordered_item_ids
                .iter()
                .enumerate()
                .map(|(i, id)| (id.as_str(), i))
                .collect();
            for (new_idx, item_id) in req.ordered_item_ids.iter().enumerate() {
                let list_id: Option<Option<String>> = tx
                    .query_row(
                        "SELECT list_id FROM productivity_item WHERE id = ?1",
                        [item_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                let Some(list_id) = list_id else {
                    continue;
                };
                match ensure_list_writable(tx, list_id.as_deref()) {
                    Ok(()) => {}
                    Err(e) if e.code == "ARCHIVED_LIST_READONLY" => {
                        let old_idx = current_indices
                            .get(item_id.as_str())
                            .ok_or_else(|| DomainError::revision_conflict("ordered item set mismatch"))?;
                        if new_idx != *old_idx {
                            return Err(DomainError::archived_list_readonly());
                        }
                    }
                    Err(e) => return Err(e),
                }
            }
            let now = utc_now();
            write_item_order(tx, &req.ordered_item_ids, &now)?;
            let mut items = Vec::new();
            for id in &req.ordered_item_ids {
                items.push(item_snapshot(tx, id, true)?);
            }
            Ok(ReorderItemsResponse {
                item_order: item_order_snapshot(tx)?,
                items,
            })
        })
    })
}

pub fn move_item_to_list_and_place(
    data_dir: &str,
    req: MoveItemToListAndPlaceRequest,
) -> DomainResult<MoveItemToListAndPlaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (item, extra) = load_item_row(tx, &req.item.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.item.expected_revision, item.revision)?;
            ensure_item_writable(tx, &req.item.id)?;
            let target_list_id = if let Some(list_ref) = &req.list {
                let (list, list_extra) = load_list_row(tx, &list_ref.id, true)?;
                guard_unknown(&list_extra)?;
                check_revision(list_ref.expected_revision, list.revision)?;
                ensure_list_writable(tx, Some(&list_ref.id))?;
                Some(list_ref.id.clone())
            } else {
                None
            };
            let (order_revision, _) = load_item_order_row(tx)?;
            check_revision(req.item_order.expected_revision, order_revision)?;
            if req.item_order.id != ITEM_ORDER_ROOT_ID {
                return Err(DomainError::invalid_patch("invalid item order id"));
            }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_item SET list_id = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![target_list_id, now, req.item.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_item(tx, &req.item.id, &now)?;
            move_item_to_order_tail(tx, &req.item.id, target_list_id.as_deref(), &now)?;
            Ok(MoveItemToListAndPlaceResponse {
                item: item_snapshot(tx, &req.item.id, true)?,
                item_order: item_order_snapshot(tx)?,
            })
        })
    })
}
