//! Server templates / "eggs" (`/api/v1/admin/templates`). Read is `catalog.read`.
//! Only the read + list surface is exposed here (the egg *editor* is deep;
//! product creation just needs the picker list).

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameTemplate {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub supports_linux: Option<bool>,
    #[serde(default)]
    pub supports_windows: Option<bool>,
    #[serde(default)]
    pub steam_app_id: Option<serde_json::Value>,
}

/// `GET /admin/templates` — all server templates for the picker/editor.
pub async fn list(auth: &AuthManager) -> Result<Vec<GameTemplate>, PanelError> {
    auth.authed_json::<Vec<GameTemplate>, ()>(Method::GET, "/admin/templates", None)
        .await
}

/// `GET /admin/templates/:id`.
pub async fn get(auth: &AuthManager, id: &str) -> Result<GameTemplate, PanelError> {
    auth.authed_json::<GameTemplate, ()>(Method::GET, &format!("/admin/templates/{id}"), None)
        .await
}
