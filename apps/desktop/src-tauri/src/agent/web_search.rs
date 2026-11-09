use crate::data::{read_settings, ApiEntry};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

const SEARCH_MODEL: &str = "gpt-5-search-api";

pub fn validate_public_query(raw: &str) -> Result<&str, String> {
    let query = raw.trim();
    let lower = query.to_lowercase();
    let forbidden = ["我的", "本地", "记录", "附件", "文件", "路径", "账单", "密码", "密钥", "令牌", "orbita", "token", "api_key", "apikey", "password", "secret", "bearer", "file:", "http:", "https:"];
    if query.is_empty() || query.chars().count() > 160
        || query.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | '@' | '{' | '}'))
        || forbidden.iter().any(|word| lower.contains(word))
        || query.split_whitespace().any(|part| part.chars().filter(char::is_ascii_digit).count() >= 12)
    {
        return Err("搜索词须是简短的公开问题，不能包含本地记录、路径或凭据".into());
    }
    Ok(query)
}

fn has_weather_intent(text: &str) -> bool {
    let lower = text.to_lowercase();
    if ["天气", "气温", "下雨", "降雨", "降雪"].iter().any(|word| lower.contains(word)) {
        return true;
    }
    lower.split(|c: char| !c.is_ascii_alphabetic()).any(|word| matches!(word,
        "weather" | "forecast" | "rain" | "raining" | "rainy" | "rainfall"
        | "snow" | "snowing" | "snowy" | "snowfall"))
}

pub(super) fn validate_weather_location(user_text: &str, query: &str, location: Option<&str>) -> Result<(), String> {
    let user_lower = user_text.to_lowercase();
    let query_lower = query.to_lowercase();
    if !has_weather_intent(user_text) && !has_weather_intent(query) {
        return Ok(());
    }
    let location = location.unwrap_or("").trim();
    let location_lower = location.to_lowercase();
    let generic = ["今天", "今日", "明天", "后天", "现在", "近期", "当地", "附近", "这里", "哪里", "哪儿", "天气", "气温", "温度", "下雨", "降雨", "降雪", "如何", "怎么样", "多少", "预报", "本地", "周末", "today", "tomorrow", "weather", "temperature", "forecast", "here", "local"];
    if location.chars().count() < 2 || location.chars().count() > 40
        || !location.chars().all(|c| c.is_alphabetic() || matches!(c, ' ' | '-' | ',' | '.'))
        || generic.iter().any(|word| location_lower.contains(word))
        || !user_lower.contains(&location_lower)
        || !query_lower.contains(&location_lower)
    {
        return Err("请告诉我你想查询哪个城市或地区的天气。".into());
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSource {
    pub title: String,
    pub url: String,
}

pub struct SearchResult {
    pub summary: String,
    pub sources: Vec<WebSource>,
}

fn search_entry(app: &AppHandle) -> Result<ApiEntry, String> {
    let config = read_settings(app)?.ai;
    let entry = if config.search_entry_id.is_empty() {
        config.entries.iter().find(|entry| !entry.api_key.trim().is_empty() && valid_search_endpoint(&entry.base_url).is_ok())
    } else {
        config.entries.iter().find(|entry| entry.id == config.search_entry_id)
    };
    let entry = entry.ok_or("请在 AI 设置中选择 ChatAnywhere 搜索 API")?;
    valid_search_endpoint(&entry.base_url)?;
    if entry.api_key.trim().is_empty() {
        return Err("ChatAnywhere 搜索 API 尚未填写 Key".into());
    }
    Ok(entry.clone())
}

// docs/decisions/integrations.md: credentials stay with the selected local API entry.
// Pin the destination before adding Authorization; a user-editable base URL must not receive this Key.
pub fn valid_search_endpoint(base_url: &str) -> Result<Url, String> {
    let parsed = Url::parse(base_url.trim()).map_err(|_| "搜索 API 地址无效")?;
    if parsed.scheme() != "https"
        || parsed.port().is_some()
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !matches!(parsed.host_str(), Some("api.chatanywhere.tech" | "api.chatanywhere.org"))
        || !matches!(parsed.path(), "" | "/" | "/v1" | "/v1/")
    {
        return Err("搜索 API 须使用 ChatAnywhere 官方 HTTPS 地址".into());
    }
    Url::parse(&format!("https://{}/v1/chat/completions", parsed.host_str().unwrap()))
        .map_err(|_| "搜索 API 地址无效".into())
}

pub(super) fn sources_from_response(value: &Value) -> Vec<WebSource> {
    let annotations = value.pointer("/choices/0/message/annotations")
        .and_then(Value::as_array);
    let mut sources = Vec::new();
    for item in annotations.into_iter().flatten() {
        if item.get("type").and_then(Value::as_str) != Some("url_citation") {
            continue;
        }
        let Some(citation) = item.get("url_citation") else { continue };
        let Some(raw_url) = citation.get("url").and_then(Value::as_str) else { continue };
        let Ok(url) = Url::parse(raw_url) else { continue };
        let Some(host) = url.host_str() else { continue };
        if url.scheme() != "https" || url.username() != "" || url.password().is_some()
            || raw_url.len() > 2048 || host.parse::<std::net::IpAddr>().is_ok()
            || (host.starts_with('[') && host.ends_with(']'))
            || host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost")
            || host.ends_with(".local") || host.ends_with(".internal") {
            continue;
        }
        let title = citation.get("title").and_then(Value::as_str).unwrap_or(url.host_str().unwrap());
        if sources.iter().any(|source: &WebSource| source.url == raw_url) { continue; }
        sources.push(WebSource { title: title.chars().take(180).collect(), url: raw_url.to_string() });
        if sources.len() == 8 { break; }
    }
    sources
}

fn json_kind(value: Option<&Value>) -> &'static str {
    match value {
        None => "missing",
        Some(Value::Null) => "null",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
        Some(Value::String(_)) => "string",
        Some(Value::Number(_)) => "number",
        Some(Value::Bool(_)) => "boolean",
    }
}

fn log_missing_citation_shape(body: &Value) {
    let annotations = body.pointer("/choices/0/message/annotations");
    let annotation_count = annotations.and_then(Value::as_array).map(Vec::len).unwrap_or(0);
    let citation_count = annotations.and_then(Value::as_array).map(|items| items.iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("url_citation")).count()).unwrap_or(0);
    // No Key, query, URLs, response text or annotation values enter diagnostics.
    eprintln!("web_search_no_structured_citations status=200 annotations_kind={} annotations_count={} url_citation_count={} model_present={} finish_reason_present={}",
        json_kind(annotations), annotation_count, citation_count,
        body.get("model").is_some(), body.pointer("/choices/0/finish_reason").is_some());
}

