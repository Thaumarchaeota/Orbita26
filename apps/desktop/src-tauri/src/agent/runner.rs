use crate::agent::tools::{self, execute as run_tool, start_label};
use crate::agent::register_tool_confirm;
use crate::ai::{chat_url, AiChatRequest, AiStreamEvent};
use crate::data::{read_settings, ChatMessage};
use crate::ticktick;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::AppHandle;
use uuid::Uuid;

const MAX_TOOL_ROUNDS: usize = 5;

#[derive(Deserialize)]
struct ChatResponse {
    choices: Option<Vec<ChatChoice>>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: Option<ChatMessageApi>,
}

#[derive(Deserialize, Clone)]
struct ChatMessageApi {
    role: Option<String>,
    content: Option<Value>,
    tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Deserialize, Clone)]
struct ToolCall {
    id: String,
    #[serde(rename = "type")]
    kind: Option<String>,
    function: ToolFunction,
}

#[derive(Deserialize, Clone)]
struct ToolFunction {
    name: String,
    arguments: String,
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

fn build_agent_system_prompt(app: &AppHandle) -> String {
    let connected = ticktick::ticktick_auth_status(app.clone())
        .map(|s| s.connected)
        .unwrap_or(false);
    let settings = read_settings(app).ok();
    let project_id = settings
        .as_ref()
        .map(|s| s.integrations.ticktick.default_project_id.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("inbox");
    let garmin_line = match crate::garmin::garmin_status(&app) {
        Ok(s) if s.logged_in => "佳明：已登录，可 garmin_sync；勿主动 garmin_login。".to_string(),
        Ok(_) => "佳明：未登录，勿调 garmin_sync；用户要求重新登录时用 garmin_login。".into(),
        Err(_) => "佳明：状态未知。".into(),
    };
    let now_line = super::tools::local_now_line();
    let ticktick_line = if connected {
        format!("滴答清单：已连接，默认清单 projectId={project_id}。")
    } else {
        "滴答清单：未连接，不要调用 ticktick_* 工具，请提示用户去设置 → 任务授权。".into()
    };

    format!(
        "你是 Orbita 桌面助手的 Agent。你可以调用工具帮用户操作本地应用。\n\
         {now_line}\n\
         规则：\n\
         - 仅当用户明确要求时才调用工具；不要编造已执行的操作。\n\
         - 用户描述吃了/喝了什么、要记吃饭/记餐饮时：直接调用 journal_add_meal 弹出确认，勿只用文字追问。\n\
         - journal_add_meal 的 kcal 可先估计（不确定用 confidence: low），勿因热量未确认就不调工具。\n\
         - 路径必须是用户给出的、在磁盘上存在的绝对路径（如 D:\\\\folder\\\\file.txt），不要猜测路径。\n\
         - open_path：用默认程序打开文件/文件夹；reveal_path：仅在资源管理器中定位。\n\
         - 滴答：日期时间一律以「当前本地时间」为准换算；用户说明天9点/10点时，算出 dueOn+dueTime（如 09:00）。\n\
         - ticktick_list_tasks：查询任务（含 dueOn、dueTime、isOverdue）。改/删前先查。\n\
         - 滴答同名多条：列出日期时间请用户确认要操作哪几条，再分别带 taskDueOn+taskDueTime 调用；禁止猜测、禁止为未确认条目新建。\n\
         - ticktick_create_task：仅创建新任务；同名已有多条时勿 create，先问用户。\n\
         - ticktick_update_task / ticktick_delete_task：taskDueOn/taskDueTime 填原截止日期；定位填错会自动重试，仍多条则返回 candidates 等你确认。\n\
         - 滴答改期：只改 dueOn/dueTime 时，startDate 会按相同天数平移；若平移后 start 晚于 due，则与 due 对齐为同一时刻；用户另行指定 start 时以其为准。\n\
         - 生活区：journal_snapshot 查今日摘要；journal_list 查明细；写操作会弹确认框。\n\
         - 睡眠：date 为醒来日；跨夜入睡（如 23:00→07:00）用 journal_set_sleep，系统自动把入睡归到前一天。\n\
         - journal_set_sleep 在当日已有佳明睡眠时会失败，勿尝试覆盖\n\
         - 餐食 id 为 UUID（daily.data.meals[].id），不是 journal/YYYY.json 路径\n\
         - journal_add_meal 未填 at 时默认当前北京时间，无 at 的餐食不会出现在 Health 时间轨道\n\
         - garmin_sync：days 默认 7，用户指定则用其值（1-30）；需已登录。\n\
         - garmin_login：仅用户明确要求重新登录时使用；会触发 SSO。\n\
         - bkeasy_summary 查今日/本月支出；beancount_add_transaction 尚未实现勿假装成功。\n\
         - 吃饭：journal_add_meal / journal_update_meal / journal_delete_meal；热量多为 AI 估计，回答时说明是估计值。\n\
         - 喝水量来自佳明同步，不能用工具记录；用户问喝水时用 journal_snapshot 告知当前 ml。\n\
         {ticktick_line}\n\
         {garmin_line}"
    )
}

fn to_api_messages(messages: &[ChatMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| {
            json!({
                "role": m.role,
                "content": m.content,
            })
        })
        .collect()
}

fn tool_summary(name: &str, ok: bool, result: &str) -> String {
    if !ok {
        return result.to_string();
    }
    if let Ok(v) = serde_json::from_str::<Value>(result) {
        if name.starts_with("ticktick_") {
            if let Some(title) = v.get("title").and_then(|t| t.as_str()) {
                return match name {
                    "ticktick_create_task" => format!("已创建任务：{title}"),
                    "ticktick_update_task" => format!("已修改任务：{title}"),
                    "ticktick_delete_task" => format!("已删除任务：{title}"),
                    _ => format!("{name}：{title}"),
                };
            }
        }
        if name == "open_path" || name == "reveal_path" {
            if let Some(path) = v.get("path").and_then(|p| p.as_str()) {
                return if name == "open_path" {
                    format!("已打开：{path}")
                } else {
                    format!("已定位：{path}")
                };
            }
        }
        if name == "journal_add_event" {
            if let Some(remark) = v.get("remark").and_then(|t| t.as_str()) {
                return format!("已记录事件：{remark}");
            }
        }
        if name == "journal_add_mood" {
            if let Some(data) = v.get("data") {
                let emoji = data.get("emoji").and_then(|t| t.as_str()).unwrap_or("");
                return format!("已记录心情：{emoji}");
            }
        }
        if name == "journal_set_sleep" {
            return "已更新睡眠".into();
        }
        if name == "journal_add_nap" {
            return "已添加午睡".into();
        }
        if name == "journal_delete_entry" {
            if let Some(id) = v.get("deleted").and_then(|t| t.as_str()) {
                return format!("已删除：{id}");
            }
        }
        if name == "journal_add_meal" {
            if let Some(meals) = v
                .get("data")
                .and_then(|d| d.get("meals"))
                .and_then(|m| m.as_array())
            {
                if let Some(meal) = meals.last() {
                    let kcal = meal.get("kcal").and_then(|k| k.as_i64()).unwrap_or(0);
                    let text = meal.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    let items: Vec<&str> = meal
                        .get("items")
                        .and_then(|i| i.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|x| x.as_str())
                                .collect()
                        })
                        .unwrap_or_default();
                    let label = if !text.is_empty() {
                        text.to_string()
                    } else if !items.is_empty() {
                        items.join("、")
                    } else {
                        "餐食".to_string()
                    };
                    return format!("已记录餐食：{label}（{kcal} kcal）");
                }
            }
        }
        if name == "journal_update_meal" {
            return "已更新餐食记录".into();
        }
        if name == "journal_delete_meal" {
            return "已删除餐食记录".into();
        }
        if name == "garmin_sync" {
            if let (Some(d), Some(e)) = (
                v.get("dailyCount").and_then(|t| t.as_u64()),
                v.get("exerciseCount").and_then(|t| t.as_u64()),
            ) {
                return format!("佳明同步完成：{d} 天汇总，{e} 条运动");
            }
        }
        if name == "garmin_login" && v.get("ok").and_then(|t| t.as_bool()) == Some(true) {
            return "佳明登录成功".into();
        }
        if name == "bkeasy_summary" {
            if let (Some(t), Some(m)) = (
                v.get("today").and_then(|t| t.as_f64()),
                v.get("month").and_then(|t| t.as_f64()),
            ) {
                return format!("今日支出 {t:.2} 元，本月 {m:.2} 元");
            }
        }
        if name == "journal_snapshot" || name == "journal_list" {
            return "查询完成".into();
        }
    }
    result.to_string()
}

