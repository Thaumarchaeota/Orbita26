use rusqlite::params;
use rusqlite::OptionalExtension;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::error::{DomainError, DomainResult};
use crate::productivity_db::point::{point_to_json, validate_point};
use crate::productivity_db::repository::*;
use crate::productivity_db::types::*;
use crate::productivity_db::util::{new_uuid, utc_now};
use crate::productivity_db::validation::*;

fn restore_items_to_order(tx: &rusqlite::Transaction, item_ids: &[&str], now: &str) -> DomainResult<()> {
    let mut to_append = Vec::new();
    for item_id in item_ids {
        let exists = tx
            .query_row(
                "SELECT 1 FROM productivity_item_order_entry WHERE item_id = ?1 LIMIT 1",
                [item_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
            .is_some();
        if !exists {
            to_append.push(item_id);
        }
    }
    if to_append.is_empty() {
        return Ok(());
    }
    let mut position: i32 = tx
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM productivity_item_order_entry",
            [],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    for item_id in &to_append {
        tx.execute(
            "INSERT INTO productivity_item_order_entry (item_id, position) VALUES (?1, ?2)",
            params![item_id, position],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        position += 1;
    }
    bump_item_order(tx, now)?;
    Ok(())
}

pub fn create_list(data_dir: &str, req: CreateListRequest) -> DomainResult<ListResponse> {
    validate_list_status(&req.status)?;
    if let Some(p) = &req.planned_point {
        validate_point(p)?;
    }
    if let Some(p) = &req.due_point {
        validate_point(p)?;
    }
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let id = new_uuid();
            let now = utc_now();
            insert_list(
                tx,
                &id,
                &req.title,
                req.description.as_deref(),
                &req.status,
                point_to_json(&req.planned_point).as_deref(),
                point_to_json(&req.due_point).as_deref(),
                &now,
            )?;
            Ok(ListResponse {
                list: list_snapshot(tx, &id, true)?,
            })
        })
    })
}

pub fn update_list(data_dir: &str, req: UpdateListRequest) -> DomainResult<ListResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (list, extra) = load_list_row(tx, &req.list.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.list.expected_revision, list.revision)?;
            let (planned, due) = apply_point_patch(
                &list.planned_point,
                &list.due_point,
                &req.patch.planned_point,
                &req.patch.due_point,
            )?;
            let title = req.patch.title.as_deref().unwrap_or(&list.title);
            let description = if req.patch.description.is_some() {
                req.patch.description.clone().flatten()
            } else {
                list.description.clone()
            };
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_list SET title = ?1, description = ?2, planned_point_json = ?3, due_point_json = ?4, updated_at_utc = ?5 WHERE id = ?6",
                params![title, description, point_to_json(&planned), point_to_json(&due), now, req.list.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_list(tx, &req.list.id, &now)?;
            Ok(ListResponse {
                list: list_snapshot(tx, &req.list.id, true)?,
            })
        })
    })
}

pub fn set_list_status(data_dir: &str, req: SetListStatusRequest) -> DomainResult<ListResponse> {
    validate_list_status(&req.status)?;
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (list, extra) = load_list_row(tx, &req.list.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.list.expected_revision, list.revision)?;
            let targets = collect_list_item_targets(tx, &req.list.id)?;
            ensure_no_active_actions(tx, &targets)?;
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_list SET status = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![req.status, now, req.list.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_list(tx, &req.list.id, &now)?;
            Ok(ListResponse {
                list: list_snapshot(tx, &req.list.id, true)?,
            })
        })
    })
}

