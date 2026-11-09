use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::coordinator::{in_transaction, with_panel_write_token, with_snapshot};
use super::error::{DomainError, DomainResult};
use super::repository::{item_order_snapshot, list_actions, list_items, list_lists};
use super::types::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListSnapshot {
    pub resolved_data_dir: String,
    pub data_dir_epoch: u64,
    pub change_version: u64,
    pub lists: Vec<ListSnapshot>,
    pub items: Vec<ItemSnapshot>,
    pub item_order: Option<ItemOrderSnapshot>,
    pub actions: Vec<ActionSnapshot>,
    pub item_types: Option<ItemTypeCatalogSnapshot>,
    pub business_time_zone: BusinessTimeZoneResponse,
}

fn read_timezone(tx: &rusqlite::Transaction<'_>) -> DomainResult<BusinessTimeZoneResponse> {
    let base_offset: String = tx.query_row("SELECT value FROM archive_meta WHERE key='base_timezone_offset'", [], |r| r.get(0))?;
    let mut stmt = tx.prepare("SELECT start_utc,end_utc,offset FROM timezone_replacement ORDER BY start_utc,id")?;
    let replacements = stmt.query_map([], |r| Ok(BusinessTimeZoneReplacement { start_utc:r.get(0)?, end_utc:r.get(1)?, offset:r.get(2)? }))?.collect::<Result<Vec<_>, _>>()?;
    Ok(BusinessTimeZoneResponse { base_offset, replacements })
}

pub fn get_task_list_snapshot(app: &AppHandle) -> Result<TaskListSnapshot, String> {
    let root = crate::data::get_data_dir(app)?;
    with_snapshot(&root, |conn, epoch, version| {
        match conn {
            None => Ok(TaskListSnapshot {
                resolved_data_dir: root.clone(), data_dir_epoch: epoch, change_version: version,
                lists: vec![], items: vec![], item_order: None, actions: vec![], item_types: None,
                business_time_zone: BusinessTimeZoneResponse { base_offset: super::schema::BASE_TIMEZONE_OFFSET.to_string(), replacements: vec![] },
            }),
            Some(conn) => in_transaction(conn, |tx| Ok(TaskListSnapshot {
                resolved_data_dir: root.clone(), data_dir_epoch: epoch, change_version: version,
                lists: list_lists(tx, true)?, items: list_items(tx, None, false, true)?,
                item_order: Some(item_order_snapshot(tx)?), actions: list_actions(tx, true)?,
                item_types: super::classification::catalog_snapshot(tx)?, business_time_zone: read_timezone(tx)?,
            })),
        }
    }).map_err(String::from)
}

pub fn validate_item_target(root: &str, epoch: u64, item_id: &str) -> DomainResult<()> {
    with_snapshot(root, |conn, current_epoch, _| {
        if current_epoch != epoch { return Err(DomainError::archive_lifecycle("dataDir changed while navigation was pending")); }
        let conn = conn.ok_or_else(|| DomainError::root_not_found("item not found"))?;
        in_transaction(conn, |tx| {
            let item = super::repository::item_snapshot(tx, item_id, true)?;
            if item.deleted_at_utc.is_some() { return Err(DomainError::root_deleted("item deleted")); }
            Ok(())
        })
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all="camelCase")]
pub struct PanelTaskWriteRequest {
    pub expected_data_dir: String,
    pub expected_data_dir_epoch: u64,
    pub operation: PanelTaskWriteOperation,
}

#[derive(Debug, Deserialize)]
#[serde(tag="kind", content="request", rename_all="camelCase", deny_unknown_fields)]
pub enum PanelTaskWriteOperation {
    SetItemStatus(SetItemStatusRequest),
    UpdateItem(UpdateItemRequest),
    CreateItem(CreateItemRequest),
    CreateItemAfter(CreateItemAfterRequest),
    MoveItem(MoveItemToListAndPlaceRequest),
    ReorderItems(ReorderItemsRequest),
    DeleteItem(DeleteItemRequest),
    BatchMoveItemsToList(BatchMoveItemsToListRequest),
    BatchDeleteItems(BatchDeleteItemsRequest),
}

pub fn apply_task_write(app: &AppHandle, req: PanelTaskWriteRequest) -> Result<serde_json::Value, String> {
    let actual = crate::data::get_data_dir(app)?;
    if actual != req.expected_data_dir { return Err(DomainError::archive_lifecycle("dataDir changed while Panel request was pending").into()); }
    let root = req.expected_data_dir.clone();
    let epoch = req.expected_data_dir_epoch;
    with_panel_write_token(&root, epoch, || {
        let out = match req.operation {
            PanelTaskWriteOperation::SetItemStatus(r) => super::commands::set_item_status(&root, r).and_then(|v| serde_json::to_value(v).map_err(|e| DomainError::archive_lifecycle(e.to_string()))),
            PanelTaskWriteOperation::UpdateItem(r) => super::commands::update_item(&root, r).and_then(|v| serde_json::to_value(v).map_err(|e| DomainError::archive_lifecycle(e.to_string()))),
            PanelTaskWriteOperation::CreateItem(r) => super::commands::create_item(&root, r).and_then(|v| serde_json::to_value(v).map_err(|e| DomainError::archive_lifecycle(e.to_string()))),
            PanelTaskWriteOperation::CreateItemAfter(r) => super::commands::create_item_after(&root, r).and_then(|v| serde_json::to_value(v).map_err(|e| DomainError::archive_lifecycle(e.to_string()))),
            PanelTaskWriteOperation::MoveItem(r) => super::commands::move_item_to_list_and_place(&root, r).and_then(|v| serde_json::to_value(v).map_err(|e| DomainError::archive_lifecycle(e.to_string()))),
            PanelTaskWriteOperation::ReorderItems(r) => super::commands::reorder_items(&root, r).and_then(|v| serde_json::to_value(v).map_err(|e| DomainError::archive_lifecycle(e.to_string()))),
            PanelTaskWriteOperation::DeleteItem(r) => super::commands::delete_item(&root, r).and_then(|v| serde_json::to_value(v).map_err(|e| DomainError::archive_lifecycle(e.to_string()))),
            PanelTaskWriteOperation::BatchMoveItemsToList(r) => super::commands::batch_move_items_to_list(&root, r).and_then(|v| serde_json::to_value(v).map_err(|e| DomainError::archive_lifecycle(e.to_string()))),
            PanelTaskWriteOperation::BatchDeleteItems(r) => super::commands::batch_delete_items(&root, r).and_then(|v| serde_json::to_value(v).map_err(|e| DomainError::archive_lifecycle(e.to_string()))),
        };
        out
    }).map_err(String::from)
}
