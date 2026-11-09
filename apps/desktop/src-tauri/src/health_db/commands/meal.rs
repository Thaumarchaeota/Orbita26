use crate::productivity_db::coordinator::in_transaction;

use super::super::error::{HealthError, HealthResult};
use super::super::repository;
use super::super::types::{
    CreateMealRequest, DeleteMealRequest, FoodInput, ListMealsQuery, MealResponse, MealSnapshot,
    MealsListResponse, SearchMealFoodsQuery, SearchMealFoodsResponse, UpdateMealRequest, UpdateMealMetadataRequest,
};
use super::super::util::{new_uuid, parse_datetime_beijing, parse_local_date};

fn validate_title(title: &str) -> HealthResult<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(HealthError::invalid_patch("title is required"));
    }
    Ok(trimmed.to_string())
}

fn validate_slot(slot: Option<&str>, existing: Option<&str>) -> HealthResult<Option<String>> {
    let Some(slot) = slot else { return Ok(None) };
    let value = slot.trim();
    let valid = matches!(value, "breakfast" | "lunch" | "dinner" | "late_night" | "coffee" | "beverage" | "snack" | "other");
    if value.is_empty() || (!valid && existing != Some(value)) { return Err(HealthError::meal_slot_invalid()); }
    Ok(Some(value.to_string()))
}

fn validate_icon_key(icon: Option<&str>, existing: Option<&str>) -> HealthResult<Option<String>> {
    let Some(icon) = icon else { return Ok(None) };
    let value = icon.trim();
    if value.is_empty() || value.len() > 80 || !value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        if existing == Some(value) { return Ok(Some(value.to_string())); }
        return Err(HealthError::invalid_patch("iconKey is invalid"));
    }
    Ok(Some(value.to_string()))
}

fn validate_optional_number(label: &str, value: Option<f64>) -> HealthResult<()> {
    if let Some(v) = value {
        if !v.is_finite() || v < 0.0 {
            return Err(HealthError::invalid_patch(format!("{label} must be a finite number >= 0")));
        }
    }
    Ok(())
}

fn validate_food(food: &FoodInput) -> HealthResult<()> {
    if food.text.trim().is_empty() {
        return Err(HealthError::invalid_patch("food text is required"));
    }
    if !food.kcal.is_finite() || food.kcal < 0.0 {
        return Err(HealthError::invalid_patch("food kcal must be a finite number >= 0"));
    }
    let has_serving = food
        .serving_text
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if has_serving {
        if food.serving_estimated.is_none() {
            return Err(HealthError::invalid_patch("servingEstimated is required when servingText is set"));
        }
    } else if food.serving_estimated.is_some() {
        return Err(HealthError::invalid_patch("servingEstimated must be null without servingText"));
    }
    validate_optional_number("carbsGrams", food.carbs_grams)?;
    validate_optional_number("proteinGrams", food.protein_grams)?;
    validate_optional_number("fatGrams", food.fat_grams)?;
    validate_optional_number("sugarGrams", food.sugar_grams)?;
    validate_optional_number("fiberGrams", food.fiber_grams)?;
    validate_optional_number("sodiumMilligrams", food.sodium_milligrams)?;
    validate_optional_number("vitaminCMilligrams", food.vitamin_c_milligrams)?;
    let any_nutrient = [
        food.carbs_grams,
        food.protein_grams,
        food.fat_grams,
        food.sugar_grams,
        food.fiber_grams,
        food.sodium_milligrams,
        food.vitamin_c_milligrams,
    ]
    .iter()
    .any(|v| v.is_some());
    if any_nutrient {
        if food.nutrients_estimated.is_none() {
            return Err(HealthError::invalid_patch(
                "nutrientsEstimated is required when any nutrient is set",
            ));
        }
    } else if food.nutrients_estimated.is_some() {
        return Err(HealthError::invalid_patch(
            "nutrientsEstimated must be null when all nutrients are null",
        ));
    }
    Ok(())
}

fn validate_foods(foods: &[FoodInput]) -> HealthResult<()> {
    for food in foods {
        validate_food(food)?;
    }
    Ok(())
}

fn resolve_started_at(req_started_at: &str, at_hm: Option<&str>) -> HealthResult<String> {
    if let Some(hm) = at_hm {
        let date = parse_local_date(req_started_at).unwrap_or_else(|_| req_started_at[..10.min(req_started_at.len())].to_string());
        parse_datetime_beijing(&date, hm)
    } else {
        Ok(req_started_at.to_string())
    }
}

