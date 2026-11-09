use crate::productivity_db::{
    classification::{create_item_type, create_tag, get_catalog, get_tag, move_item_type, save_item_type_catalog, set_item_type_inactive, update_item_type},
    types::{CreateItemTypeRequest, CreateTagRequest, MoveItemTypeRequest, RevisionRef, SaveItemTypeCatalogNode, SaveItemTypeCatalogRequest, SetItemTypeInactiveRequest, UpdateItemTypeRequest},
};
use rusqlite::params;
use std::fs;
use super::harness::*;
use uuid::Uuid;

fn reference(catalog: &crate::productivity_db::types::ItemTypeCatalogSnapshot) -> RevisionRef {
    RevisionRef { id: catalog.id.clone(), expected_revision: catalog.revision }
}

fn create_root(data_dir: &str, name: &str, color: &str) -> crate::productivity_db::types::ItemTypeCatalogSnapshot {
    create_item_type(data_dir, CreateItemTypeRequest {
        catalog: None,
        name: name.to_string(),
        parent_item_type_id: None,
        color_override: Some(color.to_string()),
    }).expect("create root").catalog.expect("catalog created")
}

#[test]
fn catalog_read_is_non_initializing_and_first_write_creates_revision_one() {
    let mut data_dir = std::env::temp_dir();
    data_dir.push(format!("orbita-productivity-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&data_dir).expect("temp data_dir");
    let archive = TestArchive { data_dir };
    let data_dir = archive.data_dir_str();
    let before = get_catalog(&data_dir).expect("catalog read");
    assert!(before.catalog.is_none());
    assert!(!archive.data_dir.join("archive").join("archive.sqlite").exists());

    let created = create_root(&data_dir, "Work", "#aabbcc");
    assert_eq!(created.revision, 1);
    assert_eq!(created.item_types[0].color_override.as_deref(), Some("#AABBCC"));
    assert_eq!(created.item_types[0].effective_color, "#AABBCC");
    archive.cleanup();
}

#[test]
fn bulk_catalog_save_updates_legacy_compact_uuid_system_travel_color_by_persisted_id() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let catalog_id = Uuid::new_v4().to_string();
    let persisted_id = "0123456789abcdef0123456789abcdef";
    let now = "2026-10-26T00:00:00.000Z";
    let conn = archive.conn();
    conn.execute(
        "INSERT INTO productivity_item_type_catalog(id,revision,created_at_utc,updated_at_utc) VALUES (?1,1,?2,?2)",
        params![catalog_id, now],
    ).unwrap();
    conn.execute(
        "INSERT INTO productivity_item_type(id,catalog_id,name,name_key,color_override,inactive,created_at_utc,updated_at_utc,system_role) VALUES (?1,?2,'出行','出行','#4879ED',0,?3,?3,'travel')",
        params![persisted_id, catalog_id, now],
    ).unwrap();
    drop(conn);

    let current = get_catalog(&data_dir).expect("catalog read").catalog.expect("catalog exists");
    let save = |revision: i64, name: &str, color: &str| SaveItemTypeCatalogRequest {
        expected_data_dir: data_dir.clone(),
        catalog: Some(RevisionRef { id: current.id.clone(), expected_revision: revision }),
        nodes: vec![SaveItemTypeCatalogNode {
            id: persisted_id.to_string(), name: name.to_string(), parent_item_type_id: None,
            color_override: Some(color.to_string()), inactive: false,
        }],
    };
    let updated = save_item_type_catalog(&data_dir, save(current.revision, "出行", "#DF4E99"))
        .expect("bulk color update").catalog.expect("catalog remains");
    let travel = updated.item_types.iter().find(|node| node.system_role.as_deref() == Some("travel")).unwrap();
    assert_eq!(travel.id, persisted_id);
    assert_eq!(travel.color_override.as_deref(), Some("#DF4E99"));
    assert_eq!(travel.effective_color, "#DF4E99");

    let conn = archive.conn();
    let stored: String = conn.query_row("SELECT color_override FROM productivity_item_type WHERE id=?1", [persisted_id], |row| row.get(0)).unwrap();
    assert_eq!(stored, "#DF4E99");
    drop(conn);

    let rename = save_item_type_catalog(&data_dir, save(updated.revision, "Renamed travel", "#DF4E99")).unwrap_err();
    assert_err_code(rename, "INVALID_PATCH");
    archive.cleanup();
}

#[test]
fn classification_reads_remain_isolated_across_data_dir_switches() {
    let archive_a = TestArchive::new();
    let archive_b = TestArchive::new();
    let data_dir_a = archive_a.data_dir_str();
    let data_dir_b = archive_b.data_dir_str();

    let catalog_a = create_root(&data_dir_a, "A-only", "#123456");
    let tag_a = create_tag(&data_dir_a, CreateTagRequest { name: "A-only".into() })
        .unwrap()
        .tag;
    let catalog_b = create_root(&data_dir_b, "B-only", "#ABCDEF");
    let tag_b = create_tag(&data_dir_b, CreateTagRequest { name: "B-only".into() })
        .unwrap()
        .tag;

    crate::productivity_db::switch_data_dir(&data_dir_a).expect("switch to A");
    let read_a = get_catalog(&data_dir_a).unwrap().catalog.unwrap();
    assert_eq!(read_a.id, catalog_a.id);
    assert_eq!(read_a.item_types[0].name, "A-only");
    assert_eq!(get_tag(&data_dir_a, &tag_a.id).unwrap().tag.name, "A-only");
    assert_err_code(get_tag(&data_dir_a, &tag_b.id).unwrap_err(), "ROOT_NOT_FOUND");

    crate::productivity_db::switch_data_dir(&data_dir_b).expect("switch A to B");
    let read_b = get_catalog(&data_dir_b).unwrap().catalog.unwrap();
    assert_eq!(read_b.id, catalog_b.id);
    assert_eq!(read_b.item_types[0].name, "B-only");
    assert_eq!(get_tag(&data_dir_b, &tag_b.id).unwrap().tag.name, "B-only");
    assert_err_code(get_tag(&data_dir_b, &tag_a.id).unwrap_err(), "ROOT_NOT_FOUND");

    crate::productivity_db::switch_data_dir(&data_dir_a).expect("switch B to A");
    let read_a_again = get_catalog(&data_dir_a).unwrap().catalog.unwrap();
    assert_eq!(read_a_again.id, catalog_a.id);
    assert_eq!(get_tag(&data_dir_a, &tag_a.id).unwrap().tag.name, "A-only");

    // Close the coordinator connection before deleting both temporary roots.
    crate::productivity_db::switch_data_dir("").expect("switch away from test roots");
    archive_a.cleanup();
    archive_b.cleanup();
}

#[test]
fn catalog_names_are_global_trimmed_case_insensitive_and_inactive_names_remain_reserved() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let root = create_root(&data_dir, "Work", "#123456");
    let child = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: Some(reference(&root)),
        name: "Course".to_string(),
        parent_item_type_id: Some(root.item_types.iter().find(|n| n.name == "Work").unwrap().id.clone()),
        color_override: None,
    }).expect("create child").catalog.unwrap();
    assert_eq!(child.item_types.iter().find(|n| n.name == "Course").unwrap().effective_color, "#123456");

    let duplicate = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: Some(reference(&child)),
        name: "  wOrK  ".to_string(),
        parent_item_type_id: Some(child.item_types.iter().find(|n| n.name == "Course").unwrap().id.clone()),
        color_override: None,
    }).unwrap_err();
    assert_err_code(duplicate, "INVALID_PATCH");

    let inactive = set_item_type_inactive(&data_dir, SetItemTypeInactiveRequest {
        catalog: reference(&child), item_type_id: child.item_types.iter().find(|n| n.name == "Work").unwrap().id.clone(), inactive: true,
    }).expect("deactivate parent").catalog.unwrap();
    assert!(inactive.item_types.iter().all(|n| n.effective_inactive));
    assert!(!inactive.item_types.iter().find(|n| n.name == "Course").unwrap().inactive);

    let duplicate_inactive = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: Some(reference(&inactive)),
        name: "Work".to_string(),
        parent_item_type_id: None,
        color_override: Some("#654321".to_string()),
    }).unwrap_err();
    assert_err_code(duplicate_inactive, "INVALID_PATCH");

    let child_inactive = set_item_type_inactive(&data_dir, SetItemTypeInactiveRequest {
        catalog: reference(&inactive),
        item_type_id: inactive.item_types.iter().find(|n| n.name == "Course").unwrap().id.clone(),
        inactive: true,
    }).expect("deactivate child explicitly").catalog.unwrap();
    let parent_reenabled = set_item_type_inactive(&data_dir, SetItemTypeInactiveRequest {
        catalog: reference(&child_inactive),
        item_type_id: child_inactive.item_types.iter().find(|n| n.name == "Work").unwrap().id.clone(),
        inactive: false,
    }).expect("reenable parent only").catalog.unwrap();
    let parent = parent_reenabled.item_types.iter().find(|n| n.name == "Work").unwrap();
    let child = parent_reenabled.item_types.iter().find(|n| n.name == "Course").unwrap();
    assert!(!parent.effective_inactive);
    assert!(child.inactive && child.effective_inactive);
    archive.cleanup();
}

