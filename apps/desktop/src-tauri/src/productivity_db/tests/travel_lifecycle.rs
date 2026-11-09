use rusqlite::params;

use crate::productivity_db::commands::{restore_action, restore_item};
use crate::productivity_db::tests::harness::{assert_err_code, TestArchive};
use crate::productivity_db::travel::{create_travel, delete_travel, restore_travel};
use crate::productivity_db::types::{
    CreateTravelRequest, DeleteTravelRequest, RestoreActionRequest, RestoreItemRequest,
    RestoreTravelRequest, RevisionRef, TravelRangeInput, TravelSnapshot,
};

fn one_range() -> TravelRangeInput {
    TravelRangeInput {
        planned_start_at: Some("2026-10-18T01:00:00Z".into()),
        planned_end_at: Some("2026-10-18T04:00:00Z".into()),
        departure_code: None,
        departure_name: Some("上海虹桥".into()),
        arrival_code: None,
        arrival_name: Some("北京南".into()),
        departure_terminal: None,
        arrival_terminal: None,
        departure_gate: None,
        arrival_gate: None,
    }
}

fn create_train(data_dir: &str) -> TravelSnapshot {
    create_travel(
        data_dir,
        CreateTravelRequest {
            expected_data_dir: data_dir.to_string(),
            title: "G123".into(),
            kind: "train".into(),
            root_color: Some("#506070".into()),
            ranges: vec![one_range()],
            list_id: None,
            description: None,
        },
    )
    .expect("create travel")
}

fn item_ref(snap: &TravelSnapshot) -> RevisionRef {
    RevisionRef {
        id: snap.item.id.clone(),
        expected_revision: snap.item.revision,
    }
}

fn action_refs(snap: &TravelSnapshot) -> Vec<RevisionRef> {
    snap.actions
        .iter()
        .map(|action| RevisionRef {
            id: action.id.clone(),
            expected_revision: action.revision,
        })
        .collect()
}

fn delete_group(data_dir: &str, snap: TravelSnapshot) -> TravelSnapshot {
    delete_travel(
        data_dir,
        DeleteTravelRequest {
            expected_data_dir: data_dir.to_string(),
            item: item_ref(&snap),
            expected_actions: action_refs(&snap),
        },
    )
    .expect("delete travel")
}

#[test]
fn restore_item_rejects_travel_after_group_delete() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_train(&data_dir);
    let deleted = delete_group(&data_dir, created);
    let err = restore_item(
        &data_dir,
        RestoreItemRequest {
            item: item_ref(&deleted),
        },
    )
    .unwrap_err();
    assert_err_code(err, "INVALID_PATCH");
    let still = archive.conn();
    let item_deleted: Option<String> = still
        .query_row(
            "SELECT deleted_at_utc FROM productivity_item WHERE id=?1",
            [&deleted.item.id],
            |row| row.get(0),
        )
        .unwrap();
    let detail_deleted: Option<String> = still
        .query_row(
            "SELECT deleted_at_utc FROM productivity_item_travel_detail WHERE item_id=?1",
            [&deleted.item.id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(item_deleted.is_some());
    assert!(detail_deleted.is_some());
    archive.cleanup();
}

#[test]
fn restore_action_rejects_travel_after_group_delete() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_train(&data_dir);
    let deleted = delete_group(&data_dir, created);
    let err = restore_action(
        &data_dir,
        RestoreActionRequest {
            action: RevisionRef {
                id: deleted.actions[0].id.clone(),
                expected_revision: deleted.actions[0].revision,
            },
            session: None,
        },
    )
    .unwrap_err();
    assert_err_code(err, "INVALID_PATCH");
    archive.cleanup();
}

#[test]
fn restore_travel_rejects_unknown_detail_extra_json() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_train(&data_dir);
    let deleted = delete_group(&data_dir, created);
    archive
        .conn()
        .execute(
            "UPDATE productivity_item_travel_detail SET extra_json=?1 WHERE item_id=?2",
            params![r#"{"future":true}"#, deleted.item.id],
        )
        .unwrap();
    let err = restore_travel(
        &data_dir,
        RestoreTravelRequest {
            expected_data_dir: data_dir.clone(),
            item: item_ref(&deleted),
            expected_actions: action_refs(&deleted),
        },
    )
    .unwrap_err();
    assert_err_code(err, "UNKNOWN_FIELD_WRITE_BLOCKED");
    archive.cleanup();
}

#[test]
fn restore_travel_rejects_unknown_leg_extra_json() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_train(&data_dir);
    let deleted = delete_group(&data_dir, created);
    archive
        .conn()
        .execute(
            "UPDATE productivity_item_travel_leg SET extra_json=?1 WHERE item_id=?2",
            params![r#"{"future":true}"#, deleted.item.id],
        )
        .unwrap();
    let err = restore_travel(
        &data_dir,
        RestoreTravelRequest {
            expected_data_dir: data_dir.clone(),
            item: item_ref(&deleted),
            expected_actions: action_refs(&deleted),
        },
    )
    .unwrap_err();
    assert_err_code(err, "UNKNOWN_FIELD_WRITE_BLOCKED");
    archive.cleanup();
}

#[test]
fn restore_travel_revives_group() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_train(&data_dir);
    let deleted = delete_group(&data_dir, created);
    let restored = restore_travel(
        &data_dir,
        RestoreTravelRequest {
            expected_data_dir: data_dir.clone(),
            item: item_ref(&deleted),
            expected_actions: action_refs(&deleted),
        },
    )
    .expect("restore travel");
    assert!(restored.item.deleted_at_utc.is_none());
    assert!(restored.detail.as_ref().unwrap().deleted_at_utc.is_none());
    assert!(restored.legs.iter().all(|leg| leg.deleted_at_utc.is_none()));
    assert!(restored.actions.iter().all(|action| action.deleted_at_utc.is_none()));
    archive.cleanup();
}
