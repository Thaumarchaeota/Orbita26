use crate::data::{read_settings, write_settings, AppSettings, TicktickIntegration};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use url::form_urlencoded;
use url::Url;

static OAUTH_LISTENER: Mutex<Option<TcpListener>> = Mutex::new(None);
static OAUTH_CFG: Mutex<Option<TicktickIntegration>> = Mutex::new(None);

const AUTH_URL: &str = "https://dida365.com/oauth/authorize";
const TOKEN_URL: &str = "https://dida365.com/oauth/token";
const API_BASE: &str = "https://api.dida365.com/open/v1";
const SCOPE: &str = "tasks:read tasks:write";
const DEFAULT_PORT: u16 = 8765;
const DEFAULT_TICKTICK_CLIENT_ID: &str = "m5iR14msV0KXA5fDYt";
const DEFAULT_TICKTICK_CLIENT_SECRET: &str = "QsjOxN217ijYZAPOH4GnZJxiyCVdp7s1";
const DEFAULT_TICKTICK_REDIRECT: &str = "http://127.0.0.1:8765/callback";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DidaAuthStatus {
    pub connected: bool,
}

fn ticktick_cfg(settings: &AppSettings) -> TicktickIntegration {
    settings.integrations.ticktick.clone()
}

fn save_token(app: &AppHandle, token: String) -> Result<(), String> {
    let mut settings = read_settings(app)?;
    settings.integrations.ticktick.access_token = token;
    write_settings(app, settings)
}

fn api_get(token: &str, path: &str) -> Result<Value, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(format!("{API_BASE}{path}"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("API {status}: {body}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("解析失败: {e}"))
}

fn api_post(token: &str, path: &str, body: &Value) -> Result<Value, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("{API_BASE}{path}"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("API {status}: {text}"));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("解析失败: {e}"))
}

fn api_delete(token: &str, path: &str) -> Result<(), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .delete(format!("{API_BASE}{path}"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let body = resp.text().unwrap_or_default();
    Err(format!("API {status}: {body}"))
}

fn open_browser(app: &AppHandle, url: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("打开浏览器失败: {e}"))
}

pub fn dida_begin_oauth(app: AppHandle) -> Result<String, String> {
    let settings = read_settings(&app)?;
    let cfg = effective_cfg(&ticktick_cfg(&settings));
    let mut save = settings.clone();
    save.integrations.ticktick = cfg.clone();
    write_settings(&app, save)?;
    let port = redirect_port(&cfg.redirect_uri);
    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
        .map_err(|e| format!("无法监听端口 {port}，请关闭占用该端口的程序后重试: {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;
    *OAUTH_LISTENER.lock().map_err(|e| e.to_string())? = Some(listener);
    *OAUTH_CFG.lock().map_err(|e| e.to_string())? = Some(cfg.clone());
    Ok(auth_url(&cfg))
}

pub fn dida_finish_oauth(app: AppHandle) -> Result<DidaAuthStatus, String> {
    let listener = OAUTH_LISTENER
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "OAuth 未开始".to_string())?;
    let cfg = OAUTH_CFG
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "OAuth 配置丢失".to_string())?;
    let code = wait_oauth_code_on(listener)?;
    let token = exchange_token(&cfg, &code)?;
    save_token(&app, token)?;
    dida_auth_status(app)
}

pub fn dida_connect(app: AppHandle) -> Result<DidaAuthStatus, String> {
    let url = dida_begin_oauth(app.clone())?;
    open_browser(&app, &url)?;
    dida_finish_oauth(app)
}

enum OAuthCallback {
    Code(String),
    Error(String),
    Ignore,
}

fn parse_oauth_callback(req: &str) -> OAuthCallback {
    let line = match req.lines().next() {
        Some(l) => l,
        None => return OAuthCallback::Ignore,
    };
    let path = match line.split_whitespace().nth(1) {
        Some(p) => p,
        None => return OAuthCallback::Ignore,
    };
    if path == "/favicon.ico" || path == "/" {
        return OAuthCallback::Ignore;
    }
    let full = format!("http://127.0.0.1{path}");
    let url = match Url::parse(&full) {
        Ok(u) => u,
        Err(_) => return OAuthCallback::Ignore,
    };
    let mut code: Option<String> = None;
    let mut err: Option<String> = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "error" => err = Some(v.into_owned()),
            _ => {}
        }
    }
    if let Some(e) = err {
        return OAuthCallback::Error(e);
    }
    if let Some(c) = code {
        return OAuthCallback::Code(c);
    }
    OAuthCallback::Ignore
}

