use super::harness::*;

#[test]
fn nap_complete_set_tombstones_only_garmin_outside_payload() {
    let archive = TestArchive::new();
    let date = "2026-03-23";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();

    let kept_garmin = insert_garmin_nap(&conn, date, "2026-03-23T03:00:00Z", "2026-03-23T03:30:00Z");
    let removed_garmin = insert_garmin_nap(&conn, date, "2026-03-23T06:00:00Z", "2026-03-23T06:20:00Z");
    let manual = insert_manual_nap(&conn, date, "2026-03-23T08:00:00Z", "2026-03-23T08:15:00Z");

    let run_id = new_run_id();
    apply_batch(
        &data_dir,
        &run_id,
        date,
        date,
        vec![complete_entry(
            "nap",
            date,
            serde_json::json!({
                "naps": [{
                    "startedAt": "2026-03-23T03:00:00Z",
                    "endedAt": "2026-03-23T03:30:00Z",
                    "source": "garmin"
                }]
            }),
            None,
        )],
    );

    assert!(!nap_deleted(&conn, &kept_garmin));
    assert!(nap_deleted(&conn, &removed_garmin));
    assert!(!nap_deleted(&conn, &manual));

    archive.cleanup();
}