async fn await_or_abort<T>(future: impl std::future::Future<Output = Result<T, reqwest::Error>>, flag: &AtomicBool) -> Result<Option<T>, String> {
    tokio::pin!(future);
    loop {
        if flag.load(Ordering::Relaxed) { return Ok(None); }
        tokio::select! {
            result = &mut future => return result.map(Some).map_err(|e| format!("网页搜索请求失败: {e}")),
            _ = tokio::time::sleep(std::time::Duration::from_millis(50)) => {},
        }
    }
}

pub async fn search(app: &AppHandle, question: &str, flag: &AtomicBool) -> Result<Option<SearchResult>, String> {
    let question = validate_public_query(question)?;
    let entry = search_entry(app)?;
    let endpoint = valid_search_endpoint(&entry.base_url)?;
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(25))
        .build().map_err(|e| format!("网页搜索客户端初始化失败: {e}"))?;
    // docs/decisions/integrations.md: only a bounded public query crosses this boundary; local records, history, tools and the main model Key stay local.
    let response = await_or_abort(client.post(endpoint)
        .bearer_auth(entry.api_key.trim())
        .json(&json!({"model": SEARCH_MODEL, "messages": [{"role": "user", "content": question}], "web_search_options": {}}))
        .send(), flag).await?;
    let Some(response) = response else { return Ok(None) };
    if !response.status().is_success() {
        return Err(format!("网页搜索失败（HTTP {}）", response.status().as_u16()));
    }
    let body = await_or_abort(response.json::<Value>(), flag).await?;
    let Some(body) = body else { return Ok(None) };
    let sources = sources_from_response(&body);
    if sources.is_empty() {
        log_missing_citation_shape(&body);
        return Err("网页搜索未返回可展示的结构化引用，无法核验来源".into());
    }
    let summary = body.pointer("/choices/0/message/content")
        .and_then(Value::as_str).unwrap_or("").chars().take(5000).collect::<String>();
    if summary.trim().is_empty() { return Err("网页搜索未返回摘要".into()); }
    Ok(Some(SearchResult { summary, sources }))
}
