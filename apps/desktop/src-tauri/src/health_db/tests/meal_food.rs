use rusqlite::Connection;
use uuid::Uuid;

use crate::health_db::commands::{create_meal, delete_meal, get_meal, update_meal};
use crate::health_db::types::{
    CreateMealRequest, DeleteMealRequest, FoodInput, MealRef, UpdateMealRequest,
};
use crate::health_db::util::datetime_to_instant_beijing;

use super::harness::*;

fn sample_food(text: &str, kcal: f64) -> FoodInput {
    FoodInput {
        text: text.to_string(),
        kcal,
        kcal_estimated: false,
        serving_text: None,
        serving_estimated: None,
        carbs_grams: None,
        protein_grams: None,
        fat_grams: None,
        sugar_grams: None,
        fiber_grams: None,
        sodium_milligrams: None,
        vitamin_c_milligrams: None,
        nutrients_estimated: None,
    }
}

fn meal_root_storage(conn: &Connection, meal_id: &str) -> (Option<f64>, String, Option<String>) {
    conn.query_row(
        "SELECT kcal, items_json, title FROM health_meal WHERE id = ?1",
        [meal_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .expect("meal root row")
}

fn active_food_count(conn: &Connection, meal_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM health_meal_food WHERE meal_id = ?1 AND deleted_at_utc IS NULL",
        [meal_id],
        |r| r.get(0),
    )
    .expect("active food count")
}

fn all_food_count(conn: &Connection, meal_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM health_meal_food WHERE meal_id = ?1",
        [meal_id],
        |r| r.get(0),
    )
    .expect("all food count")
}

