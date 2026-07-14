//! Platform settings (`/api/v1/admin/settings/*`). Gated by `settings.manage`.
//!
//! Reads return the panel's MASKED config views: secrets (SMTP password, Steam
//! password / Web API key, one-time Guard code) are NEVER returned — only
//! whether they're set (`passwordSet`, `apiKeySet`, …). Writes accept those
//! secrets as request-only fields; omitting a field leaves the stored value
//! untouched, so a blank password on save keeps the current one.
//!
//! Wire quirks mirrored exactly:
//! - `PATCH /settings/email` and `PATCH /settings/steam` return no body (the UI
//!   refetches the masked config) → `authed_no_content`.
//! - `PATCH /settings/vanity` and `PATCH /settings/referrals` re-read and return
//!   the fresh config → typed structs.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;

// ── Email (SMTP) ───────────────────────────────────────────────────────

/// Masked SMTP config (`GET /admin/settings/email`). The password is never
/// returned — only `passwordSet` reports whether one is stored.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailConfig {
    #[serde(default)]
    pub configured: bool,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub secure: bool,
    /// Transactional-email theme: "dark" | "light".
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub password_set: bool,
}

/// Owner SMTP edits — only provided fields change. `password` is write-only
/// (encrypted at rest, never echoed back).
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmailUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    /// Write-only SMTP password.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secure: Option<bool>,
    /// "dark" | "light".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
}

/// `POST /admin/settings/email/test` result.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestEmailResult {
    /// False when SMTP isn't configured (the email was logged, not delivered).
    #[serde(default)]
    pub delivered: bool,
}

/// `GET /admin/settings/email` — masked SMTP config.
pub async fn email_get(auth: &AuthManager) -> Result<EmailConfig, PanelError> {
    auth.authed_json::<EmailConfig, ()>(Method::GET, "/admin/settings/email", None)
        .await
}

/// `PATCH /admin/settings/email` — apply edits (returns no body; refetch after).
pub async fn email_update(auth: &AuthManager, body: &EmailUpdate) -> Result<(), PanelError> {
    auth.authed_no_content(Method::PATCH, "/admin/settings/email", Some(body))
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TestEmailBody<'a> {
    to: &'a str,
}

/// `POST /admin/settings/email/test` — send a test email using the saved config.
pub async fn email_test(auth: &AuthManager, to: &str) -> Result<TestEmailResult, PanelError> {
    let body = TestEmailBody { to };
    auth.authed_json(Method::POST, "/admin/settings/email/test", Some(&body))
        .await
}

// ── Steam (central SteamCMD login + Web API key) ───────────────────────

/// Masked Steam config (`GET /admin/settings/steam`). Secrets (password, API
/// key, staged Guard code) are never returned — only booleans reporting state.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamConfig {
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub api_key_set: bool,
    #[serde(default)]
    pub password_set: bool,
    /// True when username + password are both set (steamcmd can log in).
    #[serde(default)]
    pub login_configured: bool,
    /// True when a one-time Steam Guard code is staged for the next install.
    #[serde(default)]
    pub guard_code_pending: bool,
}

/// Owner Steam edits — only provided fields change. `api_key`, `password` and
/// `guard_code` are all write-only (encrypted / consumed once; never echoed).
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SteamUpdate {
    /// Write-only Steam Web API key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// Write-only Steam password.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Write-only one-time Steam Guard code (staged, consumed on next install).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guard_code: Option<String>,
}

/// `POST /admin/settings/steam/verify` result — the steamcmd login probe.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamVerifyResult {
    #[serde(default)]
    pub ok: bool,
    /// steamcmd output log (surfaced verbatim in the UI).
    #[serde(default)]
    pub output: String,
}

/// `GET /admin/settings/steam` — masked Steam config.
pub async fn steam_get(auth: &AuthManager) -> Result<SteamConfig, PanelError> {
    auth.authed_json::<SteamConfig, ()>(Method::GET, "/admin/settings/steam", None)
        .await
}

/// `PATCH /admin/settings/steam` — apply edits (returns no body; refetch after).
pub async fn steam_update(auth: &AuthManager, body: &SteamUpdate) -> Result<(), PanelError> {
    auth.authed_no_content(Method::PATCH, "/admin/settings/steam", Some(body))
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SteamVerifyBody<'a> {
    node_id: &'a str,
    /// Fresh Guard code for this login; falls back to the staged code if omitted.
    #[serde(skip_serializing_if = "Option::is_none")]
    guard_code: Option<&'a str>,
}

/// `POST /admin/settings/steam/verify` — log in on `node_id` now, caching the
/// machine-auth there. Consumes the staged Guard code on success.
pub async fn steam_verify(
    auth: &AuthManager,
    node_id: &str,
    guard_code: Option<&str>,
) -> Result<SteamVerifyResult, PanelError> {
    let body = SteamVerifyBody { node_id, guard_code };
    auth.authed_json(Method::POST, "/admin/settings/steam/verify", Some(&body))
        .await
}

// ── Custom server addresses (vanity labels) ────────────────────────────

/// Vanity-address config (`GET /admin/settings/vanity`).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VanityConfig {
    #[serde(default)]
    pub enabled: bool,
    /// One-time fee in minor units (e.g. 200 = $2.00; 0 = free).
    #[serde(default)]
    pub fee_minor: i64,
    /// Extra reserved words (merged with the built-in list) — one per entry.
    #[serde(default)]
    pub reserved_words: Vec<String>,
}

/// Owner vanity edits — only provided fields change.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VanityUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fee_minor: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reserved_words: Option<Vec<String>>,
}

/// `GET /admin/settings/vanity`.
pub async fn vanity_get(auth: &AuthManager) -> Result<VanityConfig, PanelError> {
    auth.authed_json::<VanityConfig, ()>(Method::GET, "/admin/settings/vanity", None)
        .await
}

/// `PATCH /admin/settings/vanity` — returns the fresh config (the panel re-reads
/// after applying).
pub async fn vanity_update(
    auth: &AuthManager,
    body: &VanityUpdate,
) -> Result<VanityConfig, PanelError> {
    auth.authed_json(Method::PATCH, "/admin/settings/vanity", Some(body))
        .await
}

// ── Referral program ───────────────────────────────────────────────────

/// Referral-program config (`GET /admin/settings/referrals`).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferralConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Credit BOTH sides receive on the referred customer's first paid invoice,
    /// in minor units (e.g. 500 = $5.00).
    #[serde(default)]
    pub reward_minor: i64,
}

/// Owner referral edits — only provided fields change.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReferralUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reward_minor: Option<i64>,
}

/// `GET /admin/settings/referrals`.
pub async fn referrals_get(auth: &AuthManager) -> Result<ReferralConfig, PanelError> {
    auth.authed_json::<ReferralConfig, ()>(Method::GET, "/admin/settings/referrals", None)
        .await
}

/// `PATCH /admin/settings/referrals` — returns the fresh config (the panel
/// re-reads after applying).
pub async fn referrals_update(
    auth: &AuthManager,
    body: &ReferralUpdate,
) -> Result<ReferralConfig, PanelError> {
    auth.authed_json(Method::PATCH, "/admin/settings/referrals", Some(body))
        .await
}
