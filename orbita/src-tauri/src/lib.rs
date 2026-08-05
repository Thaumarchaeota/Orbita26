use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

mod agent;
mod ai;
mod app_icon;
mod bkeasy;
mod beancount;
mod capture;
mod commands;
mod data;
mod dida;
mod everything;
mod favicon;
mod file_type_icon;
mod garmin;
mod hwmon;
mod journal;
mod obsidian;
mod paths;
mod v2ray;
mod window_shell;
mod zotero;

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        window_shell::attach_to_taskbar(&win);
        let _ = window_shell::repair_window_show(&win);
    }
}

fn app_icon() -> Result<tauri::image::Image<'static>, String> {
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
        .setup(|app| {
            let win = app
                .get_webview_window("main")
                .ok_or("main window not found")?;
            use tauri::webview::Color;
            let _ = win.set_background_color(Some(Color(0, 0, 0, 0)));
            let _ = win.set_skip_taskbar(false);
            let _ = win.set_decorations(false);
            window_shell::fit_work_area(&win)?;
            window_shell::fix_transparent_chrome(&win);
            window_shell::bring_to_front(&win);
            let win_chrome = win.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(200));
                let _ = window_shell::fit_work_area(&win_chrome);
                window_shell::fix_transparent_chrome(&win_chrome);
            });
            let show_item = MenuItem::with_id(app, "tray-show", "显示 Orbita", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let icon = app_icon()?;
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

            let win_for_close = win.clone();
            let win_for_focus = win.clone();
            win.on_window_event(move |event| {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        window_shell::detach_from_taskbar(&win_for_close);
                    }
                    WindowEvent::Focused(false) => {}
                    WindowEvent::Focused(true) => {
                        let _ = window_shell::repair_window_focus(&win_for_focus);
                    }
                    _ => {}
                }
            });

            hwmon::init();

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
            commands::dida_auth_status,
            commands::dida_begin_oauth,
            commands::dida_finish_oauth,
            commands::dida_connect,
            commands::dida_disconnect,
            commands::dida_list_projects,
            commands::dida_filter_tasks,
            commands::dida_create_task,
            commands::dida_update_task,
            commands::dida_complete_task,
            commands::dida_reopen_task,
            commands::dida_delete_task,
            commands::repair_window,
            commands::journal_list,
            commands::journal_upsert,
            commands::journal_delete,
            commands::bkeasy_summary,
            commands::garmin_status,
            commands::garmin_sync,
            commands::garmin_login,
            commands::capture_screen,
            commands::capture_copy_clipboard,
            commands::capture_save_file,
            commands::capture_crop
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {});
}