fn food_nutrient_columns(conn: &Connection, meal_id: &str) -> (Option<f64>, Option<f64>) {
    conn.query_row(
        "SELECT carbs_grams, protein_grams FROM health_meal_food
         WHERE meal_id = ?1 AND deleted_at_utc IS NULL ORDER BY position LIMIT 1",
        [meal_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .expect("food nutrient columns")
}

fn insert_legacy_meal(conn: &Connection, date: &str, text: &str, kcal: f64, items: &[&str]) -> String {
    let id = Uuid::new_v4().to_string();
    let started_at = datetime_to_instant_beijing(date, "12:00").expect("legacy instant");
    let items_json = serde_json::to_string(items).expect("items json");
    let now = "2026-03-15T00:00:00Z";
    conn.execute(
        "INSERT INTO health_meal (
            id, revision, local_date, title, started_at_utc, ended_at_utc, slot, text,
            kcal, carbs_grams, protein_grams, fat_grams, source, at_hm, items_json,
            created_at_utc, updated_at_utc, extra_json
        ) VALUES (?1, 1, ?2, NULL, ?3, NULL, 'lunch', ?4, ?5, NULL, NULL, NULL, 'manual', '12:00', ?6, ?7, ?7, '{}')",
        rusqlite::params![id, date, started_at, text, kcal, items_json, now],
    )
    .expect("insert legacy meal");
    id
}

fn create_meal_with_foods(
    data_dir: &str,
    date: &str,
    title: &str,
    foods: Vec<FoodInput>,
) -> Result<String, crate::health_db::HealthError> {
    let started_at = datetime_to_instant_beijing(date, "12:00").expect("meal instant");
    let res = create_meal(
        data_dir,
        CreateMealRequest {
            title: title.to_string(),
            started_at,
            slot: "lunch".into(),
            icon_key: None,
            text: Some(title.to_string()),
            foods,
            source: None,
            at_hm: Some("12:00".into()),
        },
    )?;
    Ok(res.meal.id)
}

#[test]
fn create_new_meal_root_kcal_and_items_json_not_truth_values() {
    let archive = TestArchive::new();
    let date = "2026-03-21";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();

    let meal_id = create_meal_with_foods(
        &data_dir,
        date,
        "新餐午餐",
        vec![sample_food("鸡胸肉", 220.0), sample_food("米饭", 180.0)],
    )
    .expect("create meal");

    let (root_kcal, items_json, title) = meal_root_storage(&conn, &meal_id);
    assert_eq!(root_kcal, None);
    assert_eq!(items_json, "[]");
    assert_eq!(title.as_deref(), Some("新餐午餐"));
    assert_eq!(active_food_count(&conn, &meal_id), 2);

    let meal = get_meal(&data_dir, &meal_id).expect("get meal").meal;
    assert_eq!(meal.record_shape, "foods");
    assert_eq!(meal.meal_kcal, Some(400.0));
    assert_eq!(meal.kcal, None);
    assert!(meal.items.is_none());
    assert_eq!(meal.foods.len(), 2);
    assert_eq!(meal.foods[0].kcal, 220.0);
    assert_eq!(meal.foods[1].kcal, 180.0);

    archive.cleanup();
}

#[test]
fn create_new_meal_empty_foods_derives_meal_kcal_zero() {
    let archive = TestArchive::new();
    let date = "2026-03-22";
    let data_dir = archive.data_dir_str();

    let meal_id = create_meal_with_foods(&data_dir, date, "空食物餐", vec![])
        .expect("create empty foods meal");

    let meal = get_meal(&data_dir, &meal_id).expect("get meal").meal;
    assert_eq!(meal.record_shape, "foods");
    assert_eq!(meal.meal_kcal, Some(0.0));
    assert!(meal.foods.is_empty());
    assert_eq!(active_food_count(&archive.conn(), &meal_id), 0);

    archive.cleanup();
}

#[test]
fn legacy_meal_without_title_reads_root_kcal_not_foods() {
    let archive = TestArchive::new();
    let date = "2026-03-23";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();

    let meal_id = insert_legacy_meal(&conn, date, "旧餐苹果", 380.0, &["苹果", "酸奶"]);

    let meal = get_meal(&data_dir, &meal_id).expect("get legacy meal").meal;
    assert_eq!(meal.record_shape, "legacy");
    assert_eq!(meal.kcal, Some(380.0));
    assert_eq!(meal.meal_kcal, Some(380.0));
    assert!(meal.foods.is_empty());
    assert_eq!(meal.items, Some(vec!["苹果".to_string(), "酸奶".to_string()]));
    assert_eq!(active_food_count(&conn, &meal_id), 0);

    archive.cleanup();
}

#[test]
fn update_legacy_meal_to_foods_clears_root_and_avoids_double_count() {
    let archive = TestArchive::new();
    let date = "2026-03-24";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();

    let meal_id = insert_legacy_meal(&conn, date, "待升级旧餐", 500.0, &["旧项"]);
    let existing = get_meal(&data_dir, &meal_id).expect("get legacy").meal;

    update_meal(
        &data_dir,
        UpdateMealRequest {
            meal: MealRef {
                id: meal_id.clone(),
                expected_revision: existing.revision,
            },
            title: "升级后新餐".into(),
            started_at: existing.started_at,
            slot: Some(Some(existing.slot.unwrap_or_else(|| "lunch".into()))),
            icon_key: Some(existing.icon_key),
            text: Some("升级后新餐".into()),
            foods: vec![sample_food("沙拉", 120.0), sample_food("汤", 80.0)],
            at_hm: existing.at_hm,
        },
    )
    .expect("upgrade legacy meal");

    let (root_kcal, items_json, title) = meal_root_storage(&conn, &meal_id);
    assert_eq!(root_kcal, None);
    assert_eq!(items_json, "[]");
    assert_eq!(title.as_deref(), Some("升级后新餐"));

    let meal = get_meal(&data_dir, &meal_id).expect("get upgraded meal").meal;
    assert_eq!(meal.record_shape, "foods");
    assert_eq!(meal.meal_kcal, Some(200.0));
    assert_eq!(meal.kcal, None);
    assert!(meal.items.is_none());
    assert_eq!(meal.foods.len(), 2);

    archive.cleanup();
}

#[test]
fn create_meal_rejects_empty_food_text_without_persisting() {
    let archive = TestArchive::new();
    let date = "2026-03-25";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();

    let err = create_meal_with_foods(
        &data_dir,
        date,
        "无效餐",
        vec![sample_food("合法食物", 100.0), sample_food("   ", 50.0)],
    )
    .expect_err("empty food text");

    assert_eq!(err.code, "INVALID_PATCH");
    assert!(meal_texts(&conn, date).is_empty());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM health_meal_food", [], |r| r.get::<_, i64>(0))
            .expect("food total"),
        0
    );

    archive.cleanup();
}

#[test]
fn create_meal_rejects_negative_food_kcal_without_persisting() {
    let archive = TestArchive::new();
    let date = "2026-03-26";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();

    let err = create_meal_with_foods(&data_dir, date, "负热量餐", vec![sample_food("蛋糕", -10.0)])
        .expect_err("negative kcal");

    assert_eq!(err.code, "INVALID_PATCH");
    assert!(meal_texts(&conn, date).is_empty());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM health_meal_food", [], |r| r.get::<_, i64>(0))
            .expect("food total"),
        0
    );

    archive.cleanup();
}

