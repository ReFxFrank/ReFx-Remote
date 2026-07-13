//! The `#[tauri::command]` surface — the only thing the frontend can call.
//! Keep `docs/ipc-contract.md` in lock-step with this file.
//!
//! Nothing returned here ever contains a token, password, or API key.

use serde::Serialize;
use tauri::State;

use crate::panel::auth::LoginOutcome;
use crate::panel::error::IpcError;
use crate::panel::models::Profile;
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
