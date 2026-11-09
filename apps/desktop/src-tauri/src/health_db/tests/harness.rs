use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::health_db::{
    commands::{create_meal, garmin_apply, sync_meals_from_journal_json},
    sync_run::create_run,
    types::{
        CreateMealRequest, FoodInput, GarminApplyRequest, GarminApplyResult, GarminClassEntry,
        GarminNormalizedBatch, MealRef, UpdateMealRequest,
    },
    util::{content_hash, datetime_to_instant_beijing},
    HealthError,
};
use crate::productivity_db::coordinator::{db_path, in_transaction, with_read, with_write};

pub struct TestArchive {
    pub data_dir: PathBuf,
    journal_path: PathBuf,
    journal_bytes: Vec<u8>,
    journal_mtime: SystemTime,
}

impl TestArchive {
    pub fn new() -> Self {
        crate::health_db::host_lock::release();
        let mut data_dir = std::env::temp_dir();
        data_dir.push(format!("orbita-health-archive-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&data_dir).expect("temp data_dir");

        let journal_path = data_dir.join("journal").join("journal.sqlite");
        fs::create_dir_all(journal_path.parent().expect("journal parent")).expect("journal dir");
        seed_legacy_journal(&journal_path);
        let journal_bytes = fs::read(&journal_path).expect("read journal stub");
        let journal_mtime = fs::metadata(&journal_path)
            .expect("journal meta")
            .modified()
            .expect("journal mtime");

        init_archive(&data_dir);
        Self {
            data_dir,
            journal_path,
            journal_bytes,
            journal_mtime,
        }
    }

    pub fn data_dir_str(&self) -> String {
        self.data_dir.to_string_lossy().into_owned()
    }

    pub fn assert_journal_untouched(&self) {
        let bytes = fs::read(&self.journal_path).expect("re-read journal");
        assert_eq!(bytes, self.journal_bytes, "journal.sqlite content changed");
        let mtime = fs::metadata(&self.journal_path)
            .expect("journal meta")
            .modified()
            .expect("journal mtime");
        assert_eq!(
            mtime,
            self.journal_mtime,
            "journal.sqlite mtime changed"
        );
        let archive_path = db_path(&self.data_dir_str());
        assert_ne!(
            archive_path,
            self.journal_path,
            "archive must not write into journal.sqlite"
        );
    }

    pub fn conn(&self) -> Connection {
        Connection::open(db_path(&self.data_dir_str())).expect("open archive")
    }

    pub fn cleanup(self) {
        crate::health_db::host_lock::release();
        let _ = fs::remove_dir_all(&self.data_dir);
    }
}

fn seed_legacy_journal(path: &Path) {
    if path.exists() {
        fs::remove_file(path).ok();
    }
    let conn = Connection::open(path).expect("open legacy journal");
    conn.execute_batch(
        "CREATE TABLE meals (id TEXT PRIMARY KEY, local_date TEXT, meal_json TEXT);
         INSERT INTO meals VALUES ('legacy-meal-1', '2026-01-01', '{\"text\":\"legacy\"}');",
    )
    .expect("seed legacy journal");
}

pub fn init_archive(data_dir: &Path) {
    let root = data_dir.to_string_lossy();
    with_write(&root, |_| Ok(())).expect("init archive");
}

pub fn new_run_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn ensure_sync_run(data_dir: &str, run_id: &str, from: &str, to: &str) {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| Ok(create_run(tx, run_id, "manual", from, to)?))
    })
    .expect("create sync run");
}

pub fn apply_batch(
    data_dir: &str,
    run_id: &str,
    from: &str,
    to: &str,
    entries: Vec<GarminClassEntry>,
) -> GarminApplyResult {
    ensure_sync_run(data_dir, run_id, from, to);
    garmin_apply(
        data_dir,
        GarminApplyRequest {
            entry_point: "manual".into(),
            batch: GarminNormalizedBatch {
                run_id: run_id.to_string(),
                requested_at_utc: "2026-03-15T00:00:00Z".into(),
                local_date_from: from.into(),
                local_date_to: to.into(),
                parser_version: 1,
                entries,
            },
        },
    )
    .expect("garmin apply")
}

pub fn complete_entry(
    class_id: &str,
    local_date: &str,
    payload: Value,
    external_id: Option<&str>,
) -> GarminClassEntry {
    let hash = content_hash(&payload);
    GarminClassEntry {
        class_id: class_id.into(),
        local_date: local_date.into(),
        external_id: external_id.map(str::to_string),
        completeness: "complete".into(),
        content_hash: Some(hash),
        parser_version: Some(1),
        payload: Some(payload),
        error_code: None,
        error_summary: None,
    }
}

