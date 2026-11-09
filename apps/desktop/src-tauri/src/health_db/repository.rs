use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};

use super::error::{HealthError, HealthResult};
use super::types::{
    DerivedNutrientTotal, FoodInput, MealDerivedNutrients, MealFoodSnapshot, MealSnapshot,
};
use super::util::{new_uuid, utc_now};

pub(crate) fn has_unknown_fields(extra: &str) -> bool {
    !extra.trim().is_empty() && extra != "{}" && extra != "null"
}

pub(crate) fn guard_unknown(extra: &str) -> HealthResult<()> {
    if has_unknown_fields(extra) {
        return Err(HealthError::unknown_field_blocked());
    }
    Ok(())
}

fn read_extra_json(tx: &Transaction, table: &str, id: &str) -> HealthResult<String> {
    let sql = format!("SELECT extra_json FROM {table} WHERE id = ?1");
    tx.query_row(&sql, params![id], |row| row.get(0))
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))
}

pub(crate) fn guard_unknown_extra_for_row(tx: &Transaction, table: &str, id: &str) -> HealthResult<()> {
    guard_unknown(&read_extra_json(tx, table, id)?)
}

pub(crate) fn guard_meal_write(tx: &Transaction, id: &str) -> HealthResult<()> {
    guard_unknown_extra_for_row(tx, "health_meal", id)
}

pub(crate) fn guard_health_day_write(tx: &Transaction, id: &str) -> HealthResult<()> {
    guard_unknown_extra_for_row(tx, "health_day", id)
}

pub(crate) fn is_new_meal_title(title: Option<&str>) -> bool {
    title.map(str::trim).filter(|t| !t.is_empty()).is_some()
}

struct MealRow {
    id: String,
    revision: i64,
    title: Option<String>,
    started_at: String,
    ended_at: Option<String>,
    slot: Option<String>,
    icon_key: Option<String>,
    record_shape: String,
    text: Option<String>,
    kcal: Option<f64>,
    carbs: Option<f64>,
    protein: Option<f64>,
    fat: Option<f64>,
    source: String,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
    at_hm: Option<String>,
    items_json: String,
}

fn map_meal_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MealRow> {
    Ok(MealRow {
        id: row.get(0)?,
        revision: row.get(1)?,
        title: row.get(2)?,
        started_at: row.get(3)?,
        ended_at: row.get(4)?,
        slot: row.get(5)?,
        icon_key: row.get(6)?,
        record_shape: row.get(7)?,
        text: row.get(8)?,
        kcal: row.get(9)?,
        carbs: row.get(10)?,
        protein: row.get(11)?,
        fat: row.get(12)?,
        source: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        deleted_at: row.get(16)?,
        at_hm: row.get(17)?,
        items_json: row.get(18)?,
    })
}

const MEAL_SELECT: &str = "SELECT id, revision, title, started_at_utc, ended_at_utc, slot,
                icon_key, record_shape, text, kcal, carbs_grams, protein_grams, fat_grams, source, created_at_utc,
                updated_at_utc, deleted_at_utc, at_hm, items_json";

fn fetch_meal_row(conn: &Connection, id: &str) -> HealthResult<Option<MealRow>> {
    conn.query_row(&format!("{MEAL_SELECT} FROM health_meal WHERE id = ?1"), params![id], map_meal_row)
        .optional()
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))
}

fn load_foods(conn: &Connection, meal_id: &str, include_deleted: bool) -> HealthResult<Vec<MealFoodSnapshot>> {
    let deleted_clause = if include_deleted { "" } else { " AND deleted_at_utc IS NULL" };
    let sql = format!(
        "SELECT id, position, text, kcal, kcal_estimated, serving_text, serving_estimated,
                carbs_grams, protein_grams, fat_grams, sugar_grams, fiber_grams,
                sodium_mg, vitamin_c_mg, nutrients_estimated
         FROM health_meal_food WHERE meal_id = ?1{deleted_clause} ORDER BY position"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map(params![meal_id], |row| {
            Ok(MealFoodSnapshot {
                id: row.get(0)?,
                position: row.get(1)?,
                text: row.get(2)?,
                kcal: row.get(3)?,
                kcal_estimated: row.get::<_, i32>(4)? != 0,
                serving_text: row.get(5)?,
                serving_estimated: row.get::<_, Option<i32>>(6)?.map(|v| v != 0),
                carbs_grams: row.get(7)?,
                protein_grams: row.get(8)?,
                fat_grams: row.get(9)?,
                sugar_grams: row.get(10)?,
                fiber_grams: row.get(11)?,
                sodium_milligrams: row.get(12)?,
                vitamin_c_milligrams: row.get(13)?,
                nutrients_estimated: row.get::<_, Option<i32>>(14)?.map(|v| v != 0),
            })
        })
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?);
    }
    Ok(out)
}

