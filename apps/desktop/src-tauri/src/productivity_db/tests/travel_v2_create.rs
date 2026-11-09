use rusqlite::Connection;

use crate::productivity_db::commands::{
    assign_item_to_list, batch_delete_items, batch_move_items_to_list, delete_item,
    delete_list_and_move_items_to_inbox, move_item_to_list, remove_item_from_list,
    set_item_status, update_item as update_item_cmd,
};
use crate::productivity_db::tests::harness::{assert_err_code, create_list, TestArchive};
use crate::productivity_db::travel_v2::{
    append, create, edit_plan, update_item, AppendTripPayload, CreateTripPayload,
    EditPlanPayload, FirstContentPayload, TravelMutationEnvelope, UpdateItemPayload,
};
use crate::productivity_db::types::{
    AssignItemToListRequest, BatchDeleteItem, BatchDeleteItemsRequest,
    BatchMoveItemsToListRequest, DeleteItemRequest, ItemPatch, MoveItemToListRequest,
    DeleteListAndMoveItemsToInboxRequest, RemoveItemFromListRequest, RevisionRef,
    SetItemStatusRequest, UpdateItemRequest,
};

fn envelope(data_dir: &str, first_content: FirstContentPayload) -> TravelMutationEnvelope<CreateTripPayload> {
    TravelMutationEnvelope {
        request_id: format!("travel-create-test-{}", uuid::Uuid::new_v4()),
        expected_data_dir: data_dir.to_string(),
        item_ref: None,
        action_refs: Vec::new(),
        checkpoint_refs: Vec::new(),
        payload: CreateTripPayload {
            new_item_id: format!("travel-item-{}", uuid::Uuid::new_v4()),
            list_id: None,
            title: "测试出行".into(),
            first_content,
        },
    }
}

fn create_trip(data_dir: &str, is_action: bool) -> crate::productivity_db::travel_v2::TravelMutationResult {
    create_trip_in_list(data_dir, is_action, None)
}

fn create_trip_in_list(
    data_dir: &str,
    is_action: bool,
    list_id: Option<String>,
) -> crate::productivity_db::travel_v2::TravelMutationResult {
    let first_content = if is_action {
        FirstContentPayload::Action {
            action_id: format!("action-{}", uuid::Uuid::new_v4()),
            transportation_id: format!("transport-{}", uuid::Uuid::new_v4()),
            start_point_id: format!("point-start-{}", uuid::Uuid::new_v4()),
            end_point_id: format!("point-end-{}", uuid::Uuid::new_v4()),
            planned_start_at: "2026-10-18T01:00:00Z".into(),
            planned_end_at: "2026-10-18T04:00:00Z".into(),
            transportation_type: Some("flight".into()),
            start_location: Some("上海虹桥".into()),
            end_location: Some("北京首都".into()),
            transportation_fields: crate::productivity_db::travel_v2::TransportationFirstFields {
                service_number: Some("CA123".into()),
                departure_name: Some("上海虹桥".into()),
                arrival_name: Some("北京首都".into()),
                departure_code: Some("SHA".into()),
                arrival_code: Some("PEK".into()),
                ..Default::default()
            },
            transportation_source_snapshot: Some(serde_json::json!({
                "provider": "variflight",
                "raw": { "flightNo": "CA123", "from": "SHA", "to": "PEK" }
            })),
        }
    } else {
        FirstContentPayload::Checkpoint {
            checkpoint_id: format!("checkpoint-{}", uuid::Uuid::new_v4()),
            planned_at_utc: "2026-10-18T01:00:00Z".into(),
            title: Some("出发".into()),
            location: Some("上海".into()),
        }
    };

    // This is the production V2 aggregate entry point on a fresh archive. No
    // travel preset or classification catalog is pre-created by the fixture.
    let mut request = envelope(data_dir, first_content);
    request.payload.list_id = list_id;
    create(data_dir, request).expect("create V2 trip")
}

