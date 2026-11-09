use crate::productivity_db::{
    classification::{create_item_type, create_tag, delete_item_type, get_catalog, set_item_type_inactive, set_tag_inactive},
    commands::{create_item as create_item_cmd, delete_item, restore_item, update_item},
    types::{
        ClassificationExpected, CreateItemRequest, CreateItemTypeRequest, CreateTagRequest,
        DeleteItemRequest, DeleteItemTypeRequest, ItemPatch, RestoreItemRequest, RevisionRef,
        SetItemTypeInactiveRequest, SetTagInactiveRequest, UpdateItemRequest,
    },
};
use super::harness::*;

fn reference(id: &str, revision: i64) -> RevisionRef {
    RevisionRef { id: id.to_string(), expected_revision: revision }
}

#[test]
fn item_classification_create_patch_omission_and_explicit_clear_have_distinct_semantics() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let catalog = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: None, name: "Work".into(), parent_item_type_id: None,
        color_override: Some("#123456".into()),
    }).unwrap().catalog.unwrap();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Important".into() }).unwrap().tag;
    let item = create_item_cmd(&data_dir, CreateItemRequest {
        title: "item".into(), description: None, status: "进行中".into(), list_id: None,
        priority: "none".into(), planned_point: None, due_point: None,
        item_type_id: Some(catalog.item_types[0].id.clone()), tag_ids: vec![tag.id.clone()],
        classification_expected: Some(ClassificationExpected {
            item_type_catalog: Some(reference(&catalog.id, catalog.revision)),
            tags: vec![reference(&tag.id, tag.revision)],
        }),
    }).expect("create classified item").item;
    assert_eq!(item.item_type_id.as_deref(), Some(catalog.item_types[0].id.as_str()));
    assert_eq!(item.tag_ids, vec![tag.id.clone()]);

    let same_values = update_item(&data_dir, UpdateItemRequest {
        item: reference(&item.id, item.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None,
            item_type_id: Some(Some(catalog.item_types[0].id.clone())), tag_ids: Some(vec![tag.id.clone()]),
            classification_expected: None,
        },
    }).expect("same active associations are a no-op").item;
    assert_eq!(same_values.revision, item.revision);
    assert_eq!(same_values.updated_at_utc, item.updated_at_utc);

    let no_classification_patch = update_item(&data_dir, UpdateItemRequest {
        item: reference(&same_values.id, same_values.revision),
        patch: ItemPatch {
            title: Some("renamed".into()), description: None, status: None, priority: None,
            planned_point: None, due_point: None, item_type_id: None, tag_ids: None,
            classification_expected: None,
        },
    }).expect("ordinary patch leaves classification intact").item;
    assert_eq!(no_classification_patch.revision, same_values.revision + 1);
    assert_eq!(no_classification_patch.item_type_id, same_values.item_type_id);
    assert_eq!(no_classification_patch.tag_ids, same_values.tag_ids);

    let cleared = update_item(&data_dir, UpdateItemRequest {
        item: reference(&no_classification_patch.id, no_classification_patch.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None, item_type_id: Some(None), tag_ids: Some(vec![]),
            classification_expected: None,
        },
    }).expect("explicit empty classification").item;
    assert_eq!(cleared.revision, no_classification_patch.revision + 1);
    assert_eq!(cleared.item_type_id, None);
    assert!(cleared.tag_ids.is_empty());
    archive.cleanup();
}

