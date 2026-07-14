//! Public "Meet the team" members (`/api/v1/admin/staff`). Gated by
//! `content.manage`. NOTE: these are marketing/team-page entries (the public
//! `/team` page), NOT RBAC staff/roles — they aren't tied to user accounts.
//!
//! `avatarUrl` is a plain string; the UI passes either an `https://…` URL or a
//! `data:` URI for an uploaded image. Nothing here is a secret.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub bio: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub link: Option<String>,
    #[serde(default)]
    pub is_active: bool,
    #[serde(default)]
    pub sort_order: i64,
}

/// `GET /admin/staff` — every member (admin view, incl. inactive), ordered.
pub async fn list(auth: &AuthManager) -> Result<Vec<TeamMember>, PanelError> {
    auth.authed_json::<Vec<TeamMember>, ()>(Method::GET, "/admin/staff", None)
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberCreate<'a> {
    pub name: &'a str,
    pub title: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i64>,
}

/// `POST /admin/staff` — add a team member (server defaults `isActive` true,
/// `sortOrder` 0 when omitted).
pub async fn create(auth: &AuthManager, body: &TeamMemberCreate<'_>) -> Result<TeamMember, PanelError> {
    auth.authed_json(Method::POST, "/admin/staff", Some(body)).await
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberUpdate<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i64>,
}

/// `PATCH /admin/staff/:id` — partial update; omitted fields are left unchanged.
pub async fn update(auth: &AuthManager, id: &str, body: &TeamMemberUpdate<'_>) -> Result<TeamMember, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/staff/{id}"), Some(body))
        .await
}

/// `DELETE /admin/staff/:id` — remove from the public team page (204).
pub async fn delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/staff/{id}"), None)
        .await
}
