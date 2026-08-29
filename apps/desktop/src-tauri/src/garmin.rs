use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};
use tauri::AppHandle;

use crate::data;
use crate::journal::{self, beijing_now_ts, beijing_today};
use crate::v2ray;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminStatus {
    pub configured: bool,
    pub logged_in: bool,
    pub rate_limited: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminSyncRequest {
    pub from: Option<String>,
    pub to: Option<String>,
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
struct PythonSyncResult {
    ok: bool,
    message: Option<String>,
    reason: Option<String>,
    daily: Option<Vec<DailyItem>>,
    routines: Option<Vec<RoutineItem>>,
    exercises: Option<Vec<ExerciseItem>>,
}

#[derive(Debug, Deserialize)]
struct PythonLoginResult {
    ok: bool,
    message: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RoutineItem {
    date: String,
    night: Map<String, Value>,
    naps: Option<Vec<Map<String, Value>>>,
}

#[derive(Debug, Deserialize)]
struct DailyItem {
    date: String,
    #[serde(rename = "fetchedAt")]
    fetched_at: Option<i64>,
    data: Option<Map<String, Value>>,
}

#[derive(Debug, Deserialize)]
struct ExerciseItem {
    date: String,
    #[serde(rename = "externalId")]
    external_id: String,
    sport: String,
    duration: i64,
    metrics: Option<Map<String, Value>>,
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

fn add_days(date: &str, delta: i64) -> Result<String, String> {
    use chrono::{Duration, NaiveDate};
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|e| e.to_string())?;
    Ok((d + Duration::days(delta))
        .format("%Y-%m-%d")
        .to_string())
}

const SYNC_TIMEOUT: Duration = Duration::from_secs(300);
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

fn run_command_with_timeout(mut cmd: Command, timeout: Duration, timeout_msg: &str) -> Result<Output, String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start python: {e}"))?;

    let stdout_handle = child.stdout.take().map(|mut out| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = out.read_to_end(&mut buf);
            buf
        })
    });
    let stderr_handle = child.stderr.take().map(|mut err| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = err.read_to_end(&mut buf);
            buf
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

    let stdout = stdout_handle
        .map(|h| h.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = stderr_handle
        .map(|h| h.join().unwrap_or_default())
        .unwrap_or_default();
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

pub fn garmin_sync(app: &AppHandle, req: GarminSyncRequest) -> Result<GarminSyncResponse, String> {
    journal::journal_root(app)?;
    let settings = data::read_settings(app)?;
    let to = req.to.unwrap_or_else(beijing_today);
    let from = req.from.unwrap_or_else(|| add_days(&to, -6).unwrap_or(to.clone()));

    let token_dir = resolve_token_dir(app, &settings)?;
    std::fs::create_dir_all(&token_dir).map_err(|e| e.to_string())?;
    let token = token_file(&token_dir);

    if !token_usable(&token) {
        return Ok(GarminSyncResponse {
            ok: false,
            message: Some(
                "\u{5c1a}\u{672a}\u{767b}\u{5f55}\u{4f73}\u{660e}\u{ff0c}\u{8bf7}\u{5230}\u{8bbe}\u{7f6e}\u{586b}\u{5199}\u{90ae}\u{7bb1}\u{5bc6}\u{7801}\u{5e76}\u{70b9}\u{51fb}\u{300c}\u{91cd}\u{65b0}\u{767b}\u{5f55}\u{4f73}\u{660e}\u{300d}".into(),
            ),
            reason: Some("no_token".into()),
            daily_count: None,
            exercise_count: None,
            routine_count: None,
        });
    }

    let script = script_path("garmin_sync.py");
    if !script.is_file() {
        return Ok(GarminSyncResponse {
            ok: false,
            message: Some("garmin_sync.py not found".into()),
            reason: Some("internal".into()),
            daily_count: None,
            exercise_count: None,
            routine_count: None,
        });
    }

    let mut cmd = build_python_cmd(&script);
    apply_v2ray_env(app, &mut cmd);
    cmd.arg("--from")
        .arg(&from)
        .arg("--to")
        .arg(&to)
        .arg("--token-dir")
        .arg(token_dir.to_string_lossy().as_ref());

    let output = match run_command_with_timeout(
        cmd,
        SYNC_TIMEOUT,
        "\u{4f73}\u{660e}\u{540c}\u{6b65}\u{8d85}\u{65f6}\u{ff08}\u{8d85}\u{8fc7} 5 \u{5206}\u{949f}\u{ff09}",
    ) {
        Ok(output) => output,
        Err(message) => {
            return Ok(GarminSyncResponse {
                ok: false,
                message: Some(message),
                reason: Some("sync_timeout".into()),
                daily_count: None,
                exercise_count: None,
                routine_count: None,
            });
        }
    };

    let parsed = match parse_json_stdout::<PythonSyncResult>(&output.stdout, &output.stderr) {
        Ok(p) => p,
        Err((reason, message)) => {
            return Ok(GarminSyncResponse {
                ok: false,
                message: Some(message),
                reason,
                daily_count: None,
                exercise_count: None,
                routine_count: None,
            });
        }
    };

    if !parsed.ok {
        return Ok(GarminSyncResponse {
            ok: false,
            message: parsed.message.or(Some("garmin sync failed".into())),
            reason: parsed.reason,
            daily_count: None,
            exercise_count: None,
            routine_count: None,
        });
    }

    let mut daily_count = 0u32;
    let mut exercise_count = 0u32;
    let mut routine_count = 0u32;
    let fetched = beijing_now_ts();

    if let Some(dailies) = parsed.daily {
        for d in dailies {
            let data_map = d.data.unwrap_or_default();
            journal::upsert_daily_from_garmin(app, &d.date, d.fetched_at.unwrap_or(fetched), data_map)?;
            daily_count += 1;
        }
    }

    if let Some(routines) = parsed.routines {
        for r in routines {
            journal::upsert_routine_night_from_garmin(app, &r.date, r.night, r.naps)?;
            routine_count += 1;
        }
    }

    if let Some(exercises) = parsed.exercises {
        for ex in exercises {
            if ex.sport != "cycling" {
                continue;
            }
            let metrics = ex.metrics.unwrap_or_default();
            journal::upsert_exercise_from_garmin(
                app,
                &ex.date,
                &ex.external_id,
                &ex.sport,
                ex.duration,
                metrics,
            )?;
            exercise_count += 1;
        }
    }

    Ok(GarminSyncResponse {
        ok: true,
        message: None,
        reason: None,
        daily_count: Some(daily_count),
        exercise_count: Some(exercise_count),
        routine_count: Some(routine_count),
    })
}
