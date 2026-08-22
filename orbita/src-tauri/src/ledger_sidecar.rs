use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;

use crate::data;

static LEDGER_CHILD: Mutex<Option<Child>> = Mutex::new(None);
static LEDGER_PORT: Mutex<Option<u16>> = Mutex::new(None);
static LEDGER_DATA_ROOT: Mutex<Option<String>> = Mutex::new(None);
static START_LOCK: Mutex<()> = Mutex::new(());

const HOST: &str = "127.0.0.1";
const PORT_MIN: u16 = 8000;
const PORT_MAX: u16 = 8010;
const EXPECTED_PARSER_REV: &str = "1";

pub fn ledger_data_root(app: &AppHandle) -> Result<String, String> {
    Ok(Path::new(&data::get_data_dir(app)?)
        .join("bill")
        .to_string_lossy()
        .into_owned())
}

fn ledger_log_path() -> PathBuf {
    std::env::temp_dir().join("orbita-ledger.log")
}

fn expected_venv_python() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("python")
        .join(".venv")
        .join("Scripts")
        .join("python.exe")
}

fn python_exe() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("ORBITA_PYTHON") {
        let path = PathBuf::from(&p);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!("ORBITA_PYTHON 指向的路径不存在: {p}"));
    }
    let venv = expected_venv_python();
    if venv.exists() {
        return Ok(venv);
    }
    Err(format!(
        "未找到 Python 虚拟环境: {}。请运行 orbita/python/setup.ps1",
        venv.display()
    ))
}

fn python_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("python")
}

fn tail_log(path: &Path, max_lines: usize) -> String {
    let Ok(content) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

fn health_ok(port: u16) -> bool {
    let url = format!("http://{HOST}:{port}/health");
    let Ok(resp) = reqwest::blocking::get(&url) else {
        return false;
    };
    if !resp.status().is_success() {
        return false;
    }
    let v = resp.json::<serde_json::Value>().ok();
    let ok = v.as_ref().and_then(|v| v.get("ok").and_then(|b| b.as_bool())) == Some(true);
    if !ok {
        return false;
    }
    v.as_ref()
        .and_then(|v| v.get("parser_rev").and_then(|r| r.as_str()))
        == Some(EXPECTED_PARSER_REV)
}

fn port_available(port: u16) -> bool {
    std::net::TcpListener::bind((HOST, port)).is_ok()
}

fn pick_port() -> Option<u16> {
    for port in PORT_MIN..=PORT_MAX {
        if port_available(port) {
            return Some(port);
        }
    }
    None
}

fn sidecar_stale(app: &AppHandle) -> Result<bool, String> {
    let expected = ledger_data_root(app)?;
    let stored = LEDGER_DATA_ROOT.lock().unwrap().clone();
    let has_child = LEDGER_CHILD.lock().unwrap().is_some();
    let has_port = LEDGER_PORT.lock().unwrap().is_some();
    Ok(stored.as_deref() != Some(expected.as_str()) || (has_port && !has_child))
}

pub fn start_sidecar(app: &AppHandle) -> Result<u16, String> {
    let data_root = ledger_data_root(app)?;

    let reuse = {
        let port = *LEDGER_PORT.lock().unwrap();
        let child_alive = LEDGER_CHILD.lock().unwrap().is_some();
        let same_root = LEDGER_DATA_ROOT.lock().unwrap().as_deref() == Some(data_root.as_str());
        match port {
            Some(p) if child_alive && same_root && health_ok(p) => Some(p),
            _ => None,
        }
    };
    if let Some(port) = reuse {
        return Ok(port);
    }
    stop_sidecar();

    let port = pick_port().ok_or("无可用 ledger 端口 (8000-8010)，请关闭占用该端口的旧记账进程后重试")?;

    let py = python_exe()?;
    std::fs::create_dir_all(&data_root)
        .map_err(|e| format!("无法创建账本目录 {}: {e}", data_root))?;

    let log_path = ledger_log_path();
    let mut stderr_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("无法打开 sidecar 日志 {}: {e}", log_path.display()))?;
    let _ = writeln!(
        stderr_file,
        "\n--- ledger sidecar spawn port={port} data_root={data_root} ---"
    );

    let mut cmd = Command::new(&py);
    cmd.current_dir(python_dir())
        .env("ORBITA_LEDGER_DATA_ROOT", &data_root)
        .env("ORBITA_LEDGER_HOST", HOST)
        .env("ORBITA_LEDGER_PORT", port.to_string())
        .args([
            "-m",
            "uvicorn",
            "ledger.main:app",
            "--host",
            HOST,
            "--port",
            &port.to_string(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr_file));

    let child = cmd.spawn().map_err(|e| {
        format!(
            "启动 ledger sidecar 失败: {e}。请确认已运行 orbita/python/setup.ps1"
        )
    })?;
    *LEDGER_CHILD.lock().unwrap() = Some(child);

    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(500));
        if health_ok(port) {
            *LEDGER_PORT.lock().unwrap() = Some(port);
            *LEDGER_DATA_ROOT.lock().unwrap() = Some(data_root);
            return Ok(port);
        }
    }

    stop_sidecar();
    let tail = tail_log(&log_path, 20);
    let mut msg = format!("ledger sidecar 健康检查失败 (日志: {})", log_path.display());
    if !tail.is_empty() {
        msg.push_str(&format!("\n{tail}"));
    }
    Err(msg)
}