fn sum_nutrient(foods: &[MealFoodSnapshot], pick: fn(&MealFoodSnapshot) -> Option<f64>) -> Option<DerivedNutrientTotal> {
    let mut any = false;
    let mut sum = 0.0;
    let mut partial = false;
    for food in foods {
        match pick(food) {
            Some(v) => {
                any = true;
                sum += v;
            }
            None => partial = true,
        }
    }
    if !any { None } else { Some(DerivedNutrientTotal { value: sum, partial }) }
}

fn derive_nutrients(foods: &[MealFoodSnapshot]) -> MealDerivedNutrients {
    MealDerivedNutrients {
        carbs_grams: sum_nutrient(foods, |f| f.carbs_grams),
        protein_grams: sum_nutrient(foods, |f| f.protein_grams),
        fat_grams: sum_nutrient(foods, |f| f.fat_grams),
        sugar_grams: sum_nutrient(foods, |f| f.sugar_grams),
        fiber_grams: sum_nutrient(foods, |f| f.fiber_grams),
        sodium_milligrams: sum_nutrient(foods, |f| f.sodium_milligrams),
        vitamin_c_milligrams: sum_nutrient(foods, |f| f.vitamin_c_milligrams),
    }
}

fn parse_items_json(items_json: &str) -> Option<Vec<String>> {
    serde_json::from_str::<Value>(items_json)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
}

// Title 非空才走 health_meal_food 聚合；见 docs/plans/evidence/v0.0.19-local-grill/meal-decision-log-2026-09-27.md
pub fn build_meal_snapshot(conn: &Connection, row: MealRow) -> HealthResult<MealSnapshot> {
    if row.record_shape == "foods" {
        let foods = load_foods(conn, &row.id, false)?;
        let meal_kcal = Some(foods.iter().map(|f| f.kcal).sum());
        let derived = derive_nutrients(&foods);
        let has_derived = derived.carbs_grams.is_some()
            || derived.protein_grams.is_some()
            || derived.fat_grams.is_some()
            || derived.sugar_grams.is_some()
            || derived.fiber_grams.is_some()
            || derived.sodium_milligrams.is_some()
            || derived.vitamin_c_milligrams.is_some();
        Ok(MealSnapshot {
            id: row.id,
            revision: row.revision,
            title: row.title,
            started_at: row.started_at,
            slot: row.slot,
            icon_key: row.icon_key,
            text: row.text,
            source: row.source,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            at_hm: row.at_hm,
            record_shape: row.record_shape,
            foods,
            meal_kcal,
            derived_nutrients: has_derived.then_some(derived),
            kcal: None,
            carbs_grams: None,
            protein_grams: None,
            fat_grams: None,
            items: None,
        })
    } else if row.record_shape == "legacy" {
        Ok(MealSnapshot {
            id: row.id,
            revision: row.revision,
            title: row.title,
            started_at: row.started_at,
            slot: row.slot,
            icon_key: row.icon_key,
            text: row.text,
            source: row.source,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            at_hm: row.at_hm,
            record_shape: row.record_shape,
            foods: vec![],
            meal_kcal: row.kcal,
            derived_nutrients: None,
            kcal: row.kcal,
            carbs_grams: row.carbs,
            protein_grams: row.protein,
            fat_grams: row.fat,
            items: parse_items_json(&row.items_json),
        })
    } else {
        Err(HealthError::archive_lifecycle("unknown meal record shape"))
    }
}

pub fn get_meal(conn: &Connection, id: &str) -> HealthResult<Option<MealSnapshot>> {
    let row = fetch_meal_row(conn, id)?;
    match row {
        Some(r) => Ok(Some(build_meal_snapshot(conn, r)?)),
        None => Ok(None),
    }
}

