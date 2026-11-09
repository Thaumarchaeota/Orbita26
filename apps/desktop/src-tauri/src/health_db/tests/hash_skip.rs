use super::harness::*;

#[test]
fn identical_content_hash_skips_write_and_revision() {
    let archive = TestArchive::new();
    let date = "2026-03-19";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();
    let payload = serde_json::json!({ "totalSteps": 7000.0, "hydrationMl": 1600.0 });
    let entry = complete_entry("health_day_summary", date, payload.clone(), None);
    let hash = entry.content_hash.clone().expect("hash");

    let run1 = new_run_id();
    let first = apply_batch(&data_dir, &run1, date, date, vec![entry.clone()]);
    assert_eq!(first.submitted_class_count, 1);
    let rev_after_first = day_revision(&conn, date).expect("day exists");

    let run2 = new_run_id();
    let second = apply_batch(&data_dir, &run2, date, date, vec![entry]);
    assert_eq!(second.skipped_same_hash_count, 1);
    assert_eq!(second.submitted_class_count, 0);
    assert_eq!(second.overall_status, "success");
    assert_eq!(day_revision(&conn, date), Some(rev_after_first));
    assert_eq!(sync_run_row(&conn, &run2).0, "success");

    let stored_hash: String = conn
        .query_row(
            "SELECT content_hash FROM garmin_class_hash WHERE class_id = 'health_day_summary' AND local_date = ?1 AND external_id = ''",
            [date],
            |r| r.get(0),
        )
        .expect("class hash");
    assert_eq!(stored_hash, hash);

    archive.cleanup();
}
