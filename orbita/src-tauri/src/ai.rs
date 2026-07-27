use crate::data::ChatMessage;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

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
    Done,
    Error { message: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub request_id: String,
    pub messages: Vec<ChatMessage>,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Serialize)]
struct ApiMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct ApiBody<'a> {
    model: &'a str,
    messages: Vec<ApiMessage<'a>>,
    stream: bool,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: Option<StreamDelta>,
}

#[derive(Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Deserialize)]
struct StreamChunk {
    choices: Option<Vec<StreamChoice>>,
}

fn chat_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/chat/completions")
    }
}

pub async fn chat_stream(
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

    let url = chat_url(&req.base_url);
    let api_messages: Vec<ApiMessage> = req
        .messages
        .iter()
        .map(|m| ApiMessage {
            role: &m.role,
            content: &m.content,
        })
        .collect();

    let body = ApiBody {
        model: &req.model,
        messages: api_messages,
        stream: true,
    };

    let client = Client::builder()
        .build()
        .map_err(|e| e.to_string())?;

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
        let _ = on_event.send(AiStreamEvent::Error {
            message: format!("HTTP {status}: {text}"),
        });
        cleanup_abort(&req.request_id);
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        if flag.load(Ordering::Relaxed) {
            break;
        }
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find("\n\n") {
            let block = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();
            for line in block.lines() {
                let line = line.trim();
                if !line.starts_with("data:") {
                    continue;
                }
                let data = line.trim_start_matches("data:").trim();
                if data == "[DONE]" {
                    let _ = on_event.send(AiStreamEvent::Done);
                    cleanup_abort(&req.request_id);
                    return Ok(());
                }
                if let Ok(parsed) = serde_json::from_str::<StreamChunk>(data) {
                    if let Some(choices) = parsed.choices {
                        for choice in choices {
                            if let Some(delta) = choice.delta {
                                if let Some(content) = delta.content {
                                    if !content.is_empty() {
                                        let _ = on_event.send(AiStreamEvent::Chunk { content });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = on_event.send(AiStreamEvent::Done);
    cleanup_abort(&req.request_id);
    Ok(())
}

pub fn abort(request_id: String) {
    let guard = ABORT_FLAGS.lock().unwrap();
    if let Some(map) = guard.as_ref() {
        if let Some(flag) = map.get(&request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}
