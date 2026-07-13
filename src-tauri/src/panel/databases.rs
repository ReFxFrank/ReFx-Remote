//! Databases (docs/recon/panel-api.md §8) — read-only list for v1. The
//! password is write-only server-side; the list never carries it.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use super::auth::AuthManager;
use super::error::PanelError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    pub id: String,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub remote_access: Option<bool>,
    #[serde(default)]
    pub created_at: Option<String>,
}

pub async fn list(auth: &AuthManager, id: &str) -> Result<Vec<Database>, PanelError> {
    auth.authed_json::<Vec<Database>, ()>(Method::GET, &format!("/servers/{id}/databases"), None)
        .await
}