#[test]
fn create_meal_rejects_nutrients_estimated_without_nutrient_values() {
    let archive = TestArchive::new();
    let date = "2026-03-27";
    let data_dir = archive.data_dir_str();

    let err = create_meal_with_foods(
        &data_dir,
        date,
        "营养标记餐",
        vec![FoodInput {
            text: "牛奶".into(),
            kcal: 120.0,
            kcal_estimated: false,
            serving_text: None,
            serving_estimated: None,
            carbs_grams: None,
            protein_grams: None,
            fat_grams: None,
            sugar_grams: None,
            fiber_grams: None,
            sodium_milligrams: None,
            vitamin_c_milligrams: None,
            nutrients_estimated: Some(false),
        }],
    )
    .expect_err("nutrients estimated without values");

    assert_eq!(err.code, "INVALID_PATCH");
    assert!(meal_texts(&archive.conn(), date).is_empty());

    archive.cleanup();
}

#[test]
fn create_meal_rejects_negative_nutrient_without_persisting() {
    let archive = TestArchive::new();
    let date = "2026-03-28";
    let data_dir = archive.data_dir_str();

    let err = create_meal_with_foods(
        &data_dir,
        date,
        "负营养餐",
        vec![FoodInput {
            text: "面包".into(),
            kcal: 200.0,
            kcal_estimated: false,
            serving_text: None,
            serving_estimated: None,
            carbs_grams: Some(-1.0),
            protein_grams: None,
            fat_grams: None,
            sugar_grams: None,
            fiber_grams: None,
            sodium_milligrams: None,
            vitamin_c_milligrams: None,
            nutrients_estimated: Some(false),
        }],
    )
    .expect_err("negative nutrient");

    assert_eq!(err.code, "INVALID_PATCH");
    assert!(meal_texts(&archive.conn(), date).is_empty());

    archive.cleanup();
}

#[test]
fn create_meal_stores_unknown_nutrients_as_null_not_zero() {
    let archive = TestArchive::new();
    let date = "2026-03-29";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();

    let meal_id =
        create_meal_with_foods(&data_dir, date, "仅热量餐", vec![sample_food("白水", 0.0)])
            .expect("create meal");

    let (carbs, protein) = food_nutrient_columns(&conn, &meal_id);
    assert_eq!(carbs, None);
    assert_eq!(protein, None);

    let meal = get_meal(&data_dir, &meal_id).expect("get meal").meal;
    assert_eq!(meal.foods[0].carbs_grams, None);
    assert_eq!(meal.foods[0].protein_grams, None);
    assert!(meal.derived_nutrients.is_none());

    archive.cleanup();
}

#[test]
fn update_meal_with_unknown_extra_json_blocks_without_partial_food_replace() {
    let archive = TestArchive::new();
    let date = "2026-03-30";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();

    let meal_id = create_manual_meal(&data_dir, date, "扩展字段餐", 300.0);
    set_meal_extra_json(&conn, &meal_id, r#"{"legacyUnknownField":"keep"}"#);
    let before_foods = get_meal(&data_dir, &meal_id).expect("get meal").meal.foods;

    let err = update_meal_text(&data_dir, &meal_id, 1, "应被拒绝").expect_err("blocked write");
    assert_eq!(err.code, "UNKNOWN_FIELD_WRITE_BLOCKED");

    let after = get_meal(&data_dir, &meal_id).expect("get meal after").meal;
    assert_eq!(after.foods.len(), before_foods.len());
    assert_eq!(after.foods[0].text, before_foods[0].text);
    assert_eq!(after.foods[0].kcal, before_foods[0].kcal);
    assert_eq!(meal_texts(&conn, date), vec!["扩展字段餐".to_string()]);

    archive.cleanup();
}

#[test]
fn delete_meal_soft_deletes_foods() {
    let archive = TestArchive::new();
    let date = "2026-03-31";
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();

    let meal_id = create_meal_with_foods(
        &data_dir,
        date,
        "待删除餐",
        vec![sample_food("A", 100.0), sample_food("B", 50.0)],
    )
    .expect("create meal");
    assert_eq!(active_food_count(&conn, &meal_id), 2);

    let existing = get_meal(&data_dir, &meal_id).expect("get meal").meal;
    delete_meal(
        &data_dir,
        DeleteMealRequest {
            meal: MealRef {
                id: meal_id.clone(),
                expected_revision: existing.revision,
            },
        },
    )
    .expect("delete meal");

    assert_eq!(active_food_count(&conn, &meal_id), 0);
    assert_eq!(all_food_count(&conn, &meal_id), 2);

    let meal = get_meal(&data_dir, &meal_id).expect("get deleted meal").meal;
    assert!(meal.deleted_at.is_some());

    archive.cleanup();
}
