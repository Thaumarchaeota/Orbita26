use super::harness::*;

#[test]
fn activity_upsert_by_external_id_and_absence_does_not_delete() {
    let archive = TestArchive::new();
    let date = "2026-03-17";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();
    let garmin_id = "garmin-act-1001";

    let run1 = new_run_id();
    apply_batch(
        &data_dir,
        &run1,
        date,
        date,
        vec![complete_entry(
            "activity",
            date,
            serde_json::json!({
                "startedAt": "2026-03-17T01:00:00Z",
                "endedAt": "2026-03-17T02:00:00Z",
                "type": "running",
                "distanceMeters": 5000.0
            }),
            Some(garmin_id),
        )],
    );
    assert_eq!(activity_rows_for_garmin_id(&conn, garmin_id), 1);
    let first = activity_payload(&conn, garmin_id);
    assert_eq!(
        first.get("metrics").and_then(|m| m.get("distance")).and_then(|d| d.as_f64()),
        Some(5000.0)
    );

    let run2 = new_run_id();
    apply_batch(
        &data_dir,
        &run2,
        date,
        date,
        vec![complete_entry(
            "activity",
            date,
            serde_json::json!({
                "startedAt": "2026-03-17T01:00:00Z",
                "endedAt": "2026-03-17T02:30:00Z",
                "type": "running",
                "distanceMeters": 8000.0
            }),
            Some(garmin_id),
        )],
    );
    assert_eq!(activity_rows_for_garmin_id(&conn, garmin_id), 1);
    let updated = activity_payload(&conn, garmin_id);
    assert_eq!(
        updated.get("metrics").and_then(|m| m.get("distance")).and_then(|d| d.as_f64()),
        Some(8000.0)
    );

    let run_empty = new_run_id();
    apply_batch(&data_dir, &run_empty, date, date, vec![]);
    assert_eq!(activity_count(&conn), 1);

    archive.cleanup();
}
