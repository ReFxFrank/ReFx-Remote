//! Staff/admin `#[tauri::command]` surface — `admin_*`. Every command is
//! authorized server-side (403 → `IpcError::Forbidden`); the frontend gates the
//! UI on `profile.permissions`. Keep `docs/ipc-contract.md` in lock-step.
//!
//! Nothing here returns a token/password EXCEPT the deliberate one-time
//! pass-throughs documented in the contract (created passwords, bootstrap
//! tokens) — none of those exist in this Tier-0 slice yet.

use serde::Serialize;
use tauri::State;

use crate::panel::admin::{roles, servers as admin_servers, users};
use crate::panel::error::IpcError;
use crate::panel::models::PageMeta;
use crate::state::AppState;

// ── Roles / RBAC (roles.manage) ────────────────────────────────────────

#[tauri::command]
pub async fn admin_roles_list(state: State<'_, AppState>) -> Result<Vec<roles::Role>, IpcError> {
    roles::list(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_role_permissions(
    state: State<'_, AppState>,
) -> Result<roles::PermissionCatalog, IpcError> {
    roles::permission_catalog(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_role_create(
    state: State<'_, AppState>,
    key: String,
    name: String,
    description: Option<String>,
    permissions: Vec<String>,
) -> Result<roles::Role, IpcError> {
    roles::create(&state.auth, &key, &name, description.as_deref(), &permissions)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn admin_role_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    permissions: Option<Vec<String>>,
) -> Result<roles::Role, IpcError> {
    roles::update(
        &state.auth,
        &id,
        name.as_deref(),
        description.as_deref(),
        permissions.as_deref(),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn admin_role_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    roles::delete(&state.auth, &id).await.map_err(Into::into)
}

// ── Users (users.read + granular users.*) ──────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserList {
    pub users: Vec<users::AdminUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn admin_users_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
    q: Option<String>,
    role: Option<String>,
    account_state: Option<String>,
) -> Result<AdminUserList, IpcError> {
    let page = users::list(
        &state.auth,
        page.unwrap_or(1),
        page_size.unwrap_or(25),
        q.as_deref(),
        role.as_deref(),
        account_state.as_deref(),
    )
    .await?;
    Ok(AdminUserList { users: page.data, meta: page.meta })
}

#[tauri::command]
pub async fn admin_user_set_role(
    state: State<'_, AppState>,
    user_id: String,
    role: Option<String>,
    role_id: Option<String>,
) -> Result<users::AdminUser, IpcError> {
    users::set_role(&state.auth, &user_id, role.as_deref(), role_id.as_deref())
        .await
        .map_err(Into::into)
}

// ── Fleet server oversight (servers.read / servers.manage) ─────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminServerList {
    pub servers: Vec<admin_servers::AdminServer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn admin_servers_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
    q: Option<String>,
) -> Result<AdminServerList, IpcError> {
    let page = admin_servers::list(
        &state.auth,
        page.unwrap_or(1),
        page_size.unwrap_or(50),
        q.as_deref(),
    )
    .await?;
    Ok(AdminServerList { servers: page.data, meta: page.meta })
}

#[tauri::command]
pub async fn admin_server_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    admin_servers::delete(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_resize(
    state: State<'_, AppState>,
    id: String,
    cpu_cores: Option<f64>,
    memory_mb: Option<u64>,
    swap_mb: Option<i64>,
    disk_mb: Option<u64>,
) -> Result<admin_servers::AdminServer, IpcError> {
    let body = admin_servers::ResizeBody { cpu_cores, memory_mb, swap_mb, disk_mb };
    admin_servers::resize(&state.auth, &id, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_transfer(
    state: State<'_, AppState>,
    id: String,
    to_node_id: String,
) -> Result<admin_servers::ServerTransfer, IpcError> {
    admin_servers::transfer(&state.auth, &id, &to_node_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_transfers(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<admin_servers::ServerTransfer>, IpcError> {
    admin_servers::transfers(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_voice_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<admin_servers::VoiceStatus, IpcError> {
    admin_servers::voice_get(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_voice_enable(
    state: State<'_, AppState>,
    id: String,
) -> Result<admin_servers::VoiceStatus, IpcError> {
    admin_servers::voice_enable(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_voice_disable(
    state: State<'_, AppState>,
    id: String,
) -> Result<admin_servers::VoiceStatus, IpcError> {
    admin_servers::voice_disable(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_suspend(
    state: State<'_, AppState>,
    id: String,
    reason: Option<String>,
) -> Result<serde_json::Value, IpcError> {
    admin_servers::suspend(&state.auth, &id, reason.as_deref()).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_unsuspend(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, IpcError> {
    admin_servers::unsuspend(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_reinstall(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, IpcError> {
    admin_servers::reinstall(&state.auth, &id).await.map_err(Into::into)
}

/// Strip a server's vanity address. `refund_credit` issues store credit — a
/// money-moving action, so the caller must pass an explicit `confirm` that the
/// UI collected via typed confirmation.
#[tauri::command]
pub async fn admin_server_vanity_strip(
    state: State<'_, AppState>,
    id: String,
    refund_credit: bool,
    confirm: bool,
) -> Result<serde_json::Value, IpcError> {
    if refund_credit && !confirm {
        return Err(IpcError {
            code: "VALIDATION",
            message: "Refund not confirmed.".into(),
            mfa_methods: None,
        });
    }
    admin_servers::vanity_strip(&state.auth, &id, refund_credit).await.map_err(Into::into)
}
