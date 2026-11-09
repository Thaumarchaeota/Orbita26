use crate::productivity_db::commands::{
    clear_action_target, delete_action, end_action, pause_action, restore_action, resume_action,
    set_action_target, start_action, update_action,
};
use crate::productivity_db::types::{
    ActionPatch, ClearActionTargetRequest, DeleteActionRequest, EndActionRequest,
    PauseActionRequest, RestoreActionRequest, ResumeActionRequest, RevisionRef,
    SetActionTargetRequest, StartActionRequest, UpdateActionRequest,
};
use rusqlite::params;

use super::harness::*;

fn seed_archived_list_state(archive: &TestArchive, list_id: &str) {
    // Direct seeding lets these tests exercise archived-List Action guards; the
    // public archive command blocks started, unended Actions before they can be tested.
    archive
        .conn()
        .execute(
            "UPDATE productivity_list SET status = '已归档' WHERE id = ?1",
            params![list_id],
        )
        .expect("seed archived List state");
}

fn archived_item_with_action(
    data_dir: &str,
) -> (
    crate::productivity_db::types::ListSnapshot,
    crate::productivity_db::types::ItemSnapshot,
    crate::productivity_db::types::ActionSnapshot,
) {
    let list = create_list(data_dir, "list");
    let item = create_item(data_dir, "item", Some(&list.id));
    let action = create_action_for_item(data_dir, "action", &item.id);
    let archived = archive_list(data_dir, &list);
    (
        archived,
        get_item(data_dir, &item.id),
        get_action(data_dir, &action.id),
    )
}

#[test]
fn archived_list_update_action_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let (_list, _item, action) = archived_item_with_action(&data_dir);
    let before = capture_facts(&archive, &data_dir);
    let rev_before = action.revision;

    let err = update_action(
        &data_dir,
        UpdateActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
            patch: ActionPatch {
                title: Some("blocked".to_string()),
                    name_link_mode: None,
                summary: None,
                planned_start_at: None,
                planned_end_at: None,
                planned_duration: None,
                appearance: None,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    assert_eq!(get_action(&data_dir, &action.id).revision, rev_before);
    archive.cleanup();
}

#[test]
fn archived_list_start_action_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let (_list, _item, action) = archived_item_with_action(&data_dir);
    let before = capture_facts(&archive, &data_dir);

    let err = start_action(
        &data_dir,
        StartActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_pause_action_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let action = create_action_for_item(&data_dir, "action", &item.id);
    start_action(
        &data_dir,
        StartActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
        },
    )
    .expect("start before archive");
    let action = get_action(&data_dir, &action.id);
    seed_archived_list_state(&archive, &list.id);
    let action = get_action(&data_dir, &action.id);
    let before = capture_facts(&archive, &data_dir);

    let err = pause_action(
        &data_dir,
        PauseActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_resume_action_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let action = create_action_for_item(&data_dir, "action", &item.id);
    let started = start_action(
        &data_dir,
        StartActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
        },
    )
    .expect("start");
    pause_action(
        &data_dir,
        PauseActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: started.action.id.clone(),
                expected_revision: started.action.revision,
            },
        },
    )
    .expect("pause");
    let action = get_action(&data_dir, &action.id);
    seed_archived_list_state(&archive, &list.id);
    let action = get_action(&data_dir, &action.id);
    let before = capture_facts(&archive, &data_dir);

    let err = resume_action(
        &data_dir,
        ResumeActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_end_action_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let action = create_action_for_item(&data_dir, "action", &item.id);
    let started = start_action(
        &data_dir,
        StartActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
        },
    )
    .expect("start");
    seed_archived_list_state(&archive, &list.id);
    let action = get_action(&data_dir, &started.action.id);
    let before = capture_facts(&archive, &data_dir);

    let err = end_action(
        &data_dir,
        EndActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_delete_action_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let (_list, _item, action) = archived_item_with_action(&data_dir);
    let before = capture_facts(&archive, &data_dir);

    let err = delete_action(
        &data_dir,
        DeleteActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_restore_action_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let action = create_action_for_item(&data_dir, "action", &item.id);
    let deleted = delete_action(
        &data_dir,
        DeleteActionRequest { expected_data_dir: None,
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
        },
    )
    .expect("delete while writable")
    .action;
    let _archived = archive_list(&data_dir, &list);
    let before = capture_facts(&archive, &data_dir);
    let rev_before = action_revision(&archive.conn(), &deleted.id);

    let err = restore_action(
        &data_dir,
        RestoreActionRequest {
            action: RevisionRef {
                id: deleted.id.clone(),
                expected_revision: deleted.revision,
            },
            session: None,
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    assert_eq!(action_revision(&archive.conn(), &deleted.id), rev_before);
    archive.cleanup();
}

#[test]
fn archived_list_set_action_target_to_archived_item_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let loose = create_loose_action(&data_dir, "loose");
    let _archived = archive_list(&data_dir, &list);
    let item = get_item(&data_dir, &item.id);
    let before = capture_facts(&archive, &data_dir);

    let err = set_action_target(
        &data_dir,
        SetActionTargetRequest {
            action: RevisionRef {
                id: loose.id.clone(),
                expected_revision: loose.revision,
            },
            target_kind: "item".to_string(),
            target_id: item.id.clone(),
            owning_root: RevisionRef {
                id: item.id.clone(),
                expected_revision: item.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_clear_action_target_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let (_list, _item, action) = archived_item_with_action(&data_dir);
    let before = capture_facts(&archive, &data_dir);

    let err = clear_action_target(
        &data_dir,
        ClearActionTargetRequest {
            action: RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            },
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}