async fn post_chat(
    client: &Client,
    url: &str,
    api_key: &str,
    model: &str,
    messages: &[Value],
    tools: Option<&[Value]>,
    stream: bool,
) -> Result<reqwest::Response, String> {
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": stream,
    });
    if let Some(t) = tools {
        body["tools"] = json!(t);
        body["tool_choice"] = json!("auto");
    }
    client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))
}

fn check_aborted(flag: &AtomicBool) -> bool {
    flag.load(Ordering::Relaxed)
}

async fn post_chat_abortable(
    client: &Client,
    url: &str,
    api_key: &str,
    model: &str,
    messages: &[Value],
    tools: Option<&[Value]>,
    stream: bool,
    flag: &AtomicBool,
) -> Result<Option<reqwest::Response>, String> {
    let fut = post_chat(client, url, api_key, model, messages, tools, stream);
    tokio::pin!(fut);
    loop {
        if check_aborted(flag) {
            return Ok(None);
        }
        tokio::select! {
            result = &mut fut => return Ok(Some(result?)),
            _ = tokio::time::sleep(std::time::Duration::from_millis(50)) => {},
        }
    }
}

async fn stream_reply(
    client: &Client,
    url: &str,
    api_key: &str,
    model: &str,
    messages: &[Value],
    flag: &AtomicBool,
    on_event: &Channel<AiStreamEvent>,
) -> Result<(), String> {
    let response = match post_chat_abortable(client, url, api_key, model, messages, None, true, flag).await? {
        Some(r) => r,
        None => return Ok(()),
    };
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let _ = on_event.send(AiStreamEvent::Error {
            message: format!("HTTP {status}: {text}"),
        });
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        if check_aborted(flag) {
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
    Ok(())
}

async fn emit_text_chunks(text: &str, on_event: &Channel<AiStreamEvent>) {
    if text.is_empty() {
        return;
    }
    const BATCH: usize = 5;
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let end = (i + BATCH).min(chars.len());
        let content: String = chars[i..end].iter().collect();
        let _ = on_event.send(AiStreamEvent::Chunk { content });
        i = end;
        if i < chars.len() {
            tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        }
    }
}

