use crate::productivity_db::tests::harness::{assert_err_code, TestArchive};
use crate::productivity_db::travel_v2::source_mapping::build_adoption_token;
use crate::productivity_db::travel_v2::{
    adopt_flight, append, create, get_trip, reopen, AdoptFlightPayload, AppendTripPayload, CreateTripPayload,
    FirstContentPayload, TravelMutationEnvelope, TravelV2GetRequest, TransportationFirstFields,
};
use crate::productivity_db::types::RevisionRef;

fn envelope<T>(
    data_dir: &str,
    snapshot: &crate::productivity_db::travel_v2::TripSnapshot,
    payload: T,
) -> TravelMutationEnvelope<T> {
    TravelMutationEnvelope {
        request_id: format!("flight-refresh-{}", uuid::Uuid::new_v4()),
        expected_data_dir: data_dir.into(),
        item_ref: Some(RevisionRef {
            id: snapshot.item.id.clone(),
            expected_revision: snapshot.item.revision,
        }),
        action_refs: snapshot.member_refs.actions.clone(),
        checkpoint_refs: snapshot.member_refs.checkpoints.clone(),
        payload,
    }
}

fn create_flight(data_dir: &str) -> crate::productivity_db::travel_v2::TravelMutationResult {
    create(
        data_dir,
        TravelMutationEnvelope {
            request_id: format!("flight-refresh-create-{}", uuid::Uuid::new_v4()),
            expected_data_dir: data_dir.into(),
            item_ref: None,
            action_refs: vec![],
            checkpoint_refs: vec![],
            payload: CreateTripPayload {
                new_item_id: format!("flight-item-{}", uuid::Uuid::new_v4()),
                list_id: None,
                title: "航班刷新回归".into(),
                first_content: FirstContentPayload::Action {
                    action_id: format!("flight-action-{}", uuid::Uuid::new_v4()),
                    transportation_id: format!("flight-transport-{}", uuid::Uuid::new_v4()),
                    start_point_id: format!("flight-start-{}", uuid::Uuid::new_v4()),
                    end_point_id: format!("flight-end-{}", uuid::Uuid::new_v4()),
                    planned_start_at: "2026-10-10T01:00:00Z".into(),
                    planned_end_at: "2026-10-10T02:00:00Z".into(),
                    transportation_type: Some("flight".into()),
                    start_location: None,
                    end_location: None,
                    transportation_fields: TransportationFirstFields::default(),
                    transportation_source_snapshot: None,
                },
            },
        },
    )
    .expect("create flight")
}

fn trip(data_dir: &str, item_id: &str) -> crate::productivity_db::travel_v2::TripSnapshot {
    get_trip(
        data_dir,
        TravelV2GetRequest {
            expected_data_dir: data_dir.into(),
            item_id: item_id.into(),
        },
    )
    .expect("read flight")
    .snapshot
    .expect("trip snapshot")
}

fn candidate() -> serde_json::Value {
    serde_json::json!({
        "FlightNo": "CA123",
        "FlightCompany": "国航",
        "FlightDepAirport": "北京大兴",
        "FlightArrAirport": "深圳宝安",
        "FlightDepcode": "PKX",
        "FlightArrcode": "SZX",
        "FlightDeptimePlanDate": "2026-10-10 09:00:00",
        "FlightArrtimePlanDate": "2026-10-10 10:00:00",
        "FlightDeptimeDate": "2026-10-10 09:10:00",
        "FlightArrtimeDate": "2026-10-10 10:12:00",
    })
}

fn adopt(
    data_dir: &str,
    snapshot: &crate::productivity_db::travel_v2::TripSnapshot,
    transportation_id: &str,
    selected_fields: Option<Vec<String>>,
    candidate: serde_json::Value,
    token_revision: Option<i64>,
) -> crate::productivity_db::error::DomainResult<crate::productivity_db::travel_v2::TravelMutationResult> {
    adopt_flight(data_dir, adoption_envelope(data_dir, snapshot, transportation_id, selected_fields, candidate, token_revision))
}

