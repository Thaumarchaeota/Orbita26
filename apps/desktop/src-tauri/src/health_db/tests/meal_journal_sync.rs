use serde_json::json;

use super::harness::*;

#[test]
fn sync_meals_from_journal_json_is_noop_and_preserves_archive_meals() {
    let archive = TestArchive::new();
    let date = "2026-03-15";
    let data_dir = archive.data_dir_str();

    create_manual_meal(&data_dir, date, "已有 Archive 餐", 450.0);
    sync_meals_from_journal(
        &data_dir,
        date,
        json!([{
            "id": "journal-meal-1",
            "text": "日记午餐",
            "kcal": 450.0,
            "slot": "lunch",
            "at": "12:30"
        }]),
    );

    let conn = archive.conn();
    assert_eq!(meal_texts(&conn, date), vec!["已有 Archive 餐".to_string()]);
    archive.assert_journal_untouched();
    archive.cleanup();
}

#[test]
fn sync_meals_from_journal_json_does_not_replace_existing_day_meals() {
    let archive = TestArchive::new();
    let date = "2026-03-16";
    let data_dir = archive.data_dir_str();

    create_manual_meal(&data_dir, date, "旧 Archive 餐", 300.0);
    sync_meals_from_journal(
        &data_dir,
        date,
        json!([{
            "id": "journal-meal-2",
            "text": "新日记餐",
            "kcal": 520.0,
            "slot": "dinner",
            "at": "19:00"
        }]),
    );

    let conn = archive.conn();
    assert_eq!(meal_texts(&conn, date), vec!["旧 Archive 餐".to_string()]);
    archive.assert_journal_untouched();
    archive.cleanup();
}

#[test]
fn sync_meals_from_journal_json_empty_array_does_not_clear_archive_meals() {
    let archive = TestArchive::new();
    let date = "2026-03-17";
    let data_dir = archive.data_dir_str();

    create_manual_meal(&data_dir, date, "待清空餐", 400.0);
    sync_meals_from_journal(&data_dir, date, json!([]));

    let conn = archive.conn();
    assert_eq!(meal_texts(&conn, date), vec!["待清空餐".to_string()]);
    archive.assert_journal_untouched();
    archive.cleanup();
}