#[test]
fn inactive_classifications_are_retained_but_cannot_be_added_again_after_removal() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let catalog = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: None, name: "Work".into(), parent_item_type_id: None,
        color_override: Some("#123456".into()),
    }).unwrap().catalog.unwrap();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Old".into() }).unwrap().tag;
    let item = create_item(&data_dir, "existing", None);
    let associated = update_item(&data_dir, UpdateItemRequest {
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
    }).unwrap().item;
    let inactive_catalog = set_item_type_inactive(&data_dir, SetItemTypeInactiveRequest {
        catalog: reference(&catalog.id, catalog.revision), item_type_id: catalog.item_types[0].id.clone(), inactive: true,
    }).unwrap().catalog.unwrap();
    let inactive_tag = set_tag_inactive(&data_dir, SetTagInactiveRequest { tag: reference(&tag.id, tag.revision), inactive: true }).unwrap().tag;

    let retained = update_item(&data_dir, UpdateItemRequest {
        item: reference(&associated.id, associated.revision),
        patch: ItemPatch {
            title: Some("ordinary edit".into()), description: None, status: None, priority: None,
            planned_point: None, due_point: None, item_type_id: None, tag_ids: None,
            classification_expected: None,
        },
    }).unwrap().item;
    assert_eq!(retained.item_type_id, associated.item_type_id);
    assert_eq!(retained.tag_ids, associated.tag_ids);

    let explicit_retain = update_item(&data_dir, UpdateItemRequest {
        item: reference(&retained.id, retained.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None,
            item_type_id: Some(Some(catalog.item_types[0].id.clone())), tag_ids: Some(vec![tag.id.clone()]),
            classification_expected: None,
        },
    }).expect("same inactive references are retained").item;
    assert_eq!(explicit_retain.item_type_id, retained.item_type_id);
    assert_eq!(explicit_retain.tag_ids, retained.tag_ids);

    let removed = update_item(&data_dir, UpdateItemRequest {
        item: reference(&explicit_retain.id, explicit_retain.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None, item_type_id: Some(None), tag_ids: Some(vec![]),
            classification_expected: None,
        },
    }).unwrap().item;
    let readd = update_item(&data_dir, UpdateItemRequest {
        item: reference(&removed.id, removed.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None,
            item_type_id: Some(Some(catalog.item_types[0].id.clone())), tag_ids: Some(vec![tag.id.clone()]),
            classification_expected: Some(ClassificationExpected {
                item_type_catalog: Some(reference(&inactive_catalog.id, inactive_catalog.revision)),
                tags: vec![reference(&inactive_tag.id, inactive_tag.revision)],
            }),
        },
    }).unwrap_err();
    assert_err_code(readd, "CLASSIFICATION_INACTIVE");
    assert_eq!(get_item(&data_dir, &item.id).item_type_id, None);
    assert!(get_item(&data_dir, &item.id).tag_ids.is_empty());
    archive.cleanup();
}

#[test]
fn duplicate_unknown_and_stale_classification_refs_fail_without_item_revision_change() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let first = create_tag(&data_dir, CreateTagRequest { name: "First".into() }).unwrap().tag;
    let item = create_item(&data_dir, "item", None);
    let duplicate = update_item(&data_dir, UpdateItemRequest {
        item: reference(&item.id, item.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None, item_type_id: None,
            tag_ids: Some(vec![first.id.clone(), first.id.clone()]),
            classification_expected: Some(ClassificationExpected { item_type_catalog: None, tags: vec![reference(&first.id, first.revision)] }),
        },
    }).unwrap_err();
    assert_err_code(duplicate, "INVALID_PATCH");

    let unknown = update_item(&data_dir, UpdateItemRequest {
        item: reference(&item.id, item.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None, item_type_id: None,
            tag_ids: Some(vec!["missing-tag".into()]),
            classification_expected: Some(ClassificationExpected { item_type_catalog: None, tags: vec![reference("missing-tag", 1)] }),
        },
    }).unwrap_err();
    assert_err_code(unknown, "ROOT_NOT_FOUND");

    let stale = update_item(&data_dir, UpdateItemRequest {
        item: reference(&item.id, item.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None, item_type_id: None,
            tag_ids: Some(vec![first.id.clone()]),
            classification_expected: Some(ClassificationExpected { item_type_catalog: None, tags: vec![reference(&first.id, first.revision + 1)] }),
        },
    }).unwrap_err();
    assert_err_code(stale, "REVISION_CONFLICT");
    let after = get_item(&data_dir, &item.id);
    assert_eq!(after.revision, item.revision);
    assert!(after.tag_ids.is_empty());
    archive.cleanup();
}

#[test]
fn soft_delete_and_restore_keep_item_type_and_tag_relations() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let catalog = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: None, name: "Travel".into(), parent_item_type_id: None,
        color_override: Some("#506070".into()),
    }).unwrap().catalog.unwrap();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Reserved".into() }).unwrap().tag;
    let created = create_item_cmd(&data_dir, CreateItemRequest {
        title: "trip".into(), description: None, status: "进行中".into(), list_id: None,
        priority: "none".into(), planned_point: None, due_point: None,
        item_type_id: Some(catalog.item_types[0].id.clone()), tag_ids: vec![tag.id.clone()],
        classification_expected: Some(ClassificationExpected {
            item_type_catalog: Some(reference(&catalog.id, catalog.revision)),
            tags: vec![reference(&tag.id, tag.revision)],
        }),
    }).unwrap().item;
    let deleted = delete_item(&data_dir, DeleteItemRequest {
        item: reference(&created.id, created.revision),
    }).unwrap().item;
    assert!(deleted.deleted_at_utc.is_some());
    assert_eq!(deleted.item_type_id.as_deref(), Some(catalog.item_types[0].id.as_str()));
    assert_eq!(deleted.tag_ids, vec![tag.id.clone()]);

    let restored = restore_item(&data_dir, RestoreItemRequest {
        item: reference(&deleted.id, deleted.revision),
    }).unwrap().item;
    assert!(restored.deleted_at_utc.is_none());
    assert_eq!(restored.item_type_id, deleted.item_type_id);
    assert_eq!(restored.tag_ids, deleted.tag_ids);
    assert_eq!(restored.revision, deleted.revision + 1);
    archive.cleanup();
}

