use crate::productivity_db::{
    classification::{create_item_type, create_tag},
    commands::create_item_after,
    types::{
        ClassificationExpected, CreateItemAfterRequest, CreateItemTypeRequest, CreateTagRequest,
        RevisionRef,
    },
};

use super::harness::*;

#[test]
fn create_item_after_inserts_after_anchor() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let a = create_item(&data_dir, "a", Some(&list.id));
    let b = create_item(&data_dir, "b", Some(&list.id));
    let order = item_order(&data_dir);
    let members = item_order_members(&data_dir);

    let res = create_item_after(
        &data_dir,
        CreateItemAfterRequest {
            title: "new".to_string(),
            description: None,
            status: "进行中".to_string(),
            list_id: Some(list.id.clone()),
            priority: "none".to_string(),
            planned_point: None,
            due_point: None,
            item_type_id: None,
            tag_ids: vec![],
            classification_expected: None,
            insert_after_item_id: a.id.clone(),
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision,
            },
            expected_members: members,
        },
    )
    .expect("create item after anchor");

    assert_eq!(
        res.item_order.ordered_item_ids,
        vec![a.id, res.item.id.clone(), b.id]
    );
    archive.cleanup();
}

#[test]
fn create_item_after_revision_conflict_rolls_back_no_new_row() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let a = create_item(&data_dir, "a", Some(&list.id));
    let _b = create_item(&data_dir, "b", Some(&list.id));
    let order = item_order(&data_dir);
    let members = item_order_members(&data_dir);
    let count_before = live_item_count(&archive.conn());

    let err = create_item_after(
        &data_dir,
        CreateItemAfterRequest {
            title: "phantom".to_string(),
            description: None,
            status: "进行中".to_string(),
            list_id: Some(list.id.clone()),
            priority: "none".to_string(),
            planned_point: None,
            due_point: None,
            item_type_id: None,
            tag_ids: vec![],
            classification_expected: None,
            insert_after_item_id: a.id.clone(),
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision - 1,
            },
            expected_members: members,
        },
    )
    .unwrap_err();

    assert_err_code(err, "REVISION_CONFLICT");
    assert_eq!(live_item_count(&archive.conn()), count_before);
    archive.cleanup();
}

#[test]
fn create_item_after_list_mismatch_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list_a = create_list(&data_dir, "list-a");
    let list_b = create_list(&data_dir, "list-b");
    let anchor = create_item(&data_dir, "anchor", Some(&list_a.id));
    let order = item_order(&data_dir);
    let members = item_order_members(&data_dir);
    let count_before = live_item_count(&archive.conn());

    let err = create_item_after(
        &data_dir,
        CreateItemAfterRequest {
            title: "wrong-list".to_string(),
            description: None,
            status: "进行中".to_string(),
            list_id: Some(list_b.id.clone()),
            priority: "none".to_string(),
            planned_point: None,
            due_point: None,
            item_type_id: None,
            tag_ids: vec![],
            classification_expected: None,
            insert_after_item_id: anchor.id.clone(),
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision,
            },
            expected_members: members,
        },
    )
    .unwrap_err();

    assert_err_code(err, "INVALID_PATCH");
    assert_eq!(live_item_count(&archive.conn()), count_before);
    archive.cleanup();
}

#[test]
fn create_item_after_anchor_not_in_order_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let anchor = create_item(&data_dir, "anchor", Some(&list.id));
    remove_item_from_order(&archive.conn(), &anchor.id);
    let order = item_order(&data_dir);
    let members = item_order_members(&data_dir);
    let count_before = live_item_count(&archive.conn());

    let err = create_item_after(
        &data_dir,
        CreateItemAfterRequest {
            title: "nowhere".to_string(),
            description: None,
            status: "进行中".to_string(),
            list_id: Some(list.id.clone()),
            priority: "none".to_string(),
            planned_point: None,
            due_point: None,
            item_type_id: None,
            tag_ids: vec![],
            classification_expected: None,
            insert_after_item_id: anchor.id.clone(),
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision,
            },
            expected_members: members,
        },
    )
    .unwrap_err();

    assert_err_code(err, "ROOT_NOT_FOUND");
    assert_eq!(live_item_count(&archive.conn()), count_before);
    archive.cleanup();
}

#[test]
fn create_item_after_applies_item_type_and_tags_with_expected_revisions() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let anchor = create_item(&data_dir, "anchor", Some(&list.id));
    let order = item_order(&data_dir);
    let members = item_order_members(&data_dir);
    let catalog = create_item_type(
        &data_dir,
        CreateItemTypeRequest {
            catalog: None,
            name: "Work".into(),
            parent_item_type_id: None,
            color_override: Some("#123456".into()),
        },
    )
    .unwrap()
    .catalog
    .unwrap();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Important".into() })
        .unwrap()
        .tag;

    let created = create_item_after(
        &data_dir,
        CreateItemAfterRequest {
            title: "classified continuation".into(),
            description: None,
            status: "进行中".into(),
            list_id: Some(list.id),
            priority: "none".into(),
            planned_point: None,
            due_point: None,
            item_type_id: Some(catalog.item_types[0].id.clone()),
            tag_ids: vec![tag.id.clone()],
            classification_expected: Some(ClassificationExpected {
                item_type_catalog: Some(RevisionRef {
                    id: catalog.id,
                    expected_revision: catalog.revision,
                }),
                tags: vec![RevisionRef {
                    id: tag.id.clone(),
                    expected_revision: tag.revision,
                }],
            }),
            insert_after_item_id: anchor.id,
            item_order: RevisionRef {
                id: order.id,
                expected_revision: order.revision,
            },
            expected_members: members,
        },
    )
    .expect("create classified continuation")
    .item;

    assert_eq!(created.item_type_id.as_deref(), Some(catalog.item_types[0].id.as_str()));
    assert_eq!(created.tag_ids, vec![tag.id]);
    archive.cleanup();
}

#[test]
fn create_item_after_stale_classification_ref_rolls_back_without_new_item() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let anchor = create_item(&data_dir, "anchor", Some(&list.id));
    let order = item_order(&data_dir);
    let members = item_order_members(&data_dir);
    let count_before = live_item_count(&archive.conn());
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Important".into() })
        .unwrap()
        .tag;

    let err = create_item_after(
        &data_dir,
        CreateItemAfterRequest {
            title: "phantom continuation".into(),
            description: None,
            status: "进行中".into(),
            list_id: Some(list.id),
            priority: "none".into(),
            planned_point: None,
            due_point: None,
            item_type_id: None,
            tag_ids: vec![tag.id.clone()],
            classification_expected: Some(ClassificationExpected {
                item_type_catalog: None,
                tags: vec![RevisionRef {
                    id: tag.id,
                    expected_revision: tag.revision + 1,
                }],
            }),
            insert_after_item_id: anchor.id,
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision,
            },
            expected_members: members,
        },
    )
    .unwrap_err();

    assert_err_code(err, "REVISION_CONFLICT");
    assert_eq!(live_item_count(&archive.conn()), count_before);
    assert_eq!(item_order(&data_dir).revision, order.revision);
    archive.cleanup();
}
