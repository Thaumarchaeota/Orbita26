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
pub(crate) use garmin::reconcile_daily_job_terminal_state;
mod garmin_sync;
mod hwmon;
mod journal_db;
mod journal;
mod journal_archive_db;
mod health_db;
mod productivity_db;
mod workspace_db;
mod ledger_sidecar;
mod obsidian;
mod paths;
mod v2ray;
mod window_shell;
mod zotero;
mod finance_v2_domain;
mod finance_v2_source;
mod finance_v2_store;
mod finance_v2_workspace;
mod finance_v2_projection;
mod finance_v2_commands;

/// Non-default integration-test seam. These calls are available only when an
/// explicit test feature is enabled and delegate to the same guarded session
/// helpers used by the Tauri commands.
#[cfg(feature = "finance-v2-test-support")]
pub mod finance_v2_test_support {
    use std::{fs, path::{Component, Path, PathBuf}};

    use crate::{
        finance_v2_commands::session,
        finance_v2_domain::Id,
        finance_v2_store::schema,
        finance_v2_workspace::{IsolatedWorkspaceRoot, LedgerIdentity},
    };

    pub use crate::finance_v2_commands::materialize::{
        run_synthetic_finance_v2_materialization_acceptance,
        FinanceV2MaterializationAcceptanceSummary,
    };

    fn require_temp_child(path: &Path, must_exist: bool) -> Result<PathBuf, String> {
        if !path.is_absolute() {
            return Err("test environment path must be absolute".into());
        }
        if path.components().any(|component| matches!(component, Component::CurDir | Component::ParentDir)) {
            return Err("test environment path must not contain dot or parent components".into());
        }
        session::reject_path_chain(path)?;
        let parent = path.parent().ok_or_else(|| "test environment path has no parent".to_owned())?;
        let name = path.file_name().ok_or_else(|| "test environment path has no final component".to_owned())?;
        let canonical_parent = fs::canonicalize(parent).map_err(|e| format!("cannot canonicalize test parent: {e}"))?;
        let canonical_temp = fs::canonicalize(std::env::temp_dir()).map_err(|e| format!("cannot canonicalize temporary directory: {e}"))?;
        if canonical_parent != canonical_temp && !canonical_parent.starts_with(&canonical_temp) {
            return Err("test environment must remain under the system temporary directory".into());
        }
        let canonical_candidate = canonical_parent.join(name);
        match fs::symlink_metadata(&canonical_candidate) {
            Ok(meta) if !must_exist && (meta.file_type().is_symlink() || meta.is_dir()) => {
                Err("new test environment path already exists or is not a regular file target".into())
            }
            Ok(_) if !must_exist => Err("new test environment path already exists".into()),
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                Err("test environment root is not a regular directory".into())
            }
            Ok(_) => {
                let canonical_root = fs::canonicalize(&canonical_candidate).map_err(|e| format!("cannot canonicalize test environment root: {e}"))?;
                if canonical_root != canonical_candidate {
                    return Err("test environment root does not resolve to its canonical path".into());
                }
                Ok(canonical_candidate)
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !must_exist => Ok(canonical_candidate),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err("test environment root does not exist".into()),
            Err(error) => Err(format!("cannot inspect test environment root: {error}")),
        }
    }

    /// Create a fresh isolated workspace under a caller-owned unique TEMP parent.
    pub fn create_isolated_environment(root_path: &Path) -> Result<(), String> {
        let root_path = require_temp_child(root_path, false)?;
        let workspace_id = Id::new();
        let identity = LedgerIdentity::new(format!("finance-v2-test:{}", workspace_id.as_str()))
            .map_err(|e| format!("invalid synthetic identity: {e:?}"))?;
        session::create_isolated_store(&root_path, workspace_id, identity)?;
        Ok(())
    }

    /// Reopen a marker-bound isolated workspace, validate its schema, and read generation.
    pub fn open_isolated_environment(root_path: &Path) -> Result<u64, String> {
        let root_path = require_temp_child(root_path, true)?;
        let root = IsolatedWorkspaceRoot::open_existing(&root_path)
            .map_err(|e| format!("test environment marker validation failed: {e:?}"))?;
        let connection = session::open_isolated_store(&root)?;
        session::current_generation(&connection)
    }

    /// Run the production path-chain guard without altering the path.
    pub fn validate_path_chain(path: &Path) -> Result<(), String> {
        session::reject_path_chain(path)
    }