pub fn insert_meal(
    tx: &Transaction,
    id: &str,
    local_date: &str,
    title: &str,
    started_at: &str,
    slot: Option<&str>,
    icon_key: Option<&str>,
    text: Option<&str>,
    source: &str,
    at_hm: Option<&str>,
    foods: &[FoodInput],
) -> HealthResult<MealSnapshot> {
    let now = utc_now();
    tx.execute(
        "INSERT INTO health_meal (
            id, revision, local_date, title, started_at_utc, ended_at_utc, slot, icon_key, record_shape, text,
            kcal, carbs_grams, protein_grams, fat_grams, source, at_hm, items_json,
            created_at_utc, updated_at_utc, extra_json
        ) VALUES (?1, 1, ?2, ?3, ?4, NULL, ?5, ?6, 'foods', ?7, NULL, NULL, NULL, NULL, ?8, ?9, '[]', ?10, ?10, '{}')",
        params![id, local_date, title, started_at, slot, icon_key, text, source, at_hm, now],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    insert_foods(tx, id, foods)?;
    get_meal(tx, id)?.ok_or_else(|| HealthError::archive_lifecycle("meal insert failed"))
}

fn insert_foods(tx: &Transaction, meal_id: &str, foods: &[FoodInput]) -> HealthResult<()> {
    let now = utc_now();
    for (pos, food) in foods.iter().enumerate() {
        let serving_text = food
            .serving_text
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        tx.execute(
            "INSERT INTO health_meal_food (
                id, meal_id, position, text, kcal, kcal_estimated, serving_text, serving_estimated,
                carbs_grams, protein_grams, fat_grams, sugar_grams, fiber_grams,
                sodium_mg, vitamin_c_mg, nutrients_estimated, created_at_utc, updated_at_utc
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)",
            params![
                new_uuid(),
                meal_id,
                pos as i32,
                food.text.trim(),
                food.kcal,
                if food.kcal_estimated { 1 } else { 0 },
                serving_text,
                food.serving_estimated.map(|v| if v { 1 } else { 0 }),
                food.carbs_grams,
                food.protein_grams,
                food.fat_grams,
                food.sugar_grams,
                food.fiber_grams,
                food.sodium_milligrams,
                food.vitamin_c_milligrams,
                food.nutrients_estimated.map(|v| if v { 1 } else { 0 }),
                now,
            ],
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    }
    Ok(())
}

