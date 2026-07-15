//! The `#[tauri::command]` surface — the only thing the frontend can call.
//! Keep `docs/ipc-contract.md` in lock-step with this file.
//!
//! Nothing returned here ever contains a token, password, or API key.

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::console::{ConsoleLine, ConsoleManager};
use crate::monitor::{Monitor, NotifyPrefs};
use crate::support_watch::{SupportPrefs, SupportWatcher};
use crate::panel::auth::LoginOutcome;
use crate::panel::backups::{self, Backup};
use crate::panel::databases::{self, Database};
use crate::panel::error::IpcError;
use crate::panel::files::{self, FileEntry};
use crate::panel::models::{PageMeta, Profile};
use crate::panel::schedules::{self, Schedule};
use crate::panel::servers::{self, LiveStats, PowerSignal, ServerDetail, ServerSummary};
use crate::panel::account;
use crate::panel::startup::{self, Startup, Variable};
use crate::settings::{Settings, SettingsStore};
use crate::state::AppState;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    // Authoritative app version (from tauri.conf.json), so what the UI shows can
    // never drift from the released version even if Cargo.toml lags behind.
    AppInfo {
        name: "ReFx Desktop",
        version: app.package_info().version.to_string(),
    }
}

/// Fire a test toast on demand so the user can confirm the Windows notification
/// pipeline works without waiting for a real crash. `Ok` means Windows accepted
/// it — if no toast appears afterward, the cause is OS-level suppression (Focus
/// Assist / notifications turned off for the app), which the app cannot detect.
/// `Err` carries the OS rejection message.
#[tauri::command]
pub fn notification_test(app: AppHandle) -> Result<(), IpcError> {
    crate::toast::show(
        &app.config().identifier,
        "ReFx Desktop",
        "Test notification — if you can see this, alerts are working.",
    )
    .map_err(|e| IpcError {
        code: "NOTIFICATION",
        message: format!("Windows rejected the notification: {e}"),
        mfa_methods: None,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub signed_in: bool,
    /// A resumable session exists on disk but the server is unreachable right
    /// now (e.g. offline at launch). The UI shows a reconnecting state and
    /// retries, instead of dropping the user to sign-in.
    pub offline: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<Profile>,
}

#[tauri::command]
pub async fn auth_status(state: State<'_, AppState>) -> Result<AuthStatus, IpcError> {
    state.ensure_bootstrapped().await;
    if !state.auth.is_signed_in().await {
        // Not resumed into memory. If the vault still holds a refresh token, the
        // resume failed on the network (a 401 would have cleared it) — we're
        // offline with a resumable session, not signed out.
        return Ok(AuthStatus {
            signed_in: false,
            offline: state.auth.has_vaulted_session(),
            profile: None,
        });
    }
    match state.auth.profile().await {
        Ok(profile) => Ok(AuthStatus {
            signed_in: true,
            offline: false,
            profile: Some(profile),
        }),
        // Session died between bootstrap and now — report signed out.
        Err(e) if e.code() == "SESSION_EXPIRED" || e.code() == "NOT_SIGNED_IN" => Ok(AuthStatus {
            signed_in: false,
            offline: false,
            profile: None,
        }),
        // Live session, but the server is unreachable right now.
        Err(e) if e.code() == "NETWORK" => Ok(AuthStatus {
            signed_in: false,
            offline: true,
            profile: None,
        }),
        Err(e) => Err(e.into()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "status")]
pub enum LoginResult {
    #[serde(rename = "ok")]
    Ok,
    #[serde(rename = "mfa")]
    Mfa { methods: Vec<String> },
}

#[tauri::command]
pub async fn auth_login(
    state: State<'_, AppState>,
    email: String,
    password: String,
    totp: Option<String>,
    remember: Option<bool>,
) -> Result<LoginResult, IpcError> {
    let outcome = state
        .auth
        .login(
            email.trim(),
            &password,
            totp.as_deref().map(str::trim).filter(|t| !t.is_empty()),
            remember.unwrap_or(true),
        )
        .await?;
    Ok(match outcome {
        LoginOutcome::SignedIn => LoginResult::Ok,
        LoginOutcome::MfaRequired { methods } => LoginResult::Mfa { methods },
    })
}

/// Change the signed-in user's password. Reachable while the account is locked
/// for a required password change (e.g. an admin set a temporary password), so
/// the customer can unblock themselves without leaving the app.
#[tauri::command]
pub async fn account_password(
    state: State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> Result<(), IpcError> {
    account::change_password(&state.auth, &current_password, &new_password).await?;
    Ok(())
}

/// Begin TOTP two-factor enrollment — returns the secret + otpauth URL.
#[tauri::command]
pub async fn mfa_totp_enroll(state: State<'_, AppState>) -> Result<account::TotpEnrollment, IpcError> {
    account::totp_enroll(&state.auth).await.map_err(Into::into)
}

/// Confirm TOTP enrollment with a code; returns the one-time recovery codes.
#[tauri::command]
pub async fn mfa_totp_verify(
    state: State<'_, AppState>,
    code: String,
) -> Result<account::RecoveryCodes, IpcError> {
    account::totp_verify(&state.auth, code.trim()).await.map_err(Into::into)
}

/// Turn off TOTP two-factor.
#[tauri::command]
pub async fn mfa_totp_disable(state: State<'_, AppState>) -> Result<(), IpcError> {
    account::totp_disable(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn auth_mfa_verify(
    state: State<'_, AppState>,
    code: String,
    method: Option<String>,
) -> Result<(), IpcError> {
    state
        .auth
        .mfa_verify(code.trim(), method.as_deref())
        .await
        .map_err(Into::into)
}

/// Passkey (Windows Hello) second factor. Runs the native WebAuthn ceremony in
/// the Rust core; the WebView only sees success/failure.
#[tauri::command]
pub async fn auth_mfa_webauthn(state: State<'_, AppState>) -> Result<(), IpcError> {
    state.auth.mfa_webauthn().await.map_err(Into::into)
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>) -> Result<(), IpcError> {
    state.auth.logout().await.map_err(Into::into)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerListResult {
    pub servers: Vec<ServerSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn servers_list(
    state: State<'_, AppState>,
    q: Option<String>,
) -> Result<ServerListResult, IpcError> {
    let page = servers::list(&state.auth, q.as_deref(), 1, 100).await?;
    Ok(ServerListResult {
        servers: page.data,
        meta: page.meta,
    })
}

#[tauri::command]
pub async fn server_get(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<ServerDetail, IpcError> {
    servers::get(&state.auth, &server_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn server_stats(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<LiveStats, IpcError> {
    servers::stats(&state.auth, &server_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn server_power(
    state: State<'_, AppState>,
    server_id: String,
    signal: String,
) -> Result<(), IpcError> {
    let signal = PowerSignal::parse(&signal).ok_or(IpcError {
        code: "VALIDATION",
        message: "Unknown power action.".into(),
        mfa_methods: None,
    })?;
    // Record intent so the background monitor doesn't misread the resulting
    // offline transition as a crash — but only for signals that actually take
    // the server down, and only tentatively: if the panel rejects the action
    // (403, network, accepted:false) we clear the mark so a genuine crash in
    // the next 120s isn't wrongly suppressed.
    if signal.marks_intent() {
        state.intent.mark(&server_id);
    }
    match servers::power(&state.auth, &server_id, signal).await {
        Ok(()) => Ok(()),
        Err(e) => {
            state.intent.clear(&server_id);
            Err(e.into())
        }
    }
}

/// Open (or reuse) the live console for a server. Returns buffered
/// scrollback; new lines then arrive on `console:{server_id}`. The FE should
/// subscribe to the events *before* calling this to avoid a gap.
#[tauri::command]
pub fn console_open(
    console: State<'_, ConsoleManager>,
    server_id: String,
) -> Vec<ConsoleLine> {
    console.open(&server_id)
}

#[tauri::command]
pub fn console_close(console: State<'_, ConsoleManager>, server_id: String) {
    console.close(&server_id);
}

#[tauri::command]
pub async fn console_command(
    state: State<'_, AppState>,
    server_id: String,
    command: String,
) -> Result<(), IpcError> {
    let cmd = command.trim();
    if cmd.is_empty() {
        return Ok(());
    }
    servers::send_command(&state.auth, &server_id, cmd)
        .await
        .map_err(Into::into)
}

// ── Files ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn files_list(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
) -> Result<Vec<FileEntry>, IpcError> {
    files::list(&state.auth, &server_id, &path).await.map_err(Into::into)
}

#[tauri::command]
pub async fn files_read(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
) -> Result<String, IpcError> {
    files::read(&state.auth, &server_id, &path).await.map_err(Into::into)
}

#[tauri::command]
pub async fn files_write(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
    content: String,
) -> Result<(), IpcError> {
    files::write(&state.auth, &server_id, &path, &content).await.map_err(Into::into)
}

#[tauri::command]
pub async fn files_delete(
    state: State<'_, AppState>,
    server_id: String,
    paths: Vec<String>,
) -> Result<(), IpcError> {
    files::delete(&state.auth, &server_id, &paths).await.map_err(Into::into)
}

#[tauri::command]
pub async fn files_rename(
    state: State<'_, AppState>,
    server_id: String,
    from: String,
    to: String,
) -> Result<(), IpcError> {
    files::rename(&state.auth, &server_id, &from, &to).await.map_err(Into::into)
}

#[tauri::command]
pub async fn files_mkdir(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
) -> Result<(), IpcError> {
    files::mkdir(&state.auth, &server_id, &path).await.map_err(Into::into)
}

#[tauri::command]
pub async fn files_compress(
    state: State<'_, AppState>,
    server_id: String,
    paths: Vec<String>,
) -> Result<(), IpcError> {
    files::compress(&state.auth, &server_id, &paths, None).await.map_err(Into::into)
}

#[tauri::command]
pub async fn files_decompress(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
) -> Result<(), IpcError> {
    files::decompress(&state.auth, &server_id, &path).await.map_err(Into::into)
}

/// Download a file: prompt for a save location, stream it there. Returns the
/// saved path, or `None` if the user cancelled the dialog.
#[tauri::command]
pub async fn files_download(
    app: AppHandle,
    state: State<'_, AppState>,
    server_id: String,
    path: String,
    suggested_name: String,
) -> Result<Option<String>, IpcError> {
    let dest = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .blocking_save_file();
    let Some(dest) = dest.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    files::download(&state.auth, &server_id, &path, &dest).await?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

/// Upload: prompt for a local file, read it, POST to `dest_dir`. Returns the
/// uploaded byte count, or `None` if the user cancelled.
#[tauri::command]
pub async fn files_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    server_id: String,
    dest_dir: String,
) -> Result<Option<u64>, IpcError> {
    let picked = app.dialog().file().blocking_pick_file();
    let Some(local) = picked.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    // Check the size from metadata BEFORE reading — otherwise a mistakenly
    // picked multi-GB file would be fully allocated in RAM before the cap.
    const MAX: u64 = 32 * 1024 * 1024;
    let meta = std::fs::metadata(&local).map_err(|e| IpcError {
        code: "OTHER",
        message: format!("Couldn't read that file: {e}"),
        mfa_methods: None,
    })?;
    if meta.len() > MAX {
        return Err(IpcError {
            code: "VALIDATION",
            message: "That file is larger than the 32 MB direct-upload limit. Use SFTP for bigger files.".into(),
            mfa_methods: None,
        });
    }
    let bytes = std::fs::read(&local).map_err(|e| IpcError {
        code: "OTHER",
        message: format!("Couldn't read that file: {e}"),
        mfa_methods: None,
    })?;
    let result = files::upload(&state.auth, &server_id, &dest_dir, &bytes).await?;
    Ok(Some(result.bytes))
}

// ── Backups ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn backups_list(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<Vec<Backup>, IpcError> {
    backups::list(&state.auth, &server_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn backup_create(
    state: State<'_, AppState>,
    server_id: String,
    name: String,
    mode: Option<String>,
) -> Result<Backup, IpcError> {
    backups::create(&state.auth, &server_id, name.trim(), mode.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn backup_set_locked(
    state: State<'_, AppState>,
    server_id: String,
    backup_id: String,
    locked: bool,
) -> Result<Backup, IpcError> {
    backups::set_locked(&state.auth, &server_id, &backup_id, locked)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn backup_delete(
    state: State<'_, AppState>,
    server_id: String,
    backup_id: String,
) -> Result<(), IpcError> {
    backups::delete(&state.auth, &server_id, &backup_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn backup_restore(
    state: State<'_, AppState>,
    server_id: String,
    backup_id: String,
) -> Result<(), IpcError> {
    backups::restore(&state.auth, &server_id, &backup_id).await.map_err(Into::into)
}

// ── Startup / variables ────────────────────────────────────────────────

#[tauri::command]
pub async fn startup_get(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<Startup, IpcError> {
    startup::get_startup(&state.auth, &server_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn variables_list(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<Vec<Variable>, IpcError> {
    startup::get_variables(&state.auth, &server_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn variable_set(
    state: State<'_, AppState>,
    server_id: String,
    env_name: String,
    value: String,
) -> Result<(), IpcError> {
    startup::set_variable(&state.auth, &server_id, &env_name, &value)
        .await
        .map_err(Into::into)
}

// ── Schedules ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn schedules_list(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<Vec<Schedule>, IpcError> {
    schedules::list(&state.auth, &server_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn schedule_set_active(
    state: State<'_, AppState>,
    server_id: String,
    schedule_id: String,
    active: bool,
) -> Result<(), IpcError> {
    schedules::set_active(&state.auth, &server_id, &schedule_id, active)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn schedule_run(
    state: State<'_, AppState>,
    server_id: String,
    schedule_id: String,
) -> Result<(), IpcError> {
    schedules::run_now(&state.auth, &server_id, &schedule_id).await.map_err(Into::into)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn schedule_create(
    state: State<'_, AppState>,
    server_id: String,
    name: String,
    cron: String,
    only_when_online: bool,
    is_active: bool,
    task_action: Option<String>,
    task_payload: Option<String>,
) -> Result<Schedule, IpcError> {
    let tasks = match task_action {
        Some(action) if !action.trim().is_empty() => vec![schedules::ScheduleTaskInput {
            action,
            payload: task_payload.unwrap_or_default(),
        }],
        _ => Vec::new(),
    };
    let body = schedules::CreateScheduleBody {
        name: name.trim().to_string(),
        cron: cron.trim().to_string(),
        only_when_online,
        is_active,
        tasks,
    };
    schedules::create(&state.auth, &server_id, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn schedule_update(
    state: State<'_, AppState>,
    server_id: String,
    schedule_id: String,
    name: String,
    cron: String,
    only_when_online: bool,
) -> Result<Schedule, IpcError> {
    let body = schedules::UpdateScheduleBody {
        name: Some(name.trim().to_string()),
        cron: Some(cron.trim().to_string()),
        only_when_online: Some(only_when_online),
    };
    schedules::update(&state.auth, &server_id, &schedule_id, &body)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn schedule_delete(
    state: State<'_, AppState>,
    server_id: String,
    schedule_id: String,
) -> Result<(), IpcError> {
    schedules::delete(&state.auth, &server_id, &schedule_id).await.map_err(Into::into)
}

// ── Databases ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn databases_list(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<Vec<Database>, IpcError> {
    databases::list(&state.auth, &server_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn database_create(
    state: State<'_, AppState>,
    server_id: String,
    engine: String,
    name: String,
    remote_access: bool,
) -> Result<databases::CreatedDatabase, IpcError> {
    databases::create(&state.auth, &server_id, engine.trim(), name.trim(), remote_access)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn database_delete(
    state: State<'_, AppState>,
    server_id: String,
    database_id: String,
) -> Result<(), IpcError> {
    databases::delete(&state.auth, &server_id, &database_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn database_rotate(
    state: State<'_, AppState>,
    server_id: String,
    database_id: String,
) -> Result<databases::DatabasePassword, IpcError> {
    databases::rotate(&state.auth, &server_id, &database_id).await.map_err(Into::into)
}

// ── Settings + diagnostics ─────────────────────────────────────────────

/// Mark the servers screen's `app:open-server` listener live (or torn down) and
/// drain any deep link that arrived before it mounted. Called on mount with
/// `true` (returning a buffered open, if any) and on unmount with `false`.
#[tauri::command]
pub fn deeplink_ready(
    state: State<'_, AppState>,
    ready: bool,
) -> Vec<serde_json::Value> {
    let mut inbox = state.deeplink.lock().expect("deeplink lock");
    inbox.ready = ready;
    if ready {
        std::mem::take(&mut inbox.pending)
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub fn settings_get(settings: State<'_, SettingsStore>) -> Settings {
    settings.get()
}

#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    settings: State<'_, SettingsStore>,
    monitor: State<'_, Monitor>,
    support: State<'_, SupportWatcher>,
    next: Settings,
) -> Result<(), IpcError> {
    use tauri_plugin_autostart::ManagerExt;
    // Only touch the OS autostart registration when it actually changed, and
    // surface a failure instead of silently persisting a state we couldn't
    // achieve (a denied Run-key write would otherwise leave the toggle stuck
    // "on" while the app never autostarts).
    let current = settings.get();
    if next.start_with_windows != current.start_with_windows {
        let launcher = app.autolaunch();
        let res = if next.start_with_windows {
            launcher.enable()
        } else {
            launcher.disable()
        };
        res.map_err(|e| IpcError {
            code: "OTHER",
            message: format!("Couldn't update \"Start with Windows\": {e}"),
            mfa_methods: None,
        })?;
    }
    monitor.set_prefs(NotifyPrefs {
        crashed: next.notify_crashed,
        back_online: next.notify_back_online,
    });
    support.set_prefs(SupportPrefs {
        enabled: next.notify_support,
    });
    settings.set(next);
    Ok(())
}

/// Return the redacted diagnostic log tail (last ~64 KB) for a support bundle.
/// The tracing layer already scrubs secrets, so this is safe to share.
#[tauri::command]
pub fn copy_diagnostics(app: AppHandle) -> Result<String, IpcError> {
    let dir = app.path().app_log_dir().map_err(|e| IpcError {
        code: "OTHER",
        message: format!("Couldn't locate logs: {e}"),
        mfa_methods: None,
    })?;
    let content = std::fs::read_to_string(dir.join("refx-desktop.log")).unwrap_or_default();
    let mut start = content.len().saturating_sub(64 * 1024);
    while start < content.len() && !content.is_char_boundary(start) {
        start += 1;
    }
    // Prepend an environment header so a pasted support bundle carries version
    // and OS context (individual log lines already carry timestamps).
    let header = format!(
        "=== ReFx Desktop diagnostics ===\nApp:  ReFx Desktop v{}\nOS:   {} {}\nLog tail (last 64 KB, secrets redacted):\n\n",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
    Ok(format!("{header}{}", &content[start..]))
}

#[tauri::command]
pub async fn backup_download(
    app: AppHandle,
    state: State<'_, AppState>,
    server_id: String,
    backup_id: String,
    suggested_name: String,
) -> Result<Option<String>, IpcError> {
    let dest = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .blocking_save_file();
    let Some(dest) = dest.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    backups::download(&state.auth, &server_id, &backup_id, &dest).await?;
    Ok(Some(dest.to_string_lossy().to_string()))
}
