//! Startup command + configurable variables (docs/recon/panel-api.md §5,
//! live-verified 2026-07-13). Respect `userEditable`/`userViewable`.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use super::auth::AuthManager;
use super::error::PanelError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Startup {
    #[serde(default)]
    pub startup_command: Option<String>,
    #[serde(default)]
    pub docker_image: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VarRules {
    #[serde(default)]
    pub options: Option<Vec<String>>,
    #[serde(default)]
    pub regex: Option<String>,
    #[serde(default)]
    pub required: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variable {
    pub env_name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// ENUM | STRING | … (the panel's variable type).
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub rules: Option<VarRules>,
    #[serde(default, deserialize_with = "super::models::null_default")]
    pub user_editable: bool,
    #[serde(default = "yes")]
    pub user_viewable: bool,
    #[serde(default)]
    pub value: String,
    /// Write-only secrets return `value: ""` + `isSet: true`.
    #[serde(default)]
    pub is_set: Option<bool>,
}

fn yes() -> bool {
    true
}

pub async fn get_startup(auth: &AuthManager, id: &str) -> Result<Startup, PanelError> {
    auth.authed_json::<Startup, ()>(Method::GET, &format!("/servers/{id}/startup"), None)
        .await
}

pub async fn get_variables(auth: &AuthManager, id: &str) -> Result<Vec<Variable>, PanelError> {
    auth.authed_json::<Vec<Variable>, ()>(Method::GET, &format!("/servers/{id}/variables"), None)
        .await
}

#[derive(Serialize)]
struct SetVarBody<'a> {
    value: &'a str,
}

/// `PUT /servers/:id/variables/:envName {value}`. Uses the no-content path so
/// the response body (whatever shape) is ignored — we refetch after.
pub async fn set_variable(
    auth: &AuthManager,
    id: &str,
    env_name: &str,
    value: &str,
) -> Result<(), PanelError> {
    auth.authed_no_content(
        Method::PUT,
        &format!("/servers/{id}/variables/{}", urlencoding::encode(env_name)),
        Some(&SetVarBody { value }),
    )
    .await
}