pub(crate) fn create_meal_in_tx(
    tx: &rusqlite::Transaction,
    req: &CreateMealRequest,
) -> HealthResult<MealSnapshot> {
    if let Some(src) = &req.source {
        if src != "manual" {
            return Err(HealthError::invalid_patch("source must be manual"));
        }
    }
    let title = validate_title(&req.title)?;
    let slot = validate_slot(req.slot.as_deref(), None)?;
    let icon = validate_icon_key(req.icon_key.as_deref(), None)?;
    validate_foods(&req.foods)?;
    let started_at = resolve_started_at(&req.started_at, req.at_hm.as_deref())?;
    // SPEC-0009: only CreateMeal checks the complete sleep envelope, including
    // awake gaps. Update/import and later sleep ingestion retain their contracts.
    if req.at_hm.as_deref().is_some_and(|v| !v.trim().is_empty()) {
        let at = chrono::DateTime::parse_from_rfc3339(&started_at)
            .map_err(|_| HealthError::invalid_patch("invalid meal timestamp"))?.timestamp();
        let mut stmt = tx.prepare("SELECT night_json FROM health_sleep_night WHERE deleted_at_utc IS NULL")
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        for row in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| HealthError::archive_lifecycle(e.to_string()))? {
            let value: serde_json::Value = serde_json::from_str(&row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?)
                .map_err(|_|HealthError::invalid_patch("睡眠资料异常，无法确认饮食时间"))?;
            let start=value["sleep"].as_i64().ok_or_else(||HealthError::invalid_patch("睡眠资料缺少开始时间"))?;
            let end=value["wake"].as_i64().ok_or_else(||HealthError::invalid_patch("睡眠资料缺少结束时间"))?;
            if end<=start{return Err(HealthError::invalid_patch("睡眠资料时间范围异常"));}
            if start <= at && at < end { return Err(HealthError::invalid_patch("在睡觉呢")); }
        }
        let mut stmt = tx.prepare("SELECT started_at_utc,ended_at_utc FROM health_nap WHERE deleted_at_utc IS NULL")
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        for row in stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e| HealthError::archive_lifecycle(e.to_string()))? {
            let (start,end)=row.map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
            let start=chrono::DateTime::parse_from_rfc3339(&start).map_err(|_|HealthError::invalid_patch("小睡资料开始时间异常"))?;
            let end=chrono::DateTime::parse_from_rfc3339(&end).map_err(|_|HealthError::invalid_patch("小睡资料结束时间异常"))?;
            if end<=start{return Err(HealthError::invalid_patch("小睡资料时间范围异常"));}
            if start.timestamp()<=at && at<end.timestamp() {return Err(HealthError::invalid_patch("在睡觉呢"));}
        }
    }
    let local_date = parse_local_date(&started_at)?;
    let id = new_uuid();
    repository::insert_meal(
        tx,
        &id,
        &local_date,
        &title,
        &started_at,
        slot.as_deref(),
        icon.as_deref(),
        req.text.as_deref(),
        "manual",
        req.at_hm.as_deref(),
        &req.foods,
    )
}

