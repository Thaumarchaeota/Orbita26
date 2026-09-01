use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WindowEvent};

mod admin_window;
mod agent;
mod ai;
mod app_icon;
mod bkeasy;
mod beancount;
mod capture;
mod commands;
mod data;
mod dev_watch;
mod ticktick;
mod everything;
mod favicon;
mod file_type_icon;
mod garmin;
mod hwmon;
mod journal_db;
mod journal;
mod ledger_sidecar;
mod obsidian;
mod paths;
mod v2ray;
mod window_shell;
mod zotero;

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        window_shell::attach_to_taskbar(&win);
        if let Err(err) = window_shell::repair_window(&win, true) {
            eprintln!("[orbita window] repair_window on tray show failed: {err}");
        }
    }
}

pub(crate) fn window_icon() -> Result<tauri::image::Image<'static>, String> {
    let bytes = include_bytes!("../icons/logo-source.png");
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    Ok(tauri::image::Image::new_owned(rgba.into_raw(), w, h))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_frame::FramePluginBuilder::new()
                .titlebar_height(32)
                .button_width(46)
                .snap_overlay(false)
                .button_hover_bg("#eef0f4")
                .close_hover_bg("#dc2626")
                .build(),
        )
        .setup(|app| {
            let win = app
                .get_webview_window("main")
                .ok_or("main window not found")?;
            use tauri::webview::Color;
            let _ = win.set_background_color(Some(Color(0, 0, 0, 0)));
            let _ = win.set_skip_taskbar(false);
            let _ = win.set_decorations(false);
            window_shell::fix_transparent_chrome(&win);
            window_shell::bring_to_front(&win);
            let show_item = MenuItem::with_id(app, "tray-show", "显示 Orbita", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let icon = window_icon()?;
            let _ = win.set_icon(icon.clone());
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .menu(&tray_menu)
                .tooltip("Orbita")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray-show" => show_main_window(app),
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            admin_window::setup_admin_window(app.handle());

            let win_for_close = win.clone();
            let win_for_focus = win.clone();
            let blur_at = Mutex::new(None::<Instant>);
            win.on_window_event(move |event| {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        window_shell::hide_to_tray(&win_for_close);
                    }
                    WindowEvent::Focused(false) => {
                        *blur_at.lock().unwrap() = Some(Instant::now());
                    }
                    WindowEvent::Focused(true) => {
                        let reload = blur_at
                            .lock()
                            .unwrap()
                            .map(|t| t.elapsed() >= Duration::from_secs(180))
                            .unwrap_or(false);
                        if let Err(err) = window_shell::repair_window(&win_for_focus, reload) {
                            eprintln!("[orbita window] repair_window on focus failed: {err}");
                        }
                        *blur_at.lock().unwrap() = None;
                    }
                    _ => {}
                }
            });

            hwmon::init();
            dev_watch::start(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_programs_menu_path,
            commands::pick_local_file,
            commands::pick_local_folder,
            commands::open_local_path,
            commands::open_with_cursor,
            commands::open_with_dialog,
            commands::reveal_path_in_explorer,
            commands::open_recycle_bin,
            commands::search_everything,
            commands::pick_app_file,
            commands::cache_app_icon,
            commands::delete_app_icon,
            commands::read_app_icon_data,
            commands::get_file_type_icons,
            commands::cache_favicon,
            commands::delete_favicon,
            commands::launch_v2ray,
            commands::is_v2ray_running,
            commands::stop_v2ray,
            commands::launch_app,
            commands::list_zotero_items,
            commands::list_obsidian_notes,
            commands::open_external_url,
            commands::read_settings,
            commands::write_settings,
            commands::read_ai_config,
            commands::write_ai_config,
            commands::list_ai_conversations,
            commands::read_ai_conversation,
            commands::write_ai_conversation,
            commands::delete_ai_conversation,
            commands::read_bookmarks,
            commands::write_bookmarks,
            commands::read_apps,
            commands::write_apps,
            commands::read_local_files,
            commands::write_local_files,
            commands::migrate_legacy_caches,
            commands::ai_chat_stream,
            commands::ai_chat_abort,
            commands::ai_generate_title,
            commands::agent_tool_confirm,
            commands::agent_tool_reject,
            commands::get_system_stats,
            commands::ticktick_auth_status,
            commands::ticktick_begin_oauth,
            commands::ticktick_finish_oauth,
            commands::ticktick_connect,
            commands::ticktick_disconnect,
            commands::ticktick_list_projects,
            commands::ticktick_filter_tasks,
            commands::ticktick_create_task,
            commands::ticktick_update_task,
            commands::ticktick_complete_task,
            commands::ticktick_reopen_task,
            commands::ticktick_delete_task,
            commands::repair_window,
            commands::journal_list,
            commands::journal_upsert,
            commands::journal_delete,
            commands::bkeasy_summary,
            commands::garmin_status,
            commands::garmin_sync,
            commands::garmin_login,
            commands::health_overview_query,
            commands::health_sync_status,
            commands::capture_screen,
            commands::capture_copy_clipboard,
            commands::capture_save_file,
            commands::capture_crop,
            commands::open_admin_window,
            #[cfg(debug_assertions)]
            commands::dev_open_finance_detail,
            commands::ledger_api_base,
            commands::ensure_ledger_sidecar,
            commands::restart_ledger_sidecar,
            commands::init_ledger_bill,
            commands::ledger_bill_nonempty
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::Ready) {
                if let Some(win) = app.get_webview_window("main") {
                    window_shell::schedule_deferred_fit_work_area(win);
                }
            }
            if matches!(event, RunEvent::Exit) {
                ledger_sidecar::stop_sidecar();
            }
        });
}
