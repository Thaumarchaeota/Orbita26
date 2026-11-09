use super::harness::*;

#[test]
fn unknown_extra_json_blocks_meal_write() {
    let archive = TestArchive::new();
    let date = "2026-03-20";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();
    let meal_id = create_manual_meal(&data_dir, date, "扩展字段餐", 400.0);

    set_meal_extra_json(&conn, &meal_id, r#"{"legacyUnknownField":"keep"}"#);

    let err = update_meal_text(&data_dir, &meal_id, 1, "应被拒绝").expect_err("blocked write");
    assert_eq!(err.code, "UNKNOWN_FIELD_WRITE_BLOCKED");

    assert_eq!(meal_texts(&conn, date), vec!["扩展字段餐".to_string()]);

    archive.cleanup();
}
