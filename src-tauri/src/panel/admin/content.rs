//! Content: internal global alerts, public homepage alerts, and status
//! incidents (`/api/v1/admin/{alerts,homepage-alerts,status/incidents}`).
//!
//! Reads are gated `content.read` (global alerts) — homepage-alerts and
//! incidents lists are `content.manage` in the panel — and every mutation is
//! `content.manage`. Authorization is enforced server-side (403 →
//! `IpcError::Forbidden`); these functions decode permissively.
//!
//! Nothing here is a secret pass-through — the one-time status-webhook signing
//! secret lives on the separate `/admin/status/webhooks` surface, not modeled
//! in this module.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;

// ── Global alerts (internal panel-wide banners) ─────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalAlert {
    pub id: String,
    /// `INFO` | `WARNING` | `CRITICAL`.
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub is_active: Option<bool>,
    #[serde(default)]
    pub starts_at: Option<String>,
    #[serde(default)]
    pub ends_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

/// Request body for creating/updating a global alert. `title`/`body` are
/// required on create; all fields are optional on PATCH (send only what
/// changes). Fields left `None` are omitted from the payload.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AlertBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    // Serialized even when None so an explicit null clears the date (the editor
    // always sends the full form; the backend distinguishes null=clear from
    // absent=keep).
    pub starts_at: Option<&'a str>,
    pub ends_at: Option<&'a str>,
}

/// `GET /admin/alerts` — every alert incl. inactive/expired, newest first.
pub async fn alerts(auth: &AuthManager) -> Result<Vec<GlobalAlert>, PanelError> {
    auth.authed_json::<Vec<GlobalAlert>, ()>(Method::GET, "/admin/alerts", None)
        .await
}

/// `POST /admin/alerts`.
pub async fn alert_create(auth: &AuthManager, body: &AlertBody<'_>) -> Result<GlobalAlert, PanelError> {
    auth.authed_json(Method::POST, "/admin/alerts", Some(body)).await
}

/// `PATCH /admin/alerts/:id`.
pub async fn alert_update(
    auth: &AuthManager,
    id: &str,
    body: &AlertBody<'_>,
) -> Result<GlobalAlert, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/alerts/{id}"), Some(body))
        .await
}

/// `DELETE /admin/alerts/:id` — permanent.
pub async fn alert_delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/alerts/{id}"), None)
        .await
}

// ── Homepage alerts (public storefront notices) ─────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomepageAlert {
    pub id: String,
    /// `INFO` | `SUCCESS` | `WARNING` | `DANGER` | `PROMO`.
    #[serde(rename = "type", default)]
    pub type_: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub is_active: Option<bool>,
    #[serde(default)]
    pub starts_at: Option<String>,
    #[serde(default)]
    pub ends_at: Option<String>,
    #[serde(default)]
    pub cta_label: Option<String>,
    #[serde(default)]
    pub cta_url: Option<String>,
    #[serde(default)]
    pub dismissible: Option<bool>,
    /// Higher priority shows first.
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// Request body for creating/updating a homepage alert. `title`/`body` are
/// required on create; all optional on PATCH. Omitted (`None`) fields are not
/// sent.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HomepageAlertBody<'a> {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub type_: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    // Serialized even when None so an explicit null clears these (the editor
    // always sends the full form; the backend treats null=clear, absent=keep).
    pub starts_at: Option<&'a str>,
    pub ends_at: Option<&'a str>,
    pub cta_label: Option<&'a str>,
    pub cta_url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i64>,
}

/// `GET /admin/homepage-alerts` — every notice incl. inactive/expired,
/// highest priority first.
pub async fn homepage_alerts(auth: &AuthManager) -> Result<Vec<HomepageAlert>, PanelError> {
    auth.authed_json::<Vec<HomepageAlert>, ()>(Method::GET, "/admin/homepage-alerts", None)
        .await
}

