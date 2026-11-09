use super::harness::*;

#[test]
fn same_transaction_multi_metric_bumps_day_revision_once_and_skips_failed_class() {
    let archive = TestArchive::new();
    let date = "2026-03-18";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();
    let run_id = new_run_id();

    let result = apply_batch(
        &data_dir,
        &run_id,
        date,
        date,
        vec![
            complete_entry(
                "health_day_sample_hr",
                date,
                sample_payload("heartRate", "2026-03-18T04:00:00Z", 70.0),
                None,
            ),
            complete_entry(
                "health_day_sample_stress",
                date,
                sample_payload("stress", "2026-03-18T05:00:00Z", 35.0),
                None,
            ),
            gap_entry("health_day_sample_spo2", date, "failed", None),
        ],
    );

    assert_eq!(result.submitted_class_count, 2);
    assert_eq!(result.retained_gap_count, 1);
    assert_eq!(day_revision(&conn, date), Some(2));
    assert_eq!(sample_metric_rows(&conn, date, "heartRate"), 1);
    assert_eq!(sample_metric_rows(&conn, date, "stress"), 1);
    assert_eq!(sample_metric_rows(&conn, date, "spo2"), 0);

    archive.cleanup();
}
