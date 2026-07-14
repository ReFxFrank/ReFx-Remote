//! Staff/admin `#[tauri::command]` surface — `admin_*`. Every command is
//! authorized server-side (403 → `IpcError::Forbidden`); the frontend gates the
//! UI on `profile.permissions`. Keep `docs/ipc-contract.md` in lock-step.
//!
//! Nothing here returns a token/password EXCEPT the deliberate one-time
//! pass-throughs documented in the contract (created passwords, bootstrap
//! tokens) — none of those exist in this Tier-0 slice yet.

use serde::Serialize;
use tauri::State;

use crate::panel::admin::{roles, users};
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
