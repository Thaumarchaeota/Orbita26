use serde::Deserialize;

use crate::agent;
use crate::ai;

#[tauri::command]
pub async fn ai_chat_stream(
    app: tauri::AppHandle,
    request: ai::AiChatRequest,
    on_event: tauri::ipc::Channel<ai::AiStreamEvent>,
) -> Result<(), String> {
    ai::chat_stream(app, request, on_event).await
}

#[tauri::command]
pub fn ai_chat_abort(request_id: String) {
    ai::abort(request_id);
}

#[tauri::command]
pub async fn ai_generate_title(request: ai::AiTitleRequest) -> Result<String, String> {
    ai::generate_title(request).await
}

#[tauri::command]
pub async fn ai_complete(request: ai::AiCompleteRequest) -> Result<String, String> {
    ai::complete(request).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolConfirmRequest {
    confirm_id: String,
    args: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolRejectRequest {
    confirm_id: String,
    reason: Option<String>,
}

#[tauri::command]
pub fn agent_tool_confirm(req: AgentToolConfirmRequest) -> Result<(), String> {
    agent::resolve_tool_confirm(&req.confirm_id, Ok(req.args))
}

#[tauri::command]
pub fn agent_tool_reject(req: AgentToolRejectRequest) -> Result<(), String> {
    agent::resolve_tool_confirm(
        &req.confirm_id,
        Err(req.reason.unwrap_or_else(|| "用户已取消".into())),
    )
}