#[test]
fn catalog_rename_color_move_and_cycle_errors_preserve_revision_and_derive_color() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let root = create_root(&data_dir, "Study", "#102030");
    let child = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: Some(reference(&root)), name: "Course".to_string(),
        parent_item_type_id: Some(root.item_types.iter().find(|n| n.name == "Study").unwrap().id.clone()), color_override: None,
    }).expect("child").catalog.unwrap();
    let grandchild = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: Some(reference(&child)), name: "Language".to_string(),
        parent_item_type_id: Some(child.item_types.iter().find(|n| n.name == "Course").unwrap().id.clone()), color_override: None,
    }).expect("grandchild").catalog.unwrap();
    assert_eq!(grandchild.item_types.iter().find(|n| n.name == "Language").unwrap().effective_color, "#102030");

    let updated = update_item_type(&data_dir, UpdateItemTypeRequest {
        catalog: reference(&grandchild), item_type_id: grandchild.item_types.iter().find(|n| n.name == "Course").unwrap().id.clone(),
        name: Some("Class".to_string()), color_override: Some(Some("#abcdef".to_string())),
    }).expect("rename and color").catalog.unwrap();
    assert_eq!(updated.revision, grandchild.revision + 1);
    assert_eq!(updated.item_types.iter().find(|n| n.name == "Class").unwrap().effective_color, "#ABCDEF");
    assert_eq!(updated.item_types.iter().find(|n| n.name == "Language").unwrap().effective_color, "#ABCDEF");

    let cycle = move_item_type(&data_dir, MoveItemTypeRequest {
        catalog: reference(&updated), item_type_id: updated.item_types.iter().find(|n| n.name == "Class").unwrap().id.clone(),
        parent_item_type_id: Some(updated.item_types.iter().find(|n| n.name == "Language").unwrap().id.clone()), color_override: None,
    }).unwrap_err();
    assert_err_code(cycle, "TREE_CYCLE");
    let after = get_catalog(&data_dir).expect("catalog after rejected move").catalog.unwrap();
    assert_eq!(after.revision, updated.revision);
    assert_eq!(
        after.item_types.iter().find(|n| n.name == "Class").unwrap().parent_item_type_id,
        updated.item_types.iter().find(|n| n.name == "Class").unwrap().parent_item_type_id,
    );

    let root_move_without_color = move_item_type(&data_dir, MoveItemTypeRequest {
        catalog: reference(&after), item_type_id: after.item_types.iter().find(|n| n.name == "Class").unwrap().id.clone(),
        parent_item_type_id: None, color_override: Some(None),
    }).unwrap_err();
    assert_err_code(root_move_without_color, "INVALID_PATCH");
    archive.cleanup();
}