async fn await_tool_confirm(
    name: &str,
    args: Value,
    on_event: &Channel<AiStreamEvent>,
    flag: &AtomicBool,
) -> Result<Value, String> {
    let confirm_id = Uuid::new_v4().to_string();
    let label = start_label(name);
    let rx = register_tool_confirm(confirm_id.clone());
    let _ = on_event.send(AiStreamEvent::ToolConfirm {
        confirm_id: confirm_id.clone(),
        name: name.to_string(),
        label,
        args,
    });
    tokio::select! {
        res = rx => match res {
            Ok(Ok(edited)) => Ok(edited),
            Ok(Err(reason)) => Err(reason),
            Err(_) => Err("确认已取消".into()),
        },
        _ = async {
            loop {
                if check_aborted(flag) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            let _ = crate::agent::resolve_tool_confirm(&confirm_id, Err("确认已取消".into()));
        } => Err("确认已取消".into()),
    }
}

async fn execute_tool_call(
    app: &AppHandle,
    name: &str,
    args: Value,
    on_event: &Channel<AiStreamEvent>,
    flag: &AtomicBool,
) -> (bool, String) {
    let final_args = if tools::requires_confirm(name) {
        match await_tool_confirm(name, args, on_event, flag).await {
            Ok(a) => a,
            Err(e) => return (false, e),
        }
    } else {
        args
    };

    let _ = on_event.send(AiStreamEvent::ToolStart {
        name: name.to_string(),
        label: start_label(name),
    });

    let app_exec = app.clone();
    let name_exec = name.to_string();
    let exec_result = tauri::async_runtime::spawn_blocking(move || {
        run_tool(&app_exec, &name_exec, final_args)
    })
    .await
    .map_err(|e| format!("工具执行失败: {e}"));

    match exec_result {
        Ok(Ok(r)) => (true, r),
        Ok(Err(e)) => (false, e),
        Err(e) => (false, e),
    }
}

pub async fn run(
    app: AppHandle,
    req: AiChatRequest,
    flag: Arc<AtomicBool>,
    on_event: Channel<AiStreamEvent>,
) -> Result<(), String> {
    let url = chat_url(&req.base_url);
    let client = Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let tools_schema = tools::tool_schemas();

    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": build_agent_system_prompt(&app),
    })];
    messages.extend(to_api_messages(&req.messages));

    for _ in 0..MAX_TOOL_ROUNDS {
        if check_aborted(&flag) {
            let _ = on_event.send(AiStreamEvent::Done);
            return Ok(());
        }

        let response = match post_chat_abortable(
            &client,
            &url,
            &req.api_key,
            &req.model,
            &messages,
            Some(&tools_schema),
            false,
            &flag,
        )
        .await?
        {
            Some(r) => r,
            None => {
                let _ = on_event.send(AiStreamEvent::Done);
                return Ok(());
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            let _ = on_event.send(AiStreamEvent::Error {
                message: format!("HTTP {status}: {text}"),
            });
            return Ok(());
        }

        let parsed: ChatResponse = response.json().await.map_err(|e| e.to_string())?;
        let Some(choice) = parsed.choices.and_then(|c| c.into_iter().next()) else {
            let _ = on_event.send(AiStreamEvent::Error {
                message: "API 响应无 choices".into(),
            });
            return Ok(());
        };
        let Some(msg) = choice.message else {
            let _ = on_event.send(AiStreamEvent::Error {
                message: "API 响应无 message".into(),
            });
            return Ok(());
        };

        if let Some(tool_calls) = msg.tool_calls.filter(|t| !t.is_empty()) {
            let assistant_content = msg
                .content
                .as_ref()
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            let mut tool_calls_json = Vec::new();
            for call in &tool_calls {
                tool_calls_json.push(json!({
                    "id": call.id,
                    "type": call.kind.as_deref().unwrap_or("function"),
                    "function": {
                        "name": call.function.name,
                        "arguments": call.function.arguments,
                    }
                }));
            }

            messages.push(json!({
                "role": "assistant",
                "content": if assistant_content.is_empty() { Value::Null } else { json!(assistant_content) },
                "tool_calls": tool_calls_json,
            }));

            for call in tool_calls {
                if check_aborted(&flag) {
                    let _ = on_event.send(AiStreamEvent::Done);
                    return Ok(());
                }

                let name = call.function.name.clone();
                let args: Value = serde_json::from_str(&call.function.arguments)
                    .unwrap_or_else(|_| json!({}));

                let (ok, result) = execute_tool_call(&app, &name, args, &on_event, &flag).await;

                let summary = tool_summary(&name, ok, &result);
                let _ = on_event.send(AiStreamEvent::ToolDone {
                    name: name.clone(),
                    ok,
                    summary: summary.clone(),
                });

                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": if ok { result } else { format!("错误: {result}") },
                }));
            }
            continue;
        }

        let text = msg
            .content
            .as_ref()
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        if !text.is_empty() {
            emit_text_chunks(&text, &on_event).await;
            let _ = on_event.send(AiStreamEvent::Done);
            return Ok(());
        }

        break;
    }

    stream_reply(
        &client,
        &url,
        &req.api_key,
        &req.model,
        &messages,
        &flag,
        &on_event,
    )
    .await
}
