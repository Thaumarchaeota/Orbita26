use super::harness::*;

#[test]
fn complete_replaces_date_class_empty_failed_incomplete_retains() {
    let archive = TestArchive::new();
    let date = "2026-03-16";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();
    let run_id = new_run_id();

    apply_batch(
        &data_dir,
        &run_id,
        date,
        date,
        vec![
            complete_entry(
                "health_day_summary",
                date,
                serde_json::json!({ "totalSteps": 5000.0, "hydrationMl": 1200.0 }),
                None,
            ),
            complete_entry(
                "health_day_sample_hr",
                date,
                sample_payload("heartRate", "2026-03-16T04:00:00Z", 68.0),
                None,
            ),
        ],
    );
    assert_eq!(day_field(&conn, date, "steps"), Some(5000.0));
    assert_eq!(sample_first_value(&conn, date, "heartRate"), Some(68.0));

    let run_gap = new_run_id();
    let result = apply_batch(
        &data_dir,
        &run_gap,
        date,
        date,
        vec![
            gap_entry("health_day_summary", date, "empty", None),
            gap_entry("health_day_sample_hr", date, "failed", None),
            gap_entry("health_day_sample_stress", date, "incomplete", None),
        ],
    );
    assert_eq!(result.retained_gap_count, 3);
    assert_eq!(day_field(&conn, date, "steps"), Some(5000.0));
    assert_eq!(sample_first_value(&conn, date, "heartRate"), Some(68.0));
    assert_eq!(sample_metric_rows(&conn, date, "stress"), 0);

    let run_replace = new_run_id();
    apply_batch(
        &data_dir,
        &run_replace,
        date,
        date,
        vec![complete_entry(
            "health_day_summary",
            date,
            serde_json::json!({ "totalSteps": 8000.0 }),
            None,
        )],
    );
    assert_eq!(day_field(&conn, date, "steps"), Some(8000.0));
    assert_eq!(sample_first_value(&conn, date, "heartRate"), Some(68.0));

    archive.cleanup();
}
