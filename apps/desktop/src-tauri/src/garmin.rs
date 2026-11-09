use serde::{Deserialize, Serialize};
use serde_json::Value;
use rusqlite::OptionalExtension;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::data;
use crate::health_db::{self, host_lock};
use crate::journal;
use crate::productivity_db::coordinator::{in_transaction, with_write_expected};
use crate::v2ray;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminStatus {
    pub configured: bool,
    pub logged_in: bool,
    pub rate_limited: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GarminSyncRequest {
    pub from: Option<String>,
    pub to: Option<String>,
    #[serde(default)]
    pub entry_point: Option<String>,
    pub resume_job: Option<crate::garmin_sync::JobIdRevisionRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminSyncResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exercise_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routine_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_job: Option<crate::garmin_sync::JobIdRevisionRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminLoginRequest {
    pub email: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminLoginResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PythonLoginResult {
    ok: bool,
    message: Option<String>,
    reason: Option<String>,
}


fn legacy_token_dir() -> PathBuf {
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        return PathBuf::from(home).join(".garminconnect");
    }
    PathBuf::from(".garminconnect")
}

fn token_usable(path: &Path) -> bool {
    path.is_file() && path.metadata().map(|m| m.len() > 2).unwrap_or(false)
}

fn migrate_legacy_token_if_needed(target: &Path) -> Result<(), String> {
    let legacy = legacy_token_dir();
    let target_token = token_file(target);
    let legacy_token = token_file(&legacy);
    if token_usable(&target_token) || !legacy_token.is_file() {
        return Ok(());
    }
    std::fs::create_dir_all(target).map_err(|e| e.to_string())?;
    if target_token.exists() {
        std::fs::remove_file(&target_token).map_err(|e| e.to_string())?;
    }
    for entry in std::fs::read_dir(&legacy).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let dest = target.join(entry.file_name());
        std::fs::copy(&path, &dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn resolve_token_dir(app: &AppHandle, settings: &data::AppSettings) -> Result<PathBuf, String> {
    let custom = settings.integrations.garmin.token_dir.trim();
    let dir = if custom.is_empty() {
        PathBuf::from(data::get_data_dir(app)?).join("garmin")
    } else {
        PathBuf::from(custom)
    };
    migrate_legacy_token_if_needed(&dir)?;
    Ok(dir)
}

fn token_file(dir: &Path) -> PathBuf {
    dir.join("garmin_tokens.json")
}

fn rate_limit_path(dir: &Path) -> PathBuf {
    dir.join("garmin_rate_limit.json")
}

fn is_rate_limited(dir: &Path) -> bool {
    let p = rate_limit_path(dir);
    if !p.is_file() {
        return false;
    }
    let raw = std::fs::read_to_string(&p).unwrap_or_default();
    let until = serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|v| v.get("until").and_then(|u| u.as_i64()))
        .unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    now < until
}

pub fn garmin_status(app: &AppHandle) -> Result<GarminStatus, String> {
    let settings = data::read_settings(app)?;
    let email = settings.integrations.credentials.garmin.email.trim();
    let token_dir = resolve_token_dir(app, &settings)?;
    let token = token_file(&token_dir);
    let configured = !email.is_empty() || token_dir.is_dir();
    let logged_in = token_usable(&token);
    let rate_limited = is_rate_limited(&token_dir);
    Ok(GarminStatus {
        configured,
        logged_in,
        rate_limited,
    })
}

fn python_exe() -> PathBuf {
    if let Ok(p) = std::env::var("ORBITA_PYTHON") {
        if Path::new(&p).exists() {
            return PathBuf::from(p);
        }
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let venv = manifest
        .join("..")
        .join("python")
        .join(".venv")
        .join("Scripts")
        .join("python.exe");
    if venv.exists() {
        return venv;
    }
    PathBuf::from("python")
}

fn scripts_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("python")
        .join("scripts")
}

fn script_path(name: &str) -> PathBuf {
    scripts_dir().join(name)
}

const LOGIN_TIMEOUT: Duration = Duration::from_secs(120);

fn decode_utf8(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

fn parse_json_stdout<T: for<'de> Deserialize<'de>>(stdout: &[u8], stderr: &[u8]) -> Result<T, (Option<String>, String)> {
    let stdout_decoded = decode_utf8(stdout);
    let stdout_s = stdout_decoded.trim();
    if stdout_s.is_empty() {
        return Err((None, friendly_garmin_error("", stderr)));
    }
    if let Ok(parsed) = serde_json::from_str::<T>(stdout_s) {
        return Ok(parsed);
    }
    for line in stdout_s.lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<T>(line) {
            return Ok(parsed);
        }
    }
    let reason = extract_reason(stdout_s);
    Err((reason, friendly_garmin_error(stdout_s, stderr)))
}

fn extract_reason(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            if let Some(r) = v.get("reason").and_then(|x| x.as_str()) {
                return Some(r.to_string());
            }
        }
    }
    if let Ok(v) = serde_json::from_str::<Value>(stdout.trim()) {
        if let Some(r) = v.get("reason").and_then(|x| x.as_str()) {
            return Some(r.to_string());
        }
    }
    None
}

fn friendly_garmin_error(stdout: &str, stderr: &[u8]) -> String {
    for line in stdout.lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            if let Some(m) = v.get("message").and_then(|x| x.as_str()) {
                return m.to_string();
            }
        }
    }
    if stdout.trim().starts_with('{') {
        if let Ok(v) = serde_json::from_str::<Value>(stdout.trim()) {
            if let Some(m) = v.get("message").and_then(|x| x.as_str()) {
                return m.to_string();
            }
        }
    }
    let stderr_s = decode_utf8(stderr);
    let blob = format!("{stdout} {stderr_s}").to_lowercase();
    if blob.contains("proxyerror") || blob.contains("unable to connect to proxy") {
        return "\u{4f73}\u{660e}\u{540c}\u{6b65}\u{5931}\u{8d25}\u{ff1a}\u{672c}\u{5730}\u{4ee3}\u{7406}\u{672a}\u{5f00}\u{542f}\u{6216}\u{672a}\u{54cd}\u{5e94}\u{ff0c}\u{8bf7}\u{5f00}\u{542f} v2rayN \u{6216}\u{5173}\u{95ed}\u{7cfb}\u{7edf}\u{4ee3}\u{7406}".into();
    }
    if blob.contains("mfa") {
        return "\u{4f73}\u{660e}\u{8d26}\u{53f7}\u{5f00}\u{542f} MFA\u{ff0c}\u{672c}\u{671f}\u{4e0d}\u{652f}\u{6301}\u{5e94}\u{7528}\u{5185}\u{767b}\u{5f55}".into();
    }
    if blob.contains("garminconnect") && blob.contains("import") {
        return "\u{672a}\u{5b89}\u{88c5} garminconnect\u{ff0c}\u{8bf7}\u{8fd0}\u{884c} apps/desktop/python/setup.ps1".into();
    }
    "\u{4f73}\u{660e}\u{540c}\u{6b65}\u{5931}\u{8d25}\u{ff0c}\u{8bf7}\u{68c0}\u{67e5}\u{751f}\u{6d3b}\u{533a}\u{51ed}\u{636e}".into()
}

const MAX_LEGACY_STDOUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_LEGACY_STDERR_BYTES: usize = 64 * 1024;

fn read_bounded(mut reader: impl Read, limit: usize, label: &str) -> Result<Vec<u8>, String> {
    let mut kept = Vec::with_capacity(limit.min(16 * 1024));
    let mut chunk = [0u8; 8192];
    let mut exceeded = false;
    loop {
        let n = reader.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        let remaining = limit.saturating_sub(kept.len());
        kept.extend_from_slice(&chunk[..n.min(remaining)]);
        exceeded |= n > remaining;
    }
    if exceeded { Err(format!("{label} exceeded the {limit} byte limit")) } else { Ok(kept) }
}

fn run_command_with_timeout(mut cmd: Command, timeout: Duration, timeout_msg: &str) -> Result<Output, String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start python: {e}"))?;

    let stdout_handle = child.stdout.take().map(|mut out| {
        std::thread::spawn(move || {
            read_bounded(out, MAX_LEGACY_STDOUT_BYTES, "Python stdout")
        })
    });
    let stderr_handle = child.stderr.take().map(|mut err| {
        std::thread::spawn(move || {
            // Drain fully while retaining only the bounded diagnostic prefix.
            read_bounded(err, MAX_LEGACY_STDERR_BYTES, "Python stderr")
        })
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(timeout_msg.into());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e.to_string()),
        }
    };

    let stdout = match stdout_handle {
        Some(h) => h.join().map_err(|_| "Python stdout reader panicked".to_string())??,
        None => Vec::new(),
    };
    let stderr = match stderr_handle {
        Some(h) => h.join().map_err(|_| "Python stderr reader panicked".to_string())??,
        None => Vec::new(),
    };
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn build_python_cmd(script: &Path) -> Command {
    let mut cmd = Command::new(python_exe());
    let parent_http_proxy = std::env::var("HTTP_PROXY")
        .or_else(|_| std::env::var("http_proxy"))
        .or_else(|_| std::env::var("HTTPS_PROXY"))
        .or_else(|_| std::env::var("https_proxy"));
    cmd.env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("NO_PROXY", "*")
        .env("no_proxy", "*")
        .env_remove("HTTP_PROXY")
        .env_remove("HTTPS_PROXY")
        .env_remove("ALL_PROXY")
        .env_remove("http_proxy")
        .env_remove("https_proxy")
        .env_remove("all_proxy");
    if let Ok(px) = parent_http_proxy {
        if !px.trim().is_empty() {
            cmd.env("ORBITA_HTTP_PROXY", px.trim());
        }
    }
    cmd.arg(script);
    cmd
}

fn apply_v2ray_env(app: &AppHandle, cmd: &mut Command) {
    let v2ray_running = v2ray::is_running(app).unwrap_or(false);
    if v2ray_running {
        cmd.env("ORBITA_V2RAY_RUNNING", "1");
    }
}