fn adoption_envelope(
    data_dir: &str,
    snapshot: &crate::productivity_db::travel_v2::TripSnapshot,
    transportation_id: &str,
    selected_fields: Option<Vec<String>>,
    candidate: serde_json::Value,
    token_revision: Option<i64>,
) -> crate::productivity_db::travel_v2::TravelMutationEnvelope<AdoptFlightPayload> {
    let transportation_id = transportation_id.to_string();
    let query_generation = 1;
    let token = build_adoption_token(
        &snapshot.item.id,
        &transportation_id,
        data_dir,
        query_generation,
        token_revision.unwrap_or(snapshot.item.revision),
    );
    envelope(
        data_dir,
        snapshot,
        AdoptFlightPayload {
            transportation_id,
            query_generation,
            candidate,
            raw: None,
            adoption_token: token,
            restore_baseline_generation: None,
            selected_fields,
        },
    )
}

fn seed_pending_actual(archive: &TestArchive, action_id: &str, start: &str, end: &str) {
    archive
        .conn()
        .execute(
            "INSERT INTO productivity_action_travel_actual_v2
             (action_id, schema_version, pending_start_at_utc, pending_end_at_utc, created_at_utc, updated_at_utc)
             VALUES (?1, 1, ?2, ?3, ?4, ?4)",
            rusqlite::params![action_id, start, end, "2026-10-10T00:00:00Z"],
        )
        .expect("seed handwritten actual");
}

#[test]
fn reopen_completed_trip_preserves_actual_and_action_state() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let action_id = &created.snapshot.actions[0].id;
    seed_pending_actual(&archive, action_id, "2026-10-10T01:10:00Z", "2026-10-10T02:10:00Z");
    archive.conn().execute("UPDATE productivity_item SET status = '完成' WHERE id = ?1", [&created.snapshot.item.id]).unwrap();
    archive.conn().execute("UPDATE productivity_action SET ended = 1 WHERE id = ?1", [action_id]).unwrap();
    let before = trip(&data_dir, &created.snapshot.item.id);
    let after = reopen(&data_dir, envelope(&data_dir, &before, serde_json::json!({}))).unwrap().snapshot;
    assert!(!after.item.completed);
    assert!(after.actions[0].ended);
    assert_eq!(after.actions[0].actual.pending_start_at_utc, before.actions[0].actual.pending_start_at_utc);
    assert_eq!(after.actions[0].actual.pending_end_at_utc, before.actions[0].actual.pending_end_at_utc);
    archive.cleanup();
}

#[test]
fn selected_field_updates_and_leaves_unselected_unchanged() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let transport_id = created.snapshot.actions[0].transportation_id.clone().expect("transport");
    let adopted = adopt(
        &data_dir,
        &created.snapshot,
        &transport_id,
        Some(vec!["operator".into()]),
        candidate(),
        None,
    )
    .expect("adopt selected operator");
    let transport = &adopted.snapshot.transportations[0];
    assert_eq!(transport.operator.as_deref(), Some("国航"));
    assert_eq!(transport.service_number, None);
    assert_eq!(transport.departure_name, None);
    let report = adopted.adoption_report.as_ref().expect("top-level adoption report");
    assert!(report["adoptionToken"].as_str().map_or(false, |token| !token.is_empty()));
    assert!(report["adopted"].as_array().is_some());
    archive.cleanup();
}

#[test]
fn adoption_report_is_returned_again_from_the_idempotency_receipt() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let transport_id = created.snapshot.actions[0].transportation_id.clone().expect("transport");
    let mut request = adoption_envelope(
        &data_dir,
        &created.snapshot,
        &transport_id,
        Some(vec!["operator".into()]),
        candidate(),
        None,
    );
    request.request_id = "flight-adoption-report-replay".into();
    let first = adopt_flight(&data_dir, request.clone()).expect("first adoption");
    let second = adopt_flight(&data_dir, request).expect("idempotent replay");
    assert_eq!(first.adoption_report, second.adoption_report);
    assert!(second.adoption_report.as_ref().and_then(|r| r["adoptionToken"].as_str()).map_or(false, |token| !token.is_empty()));
    archive.cleanup();
}

