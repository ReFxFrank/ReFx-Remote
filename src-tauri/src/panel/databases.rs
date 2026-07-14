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

/// A freshly-created database carries the one-time plaintext `password` inline
/// with the row — it's never returned again.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedDatabase {
    #[serde(flatten)]
    pub database: Database,
    #[serde(default)]
    pub password: Option<String>,
}

/// The one-time password returned by a rotate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabasePassword {
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody<'a> {
    engine: &'a str,
    name: &'a str,
    remote_access: bool,
}

/// `POST /servers/:id/databases` — provision a database. Returns the row plus
/// the plaintext `password`, which the UI must show the user exactly once.
pub async fn create(
    auth: &AuthManager,
    id: &str,
    engine: &str,
    name: &str,
    remote_access: bool,
) -> Result<CreatedDatabase, PanelError> {
    let body = CreateBody { engine, name, remote_access };
    auth.authed_json(Method::POST, &format!("/servers/{id}/databases"), Some(&body))
        .await
}

/// `DELETE /servers/:id/databases/:dbId` — drop the database and its user.
pub async fn delete(auth: &AuthManager, id: &str, db_id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/servers/{id}/databases/{db_id}"), None)
        .await
}

/// `POST /servers/:id/databases/:dbId/rotate` — new password, shown ONCE.
pub async fn rotate(auth: &AuthManager, id: &str, db_id: &str) -> Result<DatabasePassword, PanelError> {
    auth.authed_json::<DatabasePassword, ()>(
        Method::POST,
        &format!("/servers/{id}/databases/{db_id}/rotate"),
        None,
    )
    .await
}