pub(crate) fn update_meal_in_tx(
    tx: &rusqlite::Transaction,
    req: &UpdateMealRequest,
) -> HealthResult<MealSnapshot> {
    let title = validate_title(&req.title)?;
    validate_foods(&req.foods)?;
    let existing = repository::get_meal(tx, &req.meal.id)?
        .ok_or_else(|| HealthError::root_not_found("meal not found"))?;
    if existing.deleted_at.is_some() {
        Err(HealthError::root_deleted("meal is deleted"))?;
    }
    if existing.revision != req.meal.expected_revision {
        Err(HealthError::revision_conflict("meal revision mismatch"))?;
    }
    if existing.source != "manual" {
        Err(HealthError::garmin_source_readonly())?;
    }
    if existing.record_shape != "legacy" && existing.record_shape != "foods" {
        Err(HealthError::invalid_patch("unknown meal record shape"))?;
    }
    let slot_input = req.slot.as_ref().map(|v| v.as_deref()).unwrap_or(existing.slot.as_deref());
    let slot = validate_slot(slot_input, existing.slot.as_deref())?;
    let icon_value = req.icon_key.as_ref().map(|v| v.as_deref()).unwrap_or(existing.icon_key.as_deref());
    let icon = validate_icon_key(icon_value, existing.icon_key.as_deref())?;
    let at_hm = req.at_hm.as_deref().or(existing.at_hm.as_deref());
    let time_unchanged = req.started_at == existing.started_at
        && req.at_hm.as_deref().map(|value| Some(value) == existing.at_hm.as_deref()).unwrap_or(true);
    let at_hm_changed = req.at_hm.as_deref().is_some_and(|value| Some(value) != existing.at_hm.as_deref());
    let started_at = if time_unchanged {
        existing.started_at.clone()
    } else if at_hm_changed {
        resolve_started_at(&req.started_at, at_hm)?
    } else {
        req.started_at.clone()
    };
    let local_date = parse_local_date(&started_at)?;
    let revision = existing.revision + 1;
    repository::update_meal_row(
        tx,
        &req.meal.id,
        revision,
        &local_date,
        &title,
        &started_at,
        slot.as_deref(),
        icon.as_deref(),
        req.text.as_deref(),
        at_hm,
        &req.foods,
        false,
    )?;
    repository::get_meal(tx, &req.meal.id)?
        .ok_or_else(|| HealthError::archive_lifecycle("meal missing after update"))
}

pub fn create_meal(data_dir: &str, req: CreateMealRequest) -> HealthResult<MealResponse> {
    crate::productivity_db::coordinator::with_write_expected(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let meal = create_meal_in_tx(tx, &req)?;
            Ok(MealResponse { meal })
        })
    })
    .map_err(map_coordinator_err)
}

pub fn update_meal(data_dir: &str, req: UpdateMealRequest) -> HealthResult<MealResponse> {
    crate::productivity_db::coordinator::with_write_expected(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let meal = update_meal_in_tx(tx, &req)?;
            Ok(MealResponse { meal })
        })
    })
    .map_err(map_coordinator_err)
}

pub fn update_meal_metadata(data_dir: &str, req: UpdateMealMetadataRequest) -> HealthResult<MealResponse> {
    if req.expected_data_dir != data_dir {
        return Err(HealthError::invalid_patch("数据目录已切换，操作已取消"));
    }
    crate::productivity_db::coordinator::with_write_expected(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let existing = repository::get_meal(tx, &req.meal.id)?
                .ok_or_else(|| HealthError::root_not_found("meal not found"))?;
            if existing.deleted_at.is_some() { return Err(HealthError::root_deleted("meal is deleted").into()); }
            if existing.revision != req.meal.expected_revision { return Err(HealthError::revision_conflict("meal revision mismatch").into()); }
            if existing.source != "manual" { return Err(HealthError::garmin_source_readonly().into()); }
            if existing.record_shape != "legacy" && existing.record_shape != "foods" {
                return Err(HealthError::invalid_patch("unknown meal record shape").into());
            }
            let title_input = req.title.as_ref().map(|value| value.as_deref()).unwrap_or(existing.title.as_deref());
            let title = title_input.map(str::trim).filter(|value| !value.is_empty());
            if existing.record_shape == "foods" && title.is_none() {
                return Err(HealthError::invalid_patch("title is required for foods-shaped meals").into());
            }
            let slot_input = req.slot.as_ref().map(|v| v.as_deref()).unwrap_or(existing.slot.as_deref());
            let slot = validate_slot(slot_input, existing.slot.as_deref())?;
            let icon_input = req.icon_key.as_ref().map(|v| v.as_deref()).unwrap_or(existing.icon_key.as_deref());
            let icon = validate_icon_key(icon_input, existing.icon_key.as_deref())?;
            let text = req.text.as_ref().map(|v| v.as_deref()).unwrap_or(existing.text.as_deref());
            let time_update = if req.update_time {
                let requested_started_at = req.started_at.as_deref()
                    .ok_or_else(|| HealthError::invalid_patch("startedAt is required when updateTime is true"))?;
                let local_date = parse_local_date(requested_started_at)?;
                let requested_at_hm = req.at_hm.as_ref().map(|value| value.as_deref())
                    .ok_or_else(|| HealthError::invalid_patch("atHm is required when updateTime is true"))?;
                match requested_at_hm {
                    Some(value) => {
                        let value = value.trim();
                        if value.is_empty() { return Err(HealthError::invalid_patch("atHm must be null or a valid time").into()); }
                        let _ = parse_datetime_beijing(&local_date, value)?;
                        let instant = chrono::DateTime::parse_from_rfc3339(requested_started_at)
                            .map_err(|_| HealthError::invalid_patch("startedAt must be a valid instant when atHm is set"))?;
                        let local = instant.with_timezone(&super::super::util::beijing_offset());
                        if local.format("%H:%M").to_string() != value {
                            return Err(HealthError::invalid_patch("startedAt and atHm must describe the same Beijing time").into());
                        }
                        Some((local_date, requested_started_at.to_string(), Some(value.to_string())))
                    }
                    None => {
                        let date_anchor = parse_datetime_beijing(&local_date, "00:00")?;
                        Some((local_date, date_anchor, None))
                    }
                }
            } else {
                None
            };
            repository::update_meal_metadata_row(tx, &req.meal.id, existing.revision + 1,
                title, slot.as_deref(), icon.as_deref(), text,
                time_update.as_ref().map(|(date, started_at, at_hm)| (date.as_str(), started_at.as_str(), at_hm.as_deref())))?;
            let meal = repository::get_meal(tx, &req.meal.id)?
                .ok_or_else(|| HealthError::archive_lifecycle("meal missing after metadata update"))?;
            Ok(MealResponse { meal })
        })
    }).map_err(map_coordinator_err)
}

