use crate::productivity_db::commands::{
    move_item_to_list, move_item_to_list_and_place, reorder_items,
};
use crate::productivity_db::types::{
    MoveItemToListAndPlaceRequest, MoveItemToListRequest, ReorderItemsRequest, RevisionRef,
};

use super::harness::*;

#[test]
fn archived_list_move_item_in_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let active = create_list(&data_dir, "active");
    let archived_src = create_list(&data_dir, "archived-src");
    let archived = archive_list(&data_dir, &archived_src);
    let loose = create_item(&data_dir, "loose", Some(&active.id));
    let before = capture_facts(&archive, &data_dir);
    let loose_rev = loose.revision;
    let archived_rev = archived.revision;

    let err = move_item_to_list(
        &data_dir,
        MoveItemToListRequest {
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
    assert_no_fact_change(&archive, &data_dir, &before);
    assert_eq!(get_item(&data_dir, &loose.id).revision, loose_rev);
    assert_eq!(
        get_item(&data_dir, &loose.id).list_id.as_deref(),
        Some(active.id.as_str())
    );
    assert_eq!(list_revision(&archive.conn(), &archived.id), archived_rev);
    archive.cleanup();
}

#[test]
fn archived_list_move_item_out_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let active = create_list(&data_dir, "active");
    let archived_src = create_list(&data_dir, "archived-src");
    let item = create_item(&data_dir, "trapped", Some(&archived_src.id));
    let archived = archive_list(&data_dir, &archived_src);
    let item = get_item(&data_dir, &item.id);
    let before = capture_facts(&archive, &data_dir);
    let item_rev = item.revision;

    let err = move_item_to_list(
        &data_dir,
        MoveItemToListRequest {
            item: RevisionRef {
                id: item.id.clone(),
                expected_revision: item.revision,
            },
            list: RevisionRef {
                id: active.id.clone(),
                expected_revision: active.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    assert_eq!(get_item(&data_dir, &item.id).revision, item_rev);
    assert_eq!(
        get_item(&data_dir, &item.id).list_id.as_deref(),
        Some(archived.id.as_str())
    );
    archive.cleanup();
}

#[test]
fn archived_list_move_item_to_unassigned_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let _archived = archive_list(&data_dir, &list);
    let item = get_item(&data_dir, &item.id);
    let order = item_order(&data_dir);
    let before = capture_facts(&archive, &data_dir);
    let item_rev = item.revision;

    let err = move_item_to_list_and_place(
        &data_dir,
        MoveItemToListAndPlaceRequest {
            item: RevisionRef {
                id: item.id.clone(),
                expected_revision: item.revision,
            },
            list: None,
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    assert_eq!(get_item(&data_dir, &item.id).revision, item_rev);
    archive.cleanup();
}

#[test]
fn archived_list_move_item_to_list_and_place_in_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let active = create_list(&data_dir, "active");
    let archived_src = create_list(&data_dir, "archived");
    let loose = create_item(&data_dir, "loose", Some(&active.id));
    let archived = archive_list(&data_dir, &archived_src);
    let order = item_order(&data_dir);
    let before = capture_facts(&archive, &data_dir);

    let err = move_item_to_list_and_place(
        &data_dir,
        MoveItemToListAndPlaceRequest {
            item: RevisionRef {
                id: loose.id.clone(),
                expected_revision: loose.revision,
            },
            list: Some(RevisionRef {
                id: archived.id.clone(),
                expected_revision: archived.revision,
            }),
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_reorder_unchanged_archived_items_allowed() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let archived_src = create_list(&data_dir, "archived");
    let active = create_list(&data_dir, "active");
    let a = create_item(&data_dir, "a", Some(&archived_src.id));
    let b = create_item(&data_dir, "b", Some(&archived_src.id));
    let c = create_item(&data_dir, "c", Some(&active.id));
    let _archived = archive_list(&data_dir, &archived_src);
    let order = item_order(&data_dir);
    let members = item_order_members(&data_dir);
    let before = capture_facts(&archive, &data_dir);

    reorder_items(
        &data_dir,
        ReorderItemsRequest {
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision,
            },
            expected_members: members,
            ordered_item_ids: vec![a.id.clone(), b.id.clone(), c.id.clone()],
        },
    )
    .expect("noop reorder with archived items in place");

    assert_eq!(
        item_order(&data_dir).ordered_item_ids,
        vec![a.id, b.id, c.id]
    );
    assert_eq!(capture_facts(&archive, &data_dir).live_items, before.live_items);
    archive.cleanup();
}

#[test]
fn archived_list_reorder_move_archived_item_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let archived_src = create_list(&data_dir, "archived");
    let active = create_list(&data_dir, "active");
    let a = create_item(&data_dir, "a", Some(&archived_src.id));
    let b = create_item(&data_dir, "b", Some(&archived_src.id));
    let c = create_item(&data_dir, "c", Some(&active.id));
    let _archived = archive_list(&data_dir, &archived_src);
    let order = item_order(&data_dir);
    let members = item_order_members(&data_dir);
    let before = capture_facts(&archive, &data_dir);

    let err = reorder_items(
        &data_dir,
        ReorderItemsRequest {
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision,
            },
            expected_members: members,
            ordered_item_ids: vec![c.id.clone(), a.id.clone(), b.id.clone()],
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}
