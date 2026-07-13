#![deny(unsafe_code)]

//! ReFx Desktop — Rust core.
//!
//! All network I/O and secret handling lives on this side of the IPC
//! boundary; the WebView only ever sees typed `#[tauri::command]`s and
//! emitted events. The surface is enumerated in `docs/ipc-contract.md`.

mod commands;

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
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::app_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