pub fn update_meal_row(
    tx: &Transaction,
    id: &str,
    revision: i64,
    local_date: &str,
    title: &str,
    started_at: &str,
    slot: Option<&str>,
    icon_key: Option<&str>,
    text: Option<&str>,
    at_hm: Option<&str>,
    foods: &[FoodInput],
    clear_deleted: bool,
) -> HealthResult<()> {
    guard_meal_write(tx, id)?;
    let now = utc_now();
    let deleted_clause = if clear_deleted { ", deleted_at_utc = NULL" } else { "" };
    tx.execute(
        &format!(
            "UPDATE health_meal SET revision = ?1, local_date = ?2, title = ?3, started_at_utc = ?4,
             ended_at_utc = NULL, slot = ?5, icon_key = ?6, record_shape = 'foods', text = ?7, kcal = NULL, carbs_grams = NULL,
             protein_grams = NULL, fat_grams = NULL, at_hm = ?8, items_json = '[]',
             updated_at_utc = ?9{deleted_clause} WHERE id = ?10"
        ),
        params![revision, local_date, title, started_at, slot, icon_key, text, at_hm, now, id],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    soft_delete_active_foods(tx, id, &now)?;
    insert_foods(tx, id, foods)?;
    Ok(())
}

pub fn update_meal_metadata_row(
    tx: &Transaction,
    id: &str,
    revision: i64,
    title: Option<&str>,
    slot: Option<&str>,
    icon_key: Option<&str>,
    text: Option<&str>,
    time_update: Option<(&str, &str, Option<&str>)>,
) -> HealthResult<()> {
    guard_meal_write(tx, id)?;
    let now = utc_now();
    let result = if let Some((local_date, started_at, at_hm)) = time_update {
        tx.execute(
            "UPDATE health_meal SET revision = ?1, title = ?2, slot = ?3, icon_key = ?4,
             text = ?5, local_date = ?6, started_at_utc = ?7, at_hm = ?8, updated_at_utc = ?9 WHERE id = ?10",
            params![revision, title, slot, icon_key, text, local_date, started_at, at_hm, now, id],
        )
    } else {
        tx.execute(
            "UPDATE health_meal SET revision = ?1, title = ?2, slot = ?3, icon_key = ?4,
             text = ?5, updated_at_utc = ?6 WHERE id = ?7",
            params![revision, title, slot, icon_key, text, now, id],
        )
    };
    result
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

fn soft_delete_active_foods(tx: &Transaction, meal_id: &str, now: &str) -> HealthResult<()> {
    tx.execute(
        "UPDATE health_meal_food SET deleted_at_utc = ?1, updated_at_utc = ?1
         WHERE meal_id = ?2 AND deleted_at_utc IS NULL",
        params![now, meal_id],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn soft_delete_meal(tx: &Transaction, id: &str, revision: i64) -> HealthResult<()> {
    guard_meal_write(tx, id)?;
    let now = utc_now();
    tx.execute(
        "UPDATE health_meal SET revision = ?1, deleted_at_utc = ?2, updated_at_utc = ?2 WHERE id = ?3",
        params![revision, now, id],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    soft_delete_active_foods(tx, id, &now)?;
    Ok(())
}

pub fn list_meals(
    conn: &Connection,
    from: Option<&str>,
    to: Option<&str>,
    include_deleted: bool,
) -> HealthResult<Vec<MealSnapshot>> {
    let deleted_clause = if include_deleted {
        ""
    } else {
        " AND deleted_at_utc IS NULL"
    };
    let sql = format!(
        "{MEAL_SELECT} FROM health_meal WHERE 1=1{deleted_clause}
         AND (?1 IS NULL OR local_date >= ?1)
         AND (?2 IS NULL OR local_date <= ?2)
         ORDER BY started_at_utc"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map(params![from, to], map_meal_row)
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(build_meal_snapshot(conn, row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?)?);
    }
    Ok(out)
}

pub fn search_meals_by_food_text(
    conn: &Connection,
    needle: &str,
    from: Option<&str>,
    to: Option<&str>,
    slot: Option<&str>,
) -> HealthResult<Vec<MealSnapshot>> {
    let pattern = format!("%{}%", needle.replace('%', "\\%").replace('_', "\\_"));
    let mut meal_ids: Vec<String> = conn
        .prepare(
            "SELECT DISTINCT m.id FROM health_meal m
             JOIN health_meal_food f ON f.meal_id = m.id
             WHERE m.deleted_at_utc IS NULL AND f.deleted_at_utc IS NULL
               AND f.text LIKE ?1 ESCAPE '\\'
               AND (?2 IS NULL OR m.local_date >= ?2)
               AND (?3 IS NULL OR m.local_date <= ?3)
               AND (?4 IS NULL OR m.slot = ?4)
               AND m.title IS NOT NULL AND trim(m.title) != ''",
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
        .query_map(params![pattern, from, to, slot], |row| row.get::<_, String>(0))
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    let legacy_sql = format!(
        "{MEAL_SELECT} FROM health_meal m
         WHERE m.deleted_at_utc IS NULL
           AND (m.title IS NULL OR trim(m.title) = '')
           AND (?1 IS NULL OR m.local_date >= ?1)
           AND (?2 IS NULL OR m.local_date <= ?2)
           AND (?3 IS NULL OR m.slot = ?3)"
    );
    let mut legacy_stmt = conn
        .prepare(&legacy_sql)
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let legacy_rows = legacy_stmt
        .query_map(params![from, to, slot], map_meal_row)
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    for row in legacy_rows {
        let row = row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        let items = parse_items_json(&row.items_json).unwrap_or_default();
        if items.iter().any(|item| item.contains(needle)) {
            if !meal_ids.contains(&row.id) {
                meal_ids.push(row.id);
            }
        }
    }

    let mut out = Vec::new();
    for id in meal_ids {
        if let Some(meal) = get_meal(conn, &id)? {
            out.push(meal);
        }
    }
    out.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    Ok(out)
}

pub fn meal_kcal_contribution(conn: &Connection, meal_id: &str) -> HealthResult<Option<f64>> {
    let row = fetch_meal_row(conn, meal_id)?
        .ok_or_else(|| HealthError::root_not_found("meal not found"))?;
    if is_new_meal_title(row.title.as_deref()) {
        let foods = load_foods(conn, meal_id, false)?;
        Ok(Some(foods.iter().map(|f| f.kcal).sum()))
    } else {
        Ok(row.kcal)
    }
}

pub fn sum_meal_kcal_for_date(conn: &Connection, date: &str) -> HealthResult<(i32, Option<f64>)> {
    let meals = list_meals(conn, Some(date), Some(date), false)?;
    let count = meals.len() as i32;
    if count == 0 {
        return Ok((0, None));
    }
    let sum: f64 = meals.iter().filter_map(|m| m.meal_kcal).sum();
    if sum > 0.0 {
        Ok((count, Some(sum)))
    } else if meals.iter().any(|m| m.meal_kcal == Some(0.0)) {
        Ok((count, Some(0.0)))
    } else {
        Ok((count, None))
    }
}

pub fn ensure_health_day(tx: &Transaction, local_date: &str) -> HealthResult<String> {
    if let Some(id) = tx
        .query_row(
            "SELECT id FROM health_day WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            params![local_date],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
    {
        return Ok(id);
    }
    let id = new_uuid();
    let now = utc_now();
    tx.execute(
        "INSERT INTO health_day (id, revision, local_date, source, data_json, created_at_utc, updated_at_utc, extra_json)
         VALUES (?1, 1, ?2, 'garmin', '{}', ?3, ?3, '{}')",
        params![id, local_date, now],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(id)
}

pub fn bump_health_day_revision(tx: &Transaction, day_id: &str) -> HealthResult<i64> {
    guard_health_day_write(tx, day_id)?;
    let now = utc_now();
    let revision: i64 = tx
        .query_row(
            "SELECT revision FROM health_day WHERE id = ?1",
            params![day_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
        + 1;
    tx.execute(
        "UPDATE health_day SET revision = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![revision, now, day_id],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(revision)
}

pub fn read_day_data_json(conn: &Connection, local_date: &str) -> HealthResult<Value> {
    let json: Option<String> = conn
        .query_row(
            "SELECT data_json FROM health_day WHERE local_date = ?1 AND deleted_at_utc IS NULL",
            params![local_date],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    match json {
        Some(s) => serde_json::from_str(&s).map_err(|e| HealthError::archive_lifecycle(e.to_string())),
        None => Ok(json!({})),
    }
}

pub fn patch_day_data(tx: &Transaction, local_date: &str, patch: &Value) -> HealthResult<String> {
    let day_id = ensure_health_day(tx, local_date)?;
    guard_health_day_write(tx, &day_id)?;
    let mut data = read_day_data_json(tx, local_date)?;
    if let (Some(obj), Some(patch_obj)) = (data.as_object_mut(), patch.as_object()) {
        for (k, v) in patch_obj {
            obj.insert(k.clone(), v.clone());
        }
    }
    let data_json = serde_json::to_string(&data).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "UPDATE health_day SET data_json = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![data_json, utc_now(), day_id],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(day_id)
}

pub fn get_class_hash(
    conn: &Connection,
    class_id: &str,
    local_date: &str,
    external_id: &str,
) -> HealthResult<Option<(String, i32)>> {
    conn.query_row(
        "SELECT content_hash, parser_version FROM garmin_class_hash
         WHERE class_id = ?1 AND local_date = ?2 AND external_id = ?3",
        params![class_id, local_date, external_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?)),
    )
    .optional()
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))
}

pub fn set_class_hash(
    tx: &Transaction,
    class_id: &str,
    local_date: &str,
    external_id: &str,
    hash: &str,
    parser_version: i32,
) -> HealthResult<()> {
    tx.execute(
        "INSERT OR REPLACE INTO garmin_class_hash (class_id, local_date, external_id, content_hash, parser_version)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![class_id, local_date, external_id, hash, parser_version],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn delete_samples_for_metric(
    tx: &Transaction,
    local_date: &str,
    metric: &str,
    series: &str,
) -> HealthResult<()> {
    tx.execute(
        "DELETE FROM health_sample WHERE local_date = ?1 AND metric = ?2 AND series = ?3",
        params![local_date, metric, series],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn insert_sample_set(
    tx: &Transaction,
    day_id: &str,
    local_date: &str,
    metric: &str,
    series: &str,
    snapshot_json: &str,
    content_hash: &str,
    parser_version: i32,
) -> HealthResult<()> {
    let now = utc_now();
    tx.execute(
        "INSERT OR REPLACE INTO health_sample (
            id, day_id, local_date, metric, series, snapshot_json,
            content_hash, parser_version, created_at_utc, updated_at_utc
        ) VALUES (
            COALESCE((SELECT id FROM health_sample WHERE local_date = ?1 AND metric = ?2 AND series = ?3), ?4),
            ?5, ?1, ?2, ?3, ?6, ?7, ?8, ?9, ?9
        )",
        params![
            local_date,
            metric,
            series,
            new_uuid(),
            day_id,
            snapshot_json,
            content_hash,
            parser_version,
            now
        ],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn find_activity_by_garmin_id(
    conn: &Connection,
    garmin_id: &str,
) -> HealthResult<Option<(String, String)>> {
    conn.query_row(
        "SELECT id, activity_json FROM health_activity
         WHERE garmin_activity_id = ?1 AND deleted_at_utc IS NULL",
        params![garmin_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .optional()
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))
}

pub(crate) struct ActivityRow {
    id: String,
    revision: i64,
    local_date: String,
    source: String,
    garmin_activity_id: Option<String>,
    started_at_utc: Option<String>,
    ended_at_utc: Option<String>,
    type_key: Option<String>,
    title: Option<String>,
    duration_seconds: Option<f64>,
    elapsed_duration_seconds: Option<f64>,
    moving_duration_seconds: Option<f64>,
    distance_meters: Option<f64>,
    elevation_gain_meters: Option<f64>,
    avg_heart_rate_bpm: Option<f64>,
    avg_speed_mps: Option<f64>,
    avg_pace_seconds_per_km: Option<f64>,
    avg_power_watts: Option<f64>,
    calories: Option<f64>,
    detail_status: Option<String>,
    suspected_duplicate_of: Option<String>,
    created_at_utc: String,
    updated_at_utc: String,
}

const ACTIVITY_SELECT: &str = "SELECT id, revision, local_date, source, garmin_activity_id,
    started_at_utc, ended_at_utc, type_key, title, duration_seconds, elapsed_duration_seconds,
    moving_duration_seconds, distance_meters, elevation_gain_meters, avg_heart_rate_bpm,
    avg_speed_mps, avg_pace_seconds_per_km, avg_power_watts, calories, detail_status,
    suspected_duplicate_of, created_at_utc, updated_at_utc";

fn map_activity_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityRow> {
    Ok(ActivityRow {
        id: row.get(0)?,
        revision: row.get(1)?,
        local_date: row.get(2)?,
        source: row.get(3)?,
        garmin_activity_id: row.get(4)?,
        started_at_utc: row.get(5)?,
        ended_at_utc: row.get(6)?,
        type_key: row.get(7)?,
        title: row.get(8)?,
        duration_seconds: row.get(9)?,
        elapsed_duration_seconds: row.get(10)?,
        moving_duration_seconds: row.get(11)?,
        distance_meters: row.get(12)?,
        elevation_gain_meters: row.get(13)?,
        avg_heart_rate_bpm: row.get(14)?,
        avg_speed_mps: row.get(15)?,
        avg_pace_seconds_per_km: row.get(16)?,
        avg_power_watts: row.get(17)?,
        calories: row.get(18)?,
        detail_status: row.get(19)?,
        suspected_duplicate_of: row.get(20)?,
        created_at_utc: row.get(21)?,
        updated_at_utc: row.get(22)?,
    })
}

pub(crate) fn activity_row_to_list_item(row: ActivityRow) -> HealthResult<super::types::ActivityListItem> {
    // 旧行在 v7 补列前没有 started_at_utc；缺了就用 created_at，避免整表读取失败。
    let started_at = row
        .started_at_utc
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| row.created_at_utc.clone());
    Ok(super::types::ActivityListItem {
        id: row.id,
        revision: row.revision,
        local_date: row.local_date,
        source: row.source,
        garmin_activity_id: row.garmin_activity_id,
        started_at,
        ended_at: row.ended_at_utc,
        type_key: row.type_key,
        title: row.title,
        duration_seconds: row.duration_seconds,
        elapsed_duration_seconds: row.elapsed_duration_seconds,
        moving_duration_seconds: row.moving_duration_seconds,
        distance_meters: row.distance_meters,
        elevation_gain_meters: row.elevation_gain_meters,
        avg_heart_rate_bpm: row.avg_heart_rate_bpm,
        avg_speed_mps: row.avg_speed_mps,
        avg_pace_seconds_per_km: row.avg_pace_seconds_per_km,
        avg_power_watts: row.avg_power_watts,
        calories: row.calories,
        detail_status: row.detail_status,
        suspected_duplicate_of: row.suspected_duplicate_of,
        created_at: row.created_at_utc,
        updated_at: row.updated_at_utc,
    })
}

const ACTIVITY_LIST_EXCLUDED_TYPE_KEY: &str = "e_bike_fitness";

pub fn list_activities(
    conn: &Connection,
    from: Option<&str>,
    to: Option<&str>,
    limit: u32,
    offset: u32,
) -> HealthResult<Vec<super::types::ActivityListItem>> {
    let sql = format!(
        "{ACTIVITY_SELECT} FROM health_activity
         WHERE deleted_at_utc IS NULL
           AND (type_key IS NULL OR type_key != '{ACTIVITY_LIST_EXCLUDED_TYPE_KEY}')
           AND (?1 IS NULL OR local_date >= ?1)
           AND (?2 IS NULL OR local_date <= ?2)
         ORDER BY started_at_utc DESC
         LIMIT ?3 OFFSET ?4"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map(params![from, to, limit, offset], map_activity_row)
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(activity_row_to_list_item(
            row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?,
        )?);
    }
    Ok(out)
}

pub fn get_activity_row(conn: &Connection, id: &str) -> HealthResult<Option<ActivityRow>> {
    conn.query_row(
        &format!("{ACTIVITY_SELECT} FROM health_activity WHERE id = ?1 AND deleted_at_utc IS NULL"),
        params![id],
        map_activity_row,
    )
    .optional()
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))
}

pub fn list_activity_assets(
    conn: &Connection,
    activity_id: &str,
) -> HealthResult<Vec<super::types::ActivityAssetSnapshot>> {
    let mut stmt = conn
        .prepare(
            "SELECT kind, status, relative_path, sha256, acquired_at_utc
             FROM health_activity_asset WHERE activity_id = ?1 ORDER BY kind",
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map(params![activity_id], |row| {
            Ok(super::types::ActivityAssetSnapshot {
                kind: row.get(0)?,
                status: row.get(1)?,
                relative_path: row.get(2)?,
                sha256: row.get(3)?,
                acquired_at: row.get(4)?,
            })
        })
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?);
    }
    Ok(out)
}

pub fn get_activity_asset(
    conn: &Connection,
    activity_id: &str,
    kind: &str,
) -> HealthResult<Option<(String, String, String)>> {
    conn.query_row(
        "SELECT relative_path, sha256, status FROM health_activity_asset
         WHERE activity_id = ?1 AND kind = ?2",
        params![activity_id, kind],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
    )
    .optional()
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))
}

pub fn upsert_activity_asset(
    tx: &Transaction,
    activity_id: &str,
    kind: &str,
    relative_path: Option<&str>,
    sha256: Option<&str>,
    status: &str,
    acquired_at: Option<&str>,
) -> HealthResult<()> {
    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM health_activity_asset WHERE activity_id = ?1 AND kind = ?2",
            params![activity_id, kind],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    if let Some(id) = existing {
        tx.execute(
            "UPDATE health_activity_asset SET relative_path = ?1, sha256 = ?2, status = ?3,
             acquired_at_utc = ?4 WHERE id = ?5",
            params![relative_path, sha256, status, acquired_at, id],
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    } else {
        tx.execute(
            "INSERT INTO health_activity_asset (id, activity_id, kind, relative_path, sha256, status, acquired_at_utc)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                new_uuid(),
                activity_id,
                kind,
                relative_path,
                sha256,
                status,
                acquired_at
            ],
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    }
    Ok(())
}

pub fn mark_activity_asset_pending(tx: &Transaction, activity_id: &str, kind: &str) -> HealthResult<()> {
    if let Some((path, sha, _)) = get_activity_asset(tx, activity_id, kind)? {
        upsert_activity_asset(tx, activity_id, kind, Some(&path), Some(&sha), "pending", None)
    } else {
        upsert_activity_asset(tx, activity_id, kind, None, None, "pending", None)
    }
}

pub fn list_pending_original_garmin_ids(conn: &Connection) -> HealthResult<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT a.garmin_activity_id FROM health_activity_asset asset
             JOIN health_activity a ON a.id = asset.activity_id
             WHERE asset.kind = 'original_zip' AND asset.status = 'pending'
               AND a.deleted_at_utc IS NULL AND a.garmin_activity_id IS NOT NULL",
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        if let Ok(id) = row {
            out.push(id);
        }
    }
    Ok(out)
}

pub struct ActivityUpsertFields<'a> {
    pub local_date: &'a str,
    pub garmin_id: &'a str,
    pub started_at: &'a str,
    pub ended_at: Option<&'a str>,
    pub type_key: Option<&'a str>,
    pub title: Option<&'a str>,
    pub duration_seconds: Option<f64>,
    pub elapsed_duration_seconds: Option<f64>,
    pub moving_duration_seconds: Option<f64>,
    pub distance_meters: Option<f64>,
    pub elevation_gain_meters: Option<f64>,
    pub avg_heart_rate_bpm: Option<f64>,
    pub avg_speed_mps: Option<f64>,
    pub avg_pace_seconds_per_km: Option<f64>,
    pub avg_power_watts: Option<f64>,
    pub calories: Option<f64>,
    pub detail_status: &'a str,
    pub activity_json: &'a str,
    pub content_hash: &'a str,
    pub parser_version: i32,
    pub suspected_duplicate_of: Option<&'a str>,
}

pub fn upsert_garmin_activity(
    tx: &Transaction,
    activity_id: &str,
    fields: ActivityUpsertFields<'_>,
) -> HealthResult<String> {
    let now = utc_now();
    if find_activity_by_garmin_id(tx, fields.garmin_id)?.is_some() {
        let revision: i64 = tx
            .query_row(
                "SELECT revision FROM health_activity WHERE id = ?1",
                params![activity_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
            + 1;
        tx.execute(
            "UPDATE health_activity SET activity_json = ?1, content_hash = ?2, parser_version = ?3,
             revision = ?4, updated_at_utc = ?5, local_date = ?6, suspected_duplicate_of = ?7,
             started_at_utc = ?8, ended_at_utc = ?9, type_key = ?10, title = ?11,
             duration_seconds = ?12, elapsed_duration_seconds = ?13, moving_duration_seconds = ?14,
             distance_meters = ?15, elevation_gain_meters = ?16, avg_heart_rate_bpm = ?17,
             avg_speed_mps = ?18, avg_pace_seconds_per_km = ?19, avg_power_watts = ?20, calories = ?21,
             detail_status = ?22
             WHERE id = ?23",
            params![
                fields.activity_json,
                fields.content_hash,
                fields.parser_version,
                revision,
                now,
                fields.local_date,
                fields.suspected_duplicate_of,
                fields.started_at,
                fields.ended_at,
                fields.type_key,
                fields.title,
                fields.duration_seconds,
                fields.elapsed_duration_seconds,
                fields.moving_duration_seconds,
                fields.distance_meters,
                fields.elevation_gain_meters,
                fields.avg_heart_rate_bpm,
                fields.avg_speed_mps,
                fields.avg_pace_seconds_per_km,
                fields.avg_power_watts,
                fields.calories,
                fields.detail_status,
                activity_id
            ],
        )
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        return Ok(activity_id.to_string());
    }
    tx.execute(
        "INSERT INTO health_activity (
            id, revision, local_date, source, garmin_activity_id, activity_json,
            content_hash, parser_version, suspected_duplicate_of, created_at_utc, updated_at_utc,
            started_at_utc, ended_at_utc, type_key, title, duration_seconds, elapsed_duration_seconds,
            moving_duration_seconds, distance_meters, elevation_gain_meters, avg_heart_rate_bpm,
            avg_speed_mps, avg_pace_seconds_per_km, avg_power_watts, calories, detail_status
        ) VALUES (?1, 1, ?2, 'garmin', ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                  ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
        params![
            activity_id,
            fields.local_date,
            fields.garmin_id,
            fields.activity_json,
            fields.content_hash,
            fields.parser_version,
            fields.suspected_duplicate_of,
            now,
            fields.started_at,
            fields.ended_at,
            fields.type_key,
            fields.title,
            fields.duration_seconds,
            fields.elapsed_duration_seconds,
            fields.moving_duration_seconds,
            fields.distance_meters,
            fields.elevation_gain_meters,
            fields.avg_heart_rate_bpm,
            fields.avg_speed_mps,
            fields.avg_pace_seconds_per_km,
            fields.avg_power_watts,
            fields.calories,
            fields.detail_status
        ],
    )
    .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(activity_id.to_string())
}