#[test]
fn catalog_noop_patch_and_repeating_inactive_state_do_not_advance_revision() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let root = create_root(&data_dir, "Work", "#123456");
    let no_op = update_item_type(&data_dir, UpdateItemTypeRequest {
        catalog: reference(&root),
        item_type_id: root.item_types[0].id.clone(),
        name: None,
        color_override: None,
    }).expect("empty type patch").catalog.unwrap();
    assert_eq!(no_op.revision, root.revision);
    assert_eq!(no_op.updated_at_utc, root.updated_at_utc);

    let inactive = set_item_type_inactive(&data_dir, SetItemTypeInactiveRequest {
        catalog: reference(&no_op), item_type_id: no_op.item_types[0].id.clone(), inactive: true,
    }).expect("deactivate once").catalog.unwrap();
    let repeated = set_item_type_inactive(&data_dir, SetItemTypeInactiveRequest {
        catalog: reference(&inactive), item_type_id: inactive.item_types[0].id.clone(), inactive: true,
    }).expect("repeat same state").catalog.unwrap();
    assert_eq!(repeated.revision, inactive.revision);
    assert_eq!(repeated.updated_at_utc, inactive.updated_at_utc);
    archive.cleanup();
}

#[test]
fn unknown_catalog_and_member_fields_are_readable_but_block_catalog_writes() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let catalog = create_root(&data_dir, "Work", "#123456");
    let node = catalog.item_types[0].id.clone();
    let conn = archive.conn();
    conn.execute("UPDATE productivity_item_type_catalog SET extra_json=?1 WHERE id=?2", params![r#"{"futureRoot":1}"#, catalog.id]).unwrap();
    let read = get_catalog(&data_dir).expect("future root field remains readable").catalog.unwrap();
    assert_eq!(read.revision, catalog.revision);
    assert_eq!(read.item_types[0].id, node);

    let blocked_root_write = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: Some(reference(&read)), name: "Course".into(), parent_item_type_id: Some(node.clone()), color_override: None,
    }).unwrap_err();
    assert_err_code(blocked_root_write, "UNKNOWN_FIELD_WRITE_BLOCKED");

    conn.execute("UPDATE productivity_item_type_catalog SET extra_json='{}' WHERE id=?1", [&catalog.id]).unwrap();
    conn.execute("UPDATE productivity_item_type SET extra_json=?1 WHERE id=?2", params![r#"{"futureNode":1}"#, node]).unwrap();
    let read = get_catalog(&data_dir).expect("future member field remains readable").catalog.unwrap();
    let blocked_member_write = update_item_type(&data_dir, UpdateItemTypeRequest {
        catalog: reference(&read), item_type_id: node.clone(), name: Some("Renamed".into()), color_override: None,
    }).unwrap_err();
    assert_err_code(blocked_member_write, "UNKNOWN_FIELD_WRITE_BLOCKED");
    assert_eq!(get_catalog(&data_dir).unwrap().catalog.unwrap().item_types[0].name, "Work");
    archive.cleanup();
}
