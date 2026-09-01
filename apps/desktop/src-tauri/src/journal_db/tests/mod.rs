mod harness;

use harness::*;

#[test]
fn empty_db_auto_creates_without_reading_json() {
    let path = temp_db_path();
    let journal_json = path.parent().unwrap().join("journal").join("2026.json");
    let conn = open_fresh(&path);

    let version = conn
        .query_row("SELECT version FROM schema_migrations", [], |r| r.get::<_, i64>(0))
        .expect("schema version");
    assert_eq!(version, 1);
    assert!(!journal_json.exists());
    assert!(!path.parent().unwrap().join("journal").exists());

    cleanup(&path);
}

#[test]
fn shanghai_wake_date_for_cross_midnight_sleep() {
    let path = temp_db_path();
    let mut conn = open_fresh(&path);
    let tx = begin_tx(&mut conn);
    let wake_date = "2026-01-02";
    let sleep_start = 1738339200_i64;
    let sleep_end = 1738368000_i64;
    let id = uuid::Uuid::new_v4().to_string();
    let now = "2026-01-02T08:00:00Z";
    let night_json = format!(
        r#"{{"sleep":{},"wake":{}}}"#,
        sleep_start, sleep_end
    );
    tx.execute(
        "INSERT INTO sleep_nights(id, wake_date, source, revision, night_json, content_hash, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, 'garmin', 1, ?3, 'hash', ?4, ?4)",
        rusqlite::params![id, wake_date, night_json, now],
    )
    .expect("insert sleep");

    tx.commit().expect("commit");

    let projected = project_routine_wake(&conn, wake_date).expect("projection");
    assert_eq!(projected, (sleep_start, sleep_end));

    let wrong_day = project_routine_wake(&conn, "2026-01-01");
    assert!(wrong_day.is_none());

    cleanup(&path);
}

#[test]
fn manual_meals_survive_garmin_daily_sync() {
    let path = temp_db_path();
    let mut conn = open_fresh(&path);
    let local_date = "2026-03-15";

    let tx = begin_tx(&mut conn);
    insert_manual_meal(&tx, local_date, "手工午餐", 520);
    apply_garmin_daily_metrics(&tx, local_date, 8000, 1800);
    tx.commit().expect("commit");

    let meals = visible_meals(&conn, local_date);
    assert_eq!(meals, vec!["手工午餐"]);
    assert_eq!(project_daily_steps(&conn, local_date), Some(8000));

    let tx = begin_tx(&mut conn);
    apply_garmin_daily_metrics(&tx, local_date, 8500, 2000);
    tx.commit().expect("commit");

    let meals_after = visible_meals(&conn, local_date);
    assert_eq!(meals_after, vec!["手工午餐"]);
    assert_eq!(project_daily_steps(&conn, local_date), Some(8500));

    cleanup(&path);
}

#[test]
fn uuid_revision_tombstone_and_undo_semantics() {
    let path = temp_db_path();
    let mut conn = open_fresh(&path);
    let local_date = "2026-04-01";

    let tx = begin_tx(&mut conn);
    let meal_id = insert_manual_meal(&tx, local_date, "撤销测试", 300);
    tx.commit().expect("commit");

    assert!(!meal_id.contains("/"));
    assert!(!meal_id.contains("journal"));

    let rev_after_delete = {
        let tx = begin_tx(&mut conn);
        let rev = soft_delete_meal(&tx, &meal_id);
        tx.commit().expect("commit");
        rev
    };
    assert_eq!(rev_after_delete, 2);
    assert!(visible_meals(&conn, local_date).is_empty());

    let tombstone = conn
        .query_row(
            "SELECT deleted_at_utc, revision FROM meals WHERE id = ?1",
            [&meal_id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, i64>(1)?)),
        )
        .expect("tombstone row");
    assert!(tombstone.0.is_some());
    assert_eq!(tombstone.1, 2);

    let rev_after_undo = {
        let tx = begin_tx(&mut conn);
        let rev = undo_soft_delete_meal(&tx, &meal_id);
        tx.commit().expect("commit");
        rev
    };
    assert_eq!(rev_after_undo, 3);
    assert_eq!(visible_meals(&conn, local_date), vec!["撤销测试"]);

    let ops = outbox_for_record(&conn, &meal_id);
    assert_eq!(ops.len(), 3);
    assert_eq!(ops[0], ("upsert".into(), 1, "manual".into()));
    assert_eq!(ops[1], ("delete".into(), 2, "manual".into()));
    assert_eq!(ops[2], ("upsert".into(), 3, "manual".into()));

    cleanup(&path);
}

