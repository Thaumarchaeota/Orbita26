use crate::productivity_db::tests::harness::{assert_err_code, TestArchive};
use crate::productivity_db::travel_v2::{
    append, create, finish, list_week, AppendTripPayload, CreateTripPayload, FirstContentPayload,
    SetCheckpointCompletedPayload, TravelMutationEnvelope, TravelV2ListWeekRequest,
    set_checkpoint_completed,
    TransportationFirstFields,
};
use crate::productivity_db::types::RevisionRef;

fn action_trip(data_dir: &str, start: &str, end: &str) -> crate::productivity_db::travel_v2::TravelMutationResult {
    create(data_dir, TravelMutationEnvelope {
        request_id: format!("finish-create-{}", uuid::Uuid::new_v4()),
        expected_data_dir: data_dir.to_string(),
        item_ref: None,
        action_refs: vec![],
        checkpoint_refs: vec![],
        payload: CreateTripPayload {
            new_item_id: format!("finish-item-{}", uuid::Uuid::new_v4()),
            list_id: None,
            title: "完成校验出行".into(),
            first_content: FirstContentPayload::Action {
                action_id: format!("finish-action-{}", uuid::Uuid::new_v4()),
                transportation_id: format!("finish-transport-{}", uuid::Uuid::new_v4()),
                start_point_id: format!("finish-point-start-{}", uuid::Uuid::new_v4()),
                end_point_id: format!("finish-point-end-{}", uuid::Uuid::new_v4()),
                planned_start_at: start.into(),
                planned_end_at: end.into(),
                transportation_type: Some("train".into()),
                start_location: None,
                end_location: None,
                transportation_fields: TransportationFirstFields::default(),
                transportation_source_snapshot: None,
            },
        },
    }).expect("create action trip")
}

fn checkpoint_trip(data_dir: &str) -> crate::productivity_db::travel_v2::TravelMutationResult {
    create(data_dir, TravelMutationEnvelope {
        request_id: format!("finish-create-cp-{}", uuid::Uuid::new_v4()),
        expected_data_dir: data_dir.to_string(),
        item_ref: None,
        action_refs: vec![],
        checkpoint_refs: vec![],
        payload: CreateTripPayload {
            new_item_id: format!("finish-cp-item-{}", uuid::Uuid::new_v4()),
            list_id: None,
            title: "完成校验检查点".into(),
            first_content: FirstContentPayload::Checkpoint {
                checkpoint_id: format!("finish-checkpoint-{}", uuid::Uuid::new_v4()),
                planned_at_utc: "2026-10-10T01:00:00Z".into(),
                title: Some("到达".into()),
                location: None,
            },
        },
    }).expect("create checkpoint trip")
}

fn actual_envelope<T>(
    data_dir: &str,
    snapshot: &crate::productivity_db::travel_v2::TripSnapshot,
    request_id: &str,
    payload: T,
) -> TravelMutationEnvelope<T> {
    TravelMutationEnvelope {
        request_id: format!("{request_id}-{}", uuid::Uuid::new_v4()),
        expected_data_dir: data_dir.to_string(),
        item_ref: Some(RevisionRef { id: snapshot.item.id.clone(), expected_revision: snapshot.item.revision }),
        action_refs: snapshot.member_refs.actions.clone(),
        checkpoint_refs: snapshot.member_refs.checkpoints.clone(),
        payload,
    }
}

fn seed_pending_boundaries(archive: &TestArchive, action_id: &str, start: Option<&str>, end: Option<&str>) {
    archive.conn().execute(
        "INSERT INTO productivity_action_travel_actual_v2
         (action_id, schema_version, pending_start_at_utc, pending_end_at_utc, created_at_utc, updated_at_utc)
         VALUES (?1, 1, ?2, ?3, ?4, ?4)",
        rusqlite::params![action_id, start, end, "2026-10-28T00:00:00Z"],
    ).expect("seed actual boundaries");
}