pub fn delete_list(data_dir: &str, req: DeleteListRequest) -> DomainResult<ListAndItemsResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (list, extra) = load_list_row(tx, &req.list.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.list.expected_revision, list.revision)?;
            ensure_list_writable(tx, Some(&req.list.id))?;
            let actual_members = list_item_member_refs(tx, &req.list.id)?;
            check_members(&req.expected_members, &actual_members)?;
            for member in &actual_members { crate::productivity_db::health_plan::guard_item(tx,&member.id)?; crate::productivity_db::travel_foundation::guard_generic_item_write(tx,&member.id)?; }
            let targets = collect_list_item_targets(tx, &req.list.id)?;
            ensure_no_active_actions(tx, &targets)?;
            let now = utc_now();
            let batch = new_uuid();
            tx.execute(
                "UPDATE productivity_list SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3",
                params![now, batch, req.list.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            tx.execute(
                "UPDATE productivity_item SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE list_id = ?3 AND deleted_at_utc IS NULL",
                params![now, batch, req.list.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            for member in &req.expected_members {
                bump_item(tx, &member.id, &now)?;
            }
            for member in &req.expected_members {
                tx.execute(
                    "DELETE FROM productivity_item_order_entry WHERE item_id = ?1",
                    [&member.id],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
            compact_item_order_positions(tx)?;
            bump_item_order(tx, &now)?;
            crate::workspace_db::repository::hide_live_domain_member(
                tx,
                crate::workspace_db::repository::DOMAIN_PRODUCTIVITY,
                crate::workspace_db::repository::TYPE_LIST,
                &req.list.id,
                &now,
            )?;
            bump_list(tx, &req.list.id, &now)?;
            let items = items_for_list(tx, &req.list.id, false)?;
            Ok(ListAndItemsResponse {
                list: list_snapshot(tx, &req.list.id, false)?,
                items,
            })
        })
    })
}

/// Deletes the List while keeping its live Items and their planning/execution data intact.
/// Inbox is represented by `list_id = NULL`; the global order entries stay in place.
pub fn delete_list_and_move_items_to_inbox(
    req: DeleteListAndMoveItemsToInboxRequest,
) -> DomainResult<ListAndItemsResponse> {
    crate::productivity_db::coordinator::with_write_expected(&req.expected_data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (list, list_extra) = load_list_row(tx, &req.list.id, true)?;
            guard_unknown(&list_extra)?;
            check_revision(req.list.expected_revision, list.revision)?;
            let actual_members = list_item_member_refs(tx, &req.list.id)?;
            check_members(&req.expected_members, &actual_members)?;

            for member in &actual_members {
                ensure_not_travel_v2_item(tx, &member.id)?;
                let extra: String = tx.query_row(
                    "SELECT extra_json FROM productivity_item WHERE id=?1 AND deleted_at_utc IS NULL",
                    [&member.id],
                    |row| row.get(0),
                )?;
                guard_unknown(&extra)?;
            }

            let now = utc_now();
            for member in &actual_members {
                tx.execute(
                    "UPDATE productivity_item SET list_id=NULL, updated_at_utc=?1, revision=revision+1 WHERE id=?2 AND deleted_at_utc IS NULL",
                    params![now, member.id],
                )?;
            }
            // Keep the List tombstone for existing restore/history flows. Moved Items no longer
            // carry this deletion batch, so restoring the List cannot reclaim them from Inbox.
            let batch = new_uuid();
            tx.execute(
                "UPDATE productivity_list SET deleted_at_utc=?1, updated_at_utc=?1, deletion_batch_id=?2, revision=revision+1 WHERE id=?3",
                params![now, batch, req.list.id],
            )?;
            crate::workspace_db::repository::hide_live_domain_member(
                tx,
                crate::workspace_db::repository::DOMAIN_PRODUCTIVITY,
                crate::workspace_db::repository::TYPE_LIST,
                &req.list.id,
                &now,
            )?;
            let list = list_snapshot(tx, &req.list.id, false)?;
            let items = actual_members
                .iter()
                .map(|member| item_snapshot(tx, &member.id, true))
                .collect::<DomainResult<Vec<_>>>()?;
            Ok(ListAndItemsResponse { list, items })
        })
    })
}

