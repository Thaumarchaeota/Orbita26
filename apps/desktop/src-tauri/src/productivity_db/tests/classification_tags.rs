use crate::productivity_db::{
    classification::{create_tag, get_tag, list_tags, set_tag_inactive, update_tag},
    types::{CreateTagRequest, RevisionRef, SetTagInactiveRequest, UpdateTagRequest},
};
use rusqlite::params;
use super::harness::*;

fn tag_ref(tag: &crate::productivity_db::types::TagSnapshot) -> RevisionRef {
    RevisionRef { id: tag.id.clone(), expected_revision: tag.revision }
}

#[test]
fn tag_names_are_global_trimmed_case_insensitive_and_inactive_names_stay_reserved() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_tag(&data_dir, CreateTagRequest { name: " Work ".into() })
        .expect("create tag").tag;
    assert_eq!(created.name, "Work");
    assert_eq!(created.revision, 1);

    // Updating to the same normalized name excludes this tag itself from uniqueness checks.
    let same = update_tag(&data_dir, UpdateTagRequest { tag: tag_ref(&created), name: "work".into() })
        .expect("same identity rename").tag;
    assert_eq!(same.name, "work");
    assert_eq!(same.revision, created.revision + 1);

    let no_op = update_tag(&data_dir, UpdateTagRequest { tag: tag_ref(&same), name: " work ".into() })
        .expect("same trimmed display value").tag;
    assert_eq!(no_op.revision, same.revision);
    assert_eq!(no_op.updated_at_utc, same.updated_at_utc);

    let inactive = set_tag_inactive(&data_dir, SetTagInactiveRequest { tag: tag_ref(&no_op), inactive: true })
        .expect("deactivate tag").tag;
    assert!(inactive.inactive);
    let repeated = set_tag_inactive(&data_dir, SetTagInactiveRequest { tag: tag_ref(&inactive), inactive: true })
        .expect("repeat inactive").tag;
    assert_eq!(repeated.revision, inactive.revision);
    assert_eq!(repeated.updated_at_utc, inactive.updated_at_utc);
    assert_eq!(get_tag(&data_dir, &inactive.id).expect("inactive tag readable").tag.name, "work");
    assert!(list_tags(&data_dir).expect("list tags").tags.iter().any(|t| t.id == inactive.id && t.inactive));

    let duplicate = create_tag(&data_dir, CreateTagRequest { name: " WORK ".into() }).unwrap_err();
    assert_err_code(duplicate, "INVALID_PATCH");
    archive.cleanup();
}

#[test]
fn tag_and_item_type_namespaces_are_independent_and_stale_tag_revision_is_rejected() {
    use crate::productivity_db::{classification::create_item_type, types::CreateItemTypeRequest};

    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let catalog = create_item_type(&data_dir, CreateItemTypeRequest {
        catalog: None, name: "Work".into(), parent_item_type_id: None,
        color_override: Some("#223344".into()),
    }).expect("create type").catalog.unwrap();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Work".into() })
        .expect("same name in tag namespace").tag;

    let stale = update_tag(&data_dir, UpdateTagRequest {
        tag: RevisionRef { id: tag.id.clone(), expected_revision: tag.revision + 1 },
        name: "Other".into(),
    }).unwrap_err();
    assert_err_code(stale, "REVISION_CONFLICT");
    assert_eq!(get_tag(&data_dir, &tag.id).expect("tag unchanged").tag.name, "Work");
    assert_eq!(catalog.item_types[0].name, "Work");
    archive.cleanup();
}

#[test]
fn unknown_tag_fields_are_readable_but_block_tag_writes() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let tag = create_tag(&data_dir, CreateTagRequest { name: "Work".into() }).unwrap().tag;
    archive.conn().execute(
        "UPDATE productivity_tag SET extra_json=?1 WHERE id=?2",
        params![r#"{"futureTag":1}"#, tag.id],
    ).unwrap();

    let read = get_tag(&data_dir, &tag.id).expect("future tag field remains readable").tag;
    let blocked = update_tag(&data_dir, UpdateTagRequest { tag: tag_ref(&read), name: "Renamed".into() }).unwrap_err();
    assert_err_code(blocked, "UNKNOWN_FIELD_WRITE_BLOCKED");
    archive.cleanup();
}
