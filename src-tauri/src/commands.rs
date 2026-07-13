//! The `#[tauri::command]` surface — the only thing the frontend can call.
//! Keep `docs/ipc-contract.md` in lock-step with this file.
//!
//! Nothing returned here ever contains a token, password, or API key.

use serde::Serialize;
use tauri::State;

use crate::console::{ConsoleLine, ConsoleManager};
use crate::panel::auth::LoginOutcome;
use crate::panel::error::IpcError;
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
