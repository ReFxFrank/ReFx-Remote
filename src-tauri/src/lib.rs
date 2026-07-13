#![deny(unsafe_code)]

//! ReFx Desktop — Rust core.
//!
//! All network I/O and secret handling lives on this side of the IPC
//! boundary; the WebView only ever sees typed `#[tauri::command]`s and
//! emitted events. The surface is enumerated in `docs/ipc-contract.md`.

mod commands;
pub mod logging;
pub mod state;
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
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let log_dir = app.path().app_log_dir()?;
            if let Err(e) = logging::init(&log_dir) {
                eprintln!("logging init failed: {e}");
            }
            let state = state::AppState::new()?;
            let console = console::ConsoleManager::new(app.handle().clone(), state.auth.clone());
            app.manage(console);
            app.manage(state);
            Ok(())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
