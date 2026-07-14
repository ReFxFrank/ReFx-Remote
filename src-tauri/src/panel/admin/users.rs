//! Users & customers admin (`/api/v1/admin/users*`). Read is `users.read`;
//! mutations carry granular `users.*` permissions. This module currently covers
//! the list + role-assignment needed by the Roles screen; the full user-detail
//! and account-action surface lands with the Users screen (Tier 1).

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;
use crate::panel::servers::Paged;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUser {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub global_role: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub role_id: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub email_verified_at: Option<String>,
}

/// `GET /admin/users` — paginated account list with optional search/filters.
pub async fn list(
    auth: &AuthManager,
    page: u32,
    page_size: u32,
    q: Option<&str>,
    role: Option<&str>,
    state: Option<&str>,
) -> Result<Paged<AdminUser>, PanelError> {
    let mut path = format!("/admin/users?page={page}&pageSize={}", page_size.min(100));
    if let Some(q) = q.map(str::trim).filter(|s| !s.is_empty()) {
        path.push_str(&format!("&q={}", urlencoding::encode(q)));
    }
    if let Some(role) = role.filter(|s| !s.is_empty()) {
        path.push_str(&format!("&role={}", urlencoding::encode(role)));
    }
    if let Some(state) = state.filter(|s| !s.is_empty()) {
        path.push_str(&format!("&state={}", urlencoding::encode(state)));
    }
    let (data, meta) = auth
        .authed_paged::<Vec<AdminUser>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetRoleBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    role_id: Option<&'a str>,
}

/// `PATCH /admin/users/:id/role` — assign an RBAC role (by roleId) or a coarse
/// GlobalRole. This is how a user becomes staff or is promoted/demoted. The
/// server refuses to demote the last owner and syncs `globalRole`.
pub async fn set_role(
    auth: &AuthManager,
    user_id: &str,
    role: Option<&str>,
    role_id: Option<&str>,
) -> Result<AdminUser, PanelError> {
    let body = SetRoleBody { role, role_id };
    auth.authed_json(Method::PATCH, &format!("/admin/users/{user_id}/role"), Some(&body))
        .await
}
