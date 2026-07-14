//! Persisted user settings (JSON in the app config dir). Kept tiny and
//! non-secret — credentials never live here (that's the vault).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub notify_crashed: bool,
    pub notify_back_online: bool,
    /// Close-to-tray: window close hides instead of quitting.
    pub close_to_tray: bool,
    pub start_with_windows: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            notify_crashed: true,
            notify_back_online: true,
            close_to_tray: true,
            start_with_windows: false,
        }
    }
}

/// Managed state: the current settings plus a cheap atomic mirror of
/// `close_to_tray` for the window-close handler to read without locking.
pub struct SettingsStore {
    path: PathBuf,
    current: Mutex<Settings>,
    pub close_to_tray: AtomicBool,
}

impl SettingsStore {
    pub fn load(app: &AppHandle) -> Self {
        let dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
        let path = dir.join("settings.json");
        let current = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            close_to_tray: AtomicBool::new(current.close_to_tray),
            current: Mutex::new(current),
        }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().expect("settings lock").clone()
    }

    pub fn set(&self, next: Settings) {
        self.close_to_tray.store(next.close_to_tray, Ordering::Relaxed);
        {
            let mut cur = self.current.lock().expect("settings lock");
            *cur = next.clone();
        }
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&next) {
            let _ = std::fs::write(&self.path, json);
        }
    }

    pub fn wants_close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed)
    }
}