#[test]
fn transaction_rolls_back_on_failure_no_partial_outbox() {
    let path = temp_db_path();
    let mut conn = open_fresh(&path);
    let local_date = "2026-05-01";

    {
        let tx = begin_tx(&mut conn);
        let meal_id = insert_manual_meal(&tx, local_date, "原子测试", 100);
        let err = tx.execute(
            "INSERT INTO meals(id, local_date, source, revision, meal_json, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, 'manual', 1, '{}', '2026-01-01', '2026-01-01')",
            rusqlite::params![meal_id, local_date],
        );
        assert!(err.is_err());
        tx.rollback().expect("rollback");
    }

    assert_eq!(count_outbox(&conn), 0);
    assert!(visible_meals(&conn, local_date).is_empty());

    cleanup(&path);
}

#[test]
fn identical_garmin_snapshot_payload_skips_duplicate_outbox() {
    let path = temp_db_path();
    let mut conn = open_fresh(&path);
    let local_date = "2026-06-01";
    let metric = "hr";
    let samples = "[{\"t\":100,\"v\":72},{\"t\":200,\"v\":74}]";

    let tx = begin_tx(&mut conn);
    let changed = apply_metric_snapshot(&tx, local_date, metric, samples);
    assert!(changed);
    tx.commit().expect("commit");
    assert_eq!(count_outbox(&conn), 1);

    let tx = begin_tx(&mut conn);
    let changed_again = apply_metric_snapshot(&tx, local_date, metric, samples);
    assert!(!changed_again);
    tx.commit().expect("commit");
    assert_eq!(count_outbox(&conn), 1);

    let revision = conn
        .query_row(
            "SELECT revision FROM metric_day_snapshots WHERE local_date = ?1 AND metric_name = ?2",
            rusqlite::params![local_date, metric],
            |r| r.get::<_, i64>(0),
        )
        .expect("revision");
    assert_eq!(revision, 1);

    cleanup(&path);
}

#[test]
fn daily_and_routine_are_query_projections_not_stored_tables() {
    let path = temp_db_path();
    let mut conn = open_fresh(&path);
    assert!(!has_daily_or_routine_tables(&conn));

    let local_date = "2026-07-01";
    let tx = begin_tx(&mut conn);
    insert_manual_meal(&tx, local_date, "投影测试", 400);
    apply_garmin_daily_metrics(&tx, local_date, 5000, 1500);
    let wake_date = "2026-07-02";
    let id = uuid::Uuid::new_v4().to_string();
    let night_json = r#"{"sleep":1738339200,"wake":1738368000}"#;
    tx.execute(
        "INSERT INTO sleep_nights(id, wake_date, source, revision, night_json, content_hash, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, 'garmin', 1, ?3, 'hash', '2026-01-01', '2026-01-01')",
        rusqlite::params![id, wake_date, night_json],
    )
    .expect("sleep");
    tx.commit().expect("commit");

    assert!(!has_daily_or_routine_tables(&conn));
    assert_eq!(project_daily_steps(&conn, local_date), Some(5000));
    assert!(project_routine_wake(&conn, wake_date).is_some());
    assert_eq!(visible_meals(&conn, local_date).len(), 1);

    cleanup(&path);
}

#[test]
fn cross_year_local_date_query() {
    let path = temp_db_path();
    let mut conn = open_fresh(&path);

    let tx = begin_tx(&mut conn);
    insert_manual_meal(&tx, "2025-12-31", "跨年餐", 200);
    insert_manual_meal(&tx, "2026-01-01", "新年餐", 300);
    tx.commit().expect("commit");

    assert_eq!(visible_meals(&conn, "2025-12-31"), vec!["跨年餐"]);
    assert_eq!(visible_meals(&conn, "2026-01-01"), vec!["新年餐"]);

    cleanup(&path);
}
