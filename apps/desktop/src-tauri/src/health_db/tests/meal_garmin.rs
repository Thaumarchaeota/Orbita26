use super::harness::*;

#[test]
fn meal_crud_and_garmin_apply_do_not_overwrite_meals() {
    let archive = TestArchive::new();
    let date = "2026-03-15";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();

    let meal_id = create_manual_meal(&data_dir, date, "手工餐", 520.0);
    assert_eq!(meal_texts(&conn, date), vec!["手工餐".to_string()]);

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
                serde_json::json!({ "totalSteps": 9000.0, "hydrationMl": 1800.0 }),
                None,
            ),
            complete_entry(
                "health_day_sample_hr",
                date,
                sample_payload("heartRate", "2026-03-15T04:00:00Z", 72.0),
                None,
            ),
        ],
    );

    assert_eq!(meal_texts(&conn, date), vec!["手工餐".to_string()]);
    assert_eq!(day_field(&conn, date, "steps"), Some(9000.0));

    update_meal_text(&data_dir, &meal_id, 1, "更新餐").expect("update meal");
    assert_eq!(meal_texts(&conn, date), vec!["更新餐".to_string()]);

    let run_id2 = new_run_id();
    apply_batch(
        &data_dir,
        &run_id2,
        date,
        date,
        vec![complete_entry(
            "health_day_summary",
            date,
            serde_json::json!({ "totalSteps": 12000.0, "hydrationMl": 2000.0 }),
            None,
        )],
    );
    assert_eq!(meal_texts(&conn, date), vec!["更新餐".to_string()]);
    assert_eq!(day_field(&conn, date, "steps"), Some(12000.0));

    archive.cleanup();
}