#[test]
fn selected_actual_overwrites_handwritten_actual() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    seed_pending_actual(
        &archive,
        &created.snapshot.actions[0].id,
        "2026-10-10T01:30:00Z",
        "2026-10-10T01:50:00Z",
    );
    let current = trip(&data_dir, &created.snapshot.item.id);
    let transport_id = current.actions.iter().find(|action| action.id == created.snapshot.actions[0].id).unwrap().transportation_id.clone().expect("transport");
    let adopted = adopt(
        &data_dir,
        &current,
        &transport_id,
        Some(vec!["actualStart".into()]),
        candidate(),
        None,
    )
    .expect("overwrite actual");
    let actual = &adopted.snapshot.actions[0].actual;
    assert_eq!(
        actual.start_at_utc.as_deref().or(actual.pending_start_at_utc.as_deref()),
        Some("2026-10-10T01:10:00Z")
    );
    assert_eq!(
        actual.end_at_utc.as_deref().or(actual.pending_end_at_utc.as_deref()),
        Some("2026-10-10T01:50:00Z")
    );
    archive.cleanup();
}

#[test]
fn selected_single_actual_keeps_other_side_of_closed_interval() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let action_id = created.snapshot.actions[0].id.clone();
    let interval_id = format!("flight-interval-{}", uuid::Uuid::new_v4());
    archive.conn().execute(
        "INSERT INTO productivity_interval (id, action_id, started_at, ended_at, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![interval_id, action_id, "2026-10-10T01:30:00Z", "2026-10-10T01:50:00Z", "2026-10-10T00:00:00Z"],
    ).expect("seed closed interval");
    archive.conn().execute(
        "INSERT INTO productivity_action_travel_actual_v2
         (action_id, schema_version, interval_id, created_at_utc, updated_at_utc)
         VALUES (?1, 1, ?2, ?3, ?3)",
        rusqlite::params![action_id, interval_id, "2026-10-10T00:00:00Z"],
    ).expect("link closed interval");
    let current = trip(&data_dir, &created.snapshot.item.id);
    let transport_id = current.actions[0].transportation_id.clone().expect("transport");
    let adopted = adopt(
        &data_dir,
        &current,
        &transport_id,
        Some(vec!["actualStart".into()]),
        candidate(),
        None,
    ).expect("replace only actual start");
    let actual = &adopted.snapshot.actions[0].actual;
    assert_eq!(actual.start_at_utc.as_deref().or(actual.pending_start_at_utc.as_deref()), Some("2026-10-10T01:10:00Z"));
    assert_eq!(actual.end_at_utc.as_deref().or(actual.pending_end_at_utc.as_deref()), Some("2026-10-10T01:50:00Z"));
    archive.cleanup();
}

#[test]
fn selected_both_actuals_keep_start_and_end() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let transport_id = created.snapshot.actions[0]
        .transportation_id
        .clone()
        .expect("transport");
    let adopted = adopt(
        &data_dir,
        &created.snapshot,
        &transport_id,
        Some(vec!["actualStart".into(), "actualEnd".into()]),
        candidate(),
        None,
    )
    .expect("adopt both actuals");
    let actual = &adopted.snapshot.actions[0].actual;
    assert_eq!(
        actual
            .start_at_utc
            .as_deref()
            .or(actual.pending_start_at_utc.as_deref()),
        Some("2026-10-10T01:10:00Z")
    );
    assert_eq!(
        actual
            .end_at_utc
            .as_deref()
            .or(actual.pending_end_at_utc.as_deref()),
        Some("2026-10-10T02:12:00Z")
    );
    archive.cleanup();
}

#[test]
fn selected_full_actual_refresh_replaces_both_sides_even_when_moving_forward() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let action_id = created.snapshot.actions[0].id.clone();
    seed_pending_actual(&archive, &action_id, "2026-10-10T01:30:00Z", "2026-10-10T01:50:00Z");
    let current = trip(&data_dir, &created.snapshot.item.id);
    let transport_id = current.actions[0].transportation_id.clone().expect("transport");
    let mut source = candidate();
    source["FlightDeptimeDate"] = "2026-10-10 11:10:00".into();
    source["FlightArrtimeDate"] = "2026-10-10 12:12:00".into();
    let adopted = adopt(
        &data_dir,
        &current,
        &transport_id,
        Some(vec!["actualStart".into(), "actualEnd".into()]),
        source,
        None,
    )
    .expect("replace full actual range");
    let actual = &adopted.snapshot.actions[0].actual;
    assert_eq!(actual.start_at_utc.as_deref().or(actual.pending_start_at_utc.as_deref()), Some("2026-10-10T03:10:00Z"));
    assert_eq!(actual.end_at_utc.as_deref().or(actual.pending_end_at_utc.as_deref()), Some("2026-10-10T04:12:00Z"));
    archive.cleanup();
}