pub fn ensure_started(app: &AppHandle) -> Result<u16, String> {
    if sidecar_stale(app)? {
        stop_sidecar();
    } else if let Some(port) = *LEDGER_PORT.lock().unwrap() {
        if health_ok(port) {
            return Ok(port);
        }
        stop_sidecar();
    }

    let _guard = START_LOCK.lock().unwrap();

    if sidecar_stale(app)? {
        stop_sidecar();
    } else if let Some(port) = *LEDGER_PORT.lock().unwrap() {
        if health_ok(port) {
            return Ok(port);
        }
        stop_sidecar();
    }

    if LEDGER_CHILD.lock().unwrap().is_some() {
        for _ in 0..40 {
            std::thread::sleep(Duration::from_millis(500));
            if let Some(port) = *LEDGER_PORT.lock().unwrap() {
                if health_ok(port) {
                    return Ok(port);
                }
            }
        }
        stop_sidecar();
        return Err("ledger sidecar 健康检查超时".into());
    }

    start_sidecar(app)
}

pub fn ensure_started_background(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _ = ensure_started(&app);
    });
}

pub fn api_base() -> Result<String, String> {
    let port = LEDGER_PORT
        .lock()
        .unwrap()
        .ok_or("ledger sidecar 未启动")?;
    Ok(format!("http://{HOST}:{port}"))
}

pub fn restart_sidecar(app: &AppHandle) -> Result<u16, String> {
    stop_sidecar();
    start_sidecar(app)
}

pub fn ledger_bill_nonempty(app: &AppHandle) -> Result<bool, String> {
    let root = PathBuf::from(ledger_data_root(app)?);
    if !root.is_dir() {
        return Ok(false);
    }
    let mut entries = std::fs::read_dir(&root).map_err(|e| format!("无法读取 bill 目录: {e}"))?;
    Ok(entries.next().is_some())
}

pub fn init_ledger_bill(app: &AppHandle, overwrite: bool) -> Result<(), String> {
    let root = PathBuf::from(ledger_data_root(app)?);
    std::fs::create_dir_all(root.join("ledger"))
        .map_err(|e| format!("无法创建 ledger 目录: {e}"))?;

    let account = root.join("account.bean");
    if overwrite || !account.is_file() {
        std::fs::write(
            &account,
            "1990-01-01 open Equity:OpenBalance\n\n2026-01-01 open Assets:Cash CNY\n",
        )
        .map_err(|e| format!("无法写入 account.bean: {e}"))?;
    }

    let category = root.join("category.bean");
    if overwrite || !category.is_file() {
        std::fs::write(
            &category,
            "2026-01-01 open Expenses:Misc\n2026-01-01 open Income:Other\n",
        )
        .map_err(|e| format!("无法写入 category.bean: {e}"))?;
    }

    let year = chrono::Local::now().format("%Y").to_string();
    let ledger = root.join("ledger").join(format!("{year}.bean"));
    if overwrite || !ledger.is_file() {
        std::fs::write(&ledger, "").map_err(|e| format!("无法写入 ledger/{year}.bean: {e}"))?;
    }

    let settings_dir = root.join(".bkeasy");
    std::fs::create_dir_all(&settings_dir)
        .map_err(|e| format!("无法创建 .bkeasy 目录: {e}"))?;
    let settings = settings_dir.join("settings.json");
    if overwrite || !settings.is_file() {
        let wt = format!("ledger/{year}.bean");
        let body = format!("{{\"write_target\": \"{wt}\"}}\n");
        std::fs::write(&settings, body).map_err(|e| format!("无法写入 settings.json: {e}"))?;
    }

    Ok(())
}

pub fn stop_sidecar() {
    if let Some(mut child) = LEDGER_CHILD.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *LEDGER_PORT.lock().unwrap() = None;
    *LEDGER_DATA_ROOT.lock().unwrap() = None;
}
