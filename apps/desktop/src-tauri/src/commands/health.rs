use crate::health_db;

#[tauri::command]
pub fn health_create_meal(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::MealResponse, String> {
    // Existing callers omit the context; week creation binds its captured owner.
    let expected=req.get("expectedDataDir").and_then(|v|v.as_str()).map(str::to_owned);
    if let Some(expected) = &expected { if crate::data::get_data_dir(&app)? != *expected { return Err("数据目录已切换".into()); } }
    let parsed: health_db::CreateMealRequest = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    if let Some(expected)=expected { health_db::create_meal(&expected,parsed).map_err(String::from) } else {health_db::create_meal_app(&app, parsed)}
}

#[tauri::command]
pub fn health_update_meal(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::MealResponse, String> {
    let root = crate::data::get_data_dir(&app)?;
    if let Some(expected) = req.get("expectedDataDir").and_then(|v| v.as_str()) {
        if expected != root { return Err("数据目录已切换，操作已取消".into()); }
    }
    let parsed: health_db::UpdateMealRequest = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    health_db::update_meal(&root, parsed).map_err(String::from)
}

#[tauri::command]
pub fn health_update_meal_metadata(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::MealResponse, String> {
    let root = crate::data::get_data_dir(&app)?;
    let parsed: health_db::UpdateMealMetadataRequest = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    if parsed.expected_data_dir != root { return Err("数据目录已切换，操作已取消".into()); }
    health_db::update_meal_metadata(&root, parsed).map_err(String::from)
}

#[tauri::command]
pub fn health_delete_meal(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::MealResponse, String> {
    let root = crate::data::get_data_dir(&app)?;
    if let Some(expected) = req.get("expectedDataDir").and_then(|v| v.as_str()) {
        if expected != root { return Err("数据目录已切换，操作已取消".into()); }
    }
    let parsed: health_db::DeleteMealRequest = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    health_db::delete_meal(&root, parsed).map_err(String::from)
}

#[tauri::command]
pub fn health_list_meals(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::MealsListResponse, String> {
    let parsed: health_db::ListMealsQuery = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    health_db::list_meals_app(&app, parsed)
}

#[tauri::command]
pub fn health_get_meal(app: tauri::AppHandle, req: serde_json::Value) -> Result<health_db::MealResponse, String> {
    let id = req
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "id required".to_string())?;
    health_db::get_meal_app(&app, id)
}

#[tauri::command]
pub fn health_search_meal_foods(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::SearchMealFoodsResponse, String> {
    let parsed: health_db::SearchMealFoodsQuery = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    health_db::search_meal_foods_app(&app, parsed)
}

#[tauri::command]
pub fn health_get_health_root(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::read::HealthRootResponse, String> {
    let parsed: health_db::read::GetHealthRootRequest = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    health_db::get_health_root_app(&app, parsed)
}

#[tauri::command]
pub fn health_list_garmin_sync_runs(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::read::ListGarminSyncRunsResponse, String> {
    let parsed: health_db::read::ListGarminSyncRunsQuery = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    health_db::list_garmin_sync_runs_app(&app, parsed)
}

#[tauri::command]
pub fn health_get_garmin_sync_run(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::read::GetGarminSyncRunResponse, String> {
    let run_id = req
        .get("runId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "runId required".to_string())?;
    health_db::get_garmin_sync_run_app(&app, run_id)
}

#[tauri::command]
pub fn health_list_activities(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::ActivitiesListResponse, String> {
    let parsed: health_db::ListActivitiesQuery = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    health_db::list_activities_app(&app, parsed)
}

#[tauri::command]
pub fn health_get_activity(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::ActivityDetailResponse, String> {
    let id = req
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "id required".to_string())?;
    health_db::get_activity_app(&app, id)
}

#[tauri::command]
pub fn health_read_activity_asset(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::ReadActivityAssetResponse, String> {
    let parsed: health_db::ReadActivityAssetRequest = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    health_db::read_activity_asset_app(&app, parsed)
}

#[tauri::command]
pub fn health_retry_activity_original(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<(), String> {
    let parsed: health_db::RetryOriginalDownloadRequest = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    health_db::retry_activity_original_app(&app, parsed)
}

#[tauri::command]
pub fn health_apply_ai_batch(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<health_db::ApplyHealthAiBatchResponse, String> {
    let root = crate::data::get_data_dir(&app)?;
    let parsed: health_db::ApplyHealthAiBatchRequest = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    if let Some(expected) = &parsed.expected_data_dir {
        if expected != &root {
            return Err("数据目录已切换，操作已取消".to_string());
        }
    }
    health_db::apply_health_ai_batch(&root, parsed).map_err(String::from)
}

#[tauri::command]
pub fn health_export_activity_fit(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<(), String> {
    let parsed: health_db::ExportFitFromZipRequest = serde_json::from_value(req)
        .map_err(|e| format!("invalid request: {e}"))?;
    let root = crate::data::get_data_dir(&app)?;
    crate::data::ensure_under_dir(&parsed.output_path, std::path::Path::new(&root))?;
    health_db::export_activity_fit_app(&app, parsed)
}
