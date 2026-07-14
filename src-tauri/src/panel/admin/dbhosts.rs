//! Database hosts: shared MySQL/MariaDB servers the panel provisions
//! per-server databases on (`/api/v1/admin/database-hosts*`).
//! Read is `nodes.read`; mutations are `nodes.manage`.
//!
//! The admin/provisioner password is WRITE-ONLY — accepted on create/update
//! (stored AES-256-GCM encrypted server-side) and never echoed back. The
//! `SafeHost` response is `DatabaseHost` minus `passwordEnc`, plus a live
//! `databaseCount`.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;

/// A registered host, admin password stripped. `databaseCount` is present on
/// list (decorated with the live provisioned count) and absent on create/update.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseHost {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub public_host: Option<String>,
    #[serde(default)]
    pub max_databases: Option<i64>,
    #[serde(default)]
    pub is_active: Option<bool>,
    #[serde(default)]
    pub database_count: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
}

/// `POST /database-hosts/:id/test` — connection probe result.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    #[serde(default)]
    pub ok: bool,
}

/// Create payload. `password` is the write-only admin credential (required on
/// create); the others carry the panel's server-side defaults when omitted.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHostBody<'a> {
    pub name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<&'a str>,
    pub host: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub username: &'a str,
    /// Write-only admin password — encrypted at rest, never returned.
    pub password: &'a str,
    pub public_host: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_databases: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
}

/// Partial update. Every field is optional; `password` is re-set only if
/// provided (omit to keep the current one). Engine is immutable server-side.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHostBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<&'a str>,
    /// Write-only; omit to keep the current password.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_host: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_databases: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
}

/// `GET /admin/database-hosts` — every host with its live database count
/// (simple array, no pagination).
pub async fn list(auth: &AuthManager) -> Result<Vec<DatabaseHost>, PanelError> {
    auth.authed_json::<Vec<DatabaseHost>, ()>(Method::GET, "/admin/database-hosts", None)
        .await
}

/// `POST /admin/database-hosts` — register a host.
pub async fn create(auth: &AuthManager, body: &CreateHostBody<'_>) -> Result<DatabaseHost, PanelError> {
    auth.authed_json(Method::POST, "/admin/database-hosts", Some(body)).await
}

/// `PATCH /admin/database-hosts/:id` — partial update.
pub async fn update(
    auth: &AuthManager,
    id: &str,
    body: &UpdateHostBody<'_>,
) -> Result<DatabaseHost, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/database-hosts/{id}"), Some(body))
        .await
}

/// `DELETE /admin/database-hosts/:id` — 400 if the host still owns databases.
pub async fn delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/database-hosts/{id}"), None)
        .await
}

/// `POST /admin/database-hosts/:id/test` — verify the admin connection works.
pub async fn test(auth: &AuthManager, id: &str) -> Result<TestResult, PanelError> {
    auth.authed_json::<TestResult, ()>(Method::POST, &format!("/admin/database-hosts/{id}/test"), None)
        .await
}