fn send_oauth_response(stream: &mut std::net::TcpStream, ok: bool) {
    let body = if ok {
        "<html><body><h1>授权成功，可关闭此页</h1></body></html>"
    } else {
        "<html><body><h1>授权失败</h1></body></html>"
    };
    let resp = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        if ok { "200 OK" } else { "400 Bad Request" },
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn send_ignore_response(stream: &mut std::net::TcpStream) {
    let resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    let _ = stream.write_all(resp.as_bytes());
}

fn redirect_port(redirect_uri: &str) -> u16 {
    Url::parse(redirect_uri)
        .ok()
        .and_then(|u| u.port())
        .unwrap_or(DEFAULT_PORT)
}

fn exchange_token(cfg: &TicktickIntegration, code: &str) -> Result<String, String> {
    let basic = STANDARD.encode(format!("{}:{}", cfg.client_id, cfg.client_secret));
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(TOKEN_URL)
        .header("Authorization", format!("Basic {basic}"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(
            form_urlencoded::Serializer::new(String::new())
                .append_pair("code", code)
                .append_pair("grant_type", "authorization_code")
                .append_pair("scope", SCOPE)
                .append_pair("redirect_uri", &cfg.redirect_uri)
                .finish(),
        )
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body: Value = resp.json().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("换 token 失败: {body}"));
    }
    body.get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("响应无 access_token: {body}"))
}

fn require_token(app: &AppHandle) -> Result<(AppSettings, String), String> {
    let settings = read_settings(app)?;
    let token = settings.integrations.ticktick.access_token.trim().to_string();
    if token.is_empty() {
        return Err("未连接滴答清单，请先在设置中授权".into());
    }
    Ok((settings, token))
}

fn auth_url(cfg: &TicktickIntegration) -> String {
    let mut url = Url::parse(AUTH_URL).expect("auth url");
    url.query_pairs_mut()
        .append_pair("client_id", cfg.client_id.trim())
        .append_pair("redirect_uri", cfg.redirect_uri.trim())
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("state", "orbita");
    url.to_string()
}

pub fn dida_auth_status(app: AppHandle) -> Result<DidaAuthStatus, String> {
    let settings = read_settings(&app)?;
    Ok(DidaAuthStatus {
        connected: !settings.integrations.ticktick.access_token.trim().is_empty(),
    })
}

fn effective_cfg(cfg: &TicktickIntegration) -> TicktickIntegration {
    let mut c = cfg.clone();
    if c.client_id.trim().is_empty() {
        c.client_id = DEFAULT_TICKTICK_CLIENT_ID.to_string();
    }
    if c.client_secret.trim().is_empty() {
        c.client_secret = DEFAULT_TICKTICK_CLIENT_SECRET.to_string();
    }
    if c.redirect_uri.trim().is_empty() {
        c.redirect_uri = DEFAULT_TICKTICK_REDIRECT.to_string();
    }
    c
}

