use crate::productivity_db::{
    classification::{create_item_type, create_tag},
    commands::{apply_productivity_ai_batch, commit_item_with_actions, create_item as create_item_cmd},
    types::{
        ClassificationExpected, CommitActionCreateDraft, CommitItemWithActionsRequest,
        CreateItemRequest, CreateItemTypeRequest, CreateTagRequest, ItemPatch,
        ProductivityAiBatchCreateAction, ProductivityAiBatchOp,
        ProductivityAiBatchUpdateItem, ApplyProductivityAiBatchRequest, RevisionRef,
    },
};
use super::harness::*;

fn reference(id: &str, revision: i64) -> RevisionRef {
    RevisionRef { id: id.to_string(), expected_revision: revision }
}

fn empty_op() -> ProductivityAiBatchOp {
    ProductivityAiBatchOp {
        create_project: None, update_project: None, create_task: None, update_task: None,
        create_list: None, update_list: None, create_item: None, update_item: None,
        create_session: None, update_session: None, create_action: None, update_action: None,
    }
}

#[test]
fn commit_item_with_actions_commits_classification_and_item_once() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let catalog = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: None, name: "Study".into(), parent_item_type_id: None,
        color_override: Some("#204060".into()),
    }).unwrap().catalog.unwrap();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Course".into() }).unwrap().tag;

    let response = commit_item_with_actions(&data_dir, CommitItemWithActionsRequest {
        item_id: None, item_expected_revision: None,
        item_create: Some(CreateItemRequest {
            title: "learn".into(), description: None, status: "进行中".into(), list_id: None,
            priority: "none".into(), planned_point: None, due_point: None,
            item_type_id: Some(catalog.item_types[0].id.clone()), tag_ids: vec![tag.id.clone()],
            classification_expected: Some(ClassificationExpected {
                item_type_catalog: Some(reference(&catalog.id, catalog.revision)),
                tags: vec![reference(&tag.id, tag.revision)],
            }),
        }),
        item_patch: None, expected_associated_actions: vec![],
        action_creates: vec![CommitActionCreateDraft {
            title: "class session".into(), name_link_mode: None, summary: None, session_id: None,
            planned_start_at: None, planned_end_at: None, planned_duration: None, appearance: None,
        }],
        action_updates: vec![], action_deletes: vec![],
    }).expect("atomic item+action create");
    assert_eq!(response.item.revision, 1);
    assert_eq!(response.item.item_type_id.as_deref(), Some(catalog.item_types[0].id.as_str()));
    assert_eq!(response.item.tag_ids, vec![tag.id]);
    assert_eq!(response.actions.len(), 1);
    assert_eq!(response.actions[0].target_id.as_deref(), Some(response.item.id.as_str()));
    archive.cleanup();
}

#[test]
fn ai_batch_applies_multiple_item_edits_and_classification_with_one_item_revision() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "before", None);
    let catalog = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: None, name: "Travel".into(), parent_item_type_id: None,
        color_override: Some("#406080".into()),
    }).unwrap().catalog.unwrap();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Booked".into() }).unwrap().tag;
    let item_order_before = item_order(&data_dir);

    let mut title_op = empty_op();
    title_op.update_item = Some(ProductivityAiBatchUpdateItem {
        item: reference(&item.id, item.revision),
        patch: ItemPatch {
            title: Some("after".into()), description: None, status: None, priority: None,
            planned_point: None, due_point: None, item_type_id: None, tag_ids: None,
            classification_expected: None,
        },
    });
    let mut classification_op = empty_op();
    classification_op.update_item = Some(ProductivityAiBatchUpdateItem {
        item: reference(&item.id, item.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None,
            item_type_id: Some(Some(catalog.item_types[0].id.clone())), tag_ids: Some(vec![tag.id.clone()]),
            classification_expected: Some(ClassificationExpected {
                item_type_catalog: Some(reference(&catalog.id, catalog.revision)),
                tags: vec![reference(&tag.id, tag.revision)],
            }),
        },
    });
    let applied = apply_productivity_ai_batch(&data_dir, ApplyProductivityAiBatchRequest {
        ops: vec![title_op, classification_op], expected_data_dir: None,
    }).expect("AI batch applies both changes");
    assert_eq!(applied.items.len(), 1);
    assert_eq!(applied.items[0].id, item.id);
    assert_eq!(applied.items[0].revision, item.revision + 1);
    assert_eq!(applied.items[0].title, "after");
    assert_eq!(applied.items[0].item_type_id.as_deref(), Some(catalog.item_types[0].id.as_str()));
    assert_eq!(applied.items[0].tag_ids, vec![tag.id]);
    assert_eq!(item_order(&data_dir).revision, item_order_before.revision);
    archive.cleanup();
}