#[test]
fn finish_rejects_missing_checkpoint_actual_without_changing_facts_and_capability() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = checkpoint_trip(&data_dir);
    assert!(!created.snapshot.capabilities.can_finish);
    let item_id = created.snapshot.item.id.clone();
    let before: (i64, String, i64) = archive.conn().query_row(
        "SELECT i.revision, i.status, c.revision FROM productivity_item i
         JOIN productivity_checkpoint c ON c.target_id=i.id WHERE i.id=?1",
        [&item_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).unwrap();
    let err = finish(&data_dir, actual_envelope(&data_dir, &created.snapshot, "finish-missing-cp", serde_json::json!({}))).unwrap_err();
    assert_err_code(err, "actual_invalid");
    let after: (i64, String, i64) = archive.conn().query_row(
        "SELECT i.revision, i.status, c.revision FROM productivity_item i
         JOIN productivity_checkpoint c ON c.target_id=i.id WHERE i.id=?1",
        [&item_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).unwrap();
    assert_eq!(after, before);
    let completed = set_checkpoint_completed(&data_dir, actual_envelope(
        &data_dir, &created.snapshot, "finish-set-cp",
        SetCheckpointCompletedPayload {
            checkpoint_id: created.snapshot.checkpoints[0].id.clone(),
            completed: true,
            actual_at_utc: Some("2026-10-10T01:02:00Z".into()),
        },
    )).expect("record checkpoint actual");
    assert!(completed.snapshot.capabilities.can_finish);
    let done = finish(&data_dir, actual_envelope(&data_dir, &completed.snapshot, "finish-cp-success", serde_json::json!({}))).expect("finish complete checkpoint");
    assert!(done.snapshot.item.completed);
    archive.cleanup();
}

#[test]
fn finish_rejects_one_sided_join_actual_without_changing_facts() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = action_trip(&data_dir, "2026-10-10T01:00:00Z", "2026-10-10T02:00:00Z");
    let first_id = created.snapshot.actions[0].id.clone();
    let appended = append(&data_dir, actual_envelope(&data_dir, &created.snapshot, "finish-append", AppendTripPayload {
        kind: "action".into(),
        action_id: Some(format!("finish-action-{}", uuid::Uuid::new_v4())),
        checkpoint_id: None,
        transportation_id: Some(format!("finish-transport-{}", uuid::Uuid::new_v4())),
        existing_transportation_id: None,
        planned_start_at: Some("2026-10-10T02:00:00Z".into()),
        planned_end_at: Some("2026-10-10T03:00:00Z".into()),
        planned_at_utc: None,
        transportation_fields: TransportationFirstFields::default(),
        transportation_source_snapshot: None,
    })).expect("append adjacent action");
    let second_id = appended.snapshot.actions.iter().find(|a| a.id != first_id).unwrap().id.clone();
    seed_pending_boundaries(&archive, &first_id, Some("2026-10-10T01:01:00Z"), Some("2026-10-10T02:01:00Z"));
    seed_pending_boundaries(&archive, &second_id, None, Some("2026-10-10T03:01:00Z"));
    let current = crate::productivity_db::travel_v2::get_trip(&data_dir, crate::productivity_db::travel_v2::TravelV2GetRequest {
        expected_data_dir: data_dir.clone(), item_id: created.snapshot.item.id.clone(),
    }).unwrap().snapshot.unwrap();
    assert!(!current.capabilities.can_finish);
    let before: (i64, String, i64, i64) = archive.conn().query_row(
        "SELECT i.revision, i.status, a.revision, d.revision FROM productivity_item i
         JOIN productivity_action a ON a.id=?2 JOIN productivity_action d ON d.id=?3 WHERE i.id=?1",
        rusqlite::params![current.item.id, first_id, second_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).unwrap();
    let err = finish(&data_dir, actual_envelope(&data_dir, &current, "finish-missing-join-side", serde_json::json!({}))).unwrap_err();
    assert_err_code(err, "actual_invalid");
    let after: (i64, String, i64, i64) = archive.conn().query_row(
        "SELECT i.revision, i.status, a.revision, d.revision FROM productivity_item i
         JOIN productivity_action a ON a.id=?2 JOIN productivity_action d ON d.id=?3 WHERE i.id=?1",
        rusqlite::params![current.item.id, first_id, second_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).unwrap();
    assert_eq!(after, before);
    archive.cleanup();
}

#[test]
fn completed_trip_week_query_uses_actual_range_and_not_planned_range() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = action_trip(&data_dir, "2026-10-10T01:00:00Z", "2026-10-10T02:00:00Z");
    let action_id = created.snapshot.actions[0].id.clone();
    seed_pending_boundaries(&archive, &action_id, Some("2026-10-20T01:00:00Z"), Some("2026-10-20T02:00:00Z"));
    let current = crate::productivity_db::travel_v2::get_trip(&data_dir, crate::productivity_db::travel_v2::TravelV2GetRequest {
        expected_data_dir: data_dir.clone(), item_id: created.snapshot.item.id.clone(),
    }).unwrap().snapshot.unwrap();
    let done = finish(&data_dir, actual_envelope(&data_dir, &current, "finish-list-week", serde_json::json!({}))).expect("finish actual trip");
    assert!(done.snapshot.item.completed);
    let actual_week = list_week(&data_dir, TravelV2ListWeekRequest {
        expected_data_dir: data_dir.clone(), from_utc: "2026-10-20T00:00:00Z".into(), to_utc: "2026-10-21T00:00:00Z".into(),
    }).expect("actual week");
    assert!(actual_week.items.iter().any(|item| item.item_id == done.snapshot.item.id));
    let planned_week = list_week(&data_dir, TravelV2ListWeekRequest {
        expected_data_dir: data_dir.clone(), from_utc: "2026-10-10T00:00:00Z".into(), to_utc: "2026-10-11T00:00:00Z".into(),
    }).expect("planned week");
    assert!(!planned_week.items.iter().any(|item| item.item_id == done.snapshot.item.id));
    archive.cleanup();
}
