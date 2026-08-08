use std::path::PathBuf;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
    webview::Color,
};
use tauri_plugin_frame::WebviewWindowExt;

pub const ADMIN_LABEL: &str = "admin";

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
    let _ = win.create_overlay_titlebar();
    win.show().map_err(|e| e.to_string())?;
    apply_titlebar_now(&win);
    schedule_titlebar_retry(&win);
    win.set_focus().map_err(|e| e.to_string())?;
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