#[test]
fn source_actual_seconds_are_preserved() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let transport_id = created.snapshot.actions[0].transportation_id.clone().expect("transport");
    let mut source = candidate();
    source["FlightDeptimeDate"] = "2026-10-26 08:37:02".into();
    source["FlightArrtimeDate"] = "2026-10-26 11:33:24".into();
    let adopted = adopt(
        &data_dir,
        &created.snapshot,
        &transport_id,
        Some(vec!["actualStart".into(), "actualEnd".into()]),
        source,
        None,
    )
    .expect("adopt second-precision source actuals");
    let actual = &adopted.snapshot.actions[0].actual;
    assert_eq!(actual.start_at_utc.as_deref().or(actual.pending_start_at_utc.as_deref()), Some("2026-10-26T00:37:02Z"));
    assert_eq!(actual.end_at_utc.as_deref().or(actual.pending_end_at_utc.as_deref()), Some("2026-10-26T03:33:24Z"));
    archive.cleanup();
}

#[test]
fn unselected_actual_stays() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    seed_pending_actual(
        &archive,
        &created.snapshot.actions[0].id,
        "2026-10-10T01:30:00Z",
        "2026-10-10T01:50:00Z",
    );
    let current = trip(&data_dir, &created.snapshot.item.id);
    let transport_id = created.snapshot.actions[0].transportation_id.clone().expect("transport");
    let adopted = adopt(
        &data_dir,
        &current,
        &transport_id,
        Some(vec!["operator".into()]),
        candidate(),
        None,
    )
    .expect("adopt operator only");
    assert_eq!(
        adopted.snapshot.actions[0].actual.pending_start_at_utc.as_deref(),
        Some("2026-10-10T01:30:00Z")
    );
    archive.cleanup();
}

#[test]
fn empty_selected_fields_does_not_change_business_fields() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let transport_id = created.snapshot.actions[0].transportation_id.clone().expect("transport");
    let adopted = adopt(
        &data_dir,
        &created.snapshot,
        &transport_id,
        Some(vec![]),
        candidate(),
        None,
    )
    .expect("empty selected");
    let transport = &adopted.snapshot.transportations[0];
    assert_eq!(transport.operator, None);
    assert_eq!(transport.service_number, None);
    assert_eq!(adopted.snapshot.actions[0].planned_start_at, "2026-10-10T01:00:00Z");
    assert!(transport.source_snapshot.is_some());
    archive.cleanup();
}

#[test]
fn overlapping_selected_plan_rejects_and_rolls_back() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let appended = append(
        &data_dir,
        envelope(
            &data_dir,
            &created.snapshot,
            AppendTripPayload {
                kind: "action".into(),
                action_id: Some(format!("later-action-{}", uuid::Uuid::new_v4())),
                checkpoint_id: None,
                transportation_id: Some(format!("later-transport-{}", uuid::Uuid::new_v4())),
                existing_transportation_id: None,
                planned_start_at: Some("2026-10-10T02:00:00Z".into()),
                planned_end_at: Some("2026-10-10T03:00:00Z".into()),
                planned_at_utc: None,
                transportation_fields: TransportationFirstFields::default(),
                transportation_source_snapshot: None,
            },
        ),
    )
    .expect("append later action");
    let mut overlapping = candidate();
    overlapping["FlightArrtimePlanDate"] = serde_json::Value::String("2026-10-10 10:30:00".into());
    let first_id = created.snapshot.actions[0].id.clone();
    let transport_id = created.snapshot.actions[0].transportation_id.clone().expect("transport");
    let err = adopt(
        &data_dir,
        &appended.snapshot,
        &transport_id,
        Some(vec!["plannedEndAt".into()]),
        overlapping,
        None,
    )
    .unwrap_err();
    assert_err_code(err, "action_overlap");
    let after = trip(&data_dir, &created.snapshot.item.id);
    let first = after.actions.iter().find(|action| action.id == first_id).unwrap();
    assert_eq!(first.planned_start_at, "2026-10-10T01:00:00Z");
    assert_eq!(first.planned_end_at, "2026-10-10T02:00:00Z");
    archive.cleanup();
}

