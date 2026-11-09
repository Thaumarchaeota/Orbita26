use crate::productivity_db::commands::{
    assign_item_to_list, create_action, create_item as create_item_cmd, delete_item,
    remove_item_from_list, reorder_items, restore_item, set_item_status, update_item,
};
use crate::productivity_db::types::{
    AssignItemToListRequest, CreateActionRequest, CreateItemRequest, DeleteItemRequest, ItemPatch,
    RemoveItemFromListRequest, ReorderItemsRequest, RestoreItemRequest, RevisionRef,
    SetItemStatusRequest, UpdateItemRequest,
};

use super::harness::*;

#[test]
fn archived_list_update_item_returns_readonly() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let archived = archive_list(&data_dir, &list);
    assert_eq!(archived.status, "已归档");
    let item = get_item(&data_dir, &item.id);

    let err = update_item(
        &data_dir,
        UpdateItemRequest {
            item: RevisionRef {
                id: item.id.clone(),
                expected_revision: item.revision,
            },
            patch: ItemPatch {
                title: Some("blocked".to_string()),
                description: None,
                status: None,
                priority: None,
                planned_point: None,
                due_point: None,
                item_type_id: None,
                tag_ids: None,
                classification_expected: None,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    archive.cleanup();
}

#[test]
fn archived_list_create_item_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let archived = archive_list(&data_dir, &list);
    let count_before = live_item_count(&archive.conn());

    let err = create_item_cmd(
        &data_dir,
        CreateItemRequest {
            title: "new".to_string(),
            description: None,
            status: "进行中".to_string(),
            list_id: Some(archived.id.clone()),
            priority: "none".to_string(),
            planned_point: None,
            due_point: None,
            item_type_id: None,
            tag_ids: vec![],
            classification_expected: None,
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_eq!(live_item_count(&archive.conn()), count_before);
    archive.cleanup();
}

#[test]
fn archived_list_assign_item_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "archived-list");
    let archived = archive_list(&data_dir, &list);
    let loose = create_item(&data_dir, "loose", None);

    let err = assign_item_to_list(
        &data_dir,
        AssignItemToListRequest {
            item: RevisionRef {
                id: loose.id.clone(),
                expected_revision: loose.revision,
            },
            list: RevisionRef {
                id: archived.id.clone(),
                expected_revision: archived.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    archive.cleanup();
}

#[test]
fn archived_list_remove_item_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let archived = archive_list(&data_dir, &list);
    assert_eq!(archived.status, "已归档");
    let item = get_item(&data_dir, &item.id);

    let err = remove_item_from_list(
        &data_dir,
        RemoveItemFromListRequest {
            item: RevisionRef {
                id: item.id.clone(),
                expected_revision: item.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    archive.cleanup();
}

#[test]
fn archived_list_reorder_items_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let a = create_item(&data_dir, "a", Some(&list.id));
    let b = create_item(&data_dir, "b", Some(&list.id));
    let _archived = archive_list(&data_dir, &list);
    let order = item_order(&data_dir);
    let members = item_order_members(&data_dir);

    let err = reorder_items(
        &data_dir,
        ReorderItemsRequest {
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision,
            },
            expected_members: members,
            ordered_item_ids: vec![b.id.clone(), a.id.clone()],
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    archive.cleanup();
}

#[test]
fn archived_list_create_action_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let _archived = archive_list(&data_dir, &list);

    let err = create_action(
        &data_dir,
        CreateActionRequest { expected_data_dir: None,
            title: "action".to_string(),
            name_link_mode: None,
            summary: None,
            session_id: None,
            target_kind: Some("item".to_string()),
            target_id: Some(item.id.clone()),
            planned_start_at: None,
            planned_end_at: None,
            planned_duration: None,
            appearance: None,
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    archive.cleanup();
}

#[test]
fn archived_list_set_item_status_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let _archived = archive_list(&data_dir, &list);
    let item = get_item(&data_dir, &item.id);
    let before = capture_facts(&archive, &data_dir);
    let rev_before = item.revision;

    let err = set_item_status(
        &data_dir,
        SetItemStatusRequest {
            item: RevisionRef {
                id: item.id.clone(),
                expected_revision: item.revision,
            },
            status: "完成".to_string(),
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    assert_eq!(get_item(&data_dir, &item.id).revision, rev_before);
    archive.cleanup();
}

#[test]
fn archived_list_delete_item_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let _archived = archive_list(&data_dir, &list);
    let item = get_item(&data_dir, &item.id);
    let before = capture_facts(&archive, &data_dir);
    let rev_before = item.revision;

    let err = delete_item(
        &data_dir,
        DeleteItemRequest {
            item: RevisionRef {
                id: item.id.clone(),
                expected_revision: item.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    assert_eq!(get_item(&data_dir, &item.id).revision, rev_before);
    archive.cleanup();
}

#[test]
fn archived_list_restore_item_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let deleted = delete_item(
        &data_dir,
        DeleteItemRequest {
            item: RevisionRef {
                id: item.id.clone(),
                expected_revision: item.revision,
            },
        },
    )
    .expect("delete while writable")
    .item;
    let _archived = archive_list(&data_dir, &list);
    let before = capture_facts(&archive, &data_dir);
    let rev_before = item_revision(&archive.conn(), &deleted.id);

    let err = restore_item(
        &data_dir,
        RestoreItemRequest {
            item: RevisionRef {
                id: deleted.id.clone(),
                expected_revision: deleted.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    assert_eq!(item_revision(&archive.conn(), &deleted.id), rev_before);
    archive.cleanup();
}

#[test]
fn archived_list_unarchive_succeeds() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let archived = archive_list(&data_dir, &list);
    assert_eq!(archived.status, "已归档");

    let active = set_list_status(&data_dir, &archived, "进行中");
    assert_eq!(active.status, "进行中");

    let item = get_item(&data_dir, &item.id);
    update_item(
        &data_dir,
        UpdateItemRequest {
            item: RevisionRef {
                id: item.id.clone(),
                expected_revision: item.revision,
            },
            patch: ItemPatch {
                title: Some("writable again".to_string()),
                description: None,
                status: None,
                priority: None,
                planned_point: None,
                due_point: None,
                item_type_id: None,
                tag_ids: None,
                classification_expected: None,
            },
        },
    )
    .expect("update after unarchive");

    archive.cleanup();
}