#[test]
fn live_item_blocks_item_type_delete_and_tombstones_are_unassigned_when_type_is_removed() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let catalog = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: None, name: "Work".into(), parent_item_type_id: None,
        color_override: Some("#123456".into()),
    }).unwrap().catalog.unwrap();
    let type_id = catalog.item_types[0].id.clone();
    let live = create_item_cmd(&data_dir, CreateItemRequest {
        title: "live".into(), description: None, status: "进行中".into(), list_id: None,
        priority: "none".into(), planned_point: None, due_point: None,
        item_type_id: Some(type_id.clone()), tag_ids: vec![],
        classification_expected: Some(ClassificationExpected {
            item_type_catalog: Some(reference(&catalog.id, catalog.revision)),
            tags: vec![],
        }),
    }).unwrap().item;
    let after_live = get_catalog(&data_dir).unwrap().catalog.unwrap();
    let live_node = after_live.item_types.iter().find(|node| node.id == type_id).unwrap();
    assert!(!live_node.can_delete);
    assert_eq!(live_node.reference_count, 1);
    let live_err = delete_item_type(&data_dir, DeleteItemTypeRequest {
        expected_data_dir: data_dir.clone(),
        catalog: reference(&after_live.id, after_live.revision),
        item_type_id: type_id.clone(),
    }).unwrap_err();
    assert_eq!(live_err.code, "CLASSIFICATION_REFERENCED");

    let second = create_item_cmd(&data_dir, CreateItemRequest {
        title: "second".into(), description: None, status: "进行中".into(), list_id: None,
        priority: "none".into(), planned_point: None, due_point: None,
        item_type_id: Some(type_id.clone()), tag_ids: vec![],
        classification_expected: Some(ClassificationExpected {
            item_type_catalog: Some(reference(&after_live.id, after_live.revision)),
            tags: vec![],
        }),
    }).unwrap().item;
    let first_tombstone = delete_item(&data_dir, DeleteItemRequest {
        item: reference(&live.id, live.revision),
    }).unwrap().item;
    let mixed = get_catalog(&data_dir).unwrap().catalog.unwrap();
    let mixed_node = mixed.item_types.iter().find(|node| node.id == type_id).unwrap();
    assert!(!mixed_node.can_delete);
    assert_eq!(mixed_node.reference_count, 1);
    let mixed_err = delete_item_type(&data_dir, DeleteItemTypeRequest {
        expected_data_dir: data_dir.clone(),
        catalog: reference(&mixed.id, mixed.revision),
        item_type_id: type_id.clone(),
    }).unwrap_err();
    assert_eq!(mixed_err.code, "CLASSIFICATION_REFERENCED");

    let tombstoned = delete_item(&data_dir, DeleteItemRequest {
        item: reference(&second.id, second.revision),
    }).unwrap().item;
    assert!(first_tombstone.deleted_at_utc.is_some());
    assert!(tombstoned.deleted_at_utc.is_some());
    let after_tombstone = get_catalog(&data_dir).unwrap().catalog.unwrap();
    let tombstone_node = after_tombstone.item_types.iter().find(|node| node.id == type_id).unwrap();
    assert!(tombstone_node.can_delete);
    assert_eq!(tombstone_node.reference_count, 0);

    let removed = delete_item_type(&data_dir, DeleteItemTypeRequest {
        expected_data_dir: data_dir.clone(),
        catalog: reference(&after_tombstone.id, after_tombstone.revision),
        item_type_id: type_id.clone(),
    }).expect("delete type after only tombstone remains").catalog.unwrap();
    assert!(removed.item_types.iter().all(|node| node.id != type_id));

    let restored = restore_item(&data_dir, RestoreItemRequest {
        item: reference(&tombstoned.id, tombstoned.revision + 1),
    }).unwrap().item;
    assert!(restored.deleted_at_utc.is_none());
    assert_eq!(restored.item_type_id, None);
    let restored_first = restore_item(&data_dir, RestoreItemRequest {
        item: reference(&first_tombstone.id, first_tombstone.revision + 1),
    }).unwrap().item;
    assert_eq!(restored_first.item_type_id, None);
    archive.cleanup();
}