pub fn restore_list(data_dir: &str, req: RestoreListRequest) -> DomainResult<ListAndItemsResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (list, extra) = load_list_row(tx, &req.list.id, false)?;
            guard_unknown(&extra)?;
            check_revision(req.list.expected_revision, list.revision)?;
            if list.status == "已归档" {
                return Err(DomainError::archived_list_readonly());
            }
            let batch: Option<String> = tx
                .query_row(
                    "SELECT deletion_batch_id FROM productivity_list WHERE id = ?1",
                    [&req.list.id],
                    |row| row.get(0),
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let batch = batch.ok_or_else(|| DomainError::delete_batch_mismatch())?;
            let mut actual_members = Vec::new();
            let mut stmt = tx
                .prepare("SELECT id, revision FROM productivity_item WHERE list_id = ?1 AND deletion_batch_id = ?2")
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            let rows = stmt
                .query_map(params![req.list.id, batch], |row| {
                    Ok(RevisionRef {
                        id: row.get(0)?,
                        expected_revision: row.get(1)?,
                    })
                })
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            for row in rows {
                actual_members.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
            }
            check_members(&req.expected_members, &actual_members)?;
            ensure_list_writable(tx, Some(&req.list.id))?;
            for member in &actual_members { crate::productivity_db::health_plan::guard_item(tx,&member.id)?; crate::productivity_db::travel_foundation::guard_generic_item_write(tx,&member.id)?; }
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_list SET deleted_at_utc = NULL, updated_at_utc = ?1, deletion_batch_id = NULL WHERE id = ?2",
                params![now, req.list.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            for member in &req.expected_members {
                tx.execute(
                    "UPDATE productivity_item SET deleted_at_utc = NULL, updated_at_utc = ?1, deletion_batch_id = NULL WHERE id = ?2 AND deletion_batch_id = ?3",
                    params![now, member.id, batch],
                )
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                bump_item(tx, &member.id, &now)?;
            }
            let member_ids: Vec<&str> = req.expected_members.iter().map(|m| m.id.as_str()).collect();
            restore_items_to_order(tx, &member_ids, &now)?;
            bump_list(tx, &req.list.id, &now)?;
            let mut items = Vec::new();
            for member in &req.expected_members {
                items.push(item_snapshot(tx, &member.id, true)?);
            }
            Ok(ListAndItemsResponse {
                list: list_snapshot(tx, &req.list.id, true)?,
                items,
            })
        })
    })
}

pub fn create_item(data_dir: &str, req: CreateItemRequest) -> DomainResult<ItemResponse> {
    validate_item_status(&req.status)?;
    validate_item_priority(&req.priority)?;
    if let Some(p) = &req.planned_point {
        validate_point(p)?;
    }
    if let Some(p) = &req.due_point {
        validate_point(p)?;
    }
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            if let Some(list_id) = &req.list_id {
                let _ = list_snapshot(tx, list_id, true)?;
            }
            ensure_list_writable(tx, req.list_id.as_deref())?;
            let id = new_uuid();
            let now = utc_now();
            insert_item(
                tx,
                &id,
                req.list_id.as_deref(),
                &req.title,
                req.description.as_deref(),
                &req.status,
                &req.priority,
                point_to_json(&req.planned_point).as_deref(),
                point_to_json(&req.due_point).as_deref(),
                &now,
            )?;
            crate::productivity_db::classification::create_item_classification(tx,&id,req.item_type_id.as_deref(),&req.tag_ids,req.classification_expected.as_ref())?;
            append_item_to_order(tx, &id, &now)?;
            Ok(ItemResponse {
                item: item_snapshot(tx, &id, true)?,
            })
        })
    })
}

pub fn update_item(data_dir: &str, req: UpdateItemRequest) -> DomainResult<ItemResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (item, extra) = load_item_row(tx, &req.item.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.item.expected_revision, item.revision)?;
            ensure_item_writable(tx, &req.item.id)?;
            crate::productivity_db::health_plan::guard_item(tx, &req.item.id)?;
            ensure_not_travel_v2_item(tx, &req.item.id)?;
            let (planned, due) = apply_point_patch(
                &item.planned_point,
                &item.due_point,
                &req.patch.planned_point,
                &req.patch.due_point,
            )?;
            let title = req.patch.title.as_deref().unwrap_or(&item.title);
            let description = if req.patch.description.is_some() {
                req.patch.description.clone().flatten()
            } else {
                item.description.clone()
            };
            let status = if let Some(status) = &req.patch.status {
                validate_item_status(status)?;
                status.as_str()
            } else {
                item.status.as_str()
            };
            let priority = if let Some(priority) = &req.patch.priority {
                validate_item_priority(priority)?;
                priority.as_str()
            } else {
                item.priority.as_str()
            };
            let scalar_changed = title != item.title || description != item.description || status != item.status || priority != item.priority || planned != item.planned_point || due != item.due_point;
            let classification_changed = crate::productivity_db::classification::apply_item_patch_classification(tx,&req.item.id,&req.patch)?;
            if scalar_changed || classification_changed {
                let now = utc_now();
                if scalar_changed {
                    tx.execute(
                        "UPDATE productivity_item SET title = ?1, description = ?2, status = ?3, priority = ?4, planned_point_json = ?5, due_point_json = ?6, updated_at_utc = ?7 WHERE id = ?8",
                        params![title, description, status, priority, point_to_json(&planned), point_to_json(&due), now, req.item.id],
                    )
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                }
                bump_item(tx, &req.item.id, &now)?;
            }
            Ok(ItemResponse {
                item: item_snapshot(tx, &req.item.id, true)?,
            })
        })
    })
}

