//! Windows toast notifications that actually fire from background threads.
//!
//! `tauri-plugin-notification` builds a `notify_rust` toast and then `spawn`s the
//! real WinRT call onto a tokio worker, discarding its `Result`. WinRT toast
//! activation needs a COM apartment, and a tokio worker thread has none — so a
//! toast triggered from our background monitor (also a tokio task) fails at
//! `CreateToastNotifier` and the plugin silently eats the error. Apps that only
//! notify from a user action get away with it because those run on a
//! COM-initialized thread.
//!
//! We instead run the toast on a dedicated thread we `CoInitialize` ourselves
//! and return the real `Result`, so failures are visible and background alerts
//! actually show. This is the only reason the module needs `unsafe`.
#![allow(unsafe_code)]

use tauri_winrt_notification::Toast;
use windows::Win32::System::Com::{
    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
};

/// Show a toast under `app_id` (the app's AppUserModelID — must match the
/// installed Start Menu shortcut, or Windows drops it). Blocks briefly until
/// Windows accepts or rejects the toast, returning the real error on failure.
pub fn show(app_id: &str, title: &str, body: &str) -> Result<(), String> {
    let app_id = app_id.to_string();
    let title = title.to_string();
    let body = body.to_string();

    // A fresh thread so the COM init can't disturb (or be disturbed by) tokio's
    // reused worker threads.
    std::thread::spawn(move || -> Result<(), String> {
        // SAFETY: initialize a COM apartment for this thread — WinRT toast
        // activation requires one. Paired with CoUninitialize below. S_OK and
        // S_FALSE (already initialized) both report `is_ok()`.
        unsafe {
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if hr.is_err() {
                return Err(format!("CoInitializeEx failed: {hr:?}"));
            }
        }

        let result = Toast::new(&app_id)
            .title(&title)
            .text1(&body)
            .show()
            .map_err(|e| e.to_string());

        // SAFETY: balances the successful CoInitializeEx above.
        unsafe { CoUninitialize() };
        result
    })
    .join()
    .map_err(|_| "toast thread panicked".to_string())?
}
