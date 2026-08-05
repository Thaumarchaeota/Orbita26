use crate::data::ChatMessage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::AppHandle;

static ABORT_FLAGS: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

fn register_abort(request_id: &str, flag: Arc<AtomicBool>) {
    let mut guard = ABORT_FLAGS.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard.as_mut().unwrap().insert(request_id.to_string(), flag);
}

fn cleanup_abort(request_id: &str) {
    let mut guard = ABORT_FLAGS.lock().unwrap();
    if let Some(map) = guard.as_mut() {
        map.remove(request_id);
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiStreamEvent {
    Chunk { content: String },
    ToolStart { name: String, label: String },
    ToolConfirm {
        confirm_id: String,
        name: String,
        label: String,
        args: serde_json::Value,
    },
    ToolDone { name: String, ok: bool, summary: String },
    Done,
    Error { message: String },
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub request_id: String,
    pub messages: Vec<ChatMessage>,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

pub fn chat_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

pub async fn chat_stream(
    app: AppHandle,
    req: AiChatRequest,
    on_event: Channel<AiStreamEvent>,
) -> Result<(), String> {
    if req.api_key.trim().is_empty() {
        let _ = on_event.send(AiStreamEvent::Error {
            message: "请先在设置中填写 API Key".into(),
        });
        return Ok(());
    }

    let flag = Arc::new(AtomicBool::new(false));
    register_abort(&req.request_id, flag.clone());

    let result = crate::agent::run(app, req.clone(), flag.clone(), on_event.clone()).await;

    cleanup_abort(&req.request_id);
    result
}

pub fn abort(request_id: String) {
    let guard = ABORT_FLAGS.lock().unwrap();
    if let Some(map) = guard.as_ref() {
        if let Some(flag) = map.get(&request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}