/// `POST /admin/homepage-alerts`.
pub async fn homepage_alert_create(
    auth: &AuthManager,
    body: &HomepageAlertBody<'_>,
) -> Result<HomepageAlert, PanelError> {
    auth.authed_json(Method::POST, "/admin/homepage-alerts", Some(body)).await
}

/// `PATCH /admin/homepage-alerts/:id`.
pub async fn homepage_alert_update(
    auth: &AuthManager,
    id: &str,
    body: &HomepageAlertBody<'_>,
) -> Result<HomepageAlert, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/homepage-alerts/{id}"), Some(body))
        .await
}

/// `DELETE /admin/homepage-alerts/:id` — permanent.
pub async fn homepage_alert_delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/homepage-alerts/{id}"), None)
        .await
}

// ── Status incidents (public /status page) ──────────────────────────────

/// One entry on an incident's timeline (Investigating → … → Resolved).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentUpdate {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub incident_id: Option<String>,
    /// `INVESTIGATING` | `IDENTIFIED` | `MONITORING` | `RESOLVED`.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusIncident {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    /// `INVESTIGATING` | `IDENTIFIED` | `MONITORING` | `RESOLVED`.
    #[serde(default)]
    pub status: Option<String>,
    /// `MAINTENANCE` | `DEGRADED` | `OUTAGE`.
    #[serde(default)]
    pub impact: Option<String>,
    /// Affected component keys: `panel-api` | `web` | `nodes` | `ios-app`.
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub resolved_at: Option<String>,
    /// Full timeline, newest first. Absent on the add-update response (the
    /// panel returns the bare incident there) — decodes to an empty list.
    #[serde(default)]
    pub updates: Vec<IncidentUpdate>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// Request body to open an incident with its first timeline update. `title`,
/// `impact`, `components` and `body` are required; `status` defaults to
/// `INVESTIGATING` and `notify` fans the incident out to every active customer.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentCreate<'a> {
    pub title: &'a str,
    pub impact: &'a str,
    pub components: &'a [String],
    pub body: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify: Option<bool>,
}

/// Request body to append a timeline update; `RESOLVED` marks the incident
/// resolved and clears the affected components.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentUpdateBody<'a> {
    pub status: &'a str,
    pub body: &'a str,
}

/// Request body to patch incident fields directly (corrections / manual
/// resolve). All fields optional; omitted (`None`) fields are not sent.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IncidentPatch<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impact: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub components: Option<&'a [String]>,
}

/// `GET /admin/status/incidents` — every incident, newest first, with timeline.
pub async fn incidents(auth: &AuthManager) -> Result<Vec<StatusIncident>, PanelError> {
    auth.authed_json::<Vec<StatusIncident>, ()>(Method::GET, "/admin/status/incidents", None)
        .await
}

/// `POST /admin/status/incidents` — post immediately to the public status page.
pub async fn incident_create(
    auth: &AuthManager,
    body: &IncidentCreate<'_>,
) -> Result<StatusIncident, PanelError> {
    auth.authed_json(Method::POST, "/admin/status/incidents", Some(body)).await
}

/// `POST /admin/status/incidents/:id/updates` — append a timeline update.
pub async fn incident_add_update(
    auth: &AuthManager,
    id: &str,
    body: &IncidentUpdateBody<'_>,
) -> Result<StatusIncident, PanelError> {
    auth.authed_json(Method::POST, &format!("/admin/status/incidents/{id}/updates"), Some(body))
        .await
}

/// `PATCH /admin/status/incidents/:id` — patch fields (e.g. manual resolve).
pub async fn incident_update(
    auth: &AuthManager,
    id: &str,
    body: &IncidentPatch<'_>,
) -> Result<StatusIncident, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/status/incidents/{id}"), Some(body))
        .await
}

/// `DELETE /admin/status/incidents/:id` — removes the incident and its timeline.
pub async fn incident_delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/status/incidents/{id}"), None)
        .await
}
