use crate::dida;

#[tauri::command]
pub fn dida_auth_status(app: tauri::AppHandle) -> Result<dida::DidaAuthStatus, String> {
    dida::dida_auth_status(app)
}

#[tauri::command]
pub fn dida_begin_oauth(app: tauri::AppHandle) -> Result<String, String> {
    dida::dida_begin_oauth(app)
}

#[tauri::command]
pub async fn dida_finish_oauth(app: tauri::AppHandle) -> Result<dida::DidaAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || dida::dida_finish_oauth(app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dida_connect(app: tauri::AppHandle) -> Result<dida::DidaAuthStatus, String> {
    dida::dida_connect(app)
}

#[tauri::command]
pub fn dida_disconnect(app: tauri::AppHandle) -> Result<dida::DidaAuthStatus, String> {
    dida::dida_disconnect(app)
}

#[tauri::command]
pub async fn dida_list_projects(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || dida::dida_list_projects(app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dida_filter_tasks(
    app: tauri::AppHandle,
    req: dida::DidaFilterTasksRequest,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || dida::dida_filter_tasks(app, req))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dida_create_task(
    app: tauri::AppHandle,
    req: dida::DidaCreateTaskRequest,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || dida::dida_create_task(app, req))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dida_update_task(
    app: tauri::AppHandle,
    task_id: String,
    req: dida::DidaUpdateTaskRequest,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || dida::dida_update_task(app, task_id, req))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dida_complete_task(
    app: tauri::AppHandle,
    project_id: String,
    task_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || dida::dida_complete_task(app, project_id, task_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dida_reopen_task(
    app: tauri::AppHandle,
    project_id: String,
    task_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || dida::dida_reopen_task(app, project_id, task_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dida_delete_task(
    app: tauri::AppHandle,
    project_id: String,
    task_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || dida::dida_delete_task(app, project_id, task_id))
        .await
        .map_err(|e| e.to_string())?
}
