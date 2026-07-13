//! The `#[tauri::command]` surface — the only thing the frontend can call.
//! Keep `docs/ipc-contract.md` in lock-step with this file.
//!
//! Nothing returned here ever contains a token, password, or API key.

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::console::{ConsoleLine, ConsoleManager};
use crate::panel::auth::LoginOutcome;
use crate::panel::backups::{self, Backup};
use crate::panel::error::IpcError;
use crate::panel::files::{self, FileEntry};
use crate::panel::models::{PageMeta, Profile};
use crate::panel::servers::{self, LiveStats, PowerSignal, ServerDetail, ServerSummary};
use crate::state::AppState;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub signed_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<Profile>,
}

#[tauri::command]
pub async fn auth_status(state: State<'_, AppState>) -> Result<AuthStatus, IpcError> {
    state.ensure_bootstrapped().await;
    if !state.auth.is_signed_in().await {
        return Ok(AuthStatus {
            signed_in: false,
            profile: None,
        });
    }
    match state.auth.profile().await {
        Ok(profile) => Ok(AuthStatus {
            signed_in: true,
            profile: Some(profile),
        }),
        // Session died between bootstrap and now — report signed out.
        Err(e) if e.code() == "SESSION_EXPIRED" || e.code() == "NOT_SIGNED_IN" => Ok(AuthStatus {
            signed_in: false,
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
    servers::power(&state.auth, &server_id, signal)
        .await
        .map_err(Into::into)
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