pub fn gap_entry(
    class_id: &str,
    local_date: &str,
    completeness: &str,
    external_id: Option<&str>,
) -> GarminClassEntry {
    GarminClassEntry {
        class_id: class_id.into(),
        local_date: local_date.into(),
        external_id: external_id.map(str::to_string),
        completeness: completeness.into(),
        content_hash: None,
        parser_version: None,
        payload: None,
        error_code: Some("fixture_gap".into()),
        error_summary: Some("fixture gap".into()),
    }
}

pub fn sample_payload(metric: &str, at: &str, value: f64) -> Value {
    json!({
        "metric": metric,
        "series": "default",
        "samples": [{ "at": at, "value": value }]
    })
}

pub fn sync_meals_from_journal(data_dir: &str, date: &str, meals: Value) {
    sync_meals_from_journal_json(data_dir, date, meals).expect("sync meals from journal");
}

pub fn create_manual_meal(data_dir: &str, date: &str, text: &str, kcal: f64) -> String {
    let started_at = datetime_to_instant_beijing(date, "12:00").expect("meal instant");
    let res = create_meal(
        data_dir,
        CreateMealRequest {
            title: text.to_string(),
            started_at,
            slot: "lunch".into(),
            icon_key: None,
            text: Some(text.to_string()),
            foods: vec![FoodInput {
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
            }],
            source: None,
            at_hm: Some("12:00".into()),
        },
    )
    .expect("create meal");
    res.meal.id
}

pub fn update_meal_text(
    data_dir: &str,
    id: &str,
    revision: i64,
    text: &str,
) -> Result<(), HealthError> {
    let existing = crate::health_db::commands::get_meal(data_dir, id)?.meal;
    let foods = if existing.foods.is_empty() {
        vec![FoodInput {
            text: text.to_string(),
            kcal: existing.meal_kcal.unwrap_or(0.0),
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
        }]
    } else {
        existing
            .foods
            .into_iter()
            .map(|f| FoodInput {
                text: f.text,
                kcal: f.kcal,
                kcal_estimated: f.kcal_estimated,
                serving_text: f.serving_text,
                serving_estimated: f.serving_estimated,
                carbs_grams: f.carbs_grams,
                protein_grams: f.protein_grams,
                fat_grams: f.fat_grams,
                sugar_grams: f.sugar_grams,
                fiber_grams: f.fiber_grams,
                sodium_milligrams: f.sodium_milligrams,
                vitamin_c_milligrams: f.vitamin_c_milligrams,
                nutrients_estimated: f.nutrients_estimated,
            })
            .collect()
    };
    crate::health_db::commands::update_meal(
        data_dir,
        UpdateMealRequest {
            meal: MealRef {
                id: id.to_string(),
                expected_revision: revision,
            },
            title: text.to_string(),
            started_at: existing.started_at,
            slot: Some(Some(existing.slot.unwrap_or_else(|| "other".into()))),
            icon_key: Some(existing.icon_key),
            text: Some(text.to_string()),
            foods,
            at_hm: existing.at_hm,
        },
    )
    .map(|_| ())
}

pub fn day_revision(conn: &Connection, local_date: &str) -> Option<i64> {
    conn.query_row(
        "SELECT revision FROM health_day WHERE local_date = ?1 AND deleted_at_utc IS NULL",
        [local_date],
        |r| r.get(0),
    )
    .optional()
    .expect("day revision query")
}

pub fn day_field(conn: &Connection, local_date: &str, key: &str) -> Option<f64> {
    let json: String = conn
        .query_row(
            "SELECT data_json FROM health_day WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            [local_date],
            |r| r.get(0),
        )
        .optional()
        .expect("day json")?;
    let v: Value = serde_json::from_str(&json).expect("parse day json");
    v.get(key).and_then(|x| x.as_f64())
}

pub fn sample_metric_rows(conn: &Connection, local_date: &str, metric: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM health_sample WHERE local_date = ?1 AND metric = ?2 AND deleted_at_utc IS NULL",
        [local_date, metric],
        |r| r.get(0),
    )
    .expect("sample count")
}

