//! Commerce catalog: coupons + gift cards (`/api/v1/admin/{coupons,gift-cards}`).
//! Gated by `billing.manage`. Gift-card issuance creates stored value.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Coupon {
    pub id: String,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub value: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub max_redemptions: Option<i64>,
    #[serde(default)]
    pub max_per_user: Option<i64>,
    #[serde(default)]
    pub times_redeemed: Option<i64>,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCard {
    pub id: String,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub balance_minor: Option<i64>,
    #[serde(default)]
    pub initial_balance_minor: Option<i64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub is_active: Option<bool>,
}

// ── Coupons ────────────────────────────────────────────────────────────

pub async fn coupons(auth: &AuthManager) -> Result<Vec<Coupon>, PanelError> {
    auth.authed_json::<Vec<Coupon>, ()>(Method::GET, "/admin/coupons", None)
        .await
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CouponBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_redemptions: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<&'a str>,
}

pub async fn coupon_create(auth: &AuthManager, body: &CouponBody<'_>) -> Result<Coupon, PanelError> {
    auth.authed_json(Method::POST, "/admin/coupons", Some(body)).await
}

pub async fn coupon_update(auth: &AuthManager, id: &str, body: &CouponBody<'_>) -> Result<Coupon, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/coupons/{id}"), Some(body))
        .await
}

pub async fn coupon_delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/coupons/{id}"), None)
        .await
}

// ── Gift cards ─────────────────────────────────────────────────────────

pub async fn gift_cards(auth: &AuthManager) -> Result<Vec<GiftCard>, PanelError> {
    auth.authed_json::<Vec<GiftCard>, ()>(Method::GET, "/admin/gift-cards", None)
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardBody<'a> {
    pub balance_minor: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<&'a str>,
}

/// Issue a gift card — creates stored value (money-adjacent liability).
pub async fn gift_card_create(auth: &AuthManager, body: &GiftCardBody<'_>) -> Result<GiftCard, PanelError> {
    auth.authed_json(Method::POST, "/admin/gift-cards", Some(body)).await
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardUpdate<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<&'a str>,
}

pub async fn gift_card_update(auth: &AuthManager, id: &str, body: &GiftCardUpdate<'_>) -> Result<GiftCard, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/admin/gift-cards/{id}"), Some(body))
        .await
}