pub fn delete_meal(data_dir: &str, req: DeleteMealRequest) -> HealthResult<MealResponse> {
    crate::productivity_db::coordinator::with_write_expected(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let existing = repository::get_meal(tx, &req.meal.id)?
                .ok_or_else(|| HealthError::root_not_found("meal not found"))?;
            if existing.deleted_at.is_some() {
                Err(HealthError::root_deleted("meal is deleted"))?;
            }
            if existing.revision != req.meal.expected_revision {
                Err(HealthError::revision_conflict("meal revision mismatch"))?;
            }
            repository::soft_delete_meal(tx, &req.meal.id, existing.revision + 1)?;
            let meal = repository::get_meal(tx, &req.meal.id)?
                .ok_or_else(|| HealthError::archive_lifecycle("meal missing after delete"))?;
            Ok(MealResponse { meal })
        })
    })
    .map_err(map_coordinator_err)
}

pub fn get_meal(data_dir: &str, id: &str) -> HealthResult<MealResponse> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let meal = repository::get_meal(conn, id)?
                .ok_or_else(|| HealthError::root_not_found("meal not found"))?;
            MealResponse { meal }
        })
    })
    .map_err(map_coordinator_err)
}

pub fn list_meals(data_dir: &str, query: ListMealsQuery) -> HealthResult<MealsListResponse> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let meals = repository::list_meals(
                conn,
                query.local_date_from.as_deref(),
                query.local_date_to.as_deref(),
                query.include_deleted,
            )?;
            MealsListResponse { meals }
        })
    })
    .map_err(map_coordinator_err)
}

pub fn search_meal_foods(data_dir: &str, query: SearchMealFoodsQuery) -> HealthResult<SearchMealFoodsResponse> {
    let needle = query.text.trim();
    if needle.is_empty() {
        return Err(HealthError::invalid_patch("text is required"));
    }
    let slot = query.slot.as_deref().map(str::trim).map(str::to_string);
    if slot.as_deref().is_some_and(|s| !matches!(s, "breakfast" | "lunch" | "dinner" | "late_night" | "coffee" | "beverage" | "snack" | "other")) {
        return Err(HealthError::meal_slot_invalid());
    }
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        Ok({
            let conn = conn.ok_or_else(|| HealthError::archive_lifecycle("archive not initialized"))?;
            let meals = repository::search_meals_by_food_text(
                conn,
                needle,
                query.local_date_from.as_deref(),
                query.local_date_to.as_deref(),
                slot.as_deref(),
            )?;
            SearchMealFoodsResponse { meals }
        })
    })
    .map_err(map_coordinator_err)
}

pub fn sync_meals_from_journal_json(
    _data_dir: &str,
    _date: &str,
    _meals: serde_json::Value,
) -> HealthResult<()> {
    Ok(())
}

fn map_coordinator_err(e: crate::productivity_db::DomainError) -> HealthError {
    HealthError::new(e.code, e.message)
}
