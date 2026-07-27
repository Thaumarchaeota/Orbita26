use std::process::Command;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

mod ai;
mod app_icon;
mod data;
mod favicon;
mod obsidian;
mod window_shell;
mod zotero;

fn programs_menu_path() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
        Ok(format!(
            r"{appdata}\Microsoft\Windows\Start Menu\Programs"
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn get_programs_menu_path() -> Result<String, String> {
    programs_menu_path()
}

fn documents_path() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
        Ok(format!(r"{home}\Documents"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn pick_local_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let default_dir = documents_path()?;
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(default_dir)
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
async fn pick_local_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let default_dir = documents_path()?;
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(default_dir)
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
fn open_local_path(path: String) -> Result<(), String> {
    open_external_url(path)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn pick_app_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let default_dir = programs_menu_path()?;
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("程序", &["exe", "lnk"])
            .set_directory(default_dir)
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
fn launch_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("启动失败: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(&path)
            .spawn()
            .map_err(|e| format!("启动失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn launch_v2ray(app: tauri::AppHandle) -> Result<(), String> {
    let settings = data::read_settings(&app)?;
    let path = settings.integrations.v2ray.exe_path;
    Command::new(&path)
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn list_zotero_items(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<zotero::ZoteroItem>, String> {
    let n = limit.unwrap_or(20);
    let settings = data::read_settings(&app)?;
    let zotero_dir = settings.integrations.zotero.data_dir;
    let note_dir = settings.integrations.zotero.article_note_dir;
    tauri::async_runtime::spawn_blocking(move || {
        zotero::list_recent_items(&zotero_dir, &note_dir, n)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_obsidian_notes(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<obsidian::ObsidianNote>, String> {
    let n = limit.unwrap_or(50);
    let settings = data::read_settings(&app)?;
    let vault_dir = settings.integrations.obsidian.vault_dir;
    tauri::async_runtime::spawn_blocking(move || obsidian::list_notes(&vault_dir, n))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cache_app_icon(app: tauri::AppHandle, app_id: String, path: String) -> Result<Option<String>, String> {
    let data_dir = data::get_data_dir(&app)?;
    let cache_dir = data::cache_icons_dir(&data_dir);
    match app_icon::cache_icon(&cache_dir, &app_id, &path) {
        Ok(p) => Ok(Some(p)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
fn delete_app_icon(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let data_dir = data::get_data_dir(&app)?;
    let cache_dir = data::cache_icons_dir(&data_dir);
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("icons");
    if data::ensure_under_dir(&path, &cache_dir).is_err()
        && data::ensure_under_dir(&path, &legacy).is_err()
    {
        return Ok(());
    }
    app_icon::delete_cached(&path)
}

#[tauri::command]
fn read_app_icon_data(path: String) -> Result<Option<String>, String> {
    if !std::path::Path::new(&path).exists() {
        return Ok(None);
    }
    app_icon::read_data_url(&path).map(Some)
}

#[tauri::command]
async fn cache_favicon(app: tauri::AppHandle, bookmark_id: String, url: String) -> Result<Option<String>, String> {
    let data_dir = data::get_data_dir(&app)?;
    let cache_dir = data::cache_favicons_dir(&data_dir);
    let result = tauri::async_runtime::spawn_blocking(move || favicon::cache(&cache_dir, &bookmark_id, &url))
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.ok())
}

#[tauri::command]
fn delete_favicon(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let data_dir = data::get_data_dir(&app)?;
    let cache_dir = data::cache_favicons_dir(&data_dir);
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("favicons");
    if data::ensure_under_dir(&path, &cache_dir).is_err()
        && data::ensure_under_dir(&path, &legacy).is_err()
    {
        return Ok(());
    }
    favicon::delete_cached(&path)
}

#[tauri::command]
fn read_settings(app: tauri::AppHandle) -> Result<data::AppSettings, String> {
    data::read_settings(&app)
}

#[tauri::command]
fn write_settings(app: tauri::AppHandle, settings: data::AppSettings) -> Result<(), String> {
    data::write_settings(&app, settings)
}

#[tauri::command]
fn read_ai_config(app: tauri::AppHandle) -> Result<data::AiConfig, String> {
    data::read_ai_config(&app)
}

#[tauri::command]
fn write_ai_config(app: tauri::AppHandle, config: data::AiConfig) -> Result<(), String> {
    data::write_ai_config(&app, config)
}

#[tauri::command]
fn list_ai_conversations(app: tauri::AppHandle) -> Result<Vec<data::ConversationMeta>, String> {
    data::list_conversations(&app)
}

#[tauri::command]
fn read_ai_conversation(app: tauri::AppHandle, id: String) -> Result<data::Conversation, String> {
    data::read_conversation(&app, id)
}

#[tauri::command]
fn write_ai_conversation(app: tauri::AppHandle, conversation: data::Conversation) -> Result<(), String> {
    data::write_conversation(&app, conversation)
}

#[tauri::command]
fn delete_ai_conversation(app: tauri::AppHandle, id: String) -> Result<(), String> {
    data::delete_conversation(&app, id)
}

#[tauri::command]
fn read_bookmarks(app: tauri::AppHandle) -> Result<Vec<data::BookmarkEntry>, String> {
    data::read_bookmarks(&app)
}

#[tauri::command]
fn write_bookmarks(app: tauri::AppHandle, items: Vec<data::BookmarkEntry>) -> Result<(), String> {
    data::write_bookmarks(&app, items)
}

#[tauri::command]
fn read_apps(app: tauri::AppHandle) -> Result<Vec<data::AppEntry>, String> {
    data::read_apps(&app)
}

#[tauri::command]
fn write_apps(app: tauri::AppHandle, items: Vec<data::AppEntry>) -> Result<(), String> {
    data::write_apps(&app, items)
}

#[tauri::command]
fn read_local_files(app: tauri::AppHandle) -> Result<Vec<data::LocalEntry>, String> {
    data::read_local_files(&app)
}

#[tauri::command]
fn write_local_files(app: tauri::AppHandle, items: Vec<data::LocalEntry>) -> Result<(), String> {
    data::write_local_files(&app, items)
}

#[tauri::command]
fn migrate_legacy_caches(app: tauri::AppHandle) -> Result<u32, String> {
    let n = data::migrate_legacy_caches(&app)?;
    data::rewrite_icon_paths(&app)?;
    Ok(n)
}

#[tauri::command]
async fn ai_chat_stream(
    request: ai::AiChatRequest,
    on_event: tauri::ipc::Channel<ai::AiStreamEvent>,
) -> Result<(), String> {
    ai::chat_stream(request, on_event).await
}

#[tauri::command]
fn ai_chat_abort(request_id: String) {
    ai::abort(request_id);
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = window_shell::fit_work_area(&win);
        window_shell::fix_transparent_chrome(&win);
        window_shell::attach_to_taskbar(&win);
        window_shell::bring_to_front(&win);
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
            win.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window_shell::detach_from_taskbar(&win_for_close);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_programs_menu_path,
            pick_local_file,
            pick_local_folder,
            open_local_path,
            pick_app_file,
            cache_app_icon,
            delete_app_icon,
            read_app_icon_data,
            cache_favicon,
            delete_favicon,
            launch_v2ray,
            launch_app,
            list_zotero_items,
            list_obsidian_notes,
            open_external_url,
            read_settings,
            write_settings,
            read_ai_config,
            write_ai_config,
            list_ai_conversations,
            read_ai_conversation,
            write_ai_conversation,
            delete_ai_conversation,
            read_bookmarks,
            write_bookmarks,
            read_apps,
            write_apps,
            read_local_files,
            write_local_files,
            migrate_legacy_caches,
            ai_chat_stream,
            ai_chat_abort
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
