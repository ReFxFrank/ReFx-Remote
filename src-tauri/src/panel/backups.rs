//! Backups domain (docs/recon/panel-api.md §7). Restore/delete are
//! destructive → the UI gates them behind typed confirmation.

use std::path::Path;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use super::auth::AuthManager;
use super::error::PanelError;
use super::files::resolve_signed_url;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BackupState {
    Pending,
    InProgress,
    Completed,
    Failed,
    #[serde(other)]
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub state: BackupState,
    #[serde(default)]
    pub storage: Option<String>,
    #[serde(default)]
    pub progress_pct: Option<f64>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub checksum: Option<String>,
    #[serde(default)]
    pub is_locked: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

pub async fn list(auth: &AuthManager, id: &str) -> Result<Vec<Backup>, PanelError> {
    let (data, _) = auth
        .authed_paged::<Vec<Backup>, ()>(
            Method::GET,
            &format!("/servers/{id}/backups?page=1&pageSize=100"),
            None,
        )
        .await?;
    Ok(data)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody<'a> {
    name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<&'a str>,
}

pub async fn create(
    auth: &AuthManager,
    id: &str,
    name: &str,
    mode: Option<&str>,
) -> Result<Backup, PanelError> {
    auth.authed_json(
        Method::POST,
        &format!("/servers/{id}/backups"),
        Some(&CreateBody { name, mode }),
    )
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LockBody {
    is_locked: bool,
}

pub async fn set_locked(
    auth: &AuthManager,
    id: &str,
    backup_id: &str,
    locked: bool,
) -> Result<Backup, PanelError> {
    auth.authed_json(
        Method::PATCH,
        &format!("/servers/{id}/backups/{backup_id}"),
        Some(&LockBody { is_locked: locked }),
    )
    .await
}

pub async fn delete(auth: &AuthManager, id: &str, backup_id: &str) -> Result<(), PanelError> {
    // DELETE returns a bodyless 2xx (verified live) — decoding an envelope
    // would raise a spurious Decode error on every successful delete.
    auth.authed_no_content::<()>(
        Method::DELETE,
        &format!("/servers/{id}/backups/{backup_id}"),
        None,
    )
    .await
}

pub async fn restore(auth: &AuthManager, id: &str, backup_id: &str) -> Result<(), PanelError> {
    // Restore returns `{ accepted: true }` (non-null) — decode it.
    auth.authed_json::<serde_json::Value, ()>(
        Method::POST,
        &format!("/servers/{id}/backups/{backup_id}/restore"),
        None,
    )
    .await
    .map(|_| ())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedUrl {
    url: String,
}

/// Download a backup archive to `dest`. The URL is either an absolute S3/R2
/// presigned URL or a relative panel relay — resolve then stream (offsite-
/// capable because presigned URLs live on object-storage hosts).
pub async fn download(
    auth: &AuthManager,
    id: &str,
    backup_id: &str,
    dest: &Path,
) -> Result<u64, PanelError> {
    let signed: SignedUrl = auth
        .authed_json::<SignedUrl, ()>(
            Method::GET,
            &format!("/servers/{id}/backups/{backup_id}/download"),
            None,
        )
        .await?;
    let url = resolve_signed_url(auth.origin(), &signed.url);
    auth.download_offsite_to(&url, dest).await
}
