use crate::ticktick;

#[tauri::command]
pub fn ticktick_auth_status(app: tauri::AppHandle) -> Result<ticktick::TicktickAuthStatus, String> {
    ticktick::ticktick_auth_status(app)
}

#[tauri::command]
pub fn ticktick_begin_oauth(app: tauri::AppHandle) -> Result<String, String> {
    ticktick::ticktick_begin_oauth(app)
}

#[tauri::command]
pub async fn ticktick_finish_oauth(
    app: tauri::AppHandle,
) -> Result<ticktick::TicktickAuthStatus, String> {
    ticktick::ticktick_finish_oauth(app).await
}

#[tauri::command]
pub async fn ticktick_connect(app: tauri::AppHandle) -> Result<ticktick::TicktickAuthStatus, String> {
    ticktick::ticktick_connect(app).await
}

#[tauri::command]
pub fn ticktick_disconnect(app: tauri::AppHandle) -> Result<ticktick::TicktickAuthStatus, String> {
    ticktick::ticktick_disconnect(app)
}

#[tauri::command]
pub async fn ticktick_list_projects(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    ticktick::ticktick_list_projects(app).await
}

#[tauri::command]
pub async fn ticktick_filter_tasks(
    app: tauri::AppHandle,
    req: ticktick::TicktickFilterTasksRequest,
) -> Result<serde_json::Value, String> {
    ticktick::ticktick_filter_tasks(app, req).await
}

#[tauri::command]
pub async fn ticktick_create_task(
    app: tauri::AppHandle,
    req: ticktick::TicktickCreateTaskRequest,
) -> Result<serde_json::Value, String> {
    ticktick::ticktick_create_task(app, req).await
}

#[tauri::command]
pub async fn ticktick_update_task(
    app: tauri::AppHandle,
    task_id: String,
    req: ticktick::TicktickUpdateTaskRequest,
) -> Result<serde_json::Value, String> {
    ticktick::ticktick_update_task(app, task_id, req).await
}

#[tauri::command]
pub async fn ticktick_complete_task(
    app: tauri::AppHandle,
    project_id: String,
    task_id: String,
) -> Result<(), String> {
    ticktick::ticktick_complete_task(app, project_id, task_id).await
}

#[tauri::command]
pub async fn ticktick_reopen_task(
    app: tauri::AppHandle,
    project_id: String,
    task_id: String,
) -> Result<(), String> {
    ticktick::ticktick_reopen_task(app, project_id, task_id).await
}

#[tauri::command]
pub async fn ticktick_delete_task(
    app: tauri::AppHandle,
    project_id: String,
    task_id: String,
) -> Result<(), String> {
    ticktick::ticktick_delete_task(app, project_id, task_id).await
}
