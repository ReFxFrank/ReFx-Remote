//! Product/plan catalog (`/api/v1/admin/{products,prices,tiers}`).
//! Read is `catalog.read`; every mutation is `catalog.manage`.
//!
//! A HARDWARE_TIER product carries `hardwareTiers[]` (each a Low/Mid/High
//! package with its own per-interval `prices[]`); a PER_SLOT (voice) product
//! prices at the product level via `prices[]`. `amountMinor` is integer cents.
//! Nothing here is a write-only secret, so create/update return the full row.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;

// ── Response shapes (permissive decode) ─────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Price {
    pub id: String,
    #[serde(default)]
    pub product_id: Option<String>,
    /// Set when the price is scoped to a hardware tier; null = product-level.
    #[serde(default)]
    pub hardware_tier_id: Option<String>,
    #[serde(default)]
    pub interval: Option<String>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub amount_minor: Option<i64>,
    #[serde(default)]
    pub stripe_price_id: Option<String>,
    #[serde(default)]
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareTier {
    pub id: String,
    #[serde(default)]
    pub product_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub cpu_cores: Option<f64>,
    #[serde(default)]
    pub memory_mb: Option<i64>,
    #[serde(default)]
    pub disk_mb: Option<i64>,
    /// Informational only — never the billing basis.
    #[serde(default)]
    pub recommended_players: Option<i64>,
    #[serde(default)]
    pub is_recommended: Option<bool>,
    #[serde(default)]
    pub is_active: Option<bool>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub prices: Vec<Price>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    #[serde(default, rename = "type")]
    pub r#type: Option<String>,
    #[serde(default)]
    pub billing_model: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_active: Option<bool>,
    // Fallback resource limits (tiers supply the real ones on tiered products).
    #[serde(default)]
    pub cpu_cores: Option<f64>,
    #[serde(default)]
    pub memory_mb: Option<i64>,
    #[serde(default)]
    pub disk_mb: Option<i64>,
    #[serde(default)]
    pub slots: Option<i64>,
    #[serde(default)]
    pub allowed_template_ids: Vec<String>,
    /// Low/Mid/High packages on HARDWARE_TIER products (each with its prices).
    #[serde(default)]
    pub hardware_tiers: Vec<HardwareTier>,
    /// Product-level prices (PER_SLOT/voice products).
    #[serde(default)]
    pub prices: Vec<Price>,
    // GPortal-style per-slot pricing (PER_SLOT products).
    #[serde(default)]
    pub per_slot: Option<bool>,
    #[serde(default)]
    pub game_template_id: Option<String>,
    #[serde(default)]
    pub min_slots: Option<i64>,
    #[serde(default)]
    pub max_slots: Option<i64>,
    #[serde(default)]
    pub slot_step: Option<i64>,
    #[serde(default)]
    pub cpu_per_slot: Option<f64>,
    #[serde(default)]
    pub memory_mb_per_slot: Option<i64>,
    #[serde(default)]
    pub disk_mb_per_slot: Option<i64>,
    /// Reserved. The panel's admin Product response does not currently inline a
    /// `variables` array (template variables live on GameTemplate, exposed via
    /// the templates domain). Kept as a default-empty, permissive field so it
    /// decodes cleanly if the panel ever attaches them.
    #[serde(default)]
    pub variables: Vec<serde_json::Value>,
}

// ── Request bodies (create + update share one all-optional struct each) ─

/// Create/update a product. Create requires `type`, `name`, `slug`; update
/// (PATCH) omits whatever isn't changing. `billingModel`/`perSlot` are
/// reconciled server-side, so either may be sent.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProductBody<'a> {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub r#type: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_model: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_cores: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_mb: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk_mb: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slots: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_template_ids: Option<&'a [String]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_slot: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_template_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_slots: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_slots: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_step: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_per_slot: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_mb_per_slot: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk_mb_per_slot: Option<i64>,
}

/// Create/update a price. `amountMinor` is required on create (cents), optional
/// on update. `interval` defaults to MONTHLY server-side when omitted.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PriceBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_minor: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stripe_price_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
}

/// Create/update a hardware tier. Create requires `name`, `cpuCores`,
/// `memoryMb`, `diskMb`; update omits whatever isn't changing.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TierBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_cores: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_mb: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk_mb: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended_players: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_recommended: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i64>,
}

// ── Products ────────────────────────────────────────────────────────────

/// `GET /admin/products` — every product (active + inactive) with its tiers +
/// prices. Plain array, not paged.
pub async fn list(auth: &AuthManager) -> Result<Vec<Product>, PanelError> {
    auth.authed_json::<Vec<Product>, ()>(Method::GET, "/admin/products", None)
        .await
}

/// `GET /admin/products/:id` — single product (admin include: all tiers/prices).
pub async fn get(auth: &AuthManager, id: &str) -> Result<Product, PanelError> {
    auth.authed_json::<Product, ()>(Method::GET, &format!("/admin/products/{id}"), None)
        .await
}

/// `POST /admin/products`.
pub async fn create(auth: &AuthManager, body: &ProductBody<'_>) -> Result<Product, PanelError> {
    auth.authed_json(Method::POST, "/admin/products", Some(body)).await
}

/// `PATCH /admin/products/:id`.
pub async fn update(auth: &AuthManager, id: &str, body: &ProductBody<'_>) -> Result<Product, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/products/{id}"), Some(body))
        .await
}

/// `DELETE /admin/products/:id` (204; 400 if it still has subscriptions).
pub async fn delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/products/{id}"), None)
        .await
}

// ── Prices ──────────────────────────────────────────────────────────────

/// `POST /admin/products/:id/prices` — add a product-level price.
pub async fn price_create(
    auth: &AuthManager,
    product_id: &str,
    body: &PriceBody<'_>,
) -> Result<Price, PanelError> {
    auth.authed_json(Method::POST, &format!("/admin/products/{product_id}/prices"), Some(body))
        .await
}

/// `PATCH /admin/prices/:priceId`.
pub async fn price_update(
    auth: &AuthManager,
    price_id: &str,
    body: &PriceBody<'_>,
) -> Result<Price, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/prices/{price_id}"), Some(body))
        .await
}

/// `DELETE /admin/prices/:priceId` (204).
pub async fn price_delete(auth: &AuthManager, price_id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/prices/{price_id}"), None)
        .await
}

/// `POST /admin/products/:id/tiers/:tierId/prices` — add a price scoped to a tier.
pub async fn tier_price_create(
    auth: &AuthManager,
    product_id: &str,
    tier_id: &str,
    body: &PriceBody<'_>,
) -> Result<Price, PanelError> {
    auth.authed_json(
        Method::POST,
        &format!("/admin/products/{product_id}/tiers/{tier_id}/prices"),
        Some(body),
    )
    .await
}

// ── Hardware tiers ──────────────────────────────────────────────────────

/// `POST /admin/products/:id/tiers`.
pub async fn tier_create(
    auth: &AuthManager,
    product_id: &str,
    body: &TierBody<'_>,
) -> Result<HardwareTier, PanelError> {
    auth.authed_json(Method::POST, &format!("/admin/products/{product_id}/tiers"), Some(body))
        .await
}

/// `PATCH /admin/tiers/:tierId`.
pub async fn tier_update(
    auth: &AuthManager,
    tier_id: &str,
    body: &TierBody<'_>,
) -> Result<HardwareTier, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/tiers/{tier_id}"), Some(body))
        .await
}

/// `DELETE /admin/tiers/:tierId` (204).
pub async fn tier_delete(auth: &AuthManager, tier_id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/tiers/{tier_id}"), None)
        .await
}
