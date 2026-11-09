use crate::productivity_db::commands::complete_thing_and_end_related_actions;
use crate::productivity_db::types::{CompleteThingRequest, RevisionRef};

use super::harness::*;

#[test]
fn archived_list_complete_thing_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let action = create_action_for_item(&data_dir, "action", &item.id);
    let archived = archive_list(&data_dir, &list);
    let before = capture_facts(&archive, &data_dir);
    let list_rev = list_revision(&archive.conn(), &archived.id);

    let err = complete_thing_and_end_related_actions(
        &data_dir,
        CompleteThingRequest {
            thing_kind: "list".to_string(),
            owning_root: RevisionRef {
                id: archived.id.clone(),
                expected_revision: archived.revision,
            },
            task_id: None,
            expected_members: vec![RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            }],
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    assert_eq!(list_revision(&archive.conn(), &archived.id), list_rev);
    assert_eq!(
        crate::productivity_db::read::get_list_cmd(&data_dir, &archived.id)
            .expect("get list")
            .list
            .status,
        "已归档"
    );
    archive.cleanup();
}

#[test]
fn archived_list_complete_item_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let action = create_action_for_item(&data_dir, "action", &item.id);
    let _archived = archive_list(&data_dir, &list);
    let item = get_item(&data_dir, &item.id);
    let before = capture_facts(&archive, &data_dir);
    let item_rev = item.revision;

    let err = complete_thing_and_end_related_actions(
        &data_dir,
        CompleteThingRequest {
            thing_kind: "item".to_string(),
            owning_root: RevisionRef {
                id: item.id.clone(),
                expected_revision: item.revision,
            },
            task_id: None,
            expected_members: vec![RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            }],
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    assert_eq!(get_item(&data_dir, &item.id).revision, item_rev);
    archive.cleanup();
}
