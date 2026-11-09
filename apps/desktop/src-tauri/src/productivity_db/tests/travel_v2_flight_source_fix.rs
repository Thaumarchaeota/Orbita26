use crate::productivity_db::tests::harness::TestArchive;
use crate::productivity_db::travel_v2::{
    adopt_flight, append, create, finish, get_trip, set_checkpoint_completed,
    AdoptFlightPayload, AppendTripPayload, CreateTripPayload, FirstContentPayload,
    SetCheckpointCompletedPayload, TravelMutationEnvelope, TravelV2GetRequest,
    TransportationFirstFields,
};
use crate::productivity_db::travel_v2::source_mapping::build_adoption_token;
use crate::productivity_db::types::RevisionRef;

fn envelope<T>(data_dir: &str, snapshot: &crate::productivity_db::travel_v2::TripSnapshot, payload: T) -> TravelMutationEnvelope<T> {
    TravelMutationEnvelope {
        request_id: format!("flight-source-fix-{}", uuid::Uuid::new_v4()),
        expected_data_dir: data_dir.into(),
        item_ref: Some(RevisionRef { id: snapshot.item.id.clone(), expected_revision: snapshot.item.revision }),
        action_refs: snapshot.member_refs.actions.clone(),
        checkpoint_refs: snapshot.member_refs.checkpoints.clone(),
        payload,
    }
}

fn create_flight(data_dir: &str, start_location: Option<&str>) -> crate::productivity_db::travel_v2::TravelMutationResult {
    create(data_dir, TravelMutationEnvelope {
        request_id: format!("flight-source-create-{}", uuid::Uuid::new_v4()),
        expected_data_dir: data_dir.into(),
        item_ref: None,
        action_refs: vec![],
        checkpoint_refs: vec![],
        payload: CreateTripPayload {
            new_item_id: format!("flight-item-{}", uuid::Uuid::new_v4()),
            list_id: None,
            title: "航班来源回归".into(),
            first_content: FirstContentPayload::Action {
                action_id: format!("flight-action-{}", uuid::Uuid::new_v4()),
                transportation_id: format!("flight-transport-{}", uuid::Uuid::new_v4()),
                start_point_id: format!("flight-start-{}", uuid::Uuid::new_v4()),
                end_point_id: format!("flight-end-{}", uuid::Uuid::new_v4()),
                planned_start_at: "2026-10-10T01:00:00Z".into(),
                planned_end_at: "2026-10-10T02:00:00Z".into(),
                transportation_type: Some("flight".into()),
                start_location: start_location.map(str::to_owned),
                end_location: None,
                transportation_fields: TransportationFirstFields::default(),
                transportation_source_snapshot: None,
            },
        },
    }).expect("create flight")
}

fn adopt(data_dir: &str, item_id: &str, candidate: serde_json::Value) -> crate::productivity_db::travel_v2::TravelMutationResult {
    let snapshot = get_trip(data_dir, TravelV2GetRequest { expected_data_dir: data_dir.into(), item_id: item_id.into() })
        .expect("read flight").snapshot.expect("trip snapshot");
    let transportation_id = snapshot.actions[0].transportation_id.clone().expect("transportation");
    let query_generation = 1;
    let token = build_adoption_token(&snapshot.item.id, &transportation_id, data_dir, query_generation, snapshot.item.revision);
    adopt_flight(data_dir, envelope(data_dir, &snapshot, AdoptFlightPayload {
        transportation_id,
        query_generation,
        candidate,
        raw: None,
        adoption_token: token,
        restore_baseline_generation: None,
        selected_fields: None,
    })).expect("adopt flight source")
}

fn add_checkpoint(data_dir: &str, snapshot: &crate::productivity_db::travel_v2::TripSnapshot) -> crate::productivity_db::travel_v2::TravelMutationResult {
    append(data_dir, envelope(data_dir, snapshot, AppendTripPayload {
        kind: "checkpoint".into(),
        action_id: None,
        checkpoint_id: Some(format!("flight-cp-{}", uuid::Uuid::new_v4())),
        transportation_id: None,
        existing_transportation_id: None,
        planned_start_at: None,
        planned_end_at: None,
        planned_at_utc: Some("2026-10-10T00:30:00Z".into()),
        transportation_fields: TransportationFirstFields::default(),
        transportation_source_snapshot: None,
    })).expect("append checkpoint")
}

