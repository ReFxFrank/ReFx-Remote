//! Servers domain: list, detail, live stats, power.
//!
//! Wire shapes from docs/api-surface.md §5 + the recon fixtures
//! (docs/recon/panel-api.md §5/§10, android-client.md §5). Decoding is
//! deliberately permissive — unknown enum values fall back to `Unknown`,
//! optional fields default — because the panel evolves faster than this app.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use super::auth::AuthManager;
use super::error::PanelError;
use super::models::PageMeta;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServerState {
    Installing,
    Offline,
    Starting,
    Running,
    Stopping,
    Crashed,
    Suspended,
    Reinstalling,
    SwitchingGame,
    Transferring,
    PendingPayment,
    #[serde(other)]
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRef {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeRef {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub fqdn: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AllocationRef {
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub alias: Option<String>,
}

/// One row of `GET /servers` (and the core of the detail response).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSummary {
    pub id: String,
    #[serde(default)]
    pub short_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub state: ServerState,
    #[serde(default)]
    pub server_type: Option<String>,
    #[serde(default)]
    pub cpu_cores: Option<f64>,
    #[serde(default)]
    pub memory_mb: Option<f64>,
    #[serde(default)]
    pub disk_mb: Option<f64>,
    #[serde(default)]
    pub slots: Option<f64>,
    #[serde(default)]
    pub suspended_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub template: Option<TemplateRef>,
    #[serde(default)]
    pub node: Option<NodeRef>,
    #[serde(default)]
    pub primary_allocation: Option<AllocationRef>,
}

/// `GET /servers/:id` — summary fields + the caller's effective per-server
/// permissions (gate UI on these; still handle 403 as the backstop).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDetail {
    #[serde(flatten)]
    pub summary: ServerSummary,
    #[serde(default)]
    pub viewer_permissions: Vec<String>,
}

/// `GET /servers/:id/stats` — floats on the wire (fixture-verified).
/// Agent-down surfaces as 503 → `PanelError::Server { status: 503, .. }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStats {
    #[serde(default)]
    pub state: ServerState,
    #[serde(default)]
    pub cpu_pct: f64,
    #[serde(default)]
    pub mem_used_mb: f64,
    #[serde(default)]
    pub mem_total_mb: f64,
    #[serde(default)]
    pub disk_used_mb: f64,
    #[serde(default)]
    pub net_rx_bytes: f64,
    #[serde(default)]
    pub net_tx_bytes: f64,
    #[serde(default)]
    pub players: Option<f64>,
    #[serde(default)]
    pub uptime_ms: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PowerSignal {
    Start,
    Stop,
    Restart,
    Kill,
}

impl PowerSignal {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "start" => Some(Self::Start),
            "stop" => Some(Self::Stop),
            "restart" => Some(Self::Restart),
            "kill" => Some(Self::Kill),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize)]
struct PowerBody {
    signal: PowerSignal,
}

#[derive(Debug, Deserialize)]
pub struct Accepted {
    #[serde(default)]
    pub accepted: bool,
}

pub struct Paged<T> {
    pub data: Vec<T>,
    pub meta: Option<PageMeta>,
}

/// `GET /servers?page=&pageSize=&q=` — one call refreshes the whole list;
/// per-server stats polling is reserved for the selected server so the
/// 120 req/min budget stays untouched (docs/decisions.md D-003).
pub async fn list(
    auth: &AuthManager,
    q: Option<&str>,
    page: u32,
    page_size: u32,
) -> Result<Paged<ServerSummary>, PanelError> {
    let mut path = format!("/servers?page={page}&pageSize={page_size}");
    if let Some(q) = q.filter(|q| !q.trim().is_empty()) {
        path.push_str("&q=");
        path.push_str(&urlencoding::encode(q.trim()));
    }
    let (data, meta) = auth
        .authed_paged::<Vec<ServerSummary>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

pub async fn get(auth: &AuthManager, id: &str) -> Result<ServerDetail, PanelError> {
    auth.authed_json::<ServerDetail, ()>(Method::GET, &format!("/servers/{id}"), None)
        .await
}

pub async fn stats(auth: &AuthManager, id: &str) -> Result<LiveStats, PanelError> {
    auth.authed_json::<LiveStats, ()>(Method::GET, &format!("/servers/{id}/stats"), None)
        .await
}

/// One power action. Never retried — mutations don't auto-retry (brief §3).
pub async fn power(
    auth: &AuthManager,
    id: &str,
    signal: PowerSignal,
) -> Result<(), PanelError> {
    let res: Accepted = auth
        .authed_json(
            Method::POST,
            &format!("/servers/{id}/power"),
            Some(&PowerBody { signal }),
        )
        .await?;
    if !res.accepted {
        return Err(PanelError::Other(
            "The panel didn't accept the power action.".into(),
        ));
    }
    Ok(())
}
