#![deny(unsafe_code)]

//! ReFx Desktop — Rust core.
//!
//! All network I/O and secret handling lives on this side of the IPC
//! boundary; the WebView only ever sees typed `#[tauri::command]`s and
//! emitted events. The surface is enumerated in `docs/ipc-contract.md`.

mod commands;
mod commands_admin;
pub mod deeplink;
pub mod logging;
pub mod monitor;
pub mod settings;
pub mod state;
pub mod tray;
pub mod vault;

pub mod console;
pub mod panel;
pub mod sftp;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance must be the first plugin registered — later
        // phases route deep links / tray activation through it.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            // A refx:// link clicked while we're already running arrives here.
            deeplink::route_from_argv(app, &argv);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        // Auto-update: the frontend `check()`s the signed `latest.json` and
        // applies verified updates; `process` provides the post-install relaunch.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let log_dir = app.path().app_log_dir()?;
            if let Err(e) = logging::init(&log_dir) {
                eprintln!("logging init failed: {e}");
            }
            let state = state::AppState::new()?;
            let store = settings::SettingsStore::load(app.handle());
            let console = console::ConsoleManager::new(app.handle().clone(), state.auth.clone());
            let mon = monitor::spawn(app.handle().clone(), state.auth.clone(), state.intent.clone());
            // Apply persisted notification prefs to the monitor.
            let s = store.get();
            mon.set_prefs(monitor::NotifyPrefs {
                crashed: s.notify_crashed,
                back_online: s.notify_back_online,
            });
            // Manage state BEFORE registering deep links: a cold-start
            // `refx://` link routes synchronously inside `register` and reads
            // `AppState` (the deep-link inbox), which must already be managed.
            app.manage(console);
            app.manage(mon);
            app.manage(store);
            app.manage(state);
            tray::build(app.handle())?;
            crate::deeplink::register(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close hides to the tray (if enabled) instead of quitting, so the
            // app keeps monitoring and firing crash alerts. Quit from the tray
            // exits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let hide = window
                        .app_handle()
                        .try_state::<settings::SettingsStore>()
                        .map(|s| s.wants_close_to_tray())
                        .unwrap_or(true);
                    if hide {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::auth_status,
            commands::auth_login,
            commands::auth_mfa_verify,
            commands::auth_logout,
            commands::servers_list,
            commands::server_get,
            commands::server_stats,
            commands::server_power,
            commands::console_open,
            commands::console_close,
            commands::console_command,
            commands::files_list,
            commands::files_read,
            commands::files_write,
            commands::files_delete,
            commands::files_rename,
            commands::files_mkdir,
            commands::files_compress,
            commands::files_decompress,
            commands::files_download,
            commands::files_upload,
            commands::backups_list,
            commands::backup_create,
            commands::backup_set_locked,
            commands::backup_delete,
            commands::backup_restore,
            commands::backup_download,
            commands::startup_get,
            commands::variables_list,
            commands::variable_set,
            commands::schedules_list,
            commands::schedule_set_active,
            commands::schedule_run,
            commands::databases_list,
            commands::settings_get,
            commands::settings_set,
            commands::copy_diagnostics,
            commands::deeplink_ready,
            commands_admin::admin_roles_list,
            commands_admin::admin_role_permissions,
            commands_admin::admin_role_create,
            commands_admin::admin_role_update,
            commands_admin::admin_role_delete,
            commands_admin::admin_users_list,
            commands_admin::admin_user_set_role,
            commands_admin::admin_user_get,
            commands_admin::admin_user_create,
            commands_admin::admin_user_set_state,
            commands_admin::admin_user_verify_email,
            commands_admin::admin_user_delete,
            commands_admin::admin_user_purge,
            commands_admin::admin_user_send_password_reset,
            commands_admin::admin_user_set_password,
            commands_admin::admin_user_credit_get,
            commands_admin::admin_user_credit_adjust,
            commands_admin::admin_customers_list,
            commands_admin::admin_servers_list,
            commands_admin::admin_server_delete,
            commands_admin::admin_server_resize,
            commands_admin::admin_server_transfer,
            commands_admin::admin_server_transfers,
            commands_admin::admin_server_voice_get,
            commands_admin::admin_server_voice_enable,
            commands_admin::admin_server_voice_disable,
            commands_admin::admin_server_suspend,
            commands_admin::admin_server_unsuspend,
            commands_admin::admin_server_reinstall,
            commands_admin::admin_server_vanity_strip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