fn candidate(actual_start: Option<&str>, actual_end: Option<&str>, departure: &str, arrival: &str) -> serde_json::Value {
    let mut value = serde_json::json!({
        "FlightNo":"CA123",
        "FlightDepAirport":departure,
        "FlightArrAirport":arrival,
        "FlightDeptimePlanDate":"2026-10-10 09:00:00",
        "FlightArrtimePlanDate":"2026-10-10 10:00:00",
    });
    if let Some(actual) = actual_start { value["FlightDeptimeDate"] = actual.into(); }
    if let Some(actual) = actual_end { value["FlightArrtimeDate"] = actual.into(); }
    value
}

#[test]
fn flight_source_arrival_only_ends_action_without_completing_item() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir, None);
    let adopted = adopt(&data_dir, &created.snapshot.item.id, candidate(None, Some("2026-10-10 10:00:00"), "北京大兴", "深圳宝安"));
    assert!(adopted.snapshot.actions[0].ended);
    assert_eq!(adopted.snapshot.actions[0].actual.pending_end_at_utc.as_deref(), Some("2026-10-10T02:00:00Z"));
    assert!(!adopted.snapshot.item.completed, "landing alone must not complete the Item without the actual start");
    archive.cleanup();
}

#[test]
fn flight_source_arrival_with_all_action_actuals_waits_for_checkpoint_actual() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir, None);
    let with_checkpoint = add_checkpoint(&data_dir, &created.snapshot);
    let arrived = adopt(&data_dir, &created.snapshot.item.id, candidate(
        Some("2026-10-10 09:00:00"), Some("2026-10-10 10:00:00"), "北京大兴", "深圳宝安",
    ));
    assert!(arrived.snapshot.actions[0].ended);
    assert!(!arrived.snapshot.item.completed, "missing checkpoint actual must keep Item open");
    let checkpoint_actual = set_checkpoint_completed(&data_dir, envelope(&data_dir, &arrived.snapshot, SetCheckpointCompletedPayload {
        checkpoint_id: with_checkpoint.snapshot.checkpoints[0].id.clone(),
        completed: true,
        actual_at_utc: Some("2026-10-10T00:30:00Z".into()),
    })).expect("record checkpoint actual");
    let done = finish(&data_dir, envelope(&data_dir, &checkpoint_actual.snapshot, serde_json::json!({})))
        .expect("complete after every point has actual");
    assert!(done.snapshot.item.completed);
    archive.cleanup();
}

#[test]
fn flight_source_endpoint_adoption_preserves_user_fields_and_updates_source_owned_values() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir, Some("用户填写的出发地"));
    let first = adopt(&data_dir, &created.snapshot.item.id, candidate(None, None, "北京大兴", "深圳宝安"));
    let action = &first.snapshot.actions[0];
    let start = first.snapshot.points.iter().find(|p| p.action_id.as_deref() == Some(action.id.as_str()) && p.role == "start").unwrap();
    let end = first.snapshot.points.iter().find(|p| p.action_id.as_deref() == Some(action.id.as_str()) && p.role == "end").unwrap();
    assert_eq!(start.location.as_deref(), Some("用户填写的出发地"));
    assert_eq!(end.location.as_deref(), Some("深圳宝安"));

    let second = adopt(&data_dir, &created.snapshot.item.id, candidate(None, None, "北京大兴", "深圳机场"));
    let action_id = &second.snapshot.actions[0].id;
    let end_id = second.snapshot.points.iter().find(|p| p.action_id.as_deref() == Some(action_id) && p.role == "end").unwrap().id.clone();
    assert_eq!(second.snapshot.points.iter().find(|p| p.id == end_id).unwrap().location.as_deref(), Some("深圳机场"));

    archive.conn().execute(
        "UPDATE productivity_item_travel_point SET location='手工改的机场', action_label='落地' WHERE id=?1",
        [&end_id],
    ).unwrap();
    let third = adopt(&data_dir, &created.snapshot.item.id, candidate(None, None, "北京大兴", "深圳宝安二号"));
    let end = third.snapshot.points.iter().find(|p| p.id == end_id).unwrap();
    assert_eq!(end.location.as_deref(), Some("手工改的机场"));
    assert_eq!(end.action_label.as_deref(), Some("落地"));

    archive.conn().execute(
        "UPDATE productivity_item_travel_point SET location=NULL WHERE id=?1",
        [&end_id],
    ).unwrap();
    let fourth = adopt(&data_dir, &created.snapshot.item.id, candidate(None, None, "北京大兴", "深圳宝安三号"));
    let end = fourth.snapshot.points.iter().find(|p| p.id == end_id).unwrap();
    assert_eq!(end.location, None, "a manually cleared source-owned value must stay empty on later adoptions");
    archive.cleanup();
}