fn wait_oauth_code_on(listener: TcpListener) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if Instant::now() > deadline {
            return Err(format!("授权超时，请重试（端口 {port}）"));
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                match parse_oauth_callback(&req) {
                    OAuthCallback::Code(code) => {
                        send_oauth_response(&mut stream, true);
                        return Ok(code);
                    }
                    OAuthCallback::Error(err) => {
                        send_oauth_response(&mut stream, false);
                        return Err(format!("授权被拒绝: {err}"));
                    }
                    OAuthCallback::Ignore => {
                        send_ignore_response(&mut stream);
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

pub fn dida_disconnect(app: AppHandle) -> Result<DidaAuthStatus, String> {
    let mut settings = read_settings(&app)?;
    settings.integrations.ticktick.access_token.clear();
    write_settings(&app, settings)?;
    dida_auth_status(app)
}

pub fn dida_list_projects(app: AppHandle) -> Result<Value, String> {
    let (_, token) = require_token(&app)?;
    api_get(&token, "/project")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DidaFilterTasksRequest {
    pub project_ids: Option<Vec<String>>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

pub fn dida_filter_tasks(app: AppHandle, req: DidaFilterTasksRequest) -> Result<Value, String> {
    let (_, token) = require_token(&app)?;
    let mut body = json!({ "status": [0] });
    if let Some(ids) = req.project_ids.filter(|v| !v.is_empty()) {
        body["projectIds"] = json!(ids);
    }
    if let Some(ref d) = req.start_date {
        body["startDate"] = json!(d);
    }
    if let Some(ref d) = req.end_date {
        body["endDate"] = json!(d);
    }
    api_post(&token, "/task/filter", &body)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DidaCreateTaskRequest {
    pub title: String,
    pub project_id: String,
    pub content: Option<String>,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub time_zone: Option<String>,
    pub is_all_day: Option<bool>,
    pub priority: Option<i32>,
}

pub fn dida_create_task(app: AppHandle, req: DidaCreateTaskRequest) -> Result<Value, String> {
    let (_, token) = require_token(&app)?;
    let mut body = json!({
        "title": req.title.trim(),
        "projectId": req.project_id,
    });
    if let Some(c) = req.content.filter(|s| !s.trim().is_empty()) {
        body["content"] = json!(c);
    }
    if let Some(ref d) = req.start_date {
        body["startDate"] = json!(d);
    }
    if let Some(ref d) = req.due_date {
        body["dueDate"] = json!(d);
    }
    if let Some(ref tz) = req.time_zone {
        body["timeZone"] = json!(tz);
    }
    if let Some(v) = req.is_all_day {
        body["isAllDay"] = json!(v);
    }
    if let Some(p) = req.priority {
        body["priority"] = json!(p);
    }
    api_post(&token, "/task", &body)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DidaUpdateTaskRequest {
    pub title: String,
    pub project_id: String,
    pub content: Option<String>,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub time_zone: Option<String>,
    pub is_all_day: Option<bool>,
    pub priority: Option<i32>,
}

pub fn dida_update_task(
    app: AppHandle,
    task_id: String,
    req: DidaUpdateTaskRequest,
) -> Result<Value, String> {
    let (_, token) = require_token(&app)?;
    let mut body = json!({
        "id": task_id,
        "projectId": req.project_id,
        "title": req.title.trim(),
    });
    if let Some(c) = req.content.filter(|s| !s.trim().is_empty()) {
        body["content"] = json!(c);
    } else {
        body["content"] = json!("");
    }
    if let Some(ref d) = req.start_date {
        body["startDate"] = json!(d);
    }
    if let Some(ref d) = req.due_date {
        body["dueDate"] = json!(d);
    }
    if let Some(ref tz) = req.time_zone {
        body["timeZone"] = json!(tz);
    }
    if let Some(v) = req.is_all_day {
        body["isAllDay"] = json!(v);
    }
    if let Some(p) = req.priority {
        body["priority"] = json!(p);
    }
    api_post(&token, &format!("/task/{task_id}"), &body)
}

pub fn dida_complete_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
) -> Result<(), String> {
    let (_, token) = require_token(&app)?;
    api_post(
        &token,
        &format!("/project/{project_id}/task/{task_id}/complete"),
        &json!({}),
    )?;
    Ok(())
}

pub fn dida_delete_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
) -> Result<(), String> {
    let (_, token) = require_token(&app)?;
    api_delete(
        &token,
        &format!("/project/{project_id}/task/{task_id}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_callback_code() {
        let req = "GET /callback?code=abc123&state=orbita HTTP/1.1\r\nHost: 127.0.0.1\r\n";
        match parse_oauth_callback(req) {
            OAuthCallback::Code(c) => assert_eq!(c, "abc123"),
            other => panic!("expected code, got {:?}", std::mem::discriminant(&other)),
        }
    }

    #[test]
    fn parse_favicon_ignored() {
        let req = "GET /favicon.ico HTTP/1.1\r\n";
        assert!(matches!(parse_oauth_callback(req), OAuthCallback::Ignore));
    }
}
