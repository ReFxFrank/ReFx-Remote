//! The user's in-app notification feed (`GET /account/notifications`). The
//! backend writes a durable row for involuntary server events (crash,
//! suspension — the same source that drives mobile push), so polling this feed
//! catches a crash even when auto-restart bounces the server back to RUNNING
//! within seconds and the transient CRASHED state falls between state polls.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use super::auth::AuthManager;
use super::error::PanelError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppNotification {
    pub id: String,
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub read_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

/// `GET /account/notifications` — newest first, plain array (no meta).
pub async fn list(
    auth: &AuthManager,
    page: u32,
    page_size: u32,
) -> Result<Vec<AppNotification>, PanelError> {
    auth.authed_json::<Vec<AppNotification>, ()>(
        Method::GET,
        &format!("/account/notifications?page={page}&pageSize={}", page_size.min(100)),
        None,
    )
    .await
}