pub fn set_item_status(data_dir: &str, req: SetItemStatusRequest) -> DomainResult<ItemResponse> {
    validate_item_status(&req.status)?;
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (item, extra) = load_item_row(tx, &req.item.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.item.expected_revision, item.revision)?;
            ensure_item_writable(tx, &req.item.id)?;
            crate::productivity_db::health_plan::guard_item(tx, &req.item.id)?;
            ensure_not_travel_v2_item(tx, &req.item.id)?;
            ensure_no_active_actions(tx, &[req.item.id.clone()])?;
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_item SET status = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![req.status, now, req.item.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_item(tx, &req.item.id, &now)?;
            Ok(ItemResponse {
                item: item_snapshot(tx, &req.item.id, true)?,
            })
        })
    })
}

pub fn delete_item(data_dir: &str, req: DeleteItemRequest) -> DomainResult<ItemResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (item, extra) = load_item_row(tx, &req.item.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.item.expected_revision, item.revision)?;
            ensure_item_writable(tx, &req.item.id)?;
            crate::productivity_db::health_plan::guard_item(tx, &req.item.id)?;
            ensure_not_travel_v2_item(tx, &req.item.id)?;
            ensure_no_active_actions(tx, &[req.item.id.clone()])?;
            let now = utc_now();
            let batch = new_uuid();
            tx.execute(
                "UPDATE productivity_item SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3",
                params![now, batch, req.item.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            remove_item_from_order(tx, &req.item.id, &now)?;
            bump_item(tx, &req.item.id, &now)?;
            Ok(ItemResponse {
                item: item_snapshot(tx, &req.item.id, false)?,
            })
        })
    })
}

pub fn restore_item(data_dir: &str, req: RestoreItemRequest) -> DomainResult<ItemResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (item, extra) = load_item_row(tx, &req.item.id, false)?;
            guard_unknown(&extra)?;
            check_revision(req.item.expected_revision, item.revision)?;
            ensure_item_writable(tx, &req.item.id)?;
            crate::productivity_db::health_plan::guard_item(tx, &req.item.id)?;
            // C13: after group delete, generic restore would revive only the Item
            // while detail/legs/actions stay tombstones. Use restore_travel.
            ensure_not_travel_item(tx, &req.item.id)?;
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_item SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.item.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_item(tx, &req.item.id, &now)?;
            restore_items_to_order(tx, &[&req.item.id], &now)?;
            Ok(ItemResponse {
                item: item_snapshot(tx, &req.item.id, true)?,
            })
        })
    })
}

pub fn assign_item_to_list(data_dir: &str, req: AssignItemToListRequest) -> DomainResult<ItemResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (item, extra) = load_item_row(tx, &req.item.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.item.expected_revision, item.revision)?;
            ensure_item_writable(tx, &req.item.id)?;
            crate::productivity_db::health_plan::guard_item(tx, &req.item.id)?;
            ensure_not_travel_v2_item(tx, &req.item.id)?;
            let (list, list_extra) = load_list_row(tx, &req.list.id, true)?;
            guard_unknown(&list_extra)?;
            check_revision(req.list.expected_revision, list.revision)?;
            ensure_list_writable(tx, Some(&req.list.id))?;
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_item SET list_id = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![req.list.id, now, req.item.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_item(tx, &req.item.id, &now)?;
            Ok(ItemResponse {
                item: item_snapshot(tx, &req.item.id, true)?,
            })
        })
    })
}

pub fn move_item_to_list(data_dir: &str, req: MoveItemToListRequest) -> DomainResult<ItemResponse> {
    assign_item_to_list(
        data_dir,
        AssignItemToListRequest {
            item: req.item,
            list: req.list,
        },
    )
}

pub fn remove_item_from_list(data_dir: &str, req: RemoveItemFromListRequest) -> DomainResult<ItemResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let (item, extra) = load_item_row(tx, &req.item.id, true)?;
            guard_unknown(&extra)?;
            check_revision(req.item.expected_revision, item.revision)?;
            ensure_item_writable(tx, &req.item.id)?;
            crate::productivity_db::health_plan::guard_item(tx, &req.item.id)?;
            ensure_not_travel_v2_item(tx, &req.item.id)?;
            let now = utc_now();
            tx.execute(
                "UPDATE productivity_item SET list_id = NULL, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.item.id],
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            bump_item(tx, &req.item.id, &now)?;
            Ok(ItemResponse {
                item: item_snapshot(tx, &req.item.id, true)?,
            })
        })
    })
}
