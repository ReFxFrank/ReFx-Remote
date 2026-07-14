//! Platform observability: audit log (`audit.read`) and the admin dashboard
//! metrics tiles (`dashboard.read`). Both read-only.

use std::collections::HashMap;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;
use crate::panel::servers::Paged;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditActor {
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLog {
    pub id: String,
    #[serde(default)]
    pub actor_id: Option<String>,
    /// Forward-compatible: the backend `listAuditLogs` query does not currently
    /// `include` the actor relation, so this is usually absent and the UI falls
    /// back to `actor_id`. Populates automatically if the backend adds the join.
    #[serde(default)]
    pub actor: Option<AuditActor>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub target_type: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Default)]
pub struct AuditFilter<'a> {
    pub actor_id: Option<&'a str>,
    pub target_type: Option<&'a str>,
    pub target_id: Option<&'a str>,
    pub action: Option<&'a str>,
    pub from: Option<&'a str>,
    pub to: Option<&'a str>,
}

/// `GET /admin/audit-logs` — filtered, paginated audit trail (newest first).
pub async fn audit_logs(
    auth: &AuthManager,
    page: u32,
    page_size: u32,
    filter: &AuditFilter<'_>,
) -> Result<Paged<AuditLog>, PanelError> {
    let mut path = format!("/admin/audit-logs?page={page}&pageSize={}", page_size.min(100));
    let mut add = |k: &str, v: Option<&str>| {
        if let Some(v) = v.map(str::trim).filter(|s| !s.is_empty()) {
            path.push_str(&format!("&{k}={}", urlencoding::encode(v)));
        }
    };
    add("actorId", filter.actor_id);
    add("targetType", filter.target_type);
    add("targetId", filter.target_id);
    add("action", filter.action);
    add("from", filter.from);
    add("to", filter.to);
    let (data, meta) = auth
        .authed_paged::<Vec<AuditLog>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

// ── Dashboard metrics ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsTotals {
    #[serde(default)]
    pub users: u64,
    #[serde(default)]
    pub servers: u64,
    #[serde(default)]
    pub nodes_online: u64,
    #[serde(default)]
    pub open_tickets: u64,
    #[serde(default)]
    pub active_subscriptions: u64,
    #[serde(default)]
    pub mrr_minor: i64,
    #[serde(default)]
    pub mrr_currency: Option<String>,
    #[serde(default)]
    pub revenue_minor: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeHealth {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub cpu_pct: Option<f64>,
    #[serde(default)]
    pub mem_pct: Option<f64>,
    #[serde(default)]
    pub disk_pct: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminMetrics {
    #[serde(default)]
    pub totals: Option<MetricsTotals>,
    #[serde(default)]
    pub servers_by_state: HashMap<String, u64>,
    #[serde(default)]
    pub nodes: Vec<NodeHealth>,
}

/// `GET /admin/metrics` — dashboard summary tiles.
pub async fn metrics(auth: &AuthManager) -> Result<AdminMetrics, PanelError> {
    auth.authed_json::<AdminMetrics, ()>(Method::GET, "/admin/metrics", None)
        .await
}