#[test]
fn ai_batch_item_create_uses_the_same_classification_rules_and_rolls_back_duplicates() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Repeated".into() }).unwrap().tag;
    let mut op = empty_op();
    op.create_item = Some(crate::productivity_db::types::ProductivityAiBatchCreateItem {
        title: "duplicate tags".into(), description: None, status: "进行中".into(), list_id: None,
        priority: "none".into(), planned_point: None, due_point: None,
        item_type_id: None, tag_ids: vec![tag.id.clone(), tag.id.clone()],
        classification_expected: Some(ClassificationExpected { item_type_catalog: None, tags: vec![reference(&tag.id, tag.revision)] }),
    });
    let before = live_item_count(&archive.conn());
    let err = apply_productivity_ai_batch(&data_dir, ApplyProductivityAiBatchRequest { ops: vec![op], expected_data_dir: None }).unwrap_err();
    assert_err_code(err, "INVALID_PATCH");
    assert_eq!(live_item_count(&archive.conn()), before);

    let mut valid = empty_op();
    valid.create_item = Some(crate::productivity_db::types::ProductivityAiBatchCreateItem {
        title: "valid classification".into(), description: None, status: "进行中".into(), list_id: None,
        priority: "none".into(), planned_point: None, due_point: None,
        item_type_id: None, tag_ids: vec![tag.id.clone()],
        classification_expected: Some(ClassificationExpected { item_type_catalog: None, tags: vec![reference(&tag.id, tag.revision)] }),
    });
    let created = apply_productivity_ai_batch(&data_dir, ApplyProductivityAiBatchRequest { ops: vec![valid], expected_data_dir: None })
        .expect("AI create uses classification validation");
    assert_eq!(created.items.len(), 1);
    assert_eq!(created.items[0].revision, 1);
    assert_eq!(created.items[0].tag_ids, vec![tag.id]);
    archive.cleanup();
}

#[test]
fn ai_batch_create_action_preserves_item_target_and_classification_isolation() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "target", None);
    let action_order_before = item_order(&data_dir).revision;
    let mut op = empty_op();
    op.create_action = Some(ProductivityAiBatchCreateAction {
        title: "action".into(), name_link_mode: None, summary: None, session_id: None,
        target_kind: Some("item".into()), target_id: Some(item.id.clone()),
        planned_start_at: None, planned_end_at: None, planned_duration: None, appearance: None,
    });
    let result = apply_productivity_ai_batch(&data_dir, ApplyProductivityAiBatchRequest {
        ops: vec![op], expected_data_dir: None,
    }).unwrap();
    assert_eq!(result.actions.len(), 1);
    assert_eq!(result.actions[0].target_id.as_deref(), Some(item.id.as_str()));
    assert_eq!(get_item(&data_dir, &item.id).revision, item.revision);
    assert_eq!(item_order(&data_dir).revision, action_order_before);
    archive.cleanup();
}

#[test]
fn ai_batch_empty_patch_and_same_classification_resubmit_are_noops() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let catalog = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: None, name: "Work".into(), parent_item_type_id: None,
        color_override: Some("#304050".into()),
    }).unwrap().catalog.unwrap();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Important".into() }).unwrap().tag;
    let item = create_item_cmd(&data_dir, CreateItemRequest {
        title: "classified".into(), description: None, status: "进行中".into(), list_id: None,
        priority: "none".into(), planned_point: None, due_point: None,
        item_type_id: Some(catalog.item_types[0].id.clone()), tag_ids: vec![tag.id.clone()],
        classification_expected: Some(ClassificationExpected {
            item_type_catalog: Some(reference(&catalog.id, catalog.revision)),
            tags: vec![reference(&tag.id, tag.revision)],
        }),
    }).unwrap().item;

    let mut empty = empty_op();
    empty.update_item = Some(ProductivityAiBatchUpdateItem {
        item: reference(&item.id, item.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None, item_type_id: None, tag_ids: None,
            classification_expected: None,
        },
    });
    let mut same_classification = empty_op();
    same_classification.update_item = Some(ProductivityAiBatchUpdateItem {
        item: reference(&item.id, item.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None,
            item_type_id: Some(Some(catalog.item_types[0].id.clone())), tag_ids: Some(vec![tag.id.clone()]),
            classification_expected: None,
        },
    });
    apply_productivity_ai_batch(&data_dir, ApplyProductivityAiBatchRequest {
        ops: vec![empty, same_classification], expected_data_dir: None,
    }).expect("no-op batch");

    let after = get_item(&data_dir, &item.id);
    assert_eq!(after.revision, item.revision);
    assert_eq!(after.updated_at_utc, item.updated_at_utc);
    assert_eq!(after.item_type_id, item.item_type_id);
    assert_eq!(after.tag_ids, item.tag_ids);
    archive.cleanup();
}
