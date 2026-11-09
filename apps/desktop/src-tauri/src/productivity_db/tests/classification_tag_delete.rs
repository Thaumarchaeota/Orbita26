use crate::productivity_db::{
    classification::{create_tag, delete_tag_and_detach_items},
    commands::{delete_item, update_item},
    types::{
        ClassificationExpected, CreateTagRequest, DeleteItemRequest, DeleteTagAndDetachItemsRequest,
        ItemPatch, RevisionRef, UpdateItemRequest,
    },
};
use super::harness::*;

fn reference(id: &str, revision: i64) -> RevisionRef {
    RevisionRef { id: id.to_string(), expected_revision: revision }
}

fn add_tag(data_dir: &str, item: &crate::productivity_db::types::ItemSnapshot, tag: &crate::productivity_db::types::TagSnapshot) -> crate::productivity_db::types::ItemSnapshot {
    update_item(data_dir, UpdateItemRequest {
        item: reference(&item.id, item.revision),
        patch: ItemPatch {
            title: None, description: None, status: None, priority: None,
            planned_point: None, due_point: None, item_type_id: None,
            tag_ids: Some(vec![tag.id.clone()]),
            classification_expected: Some(ClassificationExpected {
                item_type_catalog: None, tags: vec![reference(&tag.id, tag.revision)],
            }),
        },
    }).expect("attach tag").item
}

#[test]
fn delete_tag_detaches_live_and_soft_deleted_item_refs_and_bumps_each_changed_root_once() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Remove me".into() }).unwrap().tag;
    let live = add_tag(&data_dir, &create_item(&data_dir, "live", None), &tag);
    let old = add_tag(&data_dir, &create_item(&data_dir, "old", None), &tag);
    let deleted = delete_item(&data_dir, DeleteItemRequest { item: reference(&old.id, old.revision) }).unwrap().item;

    let deleted_tag = delete_tag_and_detach_items(&data_dir, DeleteTagAndDetachItemsRequest {
        tag: reference(&tag.id, tag.revision),
        expected_members: vec![reference(&live.id, live.revision), reference(&deleted.id, deleted.revision)],
    }).expect("delete and detach");
    assert!(deleted_tag.tag.deleted_at_utc.is_some());
    assert_eq!(deleted_tag.tag.revision, tag.revision + 1);
    assert_eq!(deleted_tag.items.len(), 2);
    for item in &deleted_tag.items {
        assert!(item.tag_ids.is_empty());
        let before = if item.id == live.id { live.revision } else { deleted.revision };
        assert_eq!(item.revision, before + 1);
    }
    assert_eq!(get_item(&data_dir, &live.id).revision, live.revision + 1);
    archive.cleanup();
}

#[test]
fn tag_delete_requires_exact_member_set_and_archived_list_guard_is_atomic() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "List");
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Keep".into() }).unwrap().tag;
    let member = add_tag(&data_dir, &create_item(&data_dir, "member", Some(&list.id)), &tag);

    let wrong_set = delete_tag_and_detach_items(&data_dir, DeleteTagAndDetachItemsRequest {
        tag: reference(&tag.id, tag.revision), expected_members: vec![],
    }).unwrap_err();
    assert_err_code(wrong_set, "REVISION_CONFLICT");

    let archived = archive_list(&data_dir, &list);
    let rejected = delete_tag_and_detach_items(&data_dir, DeleteTagAndDetachItemsRequest {
        tag: reference(&tag.id, tag.revision), expected_members: vec![reference(&member.id, member.revision)],
    }).unwrap_err();
    assert_err_code(rejected, "ARCHIVED_LIST_READONLY");
    assert_eq!(get_item(&data_dir, &member.id).revision, member.revision);
    assert_eq!(get_item(&data_dir, &member.id).tag_ids, vec![tag.id.clone()]);
    assert!(crate::productivity_db::classification::get_tag(&data_dir, &tag.id).unwrap().tag.deleted_at_utc.is_none());
    assert_eq!(archived.status, "已归档");
    archive.cleanup();
}

#[test]
fn tag_delete_unknown_member_field_blocks_whole_transaction() {
    use rusqlite::params;

    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Protected".into() }).unwrap().tag;
    let member = add_tag(&data_dir, &create_item(&data_dir, "member", None), &tag);
    archive.conn().execute(
        "UPDATE productivity_item SET extra_json=?1 WHERE id=?2",
        params![r#"{"futureItemField":1}"#, member.id],
    ).unwrap();

    let read_member = get_item(&data_dir, &member.id);
    let rejected = delete_tag_and_detach_items(&data_dir, DeleteTagAndDetachItemsRequest {
        tag: reference(&tag.id, tag.revision), expected_members: vec![reference(&member.id, member.revision)],
    }).unwrap_err();
    assert_err_code(rejected, "UNKNOWN_FIELD_WRITE_BLOCKED");
    let after = get_item(&data_dir, &member.id);
    assert_eq!(after.revision, read_member.revision);
    assert_eq!(after.tag_ids, vec![tag.id.clone()]);
    assert!(crate::productivity_db::classification::get_tag(&data_dir, &tag.id).unwrap().tag.deleted_at_utc.is_none());
    archive.cleanup();
}

#[test]
fn tag_delete_late_sql_failure_rolls_back_detach_and_all_revisions() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Rollback".into() }).unwrap().tag;
    let member = add_tag(&data_dir, &create_item(&data_dir, "member", None), &tag);
    archive.conn().execute_batch(
        "CREATE TRIGGER fail_tag_tombstone BEFORE UPDATE OF deleted_at_utc ON productivity_tag BEGIN SELECT RAISE(ABORT, 'injected tag tombstone failure'); END;",
    ).unwrap();

    let failed = delete_tag_and_detach_items(&data_dir, DeleteTagAndDetachItemsRequest {
        tag: reference(&tag.id, tag.revision), expected_members: vec![reference(&member.id, member.revision)],
    }).unwrap_err();
    assert_err_code(failed, "ARCHIVE_LIFECYCLE_ERROR");
    let after_item = get_item(&data_dir, &member.id);
    let after_tag = crate::productivity_db::classification::get_tag(&data_dir, &tag.id).unwrap().tag;
    assert_eq!(after_item.revision, member.revision);
    assert_eq!(after_item.tag_ids, vec![tag.id]);
    assert_eq!(after_tag.revision, tag.revision);
    assert!(after_tag.deleted_at_utc.is_none());
    archive.cleanup();
}
