//! The `#[tauri::command]` surface — the only thing the frontend can call.
//! Keep `docs/ipc-contract.md` in lock-step with this file.

use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "ReFx Desktop",
        version: env!("CARGO_PKG_VERSION"),
    }
}
