//! RBAC roles admin (`/api/v1/admin/roles*`). Gated by `roles.manage`.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;

#[derive(Debug, Serialize, Deserialize)]
pub struct RoleCount {
    #[serde(default)]
    pub users: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Role {
    pub id: String,
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_system: bool,
    #[serde(default)]
    pub permissions: Vec<String>,
    /// `{ users: N }` — how many accounts hold this role. Absent on create.
    #[serde(default, rename = "_count")]
    pub count: Option<RoleCount>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PermissionCatalog {
    #[serde(default)]
    pub wildcard: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

/// `GET /admin/roles` — all roles (system + custom) with assigned-user counts.
pub async fn list(auth: &AuthManager) -> Result<Vec<Role>, PanelError> {
    auth.authed_json::<Vec<Role>, ()>(Method::GET, "/admin/roles", None)
        .await
}

/// `GET /admin/roles/permissions` — the assignable-permission catalog.
pub async fn permission_catalog(auth: &AuthManager) -> Result<PermissionCatalog, PanelError> {
    auth.authed_json::<PermissionCatalog, ()>(Method::GET, "/admin/roles/permissions", None)
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody<'a> {
    key: &'a str,
    name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
    permissions: &'a [String],
}

/// `POST /admin/roles` — create a custom role.
pub async fn create(
    auth: &AuthManager,
    key: &str,
    name: &str,
    description: Option<&str>,
    permissions: &[String],
) -> Result<Role, PanelError> {
    let body = CreateBody { key, name, description, permissions };
    auth.authed_json(Method::POST, "/admin/roles", Some(&body)).await
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct UpdateBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    permissions: Option<&'a [String]>,
}

/// `PATCH /admin/roles/:id` — edit a role's name/description/permissions.
pub async fn update(
    auth: &AuthManager,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    permissions: Option<&[String]>,
) -> Result<Role, PanelError> {
    let body = UpdateBody { name, description, permissions };
    auth.authed_json(Method::PATCH, &format!("/admin/roles/{id}"), Some(&body))
        .await
}

/// `DELETE /admin/roles/:id` — delete a custom role (204; 400 if system/in-use).
pub async fn delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/roles/{id}"), None)
        .await
}
