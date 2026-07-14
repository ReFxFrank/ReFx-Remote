//! Fleet server oversight (`/api/v1/admin/servers*` + the admin-gated per-server
//! routes). Read is `servers.read`; every mutation is `servers.manage`. Power,
//! reinstall, suspend, resize on ANY server pass the staff `servers.manage`
//! override server-side. Per-server *management* (console/files/backups) reuses
//! the customer `ServerDetailPanel`; this module is the fleet table + actions.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;
use crate::panel::servers::{Paged, ServerState};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminOwner {
    pub id: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedRef {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub fqdn: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAllocation {
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub port: Option<u32>,
    #[serde(default)]
    pub alias: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminServer {
    pub id: String,
    pub name: String,
    pub state: ServerState,
    #[serde(default)]
    pub cpu_cores: Option<f64>,
    #[serde(default)]
    pub memory_mb: Option<u64>,
    #[serde(default)]
    pub disk_mb: Option<u64>,
    #[serde(default)]
    pub swap_mb: Option<i64>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub template: Option<NamedRef>,
    #[serde(default)]
    pub node: Option<NamedRef>,
    #[serde(default)]
    pub owner: Option<AdminOwner>,
    #[serde(default)]
    pub primary_allocation: Option<AdminAllocation>,
    #[serde(default)]
    pub suspended_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerTransfer {
    pub id: String,
    #[serde(default)]
    pub server_id: Option<String>,
    #[serde(default)]
    pub from_node_id: Option<String>,
    #[serde(default)]
    pub to_node_id: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub port: Option<u32>,
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub already_enabled: Option<bool>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

/// `GET /admin/servers` — the whole fleet, paginated, optional name search.
pub async fn list(
    auth: &AuthManager,
    page: u32,
    page_size: u32,
    q: Option<&str>,
) -> Result<Paged<AdminServer>, PanelError> {
    let mut path = format!("/admin/servers?page={page}&pageSize={}", page_size.min(100));
    if let Some(q) = q.map(str::trim).filter(|s| !s.is_empty()) {
        path.push_str(&format!("&q={}", urlencoding::encode(q)));
    }
    let (data, meta) = auth
        .authed_paged::<Vec<AdminServer>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

/// `DELETE /admin/servers/:id` — tear down + soft-delete. Does NOT cancel the
/// subscription (the caller must be warned).
pub async fn delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/servers/{id}"), None)
        .await
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResizeBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_cores: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_mb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub swap_mb: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk_mb: Option<u64>,
}

/// `PATCH /admin/servers/:id/resize` — staff comp resize, no invoice, applied live.
pub async fn resize(auth: &AuthManager, id: &str, body: &ResizeBody) -> Result<AdminServer, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/servers/{id}/resize"), Some(body))
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferBody<'a> {
    to_node_id: &'a str,
}

/// `POST /admin/servers/:id/transfer` — move to another node (queued).
pub async fn transfer(auth: &AuthManager, id: &str, to_node_id: &str) -> Result<ServerTransfer, PanelError> {
    let body = TransferBody { to_node_id };
    auth.authed_json(Method::POST, &format!("/admin/servers/{id}/transfer"), Some(&body))
        .await
}

/// `GET /admin/servers/:id/transfers` — transfer history (newest first).
pub async fn transfers(auth: &AuthManager, id: &str) -> Result<Vec<ServerTransfer>, PanelError> {
    auth.authed_json::<Vec<ServerTransfer>, ()>(
        Method::GET,
        &format!("/admin/servers/{id}/transfers"),
        None,
    )
    .await
}

/// `GET /admin/servers/:id/voice-chat` — dedicated voice UDP port status.
pub async fn voice_get(auth: &AuthManager, id: &str) -> Result<VoiceStatus, PanelError> {
    auth.authed_json::<VoiceStatus, ()>(Method::GET, &format!("/admin/servers/{id}/voice-chat"), None)
        .await
}

/// `POST /admin/servers/:id/voice-chat` — grant a dedicated voice UDP port.
pub async fn voice_enable(auth: &AuthManager, id: &str) -> Result<VoiceStatus, PanelError> {
    auth.authed_json::<VoiceStatus, ()>(Method::POST, &format!("/admin/servers/{id}/voice-chat"), None)
        .await
}

/// `DELETE /admin/servers/:id/voice-chat` — revoke the voice UDP port.
pub async fn voice_disable(auth: &AuthManager, id: &str) -> Result<VoiceStatus, PanelError> {
    auth.authed_json::<VoiceStatus, ()>(Method::DELETE, &format!("/admin/servers/{id}/voice-chat"), None)
        .await
}

/// `DELETE /admin/servers/:id/vanity-address` — strip a custom address, optionally
/// refunding to store credit. **Money-moving when `refund` is true.**
pub async fn vanity_strip(auth: &AuthManager, id: &str, refund_credit: bool) -> Result<serde_json::Value, PanelError> {
    let path = if refund_credit {
        format!("/admin/servers/{id}/vanity-address?refund=credit")
    } else {
        format!("/admin/servers/{id}/vanity-address")
    };
    auth.authed_json::<serde_json::Value, ()>(Method::DELETE, &path, None)
        .await
}

// ── per-server admin routes (staff override) ───────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SuspendBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

/// `POST /servers/:id/suspend` — suspend any server (staff override).
pub async fn suspend(auth: &AuthManager, id: &str, reason: Option<&str>) -> Result<serde_json::Value, PanelError> {
    let body = SuspendBody { reason };
    auth.authed_json(Method::POST, &format!("/servers/{id}/suspend"), Some(&body))
        .await
}

/// `POST /servers/:id/unsuspend` — unsuspend any server (staff override).
pub async fn unsuspend(auth: &AuthManager, id: &str) -> Result<serde_json::Value, PanelError> {
    auth.authed_json::<serde_json::Value, ()>(Method::POST, &format!("/servers/{id}/unsuspend"), None)
        .await
}

/// `POST /servers/:id/reinstall` — reinstall any server (may overwrite files).
pub async fn reinstall(auth: &AuthManager, id: &str) -> Result<serde_json::Value, PanelError> {
    auth.authed_json::<serde_json::Value, ()>(Method::POST, &format!("/servers/{id}/reinstall"), None)
        .await
}