pub fn garmin_login(app: &AppHandle, req: GarminLoginRequest) -> Result<GarminLoginResponse, String> {
    let _request = match crate::garmin_sync::acquire_legacy_request() {
        Ok(guard) => guard,
        Err((code, message)) => {
            return Ok(GarminLoginResponse {
                ok: false,
                message: Some(message.into()),
                reason: Some(code.into()),
            });
        }
    };
    // Invalidate invocation-local results before any login-side credential mutation (§20).
    crate::garmin_sync::fetch_reuse::advance_auth_epoch();
    let settings = data::read_settings(app)?;
    let email = req
        .email
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(settings.integrations.credentials.garmin.email.trim());
    let password = req.password.unwrap_or_else(|| settings.integrations.credentials.garmin.password.clone());
    if email.is_empty() || password.is_empty() {
        return Ok(GarminLoginResponse {
            ok: false,
            message: Some("??????????".into()),
            reason: Some("bad_credentials".into()),
        });
    }

    let token_dir = resolve_token_dir(app, &settings)?;
    std::fs::create_dir_all(&token_dir).map_err(|e| e.to_string())?;

    let script = script_path("garmin_login.py");
    if !script.is_file() {
        return Ok(GarminLoginResponse {
            ok: false,
            message: Some("garmin_login.py not found".into()),
            reason: Some("internal".into()),
        });
    }

    let mut cmd = build_python_cmd(&script);
    apply_v2ray_env(app, &mut cmd);
    cmd.arg("--token-dir")
        .arg(token_dir.to_string_lossy().as_ref())
        .arg("--email")
        .arg(email)
        .arg("--password")
        .arg(&password);

    let output = match run_command_with_timeout(
        cmd,
        LOGIN_TIMEOUT,
        "\u{4f73}\u{660e}\u{767b}\u{5f55}\u{8d85}\u{65f6}\u{ff08}120 \u{79d2}\u{ff09}",
    ) {
        Ok(output) => output,
        Err(message) => {
            return Ok(GarminLoginResponse {
                ok: false,
                message: Some(message),
                reason: Some("sync_timeout".into()),
            });
        }
    };

    let parsed = match parse_json_stdout::<PythonLoginResult>(&output.stdout, &output.stderr) {
        Ok(p) => p,
        Err((reason, message)) => {
            return Ok(GarminLoginResponse {
                ok: false,
                message: Some(message),
                reason,
            });
        }
    };

    Ok(GarminLoginResponse {
        ok: parsed.ok,
        message: parsed.message,
        reason: parsed.reason,
    })
}

// Overlay (main) and Insight (admin) are separate webviews; AppHandle.emit does not reach both.
fn emit_garmin_syncing(app: &AppHandle, busy: bool) {
    for (_, win) in app.webview_windows() {
        let _ = win.emit("orbita:garmin-syncing", busy);
    }
}

fn garmin_sync_lock_conflict(entry_point: &str) -> GarminSyncResponse {
    if entry_point == "auto" {
        GarminSyncResponse {
            ok: false,
            message: None,
            reason: Some("GARMIN_SYNC_IN_PROGRESS".into()),
            daily_count: None,
            exercise_count: None,
            routine_count: None,
            resume_job: None,
        }
    } else {
        GarminSyncResponse {
            ok: false,
            message: Some("佳明同步正在进行中".into()),
            reason: Some("GARMIN_SYNC_IN_PROGRESS".into()),
            daily_count: None,
            exercise_count: None,
            routine_count: None,
            resume_job: None,
        }
    }
}

fn garmin_gate_block_response(code: &str, message: &str) -> GarminSyncResponse {
    GarminSyncResponse { ok: false, message: Some(message.into()), reason: Some(code.into()), daily_count: None, exercise_count: None, routine_count: None, resume_job: None }
}

fn resolve_client_entry_point(raw: Option<&str>) -> &'static str {
    if raw == Some("auto") {
        "auto"
    } else {
        "manual"
    }
}

pub fn garmin_sync(app: &AppHandle, req: GarminSyncRequest) -> Result<GarminSyncResponse, String> {
    journal::journal_root(app)?;
    let entry_point = resolve_client_entry_point(req.entry_point.as_deref());
    if let Some((code, message)) = crate::garmin_sync::legacy_gate_error() {
        return Ok(garmin_gate_block_response(code, message));
    }
    // The old cooldown file is retained for compatibility; if it is stricter than the
    // app-global gate, reject before creating the run record.
    let settings = data::read_settings(app)?;
    let token_dir = resolve_token_dir(app, &settings)?;
    if is_rate_limited(&token_dir) {
        return Ok(GarminSyncResponse { ok: false, message: Some("佳明 API 限流冷却中，请稍后再试".into()), reason: Some("rate_limited".into()), daily_count: None, exercise_count: None, routine_count: None, resume_job: None });
    }
    if !host_lock::try_acquire() {
        return Ok(garmin_sync_lock_conflict(entry_point));
    }
    emit_garmin_syncing(app, true);
    let result = garmin_sync_inner(app, req, entry_point);
    host_lock::release();
    emit_garmin_syncing(app, false);
    result
}

fn garmin_sync_inner(app: &AppHandle, req: GarminSyncRequest, _entry_point: &str) -> Result<GarminSyncResponse, String> {
    // Daily production sync is a durable date × class queue. The compatibility
    // command stays at the UI boundary; it never collects a whole-range batch.
    let mut resumed_key = None;
    if let Some(resume) = req.resume_job {
        if req.entry_point.as_deref() != Some("manual") {
            return Ok(garmin_gate_block_response("GARMIN_JOB_STATE_INVALID", "只能从手动同步确认继续日常任务"));
        }
        let data_dir = data::get_data_dir(app)?;
        if crate::garmin_sync::data_dir_key(&data_dir) != resume.expected_data_dir_key {
            return Ok(garmin_gate_block_response("GARMIN_DATA_DIR_CHANGED", "数据目录已切换，继续同步已取消"));
        }
        if let Some((code, message)) = crate::garmin_sync::legacy_gate_error() {
            return Ok(garmin_gate_block_response(code, message));
        }
        let settings = data::read_settings(app)?;
        let token_dir = resolve_token_dir(app, &settings)?;
        if is_rate_limited(&token_dir) {
            return Ok(garmin_gate_block_response("rate_limited", "佳明 API 限流冷却中，请稍后再试"));
        }
        resumed_key = Some(resume.expected_data_dir_key.clone());
        crate::garmin_sync::resume_daily_request(&data_dir, resume).map_err(String::from)?;
        if crate::garmin_sync::data_dir_key(&data::get_data_dir(app)?) != crate::garmin_sync::data_dir_key(&data_dir) {
            return Ok(garmin_gate_block_response("GARMIN_DATA_DIR_CHANGED", "数据目录已切换，继续同步已取消"));
        }
    }
    run_daily_unit_job(app, resumed_key.as_deref())
}

const GARMIN_UNIT_MAX_ATTEMPTS: i64 = 3;

fn daily_reuse_context(app: &AppHandle, job_id: &str, key: &str, token_dir: &Path) -> Option<crate::garmin_sync::fetch_reuse::ReuseContext> {
    if crate::garmin_sync::data_dir_key(&data::get_data_dir(app).ok()?) != key { return None; }
    let settings = data::read_settings(app).ok()?;
    // Resolve without the legacy migration side effect while examining reuse eligibility.
    let custom = settings.integrations.garmin.token_dir.trim();
    let configured = if custom.is_empty() { PathBuf::from(data::get_data_dir(app).ok()?).join("garmin") } else { PathBuf::from(custom) };
    if configured.canonicalize().ok()? != token_dir.canonicalize().ok()? { return None; }
    crate::garmin_sync::fetch_reuse::capture_context(job_id, key, token_dir)
}

fn discover_daily_activities(app: &AppHandle, data_dir: &str, key: &str, job: &crate::garmin_sync::JobSnapshot, reuse: &mut crate::garmin_sync::fetch_reuse::RunFetchReuse) -> Result<bool, String> {
    use crate::garmin_sync::protocol::{guarded_dispatch, UnitRequest, PROTOCOL_VERSION};
    let settings = data::read_settings(app)?;
    let token_dir = resolve_token_dir(app, &settings)?;
    let script = script_path("garmin_unit.py");
    let req = UnitRequest { protocol_version: PROTOCOL_VERSION, request_id: uuid::Uuid::new_v4().to_string(),
        job_id: job.job_id.clone(), work_item_id: uuid::Uuid::new_v4().to_string(), unit_kind: "discover_activity_list".into(),
        data_dir_key: key.into(), cancellation_generation: 0,
        target: serde_json::json!({"fromDate":job.from_date,"toDate":job.to_date}), staging_path: None };
    let mut dispatched = None;
    let mut source_context = None;
    for attempt in 0..GARMIN_UNIT_MAX_ATTEMPTS {
        let mut cmd = build_python_cmd(&script);
        apply_v2ray_env(app, &mut cmd);
        cmd.arg("--token-dir").arg(token_dir.to_string_lossy().as_ref());
        let result = guarded_dispatch(data_dir, &req, || data::get_data_dir(app),
            |unit| {
                let before = daily_reuse_context(app, &job.job_id, key, &token_dir);
                reuse.observe_context(before.clone());
                let response = crate::garmin_sync::protocol::run_python_unit(&mut cmd, unit)?;
                let after = daily_reuse_context(app, &job.job_id, key, &token_dir);
                source_context = if before == after { after } else { reuse.clear(); None };
                Ok(response)
            });
        match result {
            Ok((response, guard)) if response.outcome == "retryable_failure" && attempt + 1 < GARMIN_UNIT_MAX_ATTEMPTS => {
                drop(guard);
                reuse.clear();
                if crate::garmin_sync::data_dir_key(&data::get_data_dir(app)?) != key { return Err("dataDir changed during activity discovery retry".into()); }
                std::thread::sleep(garmin_retry_delay(attempt + 1, 0));
            }
            Ok(value) => { dispatched = Some(value); break; }
            Err(_) => break,
        }
    }
    let (response, _guard) = match dispatched {
        Some(value) => value,
        None => {
            if crate::garmin_sync::data_dir_key(&data::get_data_dir(app)?) != key { return Err("dataDir changed during activity discovery".into()); }
            checkpoint_activity_discovery_gap(data_dir, job)?;
            return Ok(false);
        }
    };
    if response.outcome == "token_invalid" {
        checkpoint_activity_discovery_gap(data_dir, job)?;
        checkpoint_daily_pause(data_dir, &job.job_id, "paused", Some("token_invalid"), "Garmin token is invalid")?;
        return Ok(false);
    }
    let Some(payload) = response.payload.as_ref() else { checkpoint_activity_discovery_gap(data_dir, job)?; return Ok(false); };
    let Some(list) = payload.get("activities").and_then(serde_json::Value::as_array) else { checkpoint_activity_discovery_gap(data_dir, job)?; return Ok(false); };
    let mut evidence_complete = payload.get("evidence").and_then(|v| v.get("complete")).and_then(serde_json::Value::as_bool).unwrap_or(false)
        && response.outcome == "complete";
    if evidence_complete && list.iter().any(|activity| {
        let id = activity.get("externalId").and_then(serde_json::Value::as_str);
        let date = activity.get("localDate").and_then(serde_json::Value::as_str);
        !id.is_some_and(|value| !value.trim().is_empty() && !value.contains('|'))
            || !date.is_some_and(|value| daily_date_in_range(value, &job.from_date, &job.to_date))
    }) {
        evidence_complete = false;
    }
    let (activity_by_id, identity_conflicts) = classify_daily_activity_list(list, job);
    if evidence_complete && identity_conflicts.is_empty() {
        if let Some(context) = source_context.as_ref() {
            reuse.ingest_discovery(context, &response);
        }
    }
    crate::productivity_db::coordinator::with_write_expected(data_dir, |conn| crate::productivity_db::coordinator::in_transaction(conn, |tx| {
        let mut discovered: Vec<_> = activity_by_id.iter().collect();
        discovered.sort_by(|a, b| a.0.cmp(b.0));
        for (id, (date, _)) in discovered {
            if identity_conflicts.contains(id) { continue; }
            let target_key = format!("{date}|activity:{id}");
            if crate::garmin_sync::store::work_item_exists(tx, &job.job_id, "fetch_activity_summary", &target_key).map_err(crate::productivity_db::DomainError::from)? { continue; }
            let item = crate::garmin_sync::WorkItemSnapshot { work_item_id: uuid::Uuid::new_v4().to_string(), job_id:job.job_id.clone(), kind:"fetch_activity_summary".into(), target_key,
                priority:crate::garmin_sync::PRIORITY_DAILY_CORE, state:"pending".into(), attempt_count:0, attempt_generation:1, next_attempt_at_utc:None,
                idempotency_key:format!("{}:activity:{}:{}",job.job_id,id,1), input_hash:None, committed_hash:None, asset_version_id:None, revision:1, error_code:None, result_code:None };
            crate::garmin_sync::store::insert_work_item(tx, &item).map_err(crate::productivity_db::DomainError::from)?;
        }
        let mut conflicts: Vec<_> = identity_conflicts.iter().collect();
        conflicts.sort();
        for id in conflicts {
            let date = &activity_by_id[id].0;
            persist_activity_identity_conflict_gap(tx, job, id, date)?;
        }
        if evidence_complete {
            reconcile_activity_discovery_success(tx, job)?;
        }
        if evidence_complete && !identity_conflicts.is_empty() {
            tx.execute("UPDATE garmin_sync_job SET error_code='activity_list_identity_conflict',error_summary='活动清单中的同一 ID 日期或内容冲突，需重试摘要',revision=revision+1 WHERE job_id=?1", [&job.job_id])
                .map_err(crate::productivity_db::DomainError::from)?;
            reconcile_daily_job_terminal_state(tx, job)?;
        }
        Ok(())
    })).map_err(String::from)?;
    if !evidence_complete { checkpoint_activity_discovery_gap(data_dir, job)?; }
    Ok(evidence_complete)
}

