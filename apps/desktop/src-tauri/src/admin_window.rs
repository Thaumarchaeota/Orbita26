use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
    webview::Color,
};
use tauri_plugin_frame::WebviewWindowExt;

use crate::window_shell;

pub const ADMIN_LABEL: &str = "admin";

static ADMIN_HIDDEN_AT: Mutex<Option<Instant>> = Mutex::new(None);

const ADMIN_HIDDEN_RELOAD_SECS: u64 = 180;

pub fn setup_admin_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(ADMIN_LABEL) {
        attach_admin_window(&win);
    }
}

pub fn open_admin_window(app: &AppHandle) -> Result<(), String> {
    let win = match app.get_webview_window(ADMIN_LABEL) {
        Some(w) => w,
        None => create_admin_window(app)?,
    };
    let reload = admin_open_should_reload();
    ADMIN_HIDDEN_AT.lock().unwrap().take();
    if reload {
        if let Err(err) = window_shell::repair_window(&win, true) {
            eprintln!("[orbita admin] repair_window reload failed: {err}");
        }
        apply_titlebar_now(&win);
        schedule_titlebar_retry(&win);
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let _ = win.create_overlay_titlebar();
    win.show().map_err(|e| e.to_string())?;
    apply_titlebar_now(&win);
    schedule_titlebar_retry(&win);
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

fn admin_open_should_reload() -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    ADMIN_HIDDEN_AT
        .lock()
        .unwrap()
        .map(|t| t.elapsed() >= Duration::from_secs(ADMIN_HIDDEN_RELOAD_SECS))
        .unwrap_or(false)
}

#[cfg(debug_assertions)]
pub fn dev_open_finance_detail(app: &AppHandle) -> Result<(), String> {
    open_admin_window(app)?;
    if let Some(win) = app.get_webview_window(ADMIN_LABEL) {
        let _ = win.eval(
            "setTimeout(() => { location.hash = '#dev-finance-detail'; }, 800);",
        );
    }
    Ok(())
}

fn create_admin_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    let win = WebviewWindowBuilder::new(
        app,
        ADMIN_LABEL,
        WebviewUrl::App(PathBuf::from("index.html?app=admin")),
    )
        .title("Orbita")
        .inner_size(1100.0, 700.0)
        .center()
        .resizable(true)
        .decorations(false)
        .transparent(false)
        .closable(true)
        .build()
        .map_err(|e| e.to_string())?;
    attach_admin_window(&win);
    Ok(win)
}

fn attach_admin_window(win: &tauri::WebviewWindow) {
    if let Ok(icon) = crate::window_icon() {
        let _ = win.set_icon(icon);
    }
    let _ = win.set_background_color(Some(Color(244, 245, 247, 255)));
    let _ = win.create_overlay_titlebar();
    apply_titlebar_now(win);
    schedule_titlebar_retry(win);
    let win_clone = win.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            ADMIN_HIDDEN_AT.lock().unwrap().replace(Instant::now());
            let _ = win_clone.hide();
        }
    });
}

fn apply_titlebar_now(win: &tauri::WebviewWindow) {
    let _ = win.emit("frame-page-load", ());
}

fn schedule_titlebar_retry(win: &tauri::WebviewWindow) {
    let win = win.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        apply_titlebar_now(&win);
    });
}
