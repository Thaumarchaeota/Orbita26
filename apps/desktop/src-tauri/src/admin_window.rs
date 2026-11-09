use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
    webview::Color,
};
use tauri_plugin_frame::WebviewWindowExt;

use crate::window_shell;

pub const ADMIN_LABEL: &str = "admin";

static ADMIN_HIDDEN_AT: Mutex<Option<Instant>> = Mutex::new(None);
static INSIGHT_HAS_UNSAVED: Mutex<bool> = Mutex::new(false);

const ADMIN_HIDDEN_RELOAD_SECS: u64 = 180;

const NAV_TTL: Duration = Duration::from_secs(300);
// Keep only process-local intent so reloads can reclaim it without persisting stale paths (SPEC-0008 §6).
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct InsightItemNavigationRequest { pub request_id: String, pub expected_data_dir: String, pub expected_data_dir_epoch: u64, pub item_id: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct InsightItemNavigationStatus { pub status: String, pub request_id: String, #[serde(skip_serializing_if="Option::is_none")] pub message: Option<String> }
struct NavigationEntry { request: InsightItemNavigationRequest, created: Instant, claimed_by: Option<String>, status: String, message: Option<String> }
#[derive(Default)]
struct NavigationState { latest_pending: Option<String>, entries: HashMap<String, NavigationEntry> }
static ITEM_NAVIGATION: LazyLock<Mutex<NavigationState>> =
    LazyLock::new(|| Mutex::new(NavigationState { latest_pending: None, entries: HashMap::new() }));

fn expire_navigation(state: &mut NavigationState) {
    let now = Instant::now();
    state.entries.retain(|_, entry| now.duration_since(entry.created) < NAV_TTL);
    if state.latest_pending.as_ref().is_some_and(|id| !state.entries.contains_key(id)) { state.latest_pending = None; }
    if state.entries.len() > 32 {
        let mut ids: Vec<_> = state.entries.iter().map(|(id, entry)| (id.clone(), entry.created)).collect();
        ids.sort_by_key(|(_, created)| *created);
        for (id, _) in ids.into_iter().take(state.entries.len() - 32) { state.entries.remove(&id); }
    }
}

pub fn open_insight_item(app: &AppHandle, request: InsightItemNavigationRequest) -> Result<InsightItemNavigationStatus, String> {
    if request.request_id.trim().is_empty() { return Err("requestId is required".into()); }
    if crate::data::get_data_dir(app)? != request.expected_data_dir { return Err("dataDir changed while navigation was pending".into()); }
    crate::productivity_db::panel::validate_item_target(&request.expected_data_dir, request.expected_data_dir_epoch, &request.item_id).map_err(String::from)?;
    {
        let mut state = ITEM_NAVIGATION.lock().map_err(|_| "navigation queue unavailable".to_string())?;
        expire_navigation(&mut state);
        if let Some(existing) = state.entries.get(&request.request_id) {
            return Ok(InsightItemNavigationStatus { status: existing.status.clone(), request_id: request.request_id, message: existing.message.clone() });
        }
        if let Some(old_id) = state.latest_pending.take() {
            if let Some(old) = state.entries.get_mut(&old_id) { old.status = "cancelled".into(); old.message = Some("replaced by a newer navigation request".into()); old.claimed_by = None; }
        }
        state.entries.insert(request.request_id.clone(), NavigationEntry { request: request.clone(), created: Instant::now(), claimed_by: None, status: "accepted".into(), message: None });
        state.latest_pending = Some(request.request_id.clone());
    }
    if let Err(error) = open_admin_window(app) {
        finish_navigation(&request.request_id, "failed", Some(error.clone()));
        return Err(error);
    }
    let _ = app.emit("insight-item-navigation-requested", serde_json::json!({"requestId":request.request_id}));
    Ok(InsightItemNavigationStatus { status: "accepted".into(), request_id: request.request_id, message: None })
}

pub fn claim_insight_item_navigation(app: &AppHandle, request: ClaimItemNavigationRequest) -> Result<Option<InsightItemNavigationRequest>, String> {
    if request.host_instance_id.trim().is_empty() { return Err("hostInstanceId is required".into()); }
    let (id, target) = {
        let mut state = ITEM_NAVIGATION.lock().map_err(|_| "navigation queue unavailable".to_string())?;
        expire_navigation(&mut state);
        let Some(id) = state.latest_pending.clone() else { return Ok(None); };
        let Some(entry) = state.entries.get(&id) else { state.latest_pending = None; return Ok(None); };
        if entry.status != "accepted" { state.latest_pending = None; return Ok(None); }
        (id, entry.request.clone())
    };
    let validation = if crate::data::get_data_dir(app)? != target.expected_data_dir {
        Err("dataDir changed while navigation was pending".to_string())
    } else {
        crate::productivity_db::panel::validate_item_target(&target.expected_data_dir, target.expected_data_dir_epoch, &target.item_id).map_err(String::from)
    };
    let mut state = ITEM_NAVIGATION.lock().map_err(|_| "navigation queue unavailable".to_string())?;
    expire_navigation(&mut state);
    if state.latest_pending.as_deref() != Some(id.as_str()) { return Ok(None); }
    if let Err(error) = validation {
        state.latest_pending = None;
        let entry = state.entries.get_mut(&id).ok_or_else(|| "navigation request expired".to_string())?;
        if entry.status != "accepted" { return Ok(None); }
        entry.status = "cancelled".into(); entry.message = Some(error.clone()); entry.claimed_by = None;
        return Err(error);
    }
    let entry = state.entries.get_mut(&id).ok_or_else(|| "navigation request expired".to_string())?;
    if entry.status != "accepted" { return Ok(None); }
    entry.claimed_by = Some(request.host_instance_id);
    Ok(Some(target))
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ClaimItemNavigationRequest { pub host_instance_id: String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct AckItemNavigationRequest { pub request_id: String, pub host_instance_id: String, pub result: AckItemNavigationResult }
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct AckItemNavigationResult { pub status: String, pub message: Option<String> }
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct GetItemNavigationResultRequest { pub request_id: String }

fn finish_navigation(id: &str, status: &str, message: Option<String>) -> Result<InsightItemNavigationStatus, String> {
    let mut state = ITEM_NAVIGATION.lock().map_err(|_| "navigation queue unavailable".to_string())?;
    expire_navigation(&mut state);
    let is_latest = state.latest_pending.as_deref() == Some(id);
    {
        let entry = state.entries.get_mut(id).ok_or_else(|| "navigation request expired".to_string())?;
        if entry.status != "accepted" || !is_latest {
            return Ok(InsightItemNavigationStatus { status: entry.status.clone(), request_id: id.to_string(), message: entry.message.clone() });
        }
        entry.status = status.to_string(); entry.message = message.clone(); entry.claimed_by = None;
    };
    state.latest_pending = None;
    Ok(InsightItemNavigationStatus { status: status.to_string(), request_id: id.to_string(), message })
}

fn finish_navigation_ack(id: &str, host_instance_id: &str, status: &str, message: Option<String>) -> Result<InsightItemNavigationStatus, String> {
    let mut state = ITEM_NAVIGATION.lock().map_err(|_| "navigation queue unavailable".to_string())?;
    expire_navigation(&mut state);
    let is_latest = state.latest_pending.as_deref() == Some(id);
    {
        let entry = state.entries.get_mut(id).ok_or_else(|| "navigation request expired".to_string())?;
        // Cancellation/replacement wins races with an old Host finishing its work (SPEC-0008 §6).
        if entry.status != "accepted" || !is_latest {
            return Ok(InsightItemNavigationStatus { status: entry.status.clone(), request_id: id.to_string(), message: entry.message.clone() });
        }
        if entry.claimed_by.as_deref() != Some(host_instance_id) { return Err("navigation claim does not match host".into()); }
        entry.status = status.to_string(); entry.message = message.clone(); entry.claimed_by = None;
    }
    state.latest_pending = None;
    Ok(InsightItemNavigationStatus { status: status.to_string(), request_id: id.to_string(), message })
}

pub fn ack_insight_item_navigation(app: &AppHandle, request: AckItemNavigationRequest) -> Result<InsightItemNavigationStatus, String> {
    if !matches!(request.result.status.as_str(), "opened" | "cancelled" | "failed") { return Err("invalid navigation result status".into()); }
    let target = {
        let state = ITEM_NAVIGATION.lock().map_err(|_| "navigation queue unavailable".to_string())?;
        let entry = state.entries.get(&request.request_id).ok_or_else(|| "navigation request expired".to_string())?;
        if entry.status != "accepted" || state.latest_pending.as_deref() != Some(request.request_id.as_str()) {
            return Ok(InsightItemNavigationStatus { status: entry.status.clone(), request_id: request.request_id, message: entry.message.clone() });
        }
        if entry.claimed_by.as_deref() != Some(request.host_instance_id.as_str()) { return Err("navigation claim does not match host".into()); }
        entry.request.clone()
    };
    let validation = if crate::data::get_data_dir(app)? != target.expected_data_dir {
        Err("dataDir changed while navigation was pending".to_string())
    } else {
        crate::productivity_db::panel::validate_item_target(&target.expected_data_dir, target.expected_data_dir_epoch, &target.item_id).map_err(String::from)
    };
    if let Err(message) = validation { return finish_navigation_ack(&request.request_id, &request.host_instance_id, "cancelled", Some(message)); }
    finish_navigation_ack(&request.request_id, &request.host_instance_id, &request.result.status, request.result.message)
}

pub fn get_insight_item_navigation_result(app: &AppHandle, request: GetItemNavigationResultRequest) -> Result<InsightItemNavigationStatus, String> {
    let stale = {
        let state = ITEM_NAVIGATION.lock().map_err(|_| "navigation queue unavailable".to_string())?;
        let entry = state.entries.get(&request.request_id).ok_or_else(|| "navigation request expired".to_string())?;
        entry.status == "accepted" && crate::data::get_data_dir(app)? != entry.request.expected_data_dir
    };
    if stale { return finish_navigation(&request.request_id, "cancelled", Some("dataDir changed while navigation was pending".into())); }
    let mut state = ITEM_NAVIGATION.lock().map_err(|_| "navigation queue unavailable".to_string())?;
    expire_navigation(&mut state);
    let entry = state.entries.get(&request.request_id).ok_or_else(|| "navigation request expired".to_string())?;
    Ok(InsightItemNavigationStatus { status: entry.status.clone(), request_id: request.request_id, message: entry.message.clone() })
}

pub fn set_insight_has_unsaved(has_unsaved: bool) {
    *INSIGHT_HAS_UNSAVED.lock().unwrap() = has_unsaved;
}

pub fn insight_has_unsaved() -> bool {
    *INSIGHT_HAS_UNSAVED.lock().unwrap()
}

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
    // tauri-plugin-frame unlistens frame-page-load on CloseRequested; Insight only hides.
    // Re-bind before reload/show so - □ × survive reopen. docs/DEV.md「Orbita Insight 窗口」
    let _ = win.create_overlay_titlebar();
    if reload {
        if let Err(err) = window_shell::repair_window(&win, true) {
            eprintln!("[orbita admin] repair_window reload failed: {err}");
        }
    } else {
        win.show().map_err(|e| e.to_string())?;
    }
    apply_titlebar_now(&win);
    schedule_titlebar_retry(&win);
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

fn admin_open_should_reload() -> bool {
    // Routine reopen only; fault repair uses repair_window(reload: true) directly.
    // docs/decisions/runtime.md
    if *INSIGHT_HAS_UNSAVED.lock().unwrap() {
        return false;
    }
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

fn is_orbita_navigation(url: &url::Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" => true,
        "http" | "https" => {
            matches!(
                url.host_str(),
                Some("localhost" | "127.0.0.1" | "tauri.localhost" | "[::1]")
            ) || url
                .host_str()
                .is_some_and(|h| h.ends_with(".localhost"))
        }
        _ => false,
    }
}

fn create_admin_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    let app_nav = app.clone();
    let builder = WebviewWindowBuilder::new(
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
        .closable(true);
    // On Windows Tauri's native file-drop handler intercepts HTML drag events.
    // The Insight week view needs those events for its internal arrangement drag.
    // See docs/decisions/runtime.md for the window scope.
    let builder = builder.disable_drag_drop_handler();
    let win = builder
        // Week-view pinch uses Ctrl+wheel. Wry also gates native pinch input on
        // this flag; the Insight entrypoint prevents default whole-page zoom.
        // Scope and unverified native behavior: docs/plans/v0.0.19-work-plan-local-first.md.
        .zoom_hotkeys_enabled(true)
        .on_navigation(move |url| {
            if is_orbita_navigation(url) {
                return true;
            }
            if url.scheme() == "http" || url.scheme() == "https" {
                let _ = app_nav.emit("insight-external-navigation", url.as_str());
            }
            false
        })
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
    for delay_ms in [150_u64, 600, 1600] {
        let win = win.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(delay_ms));
            apply_titlebar_now(&win);
        });
    }
}