    /// Resolve a root-relative output through the production symlink/reparse guard.
    pub fn guard_output_path(root_path: &Path, relative: &str) -> Result<PathBuf, String> {
        let root_path = require_temp_child(root_path, true)?;
        let root = IsolatedWorkspaceRoot::open_existing(&root_path)
            .map_err(|e| format!("test environment marker validation failed: {e:?}"))?;
        session::guarded_root_path(&root, relative)
    }

    /// Run the production schema validator on a marker-bound test environment.
    pub fn validate_isolated_environment_schema(root_path: &Path) -> Result<(), String> {
        let root_path = require_temp_child(root_path, true)?;
        let root = IsolatedWorkspaceRoot::open_existing(&root_path)
            .map_err(|e| format!("test environment marker validation failed: {e:?}"))?;
        let connection = session::open_store(&root)?;
        schema::validate(&connection).map_err(|e| e.to_string())
    }

    /// Compare DDL using the production quote-aware canonicalizer.
    pub fn schema_sql_equivalent(expected: &str, actual: &str) -> bool {
        schema::sql_equivalent(expected, actual)
    }
}

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
            productivity_db::coordinator::set_invalidation_app(app.handle().clone());
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
            if let Err(err) = garmin_sync::startup(app.handle()) {
                eprintln!("[garmin_sync] startup failed (no network was attempted): {err}");
            }
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
            commands::list_insight_ai_conversations,
            commands::read_insight_ai_conversation,
            commands::write_insight_ai_conversation,
            commands::delete_insight_ai_conversation,
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
            commands::ai_complete,
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
            commands::productivity_list_projects,
            commands::productivity_get_task_list_snapshot,
            commands::productivity_panel_write_task,
            commands::productivity_get_project,
            commands::productivity_list_lists,
            commands::productivity_get_list,
            commands::productivity_list_items,
            commands::productivity_get_item,
            commands::productivity_create_travel,
            commands::productivity_create_health_plan,
            commands::productivity_ensure_health_types,
            commands::productivity_list_week_health,
            commands::productivity_link_health_plan,
            commands::productivity_unlink_health_plan,
            commands::productivity_reconcile_sleep_plans,
            commands::productivity_mutate_health_plan,
            commands::productivity_get_travel,
            commands::productivity_update_travel,
            commands::productivity_adopt_travel_flight,
            commands::productivity_delete_travel,
            commands::productivity_restore_travel,
            commands::productivity_travel_v2_get,
            commands::productivity_travel_v2_list_week,
            commands::productivity_travel_v2_list_items,
            commands::productivity_travel_v2_create,
            commands::productivity_travel_v2_append,
            commands::productivity_travel_v2_update_item,
            commands::productivity_travel_v2_update_point,
            commands::productivity_travel_v2_update_transportation,
            commands::productivity_travel_v2_edit_plan,
            commands::productivity_travel_v2_replay_plan_effect,
            commands::productivity_travel_v2_release_plan_history,
            commands::productivity_travel_v2_split,
            commands::productivity_travel_v2_set_actual,
            commands::productivity_travel_v2_set_checkpoint_completed,
            commands::productivity_travel_v2_set_join_actual,
            commands::productivity_travel_v2_finish,
            commands::productivity_travel_v2_reopen,
            commands::productivity_travel_v2_cancel,
            commands::productivity_travel_v2_delete_stage,
            commands::productivity_travel_v2_delete_checkpoint,
            commands::productivity_travel_v2_clear_point,
            commands::productivity_travel_v2_delete_trip,
            commands::productivity_travel_v2_restore,
            commands::productivity_travel_v2_query_flight,
            commands::productivity_travel_v2_adopt_flight,
            commands::productivity_travel_v2_restore_adoption_fields,
            commands::productivity_transportation_list,
            commands::productivity_travel_v2_get_receipt,
            commands::productivity_get_item_type_catalog,
            commands::productivity_delete_item_type,
            commands::productivity_save_item_type_catalog,
            commands::productivity_create_item_type,
            commands::productivity_update_item_type,
            commands::productivity_move_item_type,
            commands::productivity_set_item_type_inactive,
            commands::productivity_create_tag,
            commands::productivity_update_tag,
            commands::productivity_set_tag_inactive,
            commands::productivity_get_tag,
            commands::productivity_list_tags,
            commands::productivity_delete_tag_and_detach_items,
            commands::productivity_list_sessions,
            commands::productivity_get_session,
            commands::productivity_list_actions,
            commands::productivity_get_action,
            commands::productivity_create_checkpoint,
            commands::productivity_get_checkpoint,
            commands::productivity_list_checkpoints,
            commands::productivity_update_checkpoint,
            commands::productivity_complete_checkpoint,
            commands::productivity_correct_checkpoint_actual,
            commands::productivity_reopen_checkpoint,
            commands::productivity_delete_checkpoint,
            commands::productivity_restore_checkpoint,
            commands::productivity_set_checkpoint_target,
            commands::productivity_clear_checkpoint_target,
            commands::productivity_assign_checkpoint_to_session,
            commands::productivity_remove_checkpoint_from_session,
            commands::productivity_commit_item_with_checkpoint,
            commands::productivity_commit_checkpoint_arrangement,
            commands::productivity_get_business_time_zone,
            commands::productivity_create_project,
            commands::productivity_create_task,
            commands::productivity_create_task_in_project,
            commands::productivity_add_task_sequence,
            commands::productivity_remove_task_sequence,
            commands::productivity_set_task_sequence_anchor,
            commands::productivity_set_task_card_position,
            commands::productivity_set_task_card_positions,
            commands::productivity_reorder_task_siblings,
            commands::productivity_move_task_same_level,
            commands::productivity_set_task_status_guarded,
            commands::productivity_list_deleted_task_batches,
            commands::productivity_update_project,
            commands::productivity_update_task,
            commands::productivity_move_task_within_project,
            commands::productivity_set_project_status,
            commands::productivity_set_task_status,
            commands::productivity_delete_project,
            commands::productivity_restore_project,
            commands::productivity_delete_task_subtree,
            commands::productivity_restore_task_subtree,
            commands::productivity_restore_task_subtree_batch,
            commands::productivity_create_list,
            commands::productivity_update_list,
            commands::productivity_set_list_status,
            commands::productivity_delete_list,
            commands::productivity_delete_list_and_move_items_to_inbox,
            commands::productivity_get_list_item_members,
            commands::productivity_restore_list,
            commands::productivity_create_item,
            commands::productivity_create_item_after,
            commands::productivity_update_item,
            commands::productivity_set_item_status,
            commands::productivity_delete_item,
            commands::productivity_restore_item,
            commands::productivity_assign_item_to_list,
            commands::productivity_move_item_to_list,
            commands::productivity_remove_item_from_list,
            commands::productivity_batch_move_items_to_list,
            commands::productivity_batch_delete_items,
            commands::productivity_create_session,
            commands::productivity_update_session,
            commands::productivity_commit_session_boundary,
            commands::productivity_restore_session_boundary_state,
            commands::productivity_delete_session_only,
            commands::productivity_restore_session,
            commands::productivity_delete_session_with_actions,
            commands::productivity_restore_session_with_actions,
            commands::productivity_create_action,
            commands::productivity_update_action,
            commands::productivity_commit_action_arrangement,
            commands::productivity_restore_action_arrangement_state,
            commands::productivity_start_action,
            commands::productivity_edit_action_interval,
            commands::productivity_pause_action,
            commands::productivity_resume_action,
            commands::productivity_end_action,
            commands::productivity_reopen_action,
            commands::productivity_delete_action,
            commands::productivity_restore_action,
            commands::productivity_assign_action_to_session,
            commands::productivity_move_action_to_session,
            commands::productivity_remove_action_from_session,
            commands::productivity_set_action_target,
            commands::productivity_clear_action_target,
            commands::productivity_complete_thing_and_end_related_actions,
            commands::productivity_commit_thing_lifecycle,
            commands::bkeasy_summary,
            commands::garmin_status,
            commands::garmin_sync_busy,
            commands::garmin_sync,
            commands::garmin_login,
            commands::garmin_sync_rate_limit_status,
            commands::garmin_sync_rate_limit_restore,
            commands::garmin_sync_daily_start,
            commands::garmin_sync_scan_start,
            commands::garmin_sync_scan_cancel,
            commands::garmin_sync_job_start,
            commands::garmin_sync_job_pause,
            commands::garmin_sync_job_continue,
            commands::garmin_sync_job_cancel,
            commands::garmin_sync_job_get,
            commands::garmin_sync_scan_get,
            commands::health_overview_query,
            commands::health_sync_status,
            commands::health_create_meal,
            commands::health_update_meal,
            commands::health_update_meal_metadata,
            commands::health_delete_meal,
            commands::health_apply_ai_batch,
            commands::health_list_meals,
            commands::health_get_meal,
            commands::health_search_meal_foods,
            commands::health_get_health_root,
            commands::health_list_garmin_sync_runs,
            commands::health_get_garmin_sync_run,
            commands::capture_screen,
            commands::capture_copy_clipboard,
            commands::capture_save_file,
            commands::capture_crop,
            commands::open_admin_window,
            commands::insight_set_has_unsaved,
            commands::insight_has_unsaved,
            commands::open_insight_item,
            commands::claim_insight_item_navigation,
            commands::ack_insight_item_navigation,
            commands::get_insight_item_navigation_result,
            #[cfg(debug_assertions)]
            commands::dev_open_finance_detail,
            commands::ledger_api_base,
            commands::ensure_ledger_sidecar,
            commands::restart_ledger_sidecar,
            commands::init_ledger_bill,
            commands::ledger_bill_nonempty,
            commands::journal_archive_create_note,
            commands::journal_archive_update_note,
            commands::journal_archive_create_document,
            commands::journal_archive_save_document,
            commands::journal_archive_convert_note_to_document,
            commands::journal_archive_delete_entry,
            commands::journal_archive_get_entry,
            commands::journal_archive_list_entries,
            commands::journal_archive_apply_ai_batch,
            commands::productivity_commit_item_with_actions,
            commands::productivity_reorder_items,
            commands::productivity_move_item_to_list_and_place,
            commands::productivity_apply_ai_batch,
            commands::health_list_activities,
            commands::health_get_activity,
            commands::health_read_activity_asset,
            commands::health_retry_activity_original,
            commands::health_export_activity_fit,
            commands::workspace_create_group,
            commands::workspace_rename_group,
            commands::workspace_move_member,
            commands::workspace_reorder_container,
            commands::workspace_add_list,
            commands::workspace_add_journal_document,
            commands::workspace_remove_list,
            commands::workspace_create_link,
            commands::workspace_rename_link,
            commands::workspace_update_link_target,
            commands::workspace_rebind_local_target,
            commands::workspace_delete_link,
            commands::workspace_delete_group,
            commands::workspace_delete_project,
            commands::workspace_delete_list_body,
            commands::workspace_delete_journal_document,
            commands::workspace_list,
            commands::productivity_query_travel_source,
            finance_v2_commands::session::finance_v2_environment_pick_directory,
            finance_v2_commands::session::finance_v2_source_pick_file,
            finance_v2_commands::session::finance_v2_environment_create,
            finance_v2_commands::session::finance_v2_environment_open,
            finance_v2_commands::ledger::finance_v2_read_snapshot,
            finance_v2_commands::ledger::finance_v2_project_reports,
            finance_v2_commands::ledger::finance_v2_management_save,
            finance_v2_commands::ledger::finance_v2_source_bindings,
            finance_v2_commands::ledger::finance_v2_source_contexts,
            finance_v2_commands::source::finance_v2_parse_artifact,
            finance_v2_commands::workspace::finance_v2_workspace_create,
            finance_v2_commands::workspace::finance_v2_workspace_create_manual,
            finance_v2_commands::workspace::finance_v2_workspace_list,
            finance_v2_commands::workspace::finance_v2_workspace_read,
            finance_v2_commands::workspace::finance_v2_workspace_stage_intent,
            finance_v2_commands::workspace::finance_v2_workspace_stage_refinement,
            finance_v2_commands::workspace::finance_v2_workspace_undo,
            finance_v2_commands::workspace::finance_v2_workspace_apply_ai_suggestions,
            finance_v2_commands::workspace::finance_v2_workspace_update_row,
            finance_v2_commands::workspace::finance_v2_workspace_cancel_import,
            finance_v2_commands::commit::finance_v2_find_receipt,
            finance_v2_commands::commit::finance_v2_prepare_commit,
            finance_v2_commands::commit::finance_v2_commit_batch,
            finance_v2_commands::commit::finance_v2_recover_materialization,
            finance_v2_commands::commit::finance_v2_workspace_abandon,
            finance_v2_commands::history::finance_v2_history,
            finance_v2_commands::settings::finance_v2_rules_read,
            finance_v2_commands::settings::finance_v2_rules_save,
            finance_v2_commands::settings::finance_v2_rules_preview_append,
            finance_v2_commands::settings::finance_v2_rules_confirm_append,
            finance_v2_commands::settings::finance_v2_rules_open_file,
            finance_v2_commands::settings::finance_v2_ai_model_read,
            finance_v2_commands::settings::finance_v2_ai_model_save
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
