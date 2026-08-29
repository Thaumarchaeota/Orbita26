use crate::data::ChatMessage;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTitleRequest {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub user_message: String,
    pub assistant_message: String,
}

fn clamp_title(raw: &str) -> String {
    let t = raw
        .trim()
        .trim_matches(|c| {
            c == '"' || c == '\'' || c == '「' || c == '」' || c == '『' || c == '』'
        })
        .trim();
    let chars: Vec<char> = t.chars().collect();
    if chars.len() <= 8 {
        t.to_string()
    } else {
        chars[..8].iter().collect()
    }
}

fn trunc_chars(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        s.to_string()
    } else {
        let mut out: String = chars[..max].iter().collect();
        out.push('…');
        out
    }
}

pub async fn generate_title(req: AiTitleRequest) -> Result<String, String> {
    if req.api_key.trim().is_empty() {
        return Err("请先在设置中填写 API Key".into());
    }
    let user = req.user_message.trim();
    if user.is_empty() {
        return Err("用户消息为空".into());
    }
    let assistant = trunc_chars(req.assistant_message.trim(), 400);
    let body = json!({
        "model": req.model,
        "messages": [
            {
                "role": "system",
                "content": "根据对话生成标题，不超过8个中文字，不要引号标点，只输出标题本身。"
            },
            {
                "role": "user",
                "content": format!("用户：{user}\n助手：{assistant}")
            }
        ],
        "max_tokens": 24,
        "temperature": 0.3,
        "stream": false
    });
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let url = chat_url(&req.base_url);
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", req.api_key.trim()))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }
    let parsed: Value = response.json().await.map_err(|e| e.to_string())?;
    let text = parsed
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .trim();
    if text.is_empty() {
        return Err("API 未返回标题".into());
    }
    Ok(clamp_title(text))
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
