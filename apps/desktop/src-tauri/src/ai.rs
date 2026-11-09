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
    Connected,
    Chunk { content: String },
    Reasoning { content: String },
    SearchStart,
    SearchDone { sources: Vec<crate::agent::web_search::WebSource> },
    SearchError { message: String },
    ToolStart { name: String, label: String },
    ToolConfirm {
        confirm_id: String,
        name: String,
        label: String,
        args: serde_json::Value,
    },
    ToolDone { name: String, ok: bool, summary: String },
    Finish {
        reason: Option<String>,
        usage: Option<StreamUsageInfo>,
    },
    Done,
    Error { message: String },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamUsageInfo {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiEntryPoint {
    Panel,
    Insight,
}

impl Default for AiEntryPoint {
    fn default() -> Self {
        Self::Panel
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub request_id: String,
    pub messages: Vec<ChatMessage>,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub entry_point: AiEntryPoint,
    #[serde(default)]
    pub thinking_effort: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTitleRequest {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub user_message: String,
    #[serde(default)]
    pub assistant_message: String,
    #[serde(default)]
    pub current_title: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCompleteRequest {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub system: String,
    pub user: String,
}

fn clamp_title(raw: &str) -> String {
    let t: String = raw
        .trim()
        .trim_matches(|c: char| {
            c == '"'
                || c == '\''
                || c == '「'
                || c == '」'
                || c == '『'
                || c == '』'
                || c == '“'
                || c == '”'
                || c == '‘'
                || c == '’'
        })
        .chars()
        .filter(|c| !matches!(c, '。' | '，' | '、' | '！' | '？' | '.' | ',' | '!' | '?' | ':' | '：' | ';' | '；'))
        .collect();
    let t = t.trim();
    let chars: Vec<char> = t.chars().collect();
    if chars.len() <= 8 {
        t.to_string()
    } else {
        chars[..8].iter().collect()
    }
}

fn title_from_response(parsed: &Value) -> Result<String, String> {
    let content = parsed
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let title = clamp_title(content);
    if title.is_empty() || title == "新对话" {
        return Err("API 未返回有效标题".into());
    }
    Ok(title)
}

pub async fn generate_title(req: AiTitleRequest) -> Result<String, String> {
    if req.api_key.trim().is_empty() {
        return Err("请先在设置中填写 API Key".into());
    }
    let transcript = req.user_message.trim();
    if transcript.is_empty() {
        return Err("对话为空".into());
    }
    let current = req.current_title.trim();
    let current_line = if current.is_empty() {
        "当前标题：（无）".to_string()
    } else {
        format!("当前标题：{current}")
    };
    let body = json!({
        "model": req.model,
        "messages": [
            {
                "role": "system",
                "content": format!(
                    "你是会话标题生成器。根据截至当前的完整对话，生成一个4–8字的中文标题。\n\n规则：\n1. 标题必须是具体话题，而非对用户意图或模型任务的描述\n2. 禁止出现「用户要求」「用户需要」「我们需要」「根据对话」等元叙述\n3. 忽略寒暄、系统指令、助手能力介绍和推理内容\n4. 已有标题若仍准确概括当前主题且不超过8字，原样输出该标题；主题已变化或原标题过长则输出新标题\n5. 信息不足时直接使用「新对话」，禁止臆测\n6. 只输出最终标题，不输出思考过程、解释或标点\n\n{current_line}"
                )
            },
            {
                "role": "user",
                "content": transcript
            }
        ],
        "max_tokens": 48,
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
    title_from_response(&parsed)
}

#[cfg(test)]
mod title_tests {
    use super::title_from_response;
    use serde_json::json;

    #[test]
    fn title_uses_only_message_content() {
        assert_eq!(
            title_from_response(&json!({"choices": [{"message": {"content": "荣耀手机评测", "reasoning_content": "错误标题"}}]})).unwrap(),
            "荣耀手机评测"
        );
        assert!(title_from_response(&json!({"choices": [{"message": {"content": "", "reasoning_content": "错误标题"}}]})).is_err());
        assert!(title_from_response(&json!({"choices": [{"message": {"content": ["错误标题"]}}]})).is_err());
        assert!(title_from_response(&json!({"choices": [{"message": {"content": "新对话"}}]})).is_err());
    }

    #[test]
    fn title_is_at_most_eight_characters() {
        assert_eq!(
            title_from_response(&json!({"choices": [{"message": {"content": "荣耀手机相机评测比较"}}]})).unwrap(),
            "荣耀手机相机评测"
        );
    }
}

pub async fn complete(req: AiCompleteRequest) -> Result<String, String> {
    if req.api_key.trim().is_empty() {
        return Err("请先在设置中填写 API Key".into());
    }
    let body = json!({
        "model": req.model,
        "messages": [
            { "role": "system", "content": req.system },
            { "role": "user", "content": req.user }
        ],
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
        return Err("API 未返回内容".into());
    }
    Ok(text.to_string())
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
