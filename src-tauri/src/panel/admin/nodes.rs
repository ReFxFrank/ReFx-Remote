//! Infrastructure: nodes + locations (`/api/v1/admin/nodes*`, `/admin/locations*`).
//! Read is `nodes.read`; mutations are `nodes.manage` (locations: `locations.manage`).
//! Node/location secrets (bootstrap tokens) are one-time pass-throughs.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;
use crate::panel::servers::Paged;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub id: String,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Heartbeat {
    #[serde(default)]
    pub recorded_at: Option<String>,
    #[serde(default)]
    pub cpu_pct: Option<f64>,
    #[serde(default)]
    pub mem_used_mb: Option<f64>,
    #[serde(default)]
    pub disk_used_mb: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub fqdn: Option<String>,
    #[serde(default)]
    pub region: Option<Region>,
    #[serde(default)]
    pub latest_heartbeat: Option<Heartbeat>,
    #[serde(default)]
    pub servers: Option<u64>,
    #[serde(default)]
    pub maintenance: Option<bool>,
    #[serde(default)]
    pub cpu_cores: Option<f64>,
    #[serde(default)]
    pub memory_mb: Option<u64>,
    #[serde(default)]
    pub disk_mb: Option<u64>,
    #[serde(default)]
    pub provider: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ping {
    #[serde(default)]
    pub ms: Option<f64>,
    #[serde(default)]
    pub reachable: bool,
    #[serde(default)]
    pub heartbeat_age_ms: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeCreated {
    pub node: Node,
    pub bootstrap_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapToken {
    pub bootstrap_token: String,
    #[serde(default)]
    pub expires_at: Option<String>,
}

/// `GET /admin/nodes` — decorated node list.
pub async fn list(auth: &AuthManager, page: u32, page_size: u32) -> Result<Paged<Node>, PanelError> {
    let path = format!("/admin/nodes?page={page}&pageSize={}", page_size.min(100));
    let (data, meta) = auth
        .authed_paged::<Vec<Node>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

/// `GET /admin/nodes/:id` — single node detail (same decorated shape).
pub async fn get(auth: &AuthManager, id: &str) -> Result<Node, PanelError> {
    auth.authed_json::<Node, ()>(Method::GET, &format!("/admin/nodes/{id}"), None)
        .await
}

/// `GET /admin/nodes/regions` — region picker (static route, precedes :id).
pub async fn regions(auth: &AuthManager) -> Result<Vec<Region>, PanelError> {
    auth.authed_json::<Vec<Region>, ()>(Method::GET, "/admin/nodes/regions", None)
        .await
}

/// `GET /admin/nodes/:id/heartbeats` — history for the time-series chart.
pub async fn heartbeats(auth: &AuthManager, id: &str) -> Result<Vec<Heartbeat>, PanelError> {
    auth.authed_json::<Vec<Heartbeat>, ()>(Method::GET, &format!("/admin/nodes/{id}/heartbeats"), None)
        .await
}

/// `GET /admin/nodes/:id/ping` — live latency probe.
pub async fn ping(auth: &AuthManager, id: &str) -> Result<Ping, PanelError> {
    auth.authed_json::<Ping, ()>(Method::GET, &format!("/admin/nodes/{id}/ping"), None)
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MaintenanceBody {
    maintenance: bool,
}

/// `PATCH /admin/nodes/:id` — used here for the maintenance toggle.
pub async fn set_maintenance(auth: &AuthManager, id: &str, maintenance: bool) -> Result<Node, PanelError> {
    let body = MaintenanceBody { maintenance };
    auth.authed_json(Method::PATCH, &format!("/admin/nodes/{id}"), Some(&body))
        .await
}

/// `DELETE /admin/nodes/:id` — soft-delete (400 if it still has servers).
pub async fn delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/nodes/{id}"), None)
        .await
}

/// `POST /admin/nodes/:id/restart-agent`.
pub async fn restart_agent(auth: &AuthManager, id: &str) -> Result<serde_json::Value, PanelError> {
    auth.authed_json::<serde_json::Value, ()>(Method::POST, &format!("/admin/nodes/{id}/restart-agent"), None)
        .await
}

/// `POST /admin/nodes/:id/update-agent`.
pub async fn update_agent(auth: &AuthManager, id: &str) -> Result<serde_json::Value, PanelError> {
    auth.authed_json::<serde_json::Value, ()>(Method::POST, &format!("/admin/nodes/{id}/update-agent"), None)
        .await
}

/// `POST /admin/nodes/:id/bootstrap-token` — rotate; plaintext shown once.
pub async fn rotate_bootstrap(auth: &AuthManager, id: &str) -> Result<BootstrapToken, PanelError> {
    auth.authed_json::<BootstrapToken, ()>(Method::POST, &format!("/admin/nodes/{id}/bootstrap-token"), None)
        .await
}

// ── Locations (locations.manage) ───────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocationBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    country: Option<&'a str>,
}

/// `GET /admin/locations`.
pub async fn locations(auth: &AuthManager) -> Result<Vec<Region>, PanelError> {
    auth.authed_json::<Vec<Region>, ()>(Method::GET, "/admin/locations", None)
        .await
}

/// `POST /admin/locations`.
pub async fn location_create(
    auth: &AuthManager,
    code: &str,
    name: &str,
    country: Option<&str>,
) -> Result<Region, PanelError> {
    let body = LocationBody { code: Some(code), name: Some(name), country };
    auth.authed_json(Method::POST, "/admin/locations", Some(&body)).await
}

/// `PATCH /admin/locations/:id`.
pub async fn location_update(
    auth: &AuthManager,
    id: &str,
    code: Option<&str>,
    name: Option<&str>,
    country: Option<&str>,
) -> Result<Region, PanelError> {
    let body = LocationBody { code, name, country };
    auth.authed_json(Method::PATCH, &format!("/admin/locations/{id}"), Some(&body))
        .await
}

/// `DELETE /admin/locations/:id` (400 if nodes/servers attached).
pub async fn location_delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/locations/{id}"), None)
        .await
}