fn classify_daily_activity_list(
    list: &[serde_json::Value],
    job: &crate::garmin_sync::JobSnapshot,
) -> (std::collections::HashMap<String, (String, String)>, std::collections::HashSet<String>) {
    let mut activity_by_id: std::collections::HashMap<String, (String, String)> = std::collections::HashMap::new();
    let mut identity_conflicts = std::collections::HashSet::new();
    for activity in list {
        let Some(id) = activity.get("externalId").and_then(serde_json::Value::as_str)
            .filter(|s| !s.trim().is_empty() && !s.contains('|')) else { continue };
        let Some(date) = activity.get("localDate").and_then(serde_json::Value::as_str)
            .filter(|s| daily_date_in_range(s, &job.from_date, &job.to_date)) else { continue };
        let mut identity = activity.clone();
        if let Some(object) = identity.as_object_mut() { object.remove("normalizedEntry"); }
        let content = identity.to_string();
        if let Some((known_date, known_content)) = activity_by_id.get(id) {
            if known_date != date || known_content != &content {
                identity_conflicts.insert(id.to_string());
            }
        } else {
            activity_by_id.insert(id.to_string(), (date.to_string(), content));
        }
    }
    (activity_by_id, identity_conflicts)
}

fn persist_activity_identity_conflict_gap(
    tx: &rusqlite::Transaction<'_>,
    job: &crate::garmin_sync::JobSnapshot,
    external_id: &str,
    date: &str,
) -> Result<(), crate::productivity_db::DomainError> {
    let target = format!("{date}|activity:{external_id}");
    let rows: Vec<(String, String)> = {
        let mut stmt = tx.prepare("SELECT work_item_id,target_key FROM garmin_sync_work_item WHERE job_id=?1 AND kind='fetch_activity_summary'")
            .map_err(crate::productivity_db::DomainError::from)?;
        let mapped = stmt.query_map([&job.job_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(crate::productivity_db::DomainError::from)?;
        mapped.collect::<Result<_, _>>()
            .map_err(crate::productivity_db::DomainError::from)?
    };
    let matching: Vec<String> = rows.into_iter().filter_map(|(item_id, key)| {
        let (item_date, activity) = key.split_once('|')?;
        (activity == format!("activity:{external_id}") && daily_date_in_range(item_date, &job.from_date, &job.to_date))
            .then_some(item_id)
    }).collect();
    if let Some((keep, duplicates)) = matching.split_first() {
        tx.execute("UPDATE garmin_sync_work_item SET target_key=?1,state='gap',next_attempt_at_utc=NULL,error_code='activity_list_identity_conflict',result_code='identity_conflict',revision=revision+1 WHERE work_item_id=?2",
            rusqlite::params![target, keep]).map_err(crate::productivity_db::DomainError::from)?;
        for duplicate in duplicates {
            tx.execute("UPDATE garmin_sync_work_item SET state='cancelled',next_attempt_at_utc=NULL,error_code=NULL,result_code='duplicate_activity_id_conflict',revision=revision+1 WHERE work_item_id=?1",
                [duplicate]).map_err(crate::productivity_db::DomainError::from)?;
        }
    } else {
        let item = crate::garmin_sync::WorkItemSnapshot {
            work_item_id: uuid::Uuid::new_v4().to_string(), job_id: job.job_id.clone(),
            kind: "fetch_activity_summary".into(), target_key: target,
            priority: crate::garmin_sync::PRIORITY_DAILY_CORE, state: "gap".into(),
            attempt_count: 0, attempt_generation: 1, next_attempt_at_utc: None,
            idempotency_key: format!("{}:activity:{}:1", job.job_id, external_id),
            input_hash: None, committed_hash: None, asset_version_id: None, revision: 1,
            error_code: Some("activity_list_identity_conflict".into()),
            result_code: Some("identity_conflict".into()),
        };
        crate::garmin_sync::store::insert_work_item(tx, &item).map_err(crate::productivity_db::DomainError::from)?;
    }
    Ok(())
}

fn reconcile_activity_discovery_success(
    tx: &rusqlite::Transaction<'_>,
    job: &crate::garmin_sync::JobSnapshot,
) -> Result<(), crate::productivity_db::DomainError> {
    let target = format!("{}|activity_list_discovery", job.from_date);
    let existing: Option<String> = tx.query_row(
        "SELECT work_item_id FROM garmin_sync_work_item WHERE job_id=?1 AND kind='activity_list_discovery' AND target_key=?2",
        rusqlite::params![job.job_id, target], |r| r.get(0),
    ).optional().map_err(crate::productivity_db::DomainError::from)?;
    if let Some(id) = existing {
        // Keep the prior error_code as diagnostic evidence; state/result represent the
        // latest complete discovery attempt so a recovered gap no longer blocks success.
        tx.execute("UPDATE garmin_sync_work_item SET state='succeeded', result_code='complete_after_retry', revision=revision+1 WHERE work_item_id=?1", [&id])
            .map_err(crate::productivity_db::DomainError::from)?;
    } else {
        let item = crate::garmin_sync::WorkItemSnapshot {
            work_item_id: uuid::Uuid::new_v4().to_string(), job_id: job.job_id.clone(),
            kind: "activity_list_discovery".into(), target_key: target,
            priority: crate::garmin_sync::PRIORITY_DAILY_CORE, state: "succeeded".into(),
            attempt_count: 1, attempt_generation: 1, next_attempt_at_utc: None,
            idempotency_key: format!("{}:activity_list_discovery", job.job_id), input_hash: None,
            committed_hash: None, asset_version_id: None, revision: 1, error_code: None,
            result_code: Some("complete".into()),
        };
        crate::garmin_sync::store::insert_work_item(tx, &item).map_err(crate::productivity_db::DomainError::from)?;
    }
    tx.execute("UPDATE garmin_sync_job SET error_code=NULL, error_summary=NULL, revision=revision+1 WHERE job_id=?1 AND error_code='activity_list_incomplete'", [&job.job_id])
        .map_err(crate::productivity_db::DomainError::from)?;
    reconcile_daily_job_terminal_state(tx, job)?;
    Ok(())
}

/// Discovery recovery is the final input to daily completion. Recompute inside the
/// same Archive transaction so a recovered marker cannot leave a stale partial job.
pub(crate) fn reconcile_daily_job_terminal_state(
    tx: &rusqlite::Transaction<'_>,
    job: &crate::garmin_sync::JobSnapshot,
) -> Result<(), crate::productivity_db::DomainError> {
    use chrono::NaiveDate;
    use std::collections::HashSet;
    let (Ok(from), Ok(to)) = (
        NaiveDate::parse_from_str(&job.from_date, "%Y-%m-%d"),
        NaiveDate::parse_from_str(&job.to_date, "%Y-%m-%d"),
    ) else {
        keep_daily_job_nonterminal(tx, job)?;
        return Ok(());
    };
    // Daily jobs are defined in Shanghai business dates. Reconcile only the exact
    // seven-day target set; cardinality alone lets malformed keys mask missing work.
    if job.timezone_policy != "Asia/Shanghai" || from.format("%Y-%m-%d").to_string() != job.from_date
        || to.format("%Y-%m-%d").to_string() != job.to_date || (to - from).num_days() != 6 {
        keep_daily_job_nonterminal(tx, job)?;
        return Ok(());
    }
    let mut expected_daily = HashSet::new();
    for offset in 0..7 {
        let date = (from + chrono::Duration::days(offset)).format("%Y-%m-%d").to_string();
        for class_id in crate::garmin_sync::DAILY_CLASS_IDS {
            expected_daily.insert(format!("{date}|{class_id}"));
        }
    }
    let mut seen_daily = HashSet::new();
    let mut seen_summaries = HashSet::new();
    let mut seen_activity_ids = HashSet::new();
    let mut daily_ok = true;
    let mut summaries_ok = true;
    let mut targets_valid = true;
    let mut all_expected_processed = true;
    let mut discovery_count = 0usize;
    let mut discovery_ok = false;
    let mut has_gap = false;
    let mut identity_conflict_found = false;
    let mut stmt = tx.prepare(
        "SELECT work_item_id,kind,target_key,state,result_code,attempt_generation FROM garmin_sync_work_item WHERE job_id=?1 AND kind IN ('fetch_daily_class','fetch_activity_summary','activity_list_discovery')",
    ).map_err(crate::productivity_db::DomainError::from)?;
    let rows = stmt.query_map([&job.job_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, i64>(5)?)))
        .map_err(crate::productivity_db::DomainError::from)?;
    let mut summary_conflicts: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    let current_discovery_target = format!("{}|activity_list_discovery", job.from_date);
    let mut current_discovery_ids = Vec::new();
    for row in rows {
        let (work_item_id, kind, target, state, result_code, attempt_generation) = row.map_err(crate::productivity_db::DomainError::from)?;
        if state == "cancelled" && matches!(result_code.as_deref(), Some("outside_current_daily_range" | "historical_daily_window" | "invalid_target" | "duplicate_activity_id_conflict" | "duplicate_current_marker")) { continue; }
        let succeeded = matches!(state.as_str(), "succeeded" | "skipped_same_hash");
        if kind == "fetch_daily_class" {
            if let Some((date, _)) = target.split_once('|') {
                if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok_and(|parsed| parsed.format("%Y-%m-%d").to_string() == date && (parsed < from || parsed > to)) { continue; }
            }
            if attempt_generation <= 0 { targets_valid = false; }
            has_gap |= state == "gap";
            if !expected_daily.contains(&target) || !seen_daily.insert(target) {
                targets_valid = false;
                daily_ok = false;
            } else if !succeeded {
                daily_ok = false;
                if matches!(state.as_str(), "pending" | "fetching" | "staged" | "committing") { all_expected_processed = false; }
            }
        } else if kind == "fetch_activity_summary" {
            let parsed = target.split_once('|').filter(|(date, id)| {
                !id.contains('|') && id.strip_prefix("activity:").is_some_and(|external_id| !external_id.is_empty())
                    && NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok_and(|parsed| parsed.format("%Y-%m-%d").to_string() == *date)
            });
            if parsed.as_ref().is_some_and(|(date, _)| NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok_and(|parsed| parsed < from || parsed > to)) { continue; }
            if attempt_generation <= 0 { targets_valid = false; }
            has_gap |= state == "gap";
            let unique_activity = parsed.and_then(|(_, id)| id.strip_prefix("activity:"))
                .map(|external_id| (external_id.to_string(), seen_activity_ids.insert(external_id.to_string())));
            if let Some((external_id, false)) = unique_activity.as_ref() {
                summary_conflicts.entry(external_id.clone()).or_default().push(target.clone());
            }
            let unique_activity = unique_activity.is_some_and(|(_, unique)| unique);
            if !unique_activity || !seen_summaries.insert(target.clone()) {
                targets_valid = false;
                summaries_ok = false;
                if !unique_activity { has_gap = true; }
            } else if !succeeded {
                summaries_ok = false;
                if matches!(state.as_str(), "pending" | "fetching" | "staged" | "committing") { all_expected_processed = false; }
            }
        } else if kind == "activity_list_discovery" {
            if target != current_discovery_target { continue; }
            if attempt_generation <= 0 { targets_valid = false; }
            has_gap |= state == "gap";
            discovery_count += 1;
            if succeeded {
                discovery_ok = true;
            } else {
                targets_valid = false;
                discovery_ok = false;
                if state != "gap" { all_expected_processed = false; }
                if matches!(state.as_str(), "pending" | "fetching" | "staged" | "committing") { all_expected_processed = false; }
            }
            current_discovery_ids.push(work_item_id);
        }
    }
    drop(stmt);
    for (external_id, targets) in summary_conflicts {
        let matching: Vec<String> = {
            let mut stmt = tx.prepare("SELECT work_item_id,target_key FROM garmin_sync_work_item WHERE job_id=?1 AND kind='fetch_activity_summary'")
                .map_err(crate::productivity_db::DomainError::from)?;
            let rows = stmt.query_map([&job.job_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(crate::productivity_db::DomainError::from)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(crate::productivity_db::DomainError::from)?;
            rows.into_iter()
                .filter_map(|(id, key)| {
                    let (date, activity) = key.split_once('|')?;
                    (activity == format!("activity:{external_id}") && NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok_and(|d| d >= from && d <= to)).then_some(id)
                }).collect()
        };
        if let Some((keep, duplicates)) = matching.split_first() {
            let chosen_target = targets.first().cloned().unwrap_or_default();
            tx.execute("UPDATE garmin_sync_work_item SET target_key=?1,state='gap',next_attempt_at_utc=NULL,error_code='activity_list_identity_conflict',result_code='identity_conflict',revision=revision+1 WHERE work_item_id=?2",
                rusqlite::params![chosen_target, keep]).map_err(crate::productivity_db::DomainError::from)?;
            for duplicate in duplicates {
                tx.execute("UPDATE garmin_sync_work_item SET state='cancelled',next_attempt_at_utc=NULL,error_code=NULL,result_code='duplicate_activity_id_conflict',revision=revision+1 WHERE work_item_id=?1",
                    [duplicate]).map_err(crate::productivity_db::DomainError::from)?;
            }
            has_gap = true;
            identity_conflict_found = true;
        }
    }
    if current_discovery_ids.len() > 1 {
        let keep = &current_discovery_ids[0];
        tx.execute("UPDATE garmin_sync_work_item SET state='gap',error_code='activity_list_discovery_duplicate',result_code='duplicate_current_marker',revision=revision+1 WHERE work_item_id=?1", [keep])
            .map_err(crate::productivity_db::DomainError::from)?;
        for duplicate in current_discovery_ids.iter().skip(1) {
            tx.execute("UPDATE garmin_sync_work_item SET state='cancelled',error_code=NULL,result_code='duplicate_current_marker',revision=revision+1 WHERE work_item_id=?1", [duplicate])
            .map_err(crate::productivity_db::DomainError::from)?;
        }
        discovery_count = 1;
        discovery_ok = false;
        targets_valid = false;
        has_gap = true;
    }
    let all_expected_terminal = all_expected_processed && seen_daily == expected_daily
        && discovery_count == 1 && (discovery_ok || has_gap);
    let all_succeeded = targets_valid && seen_daily == expected_daily && daily_ok && summaries_ok
        && discovery_count == 1 && discovery_ok && !has_gap;
    let now = crate::garmin_sync::utc_now();
    let state = if all_succeeded { crate::garmin_sync::JOB_COMPLETED }
        else if all_expected_terminal && has_gap { crate::garmin_sync::JOB_PARTIAL }
        else { crate::garmin_sync::JOB_RUNNING };
    tx.execute(
        "UPDATE garmin_sync_job SET state=?1, finished_at_utc=CASE WHEN ?1 IN ('completed','partial') THEN ?2 ELSE NULL END, pause_reason=NULL, error_code=CASE WHEN ?4=1 THEN 'activity_list_identity_conflict' WHEN ?5=1 AND error_code IN ('activity_list_incomplete','activity_list_identity_conflict') THEN NULL ELSE error_code END, error_summary=CASE WHEN ?4=1 THEN '活动清单中的同一 ID 日期或内容冲突，需重试摘要' WHEN ?5=1 AND error_code IN ('activity_list_incomplete','activity_list_identity_conflict') THEN NULL ELSE error_summary END, updated_at_utc=?2, revision=revision+1 WHERE job_id=?3 AND kind='daily'",
        rusqlite::params![state, now, job.job_id, identity_conflict_found as i64, all_succeeded as i64],
    ).map_err(crate::productivity_db::DomainError::from)?;
    Ok(())
}

fn keep_daily_job_nonterminal(
    tx: &rusqlite::Transaction<'_>,
    job: &crate::garmin_sync::JobSnapshot,
) -> Result<(), crate::productivity_db::DomainError> {
    tx.execute(
        "UPDATE garmin_sync_job SET state='running', finished_at_utc=NULL, updated_at_utc=?1, revision=revision+1 WHERE job_id=?2 AND kind='daily'",
        rusqlite::params![crate::garmin_sync::utc_now(), job.job_id],
    ).map_err(crate::productivity_db::DomainError::from)?;
    Ok(())
}

fn checkpoint_activity_discovery_gap(data_dir:&str, job:&crate::garmin_sync::JobSnapshot)->Result<(),String> {
    crate::productivity_db::coordinator::with_write_expected(data_dir, |conn| crate::productivity_db::coordinator::in_transaction(conn, |tx| {
        let target = format!("{}|activity_list_discovery", job.from_date);
        if !crate::garmin_sync::store::work_item_exists(tx, &job.job_id, "activity_list_discovery", &target).map_err(crate::productivity_db::DomainError::from)? {
            let item = crate::garmin_sync::WorkItemSnapshot { work_item_id:uuid::Uuid::new_v4().to_string(), job_id:job.job_id.clone(), kind:"activity_list_discovery".into(), target_key:target,
                priority:crate::garmin_sync::PRIORITY_DAILY_CORE, state:"gap".into(), attempt_count:1, attempt_generation:1, next_attempt_at_utc:None,
                idempotency_key:format!("{}:activity_list_discovery",job.job_id), input_hash:None, committed_hash:None, asset_version_id:None, revision:1,
                error_code:Some("activity_list_incomplete".into()), result_code:Some("incomplete".into()) };
            crate::garmin_sync::store::insert_work_item(tx, &item).map_err(crate::productivity_db::DomainError::from)?;
        } else {
            tx.execute("UPDATE garmin_sync_work_item SET state='gap', error_code='activity_list_incomplete', result_code='incomplete', revision=revision+1 WHERE job_id=?1 AND kind='activity_list_discovery' AND target_key=?2", rusqlite::params![job.job_id, target]).map_err(crate::productivity_db::DomainError::from)?;
        }
        tx.execute("UPDATE garmin_sync_job SET error_code='activity_list_incomplete', error_summary='活动列表分页未能确认完整', revision=revision+1 WHERE job_id=?1", [&job.job_id]).map_err(crate::productivity_db::DomainError::from)?;
        Ok(())
    })).map_err(String::from)
}

fn garmin_retry_delay(attempt_count: i64, original_count: i64) -> std::time::Duration {
    let exponent = (attempt_count - original_count - 1).clamp(0, 2) as u32;
    std::time::Duration::from_secs(1_u64 << exponent)
}

fn run_daily_unit_job(app: &AppHandle, resumed_key: Option<&str>) -> Result<GarminSyncResponse, String> {
    use crate::garmin_sync::protocol::{guarded_dispatch, UnitRequest, PROTOCOL_VERSION};
    use crate::garmin_sync::{DailyStartRequest, WorkItemSnapshot};
    use crate::health_db::GarminApplyUnitRequest;

    let data_dir = data::get_data_dir(app)?;
    let key = crate::garmin_sync::data_dir_key(&data_dir);
    if resumed_key.is_some_and(|expected| expected != key) {
        return Ok(garmin_gate_block_response("GARMIN_DATA_DIR_CHANGED", "数据目录已切换，继续同步已取消"));
    }
    let started = crate::garmin_sync::daily_start(&data_dir, DailyStartRequest {
        request_id: uuid::Uuid::new_v4().to_string(), expected_data_dir_key: key.clone(),
    }).map_err(|e| e.message)?;
    let job_id = started.job.job_id.clone();
    if !matches!(started.job.state.as_str(), crate::garmin_sync::JOB_QUEUED | crate::garmin_sync::JOB_RUNNING) {
        let paused = started.job.kind == crate::garmin_sync::KIND_DAILY && started.job.state == crate::garmin_sync::JOB_PAUSED;
        let resume_job = paused.then(|| crate::garmin_sync::JobIdRevisionRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            expected_data_dir_key: key.clone(),
            job_id: job_id.clone(),
            expected_revision: started.job.revision,
        });
        let pause_detail = match started.job.pause_reason.as_deref() {
            Some("app_exit") => "上次应用退出",
            Some("data_dir_switch") => "数据目录曾切换",
            Some("token") => "佳明登录状态需检查",
            Some("storage") => "本地存储异常",
            Some("user") => "此前手动暂停",
            _ => started.job.error_summary.as_deref().unwrap_or("原因未记录"),
        };
        return Ok(GarminSyncResponse {
            ok: false,
            message: Some(if paused { format!("Garmin 日常同步已暂停（{pause_detail}）。继续将重试未成功项。") } else { "Garmin 同步任务当前不可执行".into() }),
            reason: Some(if paused { "GARMIN_DAILY_PAUSED".into() } else { started.job.error_code.clone().unwrap_or_else(|| started.job.state.clone()) }),
            daily_count: None,
            exercise_count: None,
            routine_count: None,
            resume_job,
        });
    }
    let mut fetch_reuse = crate::garmin_sync::fetch_reuse::RunFetchReuse::default();
    discover_daily_activities(app, &data_dir, &key, &started.job, &mut fetch_reuse)?;
    let state = crate::productivity_db::coordinator::with_read(&data_dir, |conn| {
        let conn = conn.ok_or_else(|| crate::productivity_db::DomainError::archive_lifecycle("archive not initialized"))?;
        crate::productivity_db::coordinator::in_transaction(conn, |tx| tx.query_row("SELECT state FROM garmin_sync_job WHERE job_id=?1", [&job_id], |r| r.get::<_,String>(0)).map_err(crate::productivity_db::DomainError::from))
    }).map_err(String::from)?;
    if state == "paused" || state == "blocked_rate_limit" {
        finish_daily_run(&data_dir, &job_id)?;
        return Ok(GarminSyncResponse { ok:false, message:Some("Garmin 活动列表发现未完成，同步已暂停".into()), reason:Some("activity_list_incomplete".into()), daily_count:Some(0), exercise_count:Some(0), routine_count:Some(0), resume_job: None });
    }
    let items: Vec<WorkItemSnapshot> = crate::productivity_db::coordinator::with_read(&data_dir, |conn| {
        let conn = conn.ok_or_else(|| crate::productivity_db::DomainError::archive_lifecycle("archive not initialized"))?;
        crate::productivity_db::coordinator::in_transaction(conn, |tx| {
            crate::garmin_sync::store::list_items_for_job(tx, &job_id).map_err(crate::productivity_db::DomainError::from)
        })
    }).map_err(String::from)?;
    let settings = data::read_settings(app)?;
    let token_dir = resolve_token_dir(app, &settings)?;
    let script = script_path("garmin_unit.py");
    if !script.is_file() { return Err("garmin_unit.py not found".into()); }
    let mut completed = 0u32;
    let current_from = started.job.from_date.clone();
    let current_to = started.job.to_date.clone();
    for item in items.into_iter().filter(|i| {
        i.state == crate::garmin_sync::ITEM_PENDING
            && daily_dispatch_target_is_valid(i, &current_from, &current_to)
    }) {
        if let Some((code, message)) = crate::garmin_sync::legacy_gate_error() {
            checkpoint_daily_pause(&data_dir, &job_id, "blocked_rate_limit", Some(code), message)?;
            break;
        }
        let (date, target_class) = item.target_key.split_once('|').ok_or("invalid daily work item target")?;
        let (class_id, external_id, unit_kind) = if let Some(id) = target_class.strip_prefix("activity:") { ("activity", Some(id), "fetch_activity_summary") } else { (target_class, None, "fetch_daily_class") };
        // A fetching marker is recoverable: startup can safely requeue it because no apply has committed.
        let claimed = crate::productivity_db::coordinator::with_write_expected(&data_dir, |conn| {
            crate::productivity_db::coordinator::in_transaction(conn, |tx| {
                let changed = tx.execute("UPDATE garmin_sync_work_item SET state='fetching', attempt_count=attempt_count+1, revision=revision+1 WHERE work_item_id=?1 AND state='pending'", [&item.work_item_id])
                    .map_err(crate::productivity_db::DomainError::from)?;
                if changed == 1 {
                    tx.execute("UPDATE garmin_sync_job SET state='running', started_at_utc=COALESCE(started_at_utc, ?1), updated_at_utc=?1, revision=revision+1 WHERE job_id=?2 AND state IN ('queued','running')",
                        rusqlite::params![crate::garmin_sync::utc_now(), job_id])
                        .map_err(crate::productivity_db::DomainError::from)?;
                }
                Ok(changed == 1)
            })
        }).map_err(String::from)?;
        if !claimed {
            continue;
        }
        let request = UnitRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            job_id: job_id.clone(), work_item_id: item.work_item_id.clone(),
            unit_kind: unit_kind.into(), data_dir_key: key.clone(),
            cancellation_generation: 0,
            target: if let Some(id) = external_id { serde_json::json!({"localDate":date,"externalId":id}) } else { serde_json::json!({"localDate":date,"classId":class_id}) }, staging_path: None,
        };
        let mut attempt_count = item.attempt_count + 1;
        let mut stop_job = false;
        let response = loop {
            let mut source_context = None;
            let mut cmd = build_python_cmd(&script);
            apply_v2ray_env(app, &mut cmd);
            cmd.arg("--token-dir").arg(token_dir.to_string_lossy().as_ref());
            let dispatched = guarded_dispatch(&data_dir, &request,
                || data::get_data_dir(app), |unit| {
                    let before = daily_reuse_context(app, &job_id, &key, &token_dir);
                    fetch_reuse.observe_context(before.clone());
                    if let Some(context) = before.as_ref() {
                        if let Some(response) = fetch_reuse.take_for(context, unit) {
                            if daily_reuse_context(app, &job_id, &key, &token_dir).as_ref() == Some(context) { return Ok(response); }
                            fetch_reuse.clear();
                        }
                    }
                    let response = crate::garmin_sync::protocol::run_python_unit(&mut cmd, unit)?;
                    let after = daily_reuse_context(app, &job_id, &key, &token_dir);
                    source_context = if before == after { after } else { fetch_reuse.clear(); None };
                    Ok(response)
                });
            let (mut response, _request_guard) = match dispatched {
            Ok(pair) => pair,
            Err(error) => {
                fetch_reuse.clear();
                let entry = crate::health_db::GarminClassEntry { class_id: class_id.into(), local_date: date.into(), external_id: external_id.map(str::to_string),
                    completeness: "failed".into(), content_hash: None, parser_version: None, payload: None,
                    error_code: Some("fetch_failed".into()), error_summary: Some("Garmin unit fetch failed".into()) };
                crate::health_db::garmin_apply_unit(&data_dir, GarminApplyUnitRequest { expected_data_dir_key:key.clone(), run_id:job_id.clone(), job_id:job_id.clone(), work_item_id:item.work_item_id.clone(), attempt_generation:item.attempt_generation, expected_attempt_count:attempt_count, entry, result_code:"failed".into(), error_code:Some("fetch_failed".into()), pause_state:None, pause_reason:None }).map_err(|e| e.to_string())?;
                let _ = error;
                break None;
            }
            };
            if !matches!(response.outcome.as_str(), "rate_limited" | "token_invalid") {
                if let Some(context) = source_context.as_ref() {
                    for entry in &response.related_entries {
                        let companion = if class_id == "sleep_night" { "nap" } else if class_id == "nap" { "sleep_night" } else { "" };
                        if !companion.is_empty() && entry.get("classId").and_then(Value::as_str) == Some(companion)
                            && entry.get("localDate").and_then(Value::as_str) == Some(date) {
                            fetch_reuse.insert(context, entry.clone());
                        }
                    }
                }
            } else { fetch_reuse.clear(); }
            if response.outcome != "retryable_failure" || attempt_count >= GARMIN_UNIT_MAX_ATTEMPTS {
                break Some(response);
            }
            fetch_reuse.clear();
            if let Some((code, message)) = crate::garmin_sync::legacy_gate_error() {
                let _ = (code, message);
                response.outcome = "rate_limited".into();
                break Some(response);
            }
            if crate::garmin_sync::data_dir_key(&data::get_data_dir(app)?) != key {
                checkpoint_daily_archive_failure(&data_dir, &job_id, &item.work_item_id, "dataDir changed before retry")?;
                return Err("dataDir changed before retry".into());
            }
            std::thread::sleep(garmin_retry_delay(attempt_count, item.attempt_count));
            let updated = crate::productivity_db::coordinator::with_write_expected(&data_dir, |conn| crate::productivity_db::coordinator::in_transaction(conn, |tx| {
                let job_state: String = tx.query_row("SELECT state FROM garmin_sync_job WHERE job_id=?1 AND data_dir_key=?2", rusqlite::params![job_id, key], |r| r.get(0))
                    .map_err(crate::productivity_db::DomainError::from)?;
                if job_state != "running" && job_state != "queued" {
                    tx.execute("UPDATE garmin_sync_work_item SET state='pending', result_code='retry_deferred', revision=revision+1 WHERE work_item_id=?1 AND state='fetching' AND attempt_count=?2", rusqlite::params![item.work_item_id, attempt_count])
                        .map_err(crate::productivity_db::DomainError::from)?;
                    return Ok(false);
                }
                let changed = tx.execute("UPDATE garmin_sync_work_item SET attempt_count=attempt_count+1, revision=revision+1 WHERE work_item_id=?1 AND state='fetching' AND attempt_count=?2", rusqlite::params![item.work_item_id, attempt_count])
                    .map_err(crate::productivity_db::DomainError::from)?;
                Ok(changed == 1)
            })).map_err(String::from)?;
            if !updated { stop_job = true; break None; }
            attempt_count += 1;
        };
        let Some(response) = response else {
            if stop_job { break; }
            continue;
        };
        let mut completeness = match response.outcome.as_str() {
            "complete" => "complete", "no_data" => "empty", "empty_unverified" => "empty", "incomplete" => "incomplete",
            _ => "failed",
        };
        let mut entry = if let Some(payload) = response.payload.clone() {
            serde_json::from_value::<crate::health_db::GarminClassEntry>(payload).unwrap_or_else(|_| {
                completeness = "failed";
                crate::health_db::GarminClassEntry {
                    class_id: class_id.into(), local_date: date.into(), external_id: external_id.map(str::to_string),
                    completeness: "failed".into(), content_hash: None, parser_version: Some(2), payload: None,
                    error_code: Some("invalid_payload".into()), error_summary: Some("normalized unit payload invalid".into()),
                }
            })
        } else {
            crate::health_db::GarminClassEntry { class_id:class_id.into(), local_date:date.into(), external_id:external_id.map(str::to_string), completeness:completeness.into(),
                content_hash:response.content_hash.clone(), parser_version:Some(2), payload:None,
                error_code:Some(response.outcome.clone()), error_summary:None }
        };
        if entry.class_id != class_id || entry.local_date != date || external_id.is_some_and(|id| entry.external_id.as_deref() != Some(id))
            || entry.completeness == "complete" && (entry.payload.is_none() || entry.content_hash.as_deref().map_or(true, str::is_empty))
        {
            completeness = "failed";
            entry.completeness = "failed".into();
            entry.payload = None;
            entry.content_hash = None;
            entry.error_code = Some("invalid_payload".into());
            entry.error_summary = Some("normalized unit identity or complete payload is invalid".into());
        }
        // The worker boundary rechecks the gate and active directory after the fetch. Recheck
        // once more at the transaction boundary; a concurrent 429 still checkpoints this item
        // as a gap, while dataDir changes are rejected by the expected coordinator write.
        let active_dir = data::get_data_dir(app)?;
        if crate::garmin_sync::data_dir_key(&active_dir) != key {
            return Err("dataDir changed before Garmin unit apply".into());
        }
        let gate_closed_after_fetch = crate::garmin_sync::legacy_gate_error().is_some()
            && response.outcome != "rate_limited";
        if gate_closed_after_fetch {
            completeness = "failed";
            entry.completeness = "failed".into();
            entry.payload = None;
            entry.content_hash = None;
            entry.error_code = Some("rate_limit_latched".into());
            entry.error_summary = Some("Garmin global gate closed before apply".into());
        }
        let result_code = response.outcome.clone();
        let apply_error_code = if completeness == "complete" { None } else { entry.error_code.clone().or_else(|| Some(result_code.clone())) };
        let applied = crate::health_db::garmin_apply_unit(&data_dir, GarminApplyUnitRequest {
            expected_data_dir_key:key.clone(), run_id:job_id.clone(), job_id:job_id.clone(), work_item_id:item.work_item_id.clone(),
            attempt_generation:item.attempt_generation, expected_attempt_count:attempt_count,
            entry, result_code:result_code.clone(), error_code:apply_error_code,
            pause_state: if response.outcome == "rate_limited" || gate_closed_after_fetch { Some("blocked_rate_limit".into()) } else if response.outcome == "token_invalid" { Some("paused".into()) } else { None },
            pause_reason: if response.outcome == "rate_limited" || gate_closed_after_fetch { Some("rate_limit".into()) } else if response.outcome == "token_invalid" { Some("token".into()) } else { None },
        });
        let applied = match applied {
            Ok(value) => value,
            Err(error) => {
                checkpoint_daily_archive_failure(&data_dir, &job_id, &item.work_item_id, &error.to_string())?;
                return Err(error.to_string());
            }
        };
        if matches!(applied.outcome.as_str(), "replaced" | "skipped_same_hash" | "no_data") { completed += 1; }
        if response.outcome == "rate_limited" {
            break;
        }
        if response.outcome == "token_invalid" {
            break;
        }
        if gate_closed_after_fetch {
            break;
        }
    }
    finish_daily_run(&data_dir, &job_id)?;
    let succeeded = daily_compatibility_success(&data_dir, &job_id, &key)?;
    Ok(GarminSyncResponse { ok:succeeded, message:if succeeded {None} else {Some("Garmin 同步尚未完整成功，部分数据仍待处理或存在缺口".into())},
        reason:if succeeded {None} else {Some("daily_incomplete".into())}, daily_count:Some(completed), exercise_count:Some(0), routine_count:Some(0), resume_job: None })
}

fn daily_date_in_range(date: &str, from: &str, to: &str) -> bool {
    use chrono::NaiveDate;
    let Some(date_value) = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
        .filter(|d| d.format("%Y-%m-%d").to_string() == date) else { return false };
    let (Ok(from), Ok(to)) = (NaiveDate::parse_from_str(from, "%Y-%m-%d"), NaiveDate::parse_from_str(to, "%Y-%m-%d")) else { return false };
    date_value >= from && date_value <= to
}

fn daily_dispatch_target_is_valid(item: &crate::garmin_sync::WorkItemSnapshot, from: &str, to: &str) -> bool {
    let Some((date, target)) = item.target_key.split_once('|') else { return false };
    if !daily_date_in_range(date, from, to) { return false; }
    match item.kind.as_str() {
        crate::garmin_sync::KIND_FETCH_DAILY_CLASS => crate::garmin_sync::DAILY_CLASS_IDS.contains(&target),
        "fetch_activity_summary" => target.strip_prefix("activity:")
            .is_some_and(|id| !id.trim().is_empty() && !id.contains('|')),
        _ => false,
    }
}

fn daily_compatibility_success(data_dir: &str, job_id: &str, expected_key: &str) -> Result<bool, String> {
    crate::productivity_db::coordinator::with_read(data_dir, |conn| {
        let conn = conn.ok_or_else(|| crate::productivity_db::DomainError::archive_lifecycle("archive not initialized"))?;
        crate::productivity_db::coordinator::in_transaction(conn, |tx| {
            let job = crate::garmin_sync::store::get_job(tx, job_id).map_err(crate::productivity_db::DomainError::from)?;
            let items = crate::garmin_sync::store::list_items_for_job(tx, job_id).map_err(crate::productivity_db::DomainError::from)?;
            Ok(daily_snapshot_is_success(&job, &items, expected_key))
        })
    }).map_err(String::from)
}

fn daily_snapshot_is_success(
    job: &crate::garmin_sync::JobSnapshot,
    items: &[crate::garmin_sync::WorkItemSnapshot],
    expected_key: &str,
) -> bool {
    use chrono::NaiveDate;
    use std::collections::HashSet;
    if job.data_dir_key != expected_key || job.kind != crate::garmin_sync::KIND_DAILY
        || job.state != crate::garmin_sync::JOB_COMPLETED || job.finished_at_utc.is_none() {
        return false;
    }
    let (Ok(from), Ok(to)) = (NaiveDate::parse_from_str(&job.from_date, "%Y-%m-%d"), NaiveDate::parse_from_str(&job.to_date, "%Y-%m-%d")) else { return false };
    if (to - from).num_days() != 6 { return false; }
    if from.format("%Y-%m-%d").to_string() != job.from_date || to.format("%Y-%m-%d").to_string() != job.to_date
        || job.timezone_policy != "Asia/Shanghai" { return false; }
    let mut expected = HashSet::new();
    for offset in 0..7 {
        let date = (from + chrono::Duration::days(offset)).format("%Y-%m-%d").to_string();
        for class_id in crate::garmin_sync::DAILY_CLASS_IDS {
            expected.insert(format!("{date}|{class_id}"));
        }
    }
    let mut seen_daily = HashSet::new();
    let mut seen_summary = HashSet::new();
    let mut seen_external = HashSet::new();
    let mut discovery_count = 0usize;
    for item in items {
        if item.state == "cancelled" && matches!(item.result_code.as_deref(), Some("outside_current_daily_range" | "historical_daily_window" | "invalid_target" | "duplicate_activity_id_conflict" | "duplicate_current_marker")) { continue; }
        if item.kind == crate::garmin_sync::KIND_FETCH_DAILY_CLASS {
            if let Some((date, _)) = item.target_key.split_once('|') {
                if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok_and(|parsed| parsed.format("%Y-%m-%d").to_string() == date && (parsed < from || parsed > to)) { continue; }
            }
            if item.attempt_generation <= 0 || !expected.contains(&item.target_key) || !seen_daily.insert(item.target_key.as_str())
                || !matches!(item.state.as_str(), "succeeded" | "skipped_same_hash") { return false; }
        } else if item.kind == "fetch_activity_summary" {
            let Some((date, activity)) = item.target_key.split_once('|') else { return false };
            if let Ok(parsed) = NaiveDate::parse_from_str(date, "%Y-%m-%d") {
                if parsed.format("%Y-%m-%d").to_string() == date && (parsed < from || parsed > to) { continue; }
            }
            let Some(external) = activity.strip_prefix("activity:").filter(|id| !id.trim().is_empty() && !id.contains('|')) else { return false };
            if item.attempt_generation <= 0 || !daily_date_in_range(date, &job.from_date, &job.to_date)
                || !seen_summary.insert(item.target_key.as_str()) || !seen_external.insert(external)
                || !matches!(item.state.as_str(), "succeeded" | "skipped_same_hash") { return false; }
        } else if item.kind == "activity_list_discovery" {
            if item.target_key != format!("{}|activity_list_discovery", job.from_date) { continue; }
            discovery_count += 1;
            if item.attempt_generation <= 0 || !matches!(item.state.as_str(), "succeeded" | "skipped_same_hash") { return false; }
        }
    }
    discovery_count == 1
        && seen_daily.len() == expected.len()
        && seen_daily.iter().all(|target| expected.contains(*target))
}

fn checkpoint_daily_pause(data_dir:&str, job_id:&str, state:&str, code:Option<&str>, summary:&str)->Result<(),String> {
    crate::productivity_db::coordinator::with_write_expected(data_dir, |conn| crate::productivity_db::coordinator::in_transaction(conn, |tx| {
        tx.execute("UPDATE garmin_sync_job SET state=?1, pause_reason=?2, error_code=?3, error_summary=?4, revision=revision+1, updated_at_utc=?5 WHERE job_id=?6",
            rusqlite::params![state, if state=="paused" {Some("token")} else {Some("rate_limit")}, code, summary, crate::garmin_sync::utc_now(), job_id])
            .map_err(crate::productivity_db::DomainError::from)?;
        Ok(())
    })).map_err(String::from)
}

fn checkpoint_daily_archive_failure(data_dir: &str, job_id: &str, work_item_id: &str, summary: &str) -> Result<(), String> {
    let key = crate::garmin_sync::data_dir_key(data_dir);
    crate::productivity_db::coordinator::with_write_expected(data_dir, |conn| crate::productivity_db::coordinator::in_transaction(conn, |tx| {
        let bound: String = tx.query_row("SELECT data_dir_key FROM garmin_sync_job WHERE job_id=?1", [job_id], |r| r.get(0))
            .map_err(crate::productivity_db::DomainError::from)?;
        if bound != key { return Err(crate::productivity_db::DomainError::archive_lifecycle("job dataDir binding changed")); }
        tx.execute("UPDATE garmin_sync_work_item SET state='gap', error_code='archive_apply_failed', result_code='archive_apply_failed', revision=revision+1 WHERE work_item_id=?1 AND job_id=?2 AND state='fetching'", rusqlite::params![work_item_id, job_id])
            .map_err(crate::productivity_db::DomainError::from)?;
        tx.execute("UPDATE garmin_sync_job SET state='paused', pause_reason='archive_error', error_code='archive_apply_failed', error_summary=?1, revision=revision+1, updated_at_utc=?2 WHERE job_id=?3 AND data_dir_key=?4", rusqlite::params![summary.chars().take(180).collect::<String>(), crate::garmin_sync::utc_now(), job_id, key])
            .map_err(crate::productivity_db::DomainError::from)?;
        Ok(())
    })).map_err(String::from)
}

fn finish_daily_run(data_dir:&str, run_id:&str)->Result<(),String> {
    crate::productivity_db::coordinator::with_write_expected(data_dir, |conn| crate::productivity_db::coordinator::in_transaction(conn, |tx| {
        let now = crate::garmin_sync::utc_now();
        tx.execute("UPDATE garmin_sync_run SET finished_at_utc=CASE WHEN EXISTS(SELECT 1 FROM garmin_sync_work_item WHERE job_id=?2 AND state IN ('pending','fetching','staged','committing')) THEN NULL ELSE ?1 END, overall_status=CASE WHEN EXISTS(SELECT 1 FROM garmin_sync_work_item WHERE job_id=?2 AND state IN ('pending','fetching','staged','committing')) THEN 'paused' WHEN EXISTS(SELECT 1 FROM garmin_sync_work_item WHERE job_id=?2 AND state='gap') THEN 'partial_success' ELSE 'success' END, submitted_class_count=(SELECT COUNT(*) FROM garmin_sync_work_item WHERE job_id=?2 AND state='succeeded'), skipped_same_hash_count=(SELECT COUNT(*) FROM garmin_sync_work_item WHERE job_id=?2 AND result_code='skipped_same_hash'), retained_gap_count=(SELECT COUNT(*) FROM garmin_sync_work_item WHERE job_id=?2 AND state='gap') WHERE id=?2",
            rusqlite::params![now, run_id]).map_err(crate::productivity_db::DomainError::from)?;
        Ok(())
    })).map_err(String::from)
}

#[cfg(test)]
mod daily_retry_tests {
    use super::{daily_snapshot_is_success, garmin_retry_delay, reconcile_activity_discovery_success, GARMIN_UNIT_MAX_ATTEMPTS};
    use crate::garmin_sync::{JobSnapshot, WorkItemSnapshot};
    use std::time::Duration;

    #[test]
    fn retry_backoff_is_bounded_and_attempt_count_is_finite() {
        assert_eq!(GARMIN_UNIT_MAX_ATTEMPTS, 3);
        assert_eq!(garmin_retry_delay(1, 0), Duration::from_secs(1));
        assert_eq!(garmin_retry_delay(2, 0), Duration::from_secs(2));
        assert_eq!(garmin_retry_delay(3, 0), Duration::from_secs(4));
        assert_eq!(garmin_retry_delay(8, 0), Duration::from_secs(4));
    }

    fn job(state: &str) -> JobSnapshot {
        JobSnapshot { job_id:"job".into(), data_dir_key:"key".into(), kind:"daily".into(), from_date:"2026-10-07".into(), to_date:"2026-10-13".into(),
            timezone_policy:"Asia/Shanghai".into(), intent:"daily_core".into(), force_details:false, force_original:false, scan_id:None, manifest_hash:None,
            state:state.into(), pause_reason:None, revision:1, phase_stats_json:"{}".into(), error_code:None, error_summary:None, request_id:None,
            created_at_utc:"now".into(), updated_at_utc:"now".into(), started_at_utc:Some("now".into()), finished_at_utc:Some("now".into()) }
    }

    fn item(kind: &str, target: String, state: &str) -> WorkItemSnapshot {
        WorkItemSnapshot { work_item_id:uuid::Uuid::new_v4().to_string(), job_id:"job".into(), kind:kind.into(), target_key:target,
            priority:1, state:state.into(), attempt_count:1, attempt_generation:1, next_attempt_at_utc:None,
            idempotency_key:"i".into(), input_hash:None, committed_hash:None, asset_version_id:None, revision:1, error_code:None, result_code:None }
    }

    fn complete_items() -> Vec<WorkItemSnapshot> {
        let mut items = vec![item("activity_list_discovery", "2026-10-07|activity_list_discovery".into(), "succeeded")];
        for day in 7..=13 {
            let date = format!("2026-10-{day:02}");
            for class_id in crate::garmin_sync::DAILY_CLASS_IDS { items.push(item("fetch_daily_class", format!("{date}|{class_id}"), "succeeded")); }
        }
        items
    }

    #[test]
    fn activity_discovery_deduplicates_identical_rows_and_flags_identity_conflicts() {
        let same = serde_json::json!({"externalId":"42","localDate":"2026-10-07","activityType":"run"});
        let (deduped, conflicts) = super::classify_daily_activity_list(&[same.clone(), same], &job("running"));
        assert_eq!(deduped.len(), 1);
        assert!(conflicts.is_empty());

        let first = serde_json::json!({"externalId":"42","localDate":"2026-10-07","activityType":"run"});
        let other_date = serde_json::json!({"externalId":"42","localDate":"2026-10-08","activityType":"run"});
        let (deduped, conflicts) = super::classify_daily_activity_list(&[first.clone(), other_date], &job("running"));
        assert_eq!(deduped.len(), 1);
        assert!(conflicts.contains("42"));

        let changed_content = serde_json::json!({"externalId":"42","localDate":"2026-10-07","activityType":"walk"});
        let (_, conflicts) = super::classify_daily_activity_list(&[first, changed_content], &job("running"));
        assert!(conflicts.contains("42"));
    }

    #[test]
    fn zero_gap_paused_or_pending_job_is_not_compatibility_success() {
        let mut items = complete_items();
        items.push(item("fetch_daily_class", "2026-10-13|sleep_night".into(), "pending"));
        assert!(!daily_snapshot_is_success(&job("paused"), &items, "key"));
    }

    #[test]
    fn complete_terminal_snapshot_is_compatibility_success() {
        assert!(daily_snapshot_is_success(&job("completed"), &complete_items(), "key"));
        assert!(!daily_snapshot_is_success(&job("completed"), &complete_items(), "other-data-dir-key"));
    }

    #[test]
    fn compatibility_success_rejects_duplicate_generations_but_ignores_history() {
        let mut duplicate = complete_items();
        duplicate.push(duplicate[1].clone());
        assert!(!daily_snapshot_is_success(&job("completed"), &duplicate, "key"));

        let mut outside = complete_items();
        outside.push(item("fetch_activity_summary", "2026-10-14|activity:outside".into(), "succeeded"));
        outside.push(item("activity_list_discovery", "2026-09-30|activity_list_discovery".into(), "succeeded"));
        assert!(daily_snapshot_is_success(&job("completed"), &outside, "key"));
    }

    #[test]
    fn daily_dispatch_accepts_only_canonical_in_range_targets() {
        let valid = item("fetch_activity_summary", "2026-10-13|activity:123".into(), "pending");
        assert!(super::daily_dispatch_target_is_valid(&valid, "2026-10-07", "2026-10-13"));
        let malformed = item("fetch_daily_class", "2026-10-13:sleep_night".into(), "pending");
        assert!(!super::daily_dispatch_target_is_valid(&malformed, "2026-10-07", "2026-10-13"));
        let outside = item("fetch_activity_summary", "2026-10-14|activity:123".into(), "pending");
        assert!(!super::daily_dispatch_target_is_valid(&outside, "2026-10-07", "2026-10-13"));
    }

    #[test]
    fn incomplete_discovery_is_not_compatibility_success() {
        let mut items = complete_items();
        items[0].state = "gap".into();
        assert!(!daily_snapshot_is_success(&job("completed"), &items, "key"));
    }

    #[test]
    fn successful_discovery_reconciles_prior_gap_in_same_job() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE garmin_sync_work_item (work_item_id TEXT PRIMARY KEY, job_id TEXT, kind TEXT, target_key TEXT, priority INTEGER, state TEXT, attempt_count INTEGER, attempt_generation INTEGER, next_attempt_at_utc TEXT, idempotency_key TEXT, input_hash TEXT, committed_hash TEXT, asset_version_id TEXT, revision INTEGER, error_code TEXT, result_code TEXT); CREATE TABLE garmin_sync_job (job_id TEXT PRIMARY KEY, kind TEXT, state TEXT, finished_at_utc TEXT, pause_reason TEXT, updated_at_utc TEXT, error_code TEXT, error_summary TEXT, revision INTEGER);").unwrap();
        conn.execute("INSERT INTO garmin_sync_work_item VALUES ('discovery','job','activity_list_discovery','2026-10-07|activity_list_discovery',1,'gap',1,1,NULL,'i',NULL,NULL,NULL,1,'activity_list_incomplete','incomplete')", []).unwrap();
        conn.execute("INSERT INTO garmin_sync_job VALUES ('job','daily','partial',NULL,NULL,'old','activity_list_incomplete','incomplete list',1)", []).unwrap();
        let tx = conn.transaction().unwrap();
        reconcile_activity_discovery_success(&tx, &job("running")).unwrap();
        reconcile_activity_discovery_success(&tx, &job("running")).unwrap();
        tx.commit().unwrap();
        let item: (String, String, String) = conn.query_row("SELECT state,result_code,error_code FROM garmin_sync_work_item WHERE work_item_id='discovery'", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(item, ("succeeded".into(), "complete_after_retry".into(), "activity_list_incomplete".into()));
        let job_error: Option<String> = conn.query_row("SELECT error_code FROM garmin_sync_job WHERE job_id='job'", [], |r| r.get(0)).unwrap();
        assert_eq!(job_error, None);
        let marker_count: i64 = conn.query_row("SELECT COUNT(*) FROM garmin_sync_work_item WHERE job_id='job' AND kind='activity_list_discovery' AND target_key='2026-10-07|activity_list_discovery'", [], |r| r.get(0)).unwrap();
        assert_eq!(marker_count, 1);
    }

    #[test]
    fn discovery_recovery_completes_fully_succeeded_daily_job() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE garmin_sync_work_item (work_item_id TEXT PRIMARY KEY, job_id TEXT, kind TEXT, target_key TEXT, priority INTEGER, state TEXT, attempt_count INTEGER, attempt_generation INTEGER, next_attempt_at_utc TEXT, idempotency_key TEXT, input_hash TEXT, committed_hash TEXT, asset_version_id TEXT, revision INTEGER, error_code TEXT, result_code TEXT); CREATE TABLE garmin_sync_job (job_id TEXT PRIMARY KEY, kind TEXT, state TEXT, finished_at_utc TEXT, pause_reason TEXT, updated_at_utc TEXT, error_code TEXT, error_summary TEXT, revision INTEGER);").unwrap();
        conn.execute("INSERT INTO garmin_sync_job VALUES ('job','daily','partial',NULL,NULL,'old','activity_list_incomplete','incomplete list',1)", []).unwrap();
        conn.execute("INSERT INTO garmin_sync_work_item VALUES ('discovery','job','activity_list_discovery','2026-10-07|activity_list_discovery',1,'gap',1,1,NULL,'i',NULL,NULL,NULL,1,'activity_list_incomplete','incomplete')", []).unwrap();
        for day in 7..=13 {
            for class_id in crate::garmin_sync::DAILY_CLASS_IDS {
                let target = format!("2026-10-{day:02}|{class_id}");
                conn.execute("INSERT INTO garmin_sync_work_item VALUES (?1,'job','fetch_daily_class',?2,1,'succeeded',1,1,NULL,'i',NULL,NULL,NULL,1,NULL,'complete')", rusqlite::params![format!("{day}-{class_id}"), target]).unwrap();
            }
        }
        let tx = conn.transaction().unwrap();
        reconcile_activity_discovery_success(&tx, &job("running")).unwrap();
        tx.commit().unwrap();
        let result: (String, Option<String>, Option<String>) = conn.query_row("SELECT state,finished_at_utc,error_code FROM garmin_sync_job WHERE job_id='job'", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(result.0, "completed");
        assert!(result.1.is_some());
        assert_eq!(result.2, None);
    }

    #[test]
    fn rediscovery_after_rolling_seven_day_window_completes_current_job() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE garmin_sync_work_item (work_item_id TEXT PRIMARY KEY, job_id TEXT, kind TEXT, target_key TEXT, priority INTEGER, state TEXT, attempt_count INTEGER, attempt_generation INTEGER, next_attempt_at_utc TEXT, idempotency_key TEXT, input_hash TEXT, committed_hash TEXT, asset_version_id TEXT, revision INTEGER, error_code TEXT, result_code TEXT); CREATE TABLE garmin_sync_job (job_id TEXT PRIMARY KEY, kind TEXT, state TEXT, finished_at_utc TEXT, pause_reason TEXT, updated_at_utc TEXT, error_code TEXT, error_summary TEXT, revision INTEGER);").unwrap();
        conn.execute("INSERT INTO garmin_sync_job VALUES ('job','daily','running',NULL,NULL,'old',NULL,NULL,1)", []).unwrap();
        conn.execute("INSERT INTO garmin_sync_work_item VALUES ('old-discovery','job','activity_list_discovery','2026-10-07|activity_list_discovery',1,'succeeded',1,1,NULL,'old',NULL,NULL,NULL,1,NULL,'complete')", []).unwrap();
        conn.execute("INSERT INTO garmin_sync_work_item VALUES ('old-summary','job','fetch_activity_summary','2026-10-07|activity:old',1,'succeeded',1,1,NULL,'old',NULL,NULL,NULL,1,NULL,'complete')", []).unwrap();
        for day in 14..=20 {
            for class_id in crate::garmin_sync::DAILY_CLASS_IDS {
                let target = format!("2026-10-{day:02}|{class_id}");
                conn.execute("INSERT INTO garmin_sync_work_item VALUES (?1,'job','fetch_daily_class',?2,1,'succeeded',1,1,NULL,'i',NULL,NULL,NULL,1,NULL,'complete')", rusqlite::params![format!("{day}-{class_id}"), target]).unwrap();
            }
        }
        let mut rolled_job = job("running");
        rolled_job.from_date = "2026-10-14".into();
        rolled_job.to_date = "2026-10-20".into();
        let tx = conn.transaction().unwrap();
        reconcile_activity_discovery_success(&tx, &rolled_job).unwrap();
        tx.commit().unwrap();

        let state: String = conn.query_row("SELECT state FROM garmin_sync_job WHERE job_id='job'", [], |r| r.get(0)).unwrap();
        assert_eq!(state, "completed");
        let current_markers: i64 = conn.query_row("SELECT COUNT(*) FROM garmin_sync_work_item WHERE job_id='job' AND kind='activity_list_discovery' AND target_key='2026-10-14|activity_list_discovery' AND state IN ('pending','fetching','succeeded','gap')", [], |r| r.get(0)).unwrap();
        assert_eq!(current_markers, 1);
    }

    #[test]
    fn duplicate_external_id_across_dates_becomes_retryable_gap_and_partial() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE garmin_sync_work_item (work_item_id TEXT PRIMARY KEY, job_id TEXT, kind TEXT, target_key TEXT, priority INTEGER, state TEXT, attempt_count INTEGER, attempt_generation INTEGER, next_attempt_at_utc TEXT, idempotency_key TEXT, input_hash TEXT, committed_hash TEXT, asset_version_id TEXT, revision INTEGER, error_code TEXT, result_code TEXT); CREATE TABLE garmin_sync_job (job_id TEXT PRIMARY KEY, kind TEXT, state TEXT, finished_at_utc TEXT, pause_reason TEXT, updated_at_utc TEXT, error_code TEXT, error_summary TEXT, revision INTEGER);").unwrap();
        conn.execute("INSERT INTO garmin_sync_job VALUES ('job','daily','running',NULL,NULL,'old',NULL,NULL,1)", []).unwrap();
        conn.execute("INSERT INTO garmin_sync_work_item VALUES ('discovery','job','activity_list_discovery','2026-10-07|activity_list_discovery',1,'succeeded',1,1,NULL,'i',NULL,NULL,NULL,1,NULL,'complete')", []).unwrap();
        for day in 7..=13 {
            for class_id in crate::garmin_sync::DAILY_CLASS_IDS {
                let target = format!("2026-10-{day:02}|{class_id}");
                conn.execute("INSERT INTO garmin_sync_work_item VALUES (?1,'job','fetch_daily_class',?2,1,'succeeded',1,1,NULL,'i',NULL,NULL,NULL,1,NULL,'complete')", rusqlite::params![format!("{day}-{class_id}"), target]).unwrap();
            }
        }
        for (id, date) in [("summary-a", "2026-10-07"), ("summary-b", "2026-10-08")] {
            conn.execute("INSERT INTO garmin_sync_work_item VALUES (?1,'job','fetch_activity_summary',?2,1,'succeeded',1,1,NULL,'i',NULL,NULL,NULL,1,NULL,'complete')", rusqlite::params![id, format!("{date}|activity:42")]).unwrap();
        }
        let tx = conn.transaction().unwrap();
        super::reconcile_daily_job_terminal_state(&tx, &job("running")).unwrap();
        tx.commit().unwrap();

        let state: String = conn.query_row("SELECT state FROM garmin_sync_job WHERE job_id='job'", [], |r| r.get(0)).unwrap();
        assert_eq!(state, "partial");
        let gap_count: i64 = conn.query_row("SELECT COUNT(*) FROM garmin_sync_work_item WHERE job_id='job' AND kind='fetch_activity_summary' AND state='gap' AND error_code='activity_list_identity_conflict' AND result_code='identity_conflict'", [], |r| r.get(0)).unwrap();
        assert_eq!(gap_count, 1);
        let error: Option<String> = conn.query_row("SELECT error_code FROM garmin_sync_job WHERE job_id='job'", [], |r| r.get(0)).unwrap();
        assert_eq!(error.as_deref(), Some("activity_list_identity_conflict"));
    }

    #[test]
    fn reconciliation_rejects_missing_daily_target_replaced_by_wrong_separator() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE garmin_sync_work_item (work_item_id TEXT PRIMARY KEY, job_id TEXT, kind TEXT, target_key TEXT, priority INTEGER, state TEXT, attempt_count INTEGER, attempt_generation INTEGER, next_attempt_at_utc TEXT, idempotency_key TEXT, input_hash TEXT, committed_hash TEXT, asset_version_id TEXT, revision INTEGER, error_code TEXT, result_code TEXT); CREATE TABLE garmin_sync_job (job_id TEXT PRIMARY KEY, kind TEXT, state TEXT, finished_at_utc TEXT, pause_reason TEXT, updated_at_utc TEXT, error_code TEXT, error_summary TEXT, revision INTEGER);").unwrap();
        conn.execute("INSERT INTO garmin_sync_job VALUES ('job','daily','partial',NULL,NULL,'old','activity_list_incomplete','incomplete list',1)", []).unwrap();
        conn.execute("INSERT INTO garmin_sync_work_item VALUES ('discovery','job','activity_list_discovery','2026-10-07|activity_list_discovery',1,'succeeded',1,1,NULL,'i',NULL,NULL,NULL,1,NULL,'complete')", []).unwrap();
        let missing = "2026-10-13|sleep_night";
        for day in 7..=13 {
            for class_id in crate::garmin_sync::DAILY_CLASS_IDS {
                let target = format!("2026-10-{day:02}|{class_id}");
                if target == missing { continue; }
                conn.execute("INSERT INTO garmin_sync_work_item VALUES (?1,'job','fetch_daily_class',?2,1,'succeeded',1,1,NULL,'i',NULL,NULL,NULL,1,NULL,'complete')", rusqlite::params![format!("{day}-{class_id}"), target]).unwrap();
            }
        }
        conn.execute("INSERT INTO garmin_sync_work_item VALUES ('forged','job','fetch_daily_class','2026-10-13:sleep_night',1,'succeeded',1,1,NULL,'i',NULL,NULL,NULL,1,NULL,'complete')", []).unwrap();

        let tx = conn.transaction().unwrap();
        super::reconcile_daily_job_terminal_state(&tx, &job("running")).unwrap();
        tx.commit().unwrap();

        let state: String = conn.query_row("SELECT state FROM garmin_sync_job WHERE job_id='job'", [], |r| r.get(0)).unwrap();
        assert_eq!(state, "running");
    }
}
