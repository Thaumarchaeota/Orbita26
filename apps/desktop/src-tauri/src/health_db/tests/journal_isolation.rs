use crate::productivity_db::coordinator::db_path;

use super::harness::*;

// GarminApply + legacy journal.sqlite：本文件。
// Archive meals 不被 Garmin 覆盖：meal_garmin::meal_crud_and_garmin_apply_do_not_overwrite_meals。
// Journal→Archive meals  handoff：meal_journal_sync。

#[test]
fn legacy_journal_sqlite_not_opened_or_written() {
    let archive = TestArchive::new();
    let date = "2026-03-15";
    let run_id = new_run_id();

    create_manual_meal(&archive.data_dir_str(), date, "隔离午餐", 480.0);
    apply_batch(
        &archive.data_dir_str(),
        &run_id,
        date,
        date,
        vec![complete_entry(
            "health_day_summary",
            date,
            serde_json::json!({ "totalSteps": 6000.0, "hydrationMl": 1500.0 }),
            None,
        )],
    );

    assert!(db_path(&archive.data_dir_str()).is_file());
    archive.assert_journal_untouched();
    archive.cleanup();
}