#[test]
fn selected_actual_range_conflicting_with_later_trip_segment_rejects_atomically() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let appended = append(
        &data_dir,
        envelope(
            &data_dir,
            &created.snapshot,
            AppendTripPayload {
                kind: "action".into(),
                action_id: Some(format!("later-action-{}", uuid::Uuid::new_v4())),
                checkpoint_id: None,
                transportation_id: Some(format!("later-transport-{}", uuid::Uuid::new_v4())),
                existing_transportation_id: None,
                planned_start_at: Some("2026-10-10T02:00:00Z".into()),
                planned_end_at: Some("2026-10-10T03:00:00Z".into()),
                planned_at_utc: None,
                transportation_fields: TransportationFirstFields::default(),
                transportation_source_snapshot: None,
            },
        ),
    )
    .expect("append later segment");
    let later_action_id = appended.snapshot.actions.iter().find(|a| a.id != created.snapshot.actions[0].id).unwrap().id.clone();
    archive.conn().execute(
        "INSERT INTO productivity_action_travel_actual_v2
         (action_id, schema_version, pending_start_at_utc, created_at_utc, updated_at_utc)
         VALUES (?1, 1, ?2, ?3, ?3)",
        rusqlite::params![later_action_id, "2026-10-10T02:00:00Z", "2026-10-10T00:00:00Z"],
    ).expect("seed later actual start");
    let before = trip(&data_dir, &created.snapshot.item.id);
    let transport_id = created.snapshot.actions[0].transportation_id.clone().expect("transport");
    let mut source = candidate();
    source["FlightDeptimeDate"] = "2026-10-10 09:30:00".into();
    source["FlightArrtimeDate"] = "2026-10-10 10:30:00".into();
    let err = adopt(
        &data_dir,
        &before,
        &transport_id,
        Some(vec!["actualStart".into(), "actualEnd".into()]),
        source,
        None,
    ).unwrap_err();
    assert_err_code(err, "actual_invalid");
    let after = trip(&data_dir, &created.snapshot.item.id);
    let first = after.actions.iter().find(|a| a.id == created.snapshot.actions[0].id).unwrap();
    assert!(first.actual.start_at_utc.is_none() && first.actual.pending_start_at_utc.is_none());
    assert!(first.actual.end_at_utc.is_none() && first.actual.pending_end_at_utc.is_none());
    archive.cleanup();
}

#[test]
fn stale_adoption_token_does_not_write() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    let transport_id = created.snapshot.actions[0].transportation_id.clone().expect("transport");
    let err = adopt(
        &data_dir,
        &created.snapshot,
        &transport_id,
        Some(vec!["operator".into()]),
        candidate(),
        Some(created.snapshot.item.revision + 1),
    )
    .unwrap_err();
    assert_err_code(err, "query_context_expired");
    let after = trip(&data_dir, &created.snapshot.item.id);
    assert_eq!(after.transportations[0].operator, None);
    archive.cleanup();
}

#[test]
fn none_selected_fields_still_skips_existing_actual() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let created = create_flight(&data_dir);
    seed_pending_actual(
        &archive,
        &created.snapshot.actions[0].id,
        "2026-10-10T01:30:00Z",
        "2026-10-10T01:50:00Z",
    );
    let current = trip(&data_dir, &created.snapshot.item.id);
    let transport_id = created.snapshot.actions[0].transportation_id.clone().expect("transport");
    let adopted = adopt(&data_dir, &current, &transport_id, None, candidate(), None).expect("legacy adopt");
    assert_eq!(
        adopted.snapshot.actions[0].actual.pending_start_at_utc.as_deref(),
        Some("2026-10-10T01:30:00Z")
    );
    archive.cleanup();
}