pub fn sample_first_value(conn: &Connection, local_date: &str, metric: &str) -> Option<f64> {
    let json: Option<String> = conn
        .query_row(
            "SELECT snapshot_json FROM health_sample WHERE local_date = ?1 AND metric = ?2 AND deleted_at_utc IS NULL LIMIT 1",
            [local_date, metric],
            |r| r.get(0),
        )
        .optional()
        .expect("sample json");
    json.and_then(|s| {
        let v: Value = serde_json::from_str(&s).expect("parse sample");
        v.get("samples")
            .and_then(|a| a.as_array())
            .and_then(|a| a.first())
            .and_then(|p| p.get("value"))
            .and_then(|n| n.as_f64())
    })
}

pub fn activity_rows_for_garmin_id(conn: &Connection, garmin_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM health_activity WHERE garmin_activity_id = ?1 AND deleted_at_utc IS NULL",
        [garmin_id],
        |r| r.get(0),
    )
    .expect("activity count")
}

pub fn activity_count(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM health_activity WHERE deleted_at_utc IS NULL",
        [],
        |r| r.get(0),
    )
    .expect("activity total")
}

pub fn meal_texts(conn: &Connection, local_date: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(NULLIF(trim(title), ''), text) FROM health_meal WHERE local_date = ?1 AND deleted_at_utc IS NULL ORDER BY started_at_utc",
        )
        .expect("meal texts");
    let rows = stmt
        .query_map([local_date], |r| r.get::<_, Option<String>>(0))
        .expect("meal query");
    rows.filter_map(|r| r.ok().flatten()).collect()
}

pub fn set_meal_extra_json(conn: &Connection, meal_id: &str, extra: &str) {
    conn.execute(
        "UPDATE health_meal SET extra_json = ?1 WHERE id = ?2",
        [extra, meal_id],
    )
    .expect("set meal extra_json");
}

pub fn insert_manual_nap(conn: &Connection, wake_date: &str, started: &str, ended: &str) -> String {
    let id = Uuid::new_v4().to_string();
    let nap_json = json!({ "start": 1, "end": 2 }).to_string();
    conn.execute(
        "INSERT INTO health_nap (id, revision, wake_local_date, source, started_at_utc, ended_at_utc, nap_json, created_at_utc, updated_at_utc)
         VALUES (?1, 1, ?2, 'manual', ?3, ?4, ?5, '2026-03-15T00:00:00Z', '2026-03-15T00:00:00Z')",
        rusqlite::params![id, wake_date, started, ended, nap_json],
    )
    .expect("insert manual nap");
    id
}

pub fn insert_garmin_nap(conn: &Connection, wake_date: &str, started: &str, ended: &str) -> String {
    let id = Uuid::new_v4().to_string();
    let nap_json = json!({ "start": 100, "end": 200 }).to_string();
    conn.execute(
        "INSERT INTO health_nap (id, revision, wake_local_date, source, started_at_utc, ended_at_utc, nap_json, created_at_utc, updated_at_utc)
         VALUES (?1, 1, ?2, 'garmin', ?3, ?4, ?5, '2026-03-15T00:00:00Z', '2026-03-15T00:00:00Z')",
        rusqlite::params![id, wake_date, started, ended, nap_json],
    )
    .expect("insert garmin nap");
    id
}

pub fn nap_deleted(conn: &Connection, id: &str) -> bool {
    conn.query_row(
        "SELECT deleted_at_utc IS NOT NULL FROM health_nap WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .expect("nap deleted flag")
}

pub fn sync_run_row(conn: &Connection, run_id: &str) -> (String, Option<String>, Option<String>) {
    conn.query_row(
        "SELECT overall_status, error_code, error_summary FROM garmin_sync_run WHERE id = ?1",
        [run_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .expect("sync run row")
}

pub fn sync_run_coverage_count(conn: &Connection, run_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM garmin_sync_run_coverage WHERE run_id = ?1",
        [run_id],
        |r| r.get(0),
    )
    .expect("coverage count")
}

pub fn health_fact_count(conn: &Connection) -> i64 {
    let meal = conn
        .query_row("SELECT COUNT(*) FROM health_meal", [], |r| r.get::<_, i64>(0))
        .unwrap_or(0);
    let day = conn
        .query_row("SELECT COUNT(*) FROM health_day", [], |r| r.get::<_, i64>(0))
        .unwrap_or(0);
    meal + day
}

pub fn activity_payload(conn: &Connection, garmin_id: &str) -> Value {
    let json: String = conn
        .query_row(
            "SELECT activity_json FROM health_activity WHERE garmin_activity_id = ?1 AND deleted_at_utc IS NULL",
            [garmin_id],
            |r| r.get(0),
        )
        .expect("activity json");
    serde_json::from_str(&json).expect("parse activity")
}
