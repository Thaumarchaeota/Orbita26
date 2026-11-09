use crate::health_db::projection::health_overview_query;
use crate::journal_db::HealthOverviewRequest;

use super::harness::*;

#[test]
fn hrv_writes_metric_hrv_and_projects_track_series_hrv() {
    let archive = TestArchive::new();
    let date = "2026-03-22";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();
    let run_id = new_run_id();

    apply_batch(
        &data_dir,
        &run_id,
        date,
        date,
        vec![complete_entry(
            "health_day_sample_hrv",
            date,
            sample_payload("hrv", "2026-03-22T04:00:00Z", 48.0),
            None,
        )],
    );

    assert_eq!(sample_metric_rows(&conn, date, "hrv"), 1);
    assert_eq!(sample_first_value(&conn, date, "hrv"), Some(48.0));

    let overview = health_overview_query(
        &conn,
        HealthOverviewRequest {
            selected_date: date.to_string(),
            track_from_utc: 0,
            track_to_utc: 4_102_444_800,
            trend_days: 7,
        },
    )
    .expect("overview");
    let hrv = overview
        .track
        .series
        .iter()
        .find(|s| s.metric == "hrv")
        .expect("hrv track series");
    assert!(!hrv.samples.is_empty());
    assert!(hrv.samples.iter().any(|s| s.v == Some(48.0)));

    archive.cleanup();
}
