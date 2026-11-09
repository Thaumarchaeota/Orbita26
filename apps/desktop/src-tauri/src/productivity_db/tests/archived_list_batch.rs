use crate::productivity_db::commands::{apply_productivity_ai_batch, commit_item_with_actions, create_item_after};
use crate::productivity_db::types::{
    ActionPatch, ApplyProductivityAiBatchRequest, CommitActionCreateDraft,
    CommitActionUpdateDraft, CommitItemWithActionsRequest, CreateItemAfterRequest,
    CreateItemRequest, ItemPatch, ProductivityAiBatchCreateAction, ProductivityAiBatchCreateItem,
    ProductivityAiBatchOp, ProductivityAiBatchUpdateAction, ProductivityAiBatchUpdateItem,
    RevisionRef,
};

use super::harness::*;

#[test]
fn archived_list_create_item_after_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let anchor = create_item(&data_dir, "anchor", Some(&list.id));
    let _archived = archive_list(&data_dir, &list);
    let order = item_order(&data_dir);
    let members = item_order_members(&data_dir);
    let before = capture_facts(&archive, &data_dir);

    let err = create_item_after(
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
            insert_after_item_id: anchor.id.clone(),
            item_order: RevisionRef {
                id: order.id.clone(),
                expected_revision: order.revision,
            },
            expected_members: members,
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_commit_item_update_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let _archived = archive_list(&data_dir, &list);
    let item = get_item(&data_dir, &item.id);
    let before = capture_facts(&archive, &data_dir);

    let err = commit_item_with_actions(
        &data_dir,
        CommitItemWithActionsRequest {
            item_id: Some(item.id.clone()),
            item_expected_revision: Some(item.revision),
            item_create: None,
            item_patch: Some(ItemPatch {
                title: Some("blocked".to_string()),
                description: None,
                status: None,
                priority: None,
                planned_point: None,
                due_point: None,
                item_type_id: None,
                tag_ids: None,
                classification_expected: None,
            }),
            expected_associated_actions: vec![],
            action_creates: vec![],
            action_updates: vec![],
            action_deletes: vec![],
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_commit_item_create_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let _archived = archive_list(&data_dir, &list);
    let before = capture_facts(&archive, &data_dir);

    let err = commit_item_with_actions(
        &data_dir,
        CommitItemWithActionsRequest {
            item_id: None,
            item_expected_revision: None,
            item_create: Some(CreateItemRequest {
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
            }),
            item_patch: None,
            expected_associated_actions: vec![],
            action_creates: vec![],
            action_updates: vec![],
            action_deletes: vec![],
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_commit_action_create_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let _archived = archive_list(&data_dir, &list);
    let item = get_item(&data_dir, &item.id);
    let before = capture_facts(&archive, &data_dir);

    let err = commit_item_with_actions(
        &data_dir,
        CommitItemWithActionsRequest {
            item_id: Some(item.id.clone()),
            item_expected_revision: Some(item.revision),
            item_create: None,
            item_patch: None,
            expected_associated_actions: vec![],
            action_creates: vec![CommitActionCreateDraft {
                title: "new-action".to_string(),
                name_link_mode: None,
                summary: None,
                session_id: None,
                planned_start_at: None,
                planned_end_at: None,
                planned_duration: None,
                appearance: None,
            }],
            action_updates: vec![],
            action_deletes: vec![],
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_commit_action_update_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let action = create_action_for_item(&data_dir, "action", &item.id);
    let _archived = archive_list(&data_dir, &list);
    let item = get_item(&data_dir, &item.id);
    let action = get_action(&data_dir, &action.id);
    let before = capture_facts(&archive, &data_dir);

    let err = commit_item_with_actions(
        &data_dir,
        CommitItemWithActionsRequest {
            item_id: Some(item.id.clone()),
            item_expected_revision: Some(item.revision),
            item_create: None,
            item_patch: None,
            expected_associated_actions: vec![RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            }],
            action_creates: vec![],
            action_updates: vec![CommitActionUpdateDraft {
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
            }],
            action_deletes: vec![],
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_commit_action_delete_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let action = create_action_for_item(&data_dir, "action", &item.id);
    let _archived = archive_list(&data_dir, &list);
    let item = get_item(&data_dir, &item.id);
    let action = get_action(&data_dir, &action.id);
    let before = capture_facts(&archive, &data_dir);

    let err = commit_item_with_actions(
        &data_dir,
        CommitItemWithActionsRequest {
            item_id: Some(item.id.clone()),
            item_expected_revision: Some(item.revision),
            item_create: None,
            item_patch: None,
            expected_associated_actions: vec![RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            }],
            action_creates: vec![],
            action_updates: vec![],
            action_deletes: vec![RevisionRef {
                id: action.id.clone(),
                expected_revision: action.revision,
            }],
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_ai_batch_create_item_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let _archived = archive_list(&data_dir, &list);
    let before = capture_facts(&archive, &data_dir);

    let err = apply_productivity_ai_batch(
        &data_dir,
        ApplyProductivityAiBatchRequest {
            ops: vec![ProductivityAiBatchOp {
                create_project: None,
                update_project: None,
                create_task: None,
                update_task: None,
                create_list: None,
                update_list: None,
                create_item: Some(ProductivityAiBatchCreateItem {
                    title: "ai-item".to_string(),
                    description: None,
                    status: "进行中".to_string(),
                    list_id: Some(list.id.clone()),
                    priority: "none".to_string(),
                    planned_point: None,
                    due_point: None,
                    item_type_id: None,
                    tag_ids: vec![],
                    classification_expected: None,
                }),
                update_item: None,
                create_session: None,
                update_session: None,
                create_action: None,
                update_action: None,
            }],
            expected_data_dir: None,
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_ai_batch_update_item_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let _archived = archive_list(&data_dir, &list);
    let item = get_item(&data_dir, &item.id);
    let before = capture_facts(&archive, &data_dir);

    let err = apply_productivity_ai_batch(
        &data_dir,
        ApplyProductivityAiBatchRequest {
            ops: vec![ProductivityAiBatchOp {
                create_project: None,
                update_project: None,
                create_task: None,
                update_task: None,
                create_list: None,
                update_list: None,
                create_item: None,
                update_item: Some(ProductivityAiBatchUpdateItem {
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
                }),
                create_session: None,
                update_session: None,
                create_action: None,
                update_action: None,
            }],
            expected_data_dir: None,
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_ai_batch_create_action_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let _archived = archive_list(&data_dir, &list);
    let before = capture_facts(&archive, &data_dir);

    let err = apply_productivity_ai_batch(
        &data_dir,
        ApplyProductivityAiBatchRequest {
            ops: vec![ProductivityAiBatchOp {
                create_project: None,
                update_project: None,
                create_task: None,
                update_task: None,
                create_list: None,
                update_list: None,
                create_item: None,
                update_item: None,
                create_session: None,
                update_session: None,
                create_action: Some(ProductivityAiBatchCreateAction {
                    title: "ai-action".to_string(),
                    name_link_mode: None,
                    summary: None,
                    session_id: None,
                    target_kind: Some("item".to_string()),
                    target_id: Some(item.id.clone()),
                    planned_start_at: None,
                    planned_end_at: None,
                    planned_duration: None,
                    appearance: None,
                }),
                update_action: None,
            }],
            expected_data_dir: None,
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}

#[test]
fn archived_list_ai_batch_update_action_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "item", Some(&list.id));
    let action = create_action_for_item(&data_dir, "action", &item.id);
    let _archived = archive_list(&data_dir, &list);
    let action = get_action(&data_dir, &action.id);
    let before = capture_facts(&archive, &data_dir);

    let err = apply_productivity_ai_batch(
        &data_dir,
        ApplyProductivityAiBatchRequest {
            ops: vec![ProductivityAiBatchOp {
                create_project: None,
                update_project: None,
                create_task: None,
                update_task: None,
                create_list: None,
                update_list: None,
                create_item: None,
                update_item: None,
                create_session: None,
                update_session: None,
                create_action: None,
                update_action: Some(ProductivityAiBatchUpdateAction {
                    action: RevisionRef {
                        id: action.id.clone(),
                        expected_revision: action.revision,
                    },
                    patch: crate::productivity_db::types::ActionPatch {
                        title: Some("blocked".to_string()),
                        name_link_mode: None,
                        summary: None,
                        planned_start_at: None,
                        planned_end_at: None,
                        planned_duration: None,
                        appearance: None,
                    },
                }),
            }],
            expected_data_dir: None,
        },
    )
    .unwrap_err();

    assert_err_code(err, "ARCHIVED_LIST_READONLY");
    assert_no_fact_change(&archive, &data_dir, &before);
    archive.cleanup();
}