fn assert_created_trip(
    data_dir: &str,
    archive: &TestArchive,
    is_action: bool,
) -> crate::productivity_db::travel_v2::TravelMutationResult {
    let result = create_trip(data_dir, is_action);
    assert!(result.changed);
    let item_id = result.snapshot.item.id.clone();
    assert_eq!(result.snapshot.profile.schema_version, 1);
    assert_eq!(result.snapshot.checkpoints.len(), if is_action { 0 } else { 1 });
    assert_eq!(result.snapshot.actions.len(), if is_action { 1 } else { 0 });

    let conn = archive.conn();
    let (role, item_type_id): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT t.system_role, i.item_type_id
             FROM productivity_item i
             JOIN productivity_item_type t ON t.id = i.item_type_id
             WHERE i.id = ?1",
            [&item_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("travel item classification");
    assert_eq!(role.as_deref(), Some("travel"));
    assert!(item_type_id.is_some());
    let profile_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM productivity_item_travel_profile WHERE item_id = ?1",
            [&item_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(profile_count, 1);
    let catalog_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM productivity_item_type_catalog", [], |row| row.get(0))
        .unwrap();
    assert_eq!(catalog_count, 1);
    let travel_roles = {
        let mut statement = conn
            .prepare("SELECT system_role FROM productivity_item_type WHERE system_role LIKE 'travel%' ORDER BY system_role")
            .unwrap();
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    assert_eq!(travel_roles, vec!["travel"]);
    result
}

#[derive(Debug, PartialEq, Eq)]
struct TripFacts {
    item: (i64, String, String, Option<String>, Option<String>),
    profile_rows: i64,
    action_rows: Vec<(String, i64, Option<String>, Option<String>, Option<String>)>,
    checkpoint_rows: Vec<(String, i64, String)>,
    transportation_rows: Vec<(String, Option<String>)>,
    point_rows: Vec<(String, String, String, Option<String>, Option<String>, Option<String>)>,
    catalog_rows: Vec<(String, i64)>,
    item_type_rows: Vec<(String, Option<String>, i64)>,
    list_rows: Vec<(String, i64, String, Option<String>, Option<String>)>,
}

fn trip_facts(conn: &Connection, item_id: &str) -> TripFacts {
    let item = conn
        .query_row(
            "SELECT revision, title, status, item_type_id, list_id FROM productivity_item WHERE id = ?1",
            [item_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .unwrap();
    let profile_rows = conn
        .query_row(
            "SELECT COUNT(*) FROM productivity_item_travel_profile WHERE item_id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .unwrap();
    let action_rows = {
        let mut stmt = conn
            .prepare("SELECT id, revision, transportation_id, planned_start_at, planned_end_at FROM productivity_action WHERE target_id = ?1 ORDER BY id")
            .unwrap();
        stmt.query_map([item_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let checkpoint_rows = {
        let mut stmt = conn
            .prepare("SELECT id, revision, planned_at_utc FROM productivity_checkpoint WHERE target_id = ?1 ORDER BY id")
            .unwrap();
        stmt.query_map([item_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let transportation_rows = {
        let mut stmt = conn
            .prepare("SELECT id, transportation_type FROM productivity_transportation WHERE item_id = ?1 ORDER BY id")
            .unwrap();
        stmt.query_map([item_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let point_rows = {
        let mut stmt = conn
            .prepare("SELECT id, attachment_kind, role, action_label, location, note FROM productivity_item_travel_point WHERE item_id = ?1 ORDER BY id")
            .unwrap();
        stmt.query_map([item_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let catalog_rows = {
        let mut stmt = conn
            .prepare("SELECT id, revision FROM productivity_item_type_catalog ORDER BY id")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let item_type_rows = {
        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.system_role,
                        (SELECT COUNT(*) FROM productivity_item i WHERE i.item_type_id = t.id)
                 FROM productivity_item_type t ORDER BY t.id",
            )
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let list_rows = {
        let mut stmt = conn
            .prepare("SELECT id, revision, status, deleted_at_utc, deletion_batch_id FROM productivity_list ORDER BY id")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    TripFacts {
        item,
        profile_rows,
        action_rows,
        checkpoint_rows,
        transportation_rows,
        point_rows,
        catalog_rows,
        item_type_rows,
        list_rows,
    }
}

fn assert_generic_writes_rejected(data_dir: &str, item_ref: RevisionRef, list_ref: RevisionRef) {
    let error = update_item_cmd(
        data_dir,
        UpdateItemRequest {
            item: item_ref.clone(),
            patch: ItemPatch {
                title: Some("不应修改".into()),
                description: None,
                status: Some("完成".into()),
                priority: None,
                planned_point: None,
                due_point: None,
                item_type_id: Some(None),
                tag_ids: Some(Vec::new()),
                classification_expected: None,
            },
        },
    )
    .unwrap_err();
    assert_err_code(error, "travel_command_required");

    let error = set_item_status(
        data_dir,
        SetItemStatusRequest { item: item_ref.clone(), status: "完成".into() },
    )
    .unwrap_err();
    assert_err_code(error, "travel_command_required");

    let error = delete_item(data_dir, DeleteItemRequest { item: item_ref.clone() }).unwrap_err();
    assert_err_code(error, "travel_command_required");

    let error = assign_item_to_list(
        data_dir,
        AssignItemToListRequest { item: item_ref.clone(), list: list_ref.clone() },
    )
    .unwrap_err();
    assert_err_code(error, "travel_command_required");
    let error = move_item_to_list(
        data_dir,
        MoveItemToListRequest { item: item_ref.clone(), list: list_ref },
    )
    .unwrap_err();
    assert_err_code(error, "travel_command_required");
    let error = remove_item_from_list(
        data_dir,
        RemoveItemFromListRequest { item: item_ref.clone() },
    )
    .unwrap_err();
    assert_err_code(error, "travel_command_required");

    let error = batch_move_items_to_list(
        data_dir,
        BatchMoveItemsToListRequest {
            expected_data_dir: data_dir.to_string(),
            items: vec![item_ref.clone()],
            list: None,
        },
    )
    .unwrap_err();
    assert_err_code(error, "travel_command_required");

    let error = batch_delete_items(
        data_dir,
        BatchDeleteItemsRequest {
            expected_data_dir: data_dir.to_string(),
            items: vec![BatchDeleteItem { item: item_ref, expected_actions: Vec::new() }],
        },
    )
    .unwrap_err();
    assert_err_code(error, "travel_command_required");
}

#[test]
fn generic_item_and_list_writes_reject_travel_v2_without_changes_but_v2_title_update_works() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "目标列表");
    let list_ref = RevisionRef { id: list.id, expected_revision: list.revision };

    for is_action in [false, true] {
        let created = create_trip(&data_dir, is_action);
        let item_id = created.snapshot.item.id.clone();
        let before = trip_facts(&archive.conn(), &item_id);
        let item_ref = RevisionRef {
            id: item_id.clone(),
            expected_revision: created.snapshot.item.revision,
        };

        assert_generic_writes_rejected(&data_dir, item_ref.clone(), list_ref.clone());
        assert_eq!(trip_facts(&archive.conn(), &item_id), before);

        let updated = update_item(
            &data_dir,
            TravelMutationEnvelope {
                request_id: format!("travel-title-update-{}", uuid::Uuid::new_v4()),
                expected_data_dir: data_dir.clone(),
                item_ref: Some(item_ref),
                action_refs: created.snapshot.member_refs.actions.clone(),
                checkpoint_refs: created.snapshot.member_refs.checkpoints.clone(),
                payload: UpdateItemPayload { title: "V2 标题更新".into() },
            },
        )
        .expect("V2 item title update");
        assert!(updated.changed);
        assert_eq!(updated.snapshot.item.title, "V2 标题更新");
        let after = trip_facts(&archive.conn(), &item_id);
        assert_eq!(after.item.0, before.item.0 + 1);
        assert_eq!(after.item.1, "V2 标题更新");
        assert_eq!(after.item.2, before.item.2);
        assert_eq!(after.item.3, before.item.3);
        assert_eq!(after.item.4, before.item.4);
        assert_eq!(after.profile_rows, before.profile_rows);
        assert_eq!(after.action_rows, before.action_rows);
        assert_eq!(after.checkpoint_rows, before.checkpoint_rows);
        assert_eq!(after.transportation_rows, before.transportation_rows);
        assert_eq!(after.point_rows, before.point_rows);
        assert_eq!(after.catalog_rows, before.catalog_rows);
        assert_eq!(after.item_type_rows, before.item_type_rows);
        assert_eq!(after.list_rows, before.list_rows);
    }

    archive.cleanup();
}

#[test]
fn delete_list_to_inbox_rejects_v2_member_without_changing_list_item_or_refs() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "含出行的清单");
    let created = create_trip_in_list(&data_dir, false, Some(list.id.clone()));
    let item_id = created.snapshot.item.id.clone();
    let item_ref = RevisionRef {
        id: item_id.clone(),
        expected_revision: created.snapshot.item.revision,
    };
    let before = trip_facts(&archive.conn(), &item_id);
    let err = delete_list_and_move_items_to_inbox(DeleteListAndMoveItemsToInboxRequest {
        expected_data_dir: data_dir.clone(),
        list: RevisionRef { id: list.id, expected_revision: list.revision },
        expected_members: vec![item_ref],
    })
    .unwrap_err();
    assert_err_code(err, "travel_command_required");
    assert_eq!(trip_facts(&archive.conn(), &item_id), before);
    archive.cleanup();
}

#[test]
fn fresh_archive_checkpoint_first_creates_travel_preset_profile_and_checkpoint() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    assert_created_trip(&data_dir, &archive, false);
    archive.cleanup();
}

#[test]
fn fresh_archive_action_first_creates_travel_preset_profile_and_action() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let result = assert_created_trip(&data_dir, &archive, true);
    assert!(result.changed);
    assert_eq!(result.snapshot.actions.len(), 1);
    assert_eq!(result.snapshot.transportations.len(), 1);
    let transportation = &result.snapshot.transportations[0];
    assert_eq!(transportation.transportation_type.as_deref(), Some("flight"));
    assert_eq!(transportation.service_number.as_deref(), Some("CA123"));
    assert_eq!(transportation.departure_name.as_deref(), Some("上海虹桥"));
    assert_eq!(transportation.arrival_name.as_deref(), Some("北京首都"));
    assert_eq!(transportation.departure_code.as_deref(), Some("SHA"));
    assert_eq!(transportation.arrival_code.as_deref(), Some("PEK"));
    assert_eq!(
        transportation.source_snapshot,
        Some(serde_json::json!({
            "provider": "variflight",
            "raw": { "flightNo": "CA123", "from": "SHA", "to": "PEK" }
        }))
    );
    archive.cleanup();
}

#[test]
fn shared_boundary_split_policies_allocate_point_content_on_the_requested_side_atomically() {
    for zone in ["frontEnd", "rearStart"] {
      for operation in ["setSharedBoundary", "moveDetached"] {
        for policy in ["copy", "front", "rear", "conflict"] {
            let archive = TestArchive::new();
            let data_dir = archive.data_dir_str();
            let mut created = create_trip(&data_dir, true);
            let item_id = created.snapshot.item.id.clone();
            let first_action_id = created.snapshot.actions[0].id.clone();
            let item_ref = RevisionRef { id: item_id.clone(), expected_revision: created.snapshot.item.revision };
            created = append(&data_dir, TravelMutationEnvelope {
                request_id: format!("travel-append-shared-{}", uuid::Uuid::new_v4()),
                expected_data_dir: data_dir.clone(),
                item_ref: Some(item_ref),
                action_refs: created.snapshot.member_refs.actions.clone(),
                checkpoint_refs: created.snapshot.member_refs.checkpoints.clone(),
                payload: AppendTripPayload {
                    kind: "action".into(),
                    action_id: Some(format!("rear-action-{}", uuid::Uuid::new_v4())),
                    checkpoint_id: None,
                    transportation_id: Some(format!("rear-transport-{}", uuid::Uuid::new_v4())),
                    existing_transportation_id: None,
                    planned_start_at: Some("2026-10-18T04:00:00Z".into()),
                    planned_end_at: Some("2026-10-18T06:00:00Z".into()),
                    planned_at_utc: None,
                    transportation_fields: Default::default(),
                    transportation_source_snapshot: None,
                },
            }).expect("append connected rear action");
            let rear_action_id = created.snapshot.actions.iter().find(|a| a.id != first_action_id).unwrap().id.clone();
            let shared_id = created.snapshot.points.iter()
                .find(|p| p.action_id.as_deref() == Some(&rear_action_id) && p.role == "start")
                .unwrap().id.clone();
            archive.conn().execute(
                "UPDATE productivity_item_travel_point SET action_label='换乘', location='虹桥站', note='原始共享资料' WHERE id=?1",
                [&shared_id],
            ).unwrap();
            // create_trip's first endpoint has a different seeded airport; clear it
            // for the compatible shared-point cases, then add an explicit conflict below.
            archive.conn().execute(
                "UPDATE productivity_item_travel_point SET action_label=NULL, location=NULL, note=NULL WHERE action_id=?1 AND role='end' AND deleted_at_utc IS NULL",
                [&first_action_id],
            ).unwrap();
            if policy == "conflict" {
                let front_id = created.snapshot.points.iter()
                    .find(|p| p.action_id.as_deref() == Some(&first_action_id) && p.role == "end")
                    .unwrap().id.clone();
                archive.conn().execute(
                    "UPDATE productivity_item_travel_point SET action_label='不同端点内容' WHERE id=?1",
                    [&front_id],
                ).unwrap();
            }
            let created = crate::productivity_db::travel_v2::get_trip(&data_dir,
                crate::productivity_db::travel_v2::TravelV2GetRequest {
                    expected_data_dir: data_dir.clone(),
                    item_id: item_id.clone(),
                },
            ).expect("reload before edit").snapshot.expect("travel snapshot");
            let item_ref = RevisionRef { id: item_id.clone(), expected_revision: created.item.revision };
            if operation == "setSharedBoundary" {
              let point_ids_before_same_minute = created.points.iter().map(|p| p.id.clone()).collect::<Vec<_>>();
              let same_minute = edit_plan(&data_dir, TravelMutationEnvelope {
                request_id: format!("travel-shared-same-minute-{}-{}", zone, policy),
                expected_data_dir: data_dir.clone(),
                item_ref: Some(item_ref.clone()),
                action_refs: created.member_refs.actions.clone(),
                checkpoint_refs: created.member_refs.checkpoints.clone(),
                payload: EditPlanPayload {
                    history_scope: None,
                    edit: serde_json::json!({
                        "kind":"setSharedBoundary",
                        "frontActionId":first_action_id,
                        "rearActionId":rear_action_id,
                        "zone":zone,
                        "plannedAtUtc":"2026-10-18T04:00:00.000Z",
                        "splitPolicies": {
                            "movingFrontEnd": if zone == "frontEnd" { policy } else { "copy" },
                            "movingRearStart": if zone == "rearStart" { policy } else { "copy" }
                        }
                    }),
                    resolutions: None,
                },
              }).expect("same-minute shared boundary");
              assert!(!same_minute.changed, "zone={zone}, policy={policy}");
              assert_eq!(same_minute.snapshot.points.iter().map(|p| p.id.clone()).collect::<Vec<_>>(), point_ids_before_same_minute);
            }
            let before_edit = trip_facts(&archive.conn(), &item_id);
            let attempted = edit_plan(&data_dir, TravelMutationEnvelope {
                request_id: format!("travel-split-{}-{}-{}", operation, zone, policy),
                expected_data_dir: data_dir.clone(),
                item_ref: Some(item_ref),
                action_refs: created.member_refs.actions.clone(),
                checkpoint_refs: created.member_refs.checkpoints.clone(),
                payload: EditPlanPayload {
                    history_scope: None,
                    edit: if operation == "setSharedBoundary" { serde_json::json!({
                        "kind":"setSharedBoundary",
                        "frontActionId":first_action_id,
                        "rearActionId":rear_action_id,
                        "zone":zone,
                        "plannedAtUtc": if zone == "frontEnd" { "2026-10-18T03:30:00Z" } else { "2026-10-18T04:30:00Z" },
                        "splitPolicies": {
                            "movingFrontEnd": if zone == "frontEnd" { policy } else { "copy" },
                            "movingRearStart": if zone == "rearStart" { policy } else { "copy" }
                        }
                    }) } else { serde_json::json!({
                        "kind":"moveDetached",
                        "actionId": if zone == "frontEnd" { &first_action_id } else { &rear_action_id },
                        "deltaMinutes": if zone == "frontEnd" { -30 } else { 30 },
                        "splitPolicies": {
                            "movingFrontEnd": if zone == "frontEnd" { policy } else { "copy" },
                            "movingRearStart": if zone == "rearStart" { policy } else { "copy" }
                        }
                    }) },
                    resolutions: None,
                },
            });
            if policy == "conflict" {
                assert_err_code(attempted.unwrap_err(), "point_merge_required");
                assert_eq!(trip_facts(&archive.conn(), &item_id), before_edit,
                    "failed split must roll back point and plan writes; operation={operation}, zone={zone}");
                archive.cleanup();
                continue;
            }
            let result = attempted.expect("edit shared boundary");

            let front_role = result.snapshot.points.iter().find(|p|
                p.action_id.as_deref() == Some(&first_action_id) && p.role == "end");
            let rear_role = result.snapshot.points.iter().find(|p|
                p.action_id.as_deref() == Some(&rear_action_id) && p.role == "start");
            let front_has_content = front_role.is_some_and(|p|
                p.action_label.as_deref() == Some("换乘") && p.location.as_deref() == Some("虹桥站") && p.note.as_deref() == Some("原始共享资料"));
            let rear_has_content = rear_role.is_some_and(|p|
                p.action_label.as_deref() == Some("换乘") && p.location.as_deref() == Some("虹桥站") && p.note.as_deref() == Some("原始共享资料"));
            assert_eq!(front_has_content, policy != "rear", "operation={operation}, zone={zone}, policy={policy}");
            assert_eq!(rear_has_content, policy != "front", "operation={operation}, zone={zone}, policy={policy}");
            let content_owner = if policy == "front" { front_role } else { rear_role };
            assert_eq!(content_owner.map(|point| point.id.as_str()), Some(shared_id.as_str()),
                "the existing shared point ID follows its selected owner; operation={operation}, zone={zone}, policy={policy}");
            archive.cleanup();
        }
      }
    }
}

#[test]
fn detached_middle_action_with_two_distinct_split_policies_rolls_back_if_move_overlaps_neighbor() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let mut trip = create_trip(&data_dir, true);
    let item_id = trip.snapshot.item.id.clone();
    let first_id = trip.snapshot.actions[0].id.clone();
    for (start, end, action_name) in [
        ("2026-10-18T04:00:00Z", "2026-10-18T06:00:00Z", "middle"),
        ("2026-10-18T06:00:00Z", "2026-10-18T08:00:00Z", "rear"),
    ] {
        trip = append(&data_dir, TravelMutationEnvelope {
            request_id: format!("travel-append-{action_name}-{}", uuid::Uuid::new_v4()),
            expected_data_dir: data_dir.clone(),
            item_ref: Some(RevisionRef { id: item_id.clone(), expected_revision: trip.snapshot.item.revision }),
            action_refs: trip.snapshot.member_refs.actions.clone(),
            checkpoint_refs: trip.snapshot.member_refs.checkpoints.clone(),
            payload: AppendTripPayload {
                kind: "action".into(),
                action_id: Some(format!("{action_name}-{}", uuid::Uuid::new_v4())),
                checkpoint_id: None,
                transportation_id: Some(format!("transport-{action_name}-{}", uuid::Uuid::new_v4())),
                existing_transportation_id: None,
                planned_start_at: Some(start.into()),
                planned_end_at: Some(end.into()),
                planned_at_utc: None,
                transportation_fields: Default::default(),
                transportation_source_snapshot: None,
            },
        }).expect("append contiguous action");
    }
    let middle_id = trip.snapshot.actions.iter().find(|a| a.id != first_id && a.planned_start_at == "2026-10-18T04:00:00Z").unwrap().id.clone();
    let start_point = trip.snapshot.points.iter().find(|p| p.action_id.as_deref() == Some(&middle_id) && p.role == "start").unwrap().id.clone();
    let end_point = trip.snapshot.points.iter().find(|p| p.action_id.as_deref() == Some(&middle_id) && p.role == "end").unwrap().id.clone();
    archive.conn().execute(
        "UPDATE productivity_item_travel_point SET action_label='起点资料' WHERE id=?1",
        [&start_point],
    ).unwrap();
    archive.conn().execute(
        "UPDATE productivity_item_travel_point SET action_label='终点资料' WHERE id=?1",
        [&end_point],
    ).unwrap();
    let current = crate::productivity_db::travel_v2::get_trip(&data_dir,
        crate::productivity_db::travel_v2::TravelV2GetRequest { expected_data_dir: data_dir.clone(), item_id: item_id.clone() },
    ).expect("reload before invalid move").snapshot.expect("trip snapshot");
    let before = trip_facts(&archive.conn(), &item_id);
    let error = edit_plan(&data_dir, TravelMutationEnvelope {
        request_id: format!("travel-detached-two-splits-{}", uuid::Uuid::new_v4()),
        expected_data_dir: data_dir.clone(),
        item_ref: Some(RevisionRef { id: item_id.clone(), expected_revision: current.item.revision }),
        action_refs: current.member_refs.actions.clone(),
        checkpoint_refs: current.member_refs.checkpoints.clone(),
        payload: EditPlanPayload {
            history_scope: None,
            edit: serde_json::json!({
                "kind":"moveDetached",
                "actionId":middle_id,
                "deltaMinutes":30,
                "splitPolicies":{"movingRearStart":"front","movingFrontEnd":"rear"}
            }),
            resolutions: None,
        },
    }).unwrap_err();
    assert_err_code(error, "action_overlap");
    assert_eq!(trip_facts(&archive.conn(), &item_id), before,
        "both endpoint splits and time changes must roll back together");
    archive.cleanup();
}

#[test]
fn invalid_first_content_rolls_back_item_profile_and_new_travel_preset() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let request = envelope(
        &data_dir,
        FirstContentPayload::Action {
            action_id: "invalid-action".into(),
            transportation_id: "invalid-transport".into(),
            start_point_id: "invalid-start".into(),
            end_point_id: "invalid-end".into(),
            planned_start_at: "not-a-time".into(),
            planned_end_at: "2026-10-18T04:00:00Z".into(),
            transportation_type: Some("flight".into()),
            start_location: None,
            end_location: None,
            transportation_fields: crate::productivity_db::travel_v2::TransportationFirstFields {
                service_number: Some("CA123".into()),
                ..Default::default()
            },
            transportation_source_snapshot: Some(serde_json::json!({ "provider": "variflight" })),
        },
    );

    assert!(create(&data_dir, request).is_err());
    let conn = archive.conn();
    for table in [
        "productivity_item",
        "productivity_item_travel_profile",
        "productivity_checkpoint",
        "productivity_action",
        "productivity_transportation",
        "productivity_item_type",
        "productivity_item_type_catalog",
        "productivity_item_travel_point",
    ] {
        let count: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0, "unexpected orphan rows in {table}");
    }
    drop(conn);
    archive.cleanup();
}
