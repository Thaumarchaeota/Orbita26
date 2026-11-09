use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::error::{DomainError, DomainResult};
use crate::productivity_db::point::{point_to_json, validate_point};
use crate::productivity_db::repository::*;
use crate::productivity_db::types::*;
use crate::productivity_db::util::{new_uuid, utc_now};
use crate::productivity_db::validation::*;

pub fn create_item_after(data_dir: &str, req: CreateItemAfterRequest) -> DomainResult<CreateItemAfterResponse> {
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
            ensure_list_writable(tx, req.list_id.as_deref())?;
            let (revision, _) = load_item_order_row(tx)?;
            check_revision(req.item_order.expected_revision, revision)?;
            if req.item_order.id != ITEM_ORDER_ROOT_ID {
                return Err(DomainError::invalid_patch("invalid item order id"));
            }
            let actual_members = live_item_order_member_refs(tx)?;
            check_members(&req.expected_members, &actual_members)?;
            let (anchor, anchor_extra) = load_item_row(tx, &req.insert_after_item_id, true)?;
            guard_unknown(&anchor_extra)?;
            ensure_item_writable(tx, &req.insert_after_item_id)?;
            if anchor.list_id != req.list_id {
                return Err(DomainError::invalid_patch("insertAfterItemId list mismatch"));
            }
            let order = item_order_snapshot(tx)?;
            if !order.ordered_item_ids.iter().any(|id| id == &req.insert_after_item_id) {
                return Err(DomainError::root_not_found("anchor item not in order"));
            }
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
            insert_item_after_in_order(tx, &id, &req.insert_after_item_id, &now)?;
            let item_order = item_order_snapshot(tx)?;
            let mut items = Vec::new();
            for item_id in &item_order.ordered_item_ids {
                items.push(item_snapshot(tx, item_id, true)?);
            }
            Ok(CreateItemAfterResponse {
                item: item_snapshot(tx, &id, true)?,
                item_order,
                items,
            })
        })
    })
}
