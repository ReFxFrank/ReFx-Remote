//! Users & customers admin (`/api/v1/admin/users*`). Read is `users.read`;
//! mutations carry granular `users.*` permissions. This module currently covers
//! the list + role-assignment needed by the Roles screen; the full user-detail
//! and account-action surface lands with the Users screen (Tier 1).

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;
use crate::panel::servers::Paged;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUser {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub global_role: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub role_id: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub email_verified_at: Option<String>,
}

/// `GET /admin/users` — paginated account list with optional search/filters.
pub async fn list(
    auth: &AuthManager,
    page: u32,
    page_size: u32,
    q: Option<&str>,
    role: Option<&str>,
    state: Option<&str>,
) -> Result<Paged<AdminUser>, PanelError> {
    let mut path = format!("/admin/users?page={page}&pageSize={}", page_size.min(100));
    if let Some(q) = q.map(str::trim).filter(|s| !s.is_empty()) {
        path.push_str(&format!("&q={}", urlencoding::encode(q)));
    }
    if let Some(role) = role.filter(|s| !s.is_empty()) {
        path.push_str(&format!("&role={}", urlencoding::encode(role)));
    }
    if let Some(state) = state.filter(|s| !s.is_empty()) {
        path.push_str(&format!("&state={}", urlencoding::encode(state)));
    }
    let (data, meta) = auth
        .authed_paged::<Vec<AdminUser>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminCustomer {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub global_role: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub active_services: Option<u64>,
    #[serde(default)]
    pub servers: Option<u64>,
    #[serde(default)]
    pub lifetime_spend_minor: Option<i64>,
}

/// `GET /admin/customers` — paying customers (>=1 active paid subscription).
pub async fn customers_list(
    auth: &AuthManager,
    page: u32,
    page_size: u32,
    q: Option<&str>,
) -> Result<Paged<AdminCustomer>, PanelError> {
    let mut path = format!("/admin/customers?page={page}&pageSize={}", page_size.min(100));
    if let Some(q) = q.map(str::trim).filter(|s| !s.is_empty()) {
        path.push_str(&format!("&q={}", urlencoding::encode(q)));
    }
    let (data, meta) = auth
        .authed_paged::<Vec<AdminCustomer>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

// ── Detail view ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailServer {
    pub id: String,
    #[serde(default)]
    pub short_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub node: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailSubscription {
    pub id: String,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub interval: Option<String>,
    #[serde(default)]
    pub current_period_end: Option<String>,
    #[serde(default)]
    pub cancel_at_period_end: Option<bool>,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub product: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailInvoice {
    pub id: String,
    #[serde(default)]
    pub number: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub total_minor: Option<i64>,
    #[serde(default)]
    pub amount_paid_minor: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub paid_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethod {
    pub id: String,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub brand: Option<String>,
    #[serde(default)]
    pub last4: Option<String>,
    #[serde(default)]
    pub is_default: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDetail {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub global_role: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub role_id: Option<String>,
    #[serde(default)]
    pub email_verified_at: Option<String>,
    #[serde(default)]
    pub totp_enabled_at: Option<String>,
    #[serde(default)]
    pub credit_balance_minor: Option<i64>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub owned_servers: Vec<DetailServer>,
    #[serde(default)]
    pub subscriptions: Vec<DetailSubscription>,
    #[serde(default)]
    pub invoices: Vec<DetailInvoice>,
    #[serde(default)]
    pub payment_methods: Vec<PaymentMethod>,
}

/// `GET /admin/users/:id` — full account view (secrets stripped).
pub async fn get(auth: &AuthManager, id: &str) -> Result<UserDetail, PanelError> {
    auth.authed_json::<UserDetail, ()>(Method::GET, &format!("/admin/users/{id}"), None)
        .await
}

// ── Account actions ────────────────────────────────────────────────────

/// One-time plaintext credential — returned to the WebView for copy-once and
/// NEVER persisted or logged (the redaction layer scrubs it if it ever hits a log).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneTimeSecret {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    pub password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody<'a> {
    email: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    first_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<&'a str>,
    email_verified: bool,
}

/// `POST /admin/users` — create an account. Returns the password ONCE.
pub async fn create(
    auth: &AuthManager,
    email: &str,
    password: Option<&str>,
    first_name: Option<&str>,
    last_name: Option<&str>,
    role: Option<&str>,
    email_verified: bool,
) -> Result<OneTimeSecret, PanelError> {
    let body = CreateBody { email, password, first_name, last_name, role, email_verified };
    auth.authed_json(Method::POST, "/admin/users", Some(&body)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateBody<'a> {
    state: &'a str,
}

/// `PATCH /admin/users/:id` — set account state (ACTIVE/SUSPENDED/BANNED). NOTE:
/// this route intentionally skips the role-rank guard the `ban`/`suspend` routes
/// enforce (mirrors the web admin); the server remains authoritative.
pub async fn set_state(auth: &AuthManager, id: &str, state: &str) -> Result<AdminUser, PanelError> {
    let body = StateBody { state };
    auth.authed_json(Method::PATCH, &format!("/admin/users/{id}"), Some(&body))
        .await
}

/// `POST /admin/users/:id/verify-email` — mark email verified.
pub async fn verify_email(auth: &AuthManager, id: &str) -> Result<AdminUser, PanelError> {
    auth.authed_json::<AdminUser, ()>(Method::POST, &format!("/admin/users/{id}/verify-email"), None)
        .await
}

/// `DELETE /admin/users/:id` — soft-delete (400 if the user still owns servers).
pub async fn delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/users/{id}"), None)
        .await
}

/// `POST /admin/users/:id/purge` — GDPR erasure (retains invoices/payments).
pub async fn purge(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::POST, &format!("/admin/users/{id}/purge"), None)
        .await
}

/// `POST /admin/users/:id/send-password-reset` — email a reset link.
pub async fn send_password_reset(auth: &AuthManager, id: &str) -> Result<serde_json::Value, PanelError> {
    auth.authed_json::<serde_json::Value, ()>(
        Method::POST,
        &format!("/admin/users/{id}/send-password-reset"),
        None,
    )
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetPasswordBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<&'a str>,
}

/// `POST /admin/users/:id/set-password` — set a temporary password (omit to
/// auto-generate). Returns the password ONCE.
pub async fn set_password(auth: &AuthManager, id: &str, password: Option<&str>) -> Result<OneTimeSecret, PanelError> {
    let body = SetPasswordBody { password };
    auth.authed_json(Method::POST, &format!("/admin/users/{id}/set-password"), Some(&body))
        .await
}

// ── Store credit (users.credit — MONEY) ────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditTx {
    pub id: String,
    #[serde(default)]
    pub amount_minor: Option<i64>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditLedger {
    #[serde(default)]
    pub balance_minor: i64,
    #[serde(default)]
    pub transactions: Vec<CreditTx>,
}

/// `GET /admin/users/:id/credit` — balance + ledger.
pub async fn credit_get(auth: &AuthManager, id: &str) -> Result<CreditLedger, PanelError> {
    auth.authed_json::<CreditLedger, ()>(Method::GET, &format!("/admin/users/{id}/credit"), None)
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GrantCreditBody<'a> {
    amount_minor: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<&'a str>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditBalance {
    #[serde(default)]
    pub balance_minor: i64,
}

/// `POST /admin/users/:id/credit` — grant (positive) / deduct (negative) credit.
pub async fn credit_adjust(
    auth: &AuthManager,
    id: &str,
    amount_minor: i64,
    reason: Option<&str>,
    note: Option<&str>,
) -> Result<CreditBalance, PanelError> {
    let body = GrantCreditBody { amount_minor, reason, note };
    auth.authed_json(Method::POST, &format!("/admin/users/{id}/credit"), Some(&body))
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetRoleBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    role_id: Option<&'a str>,
}

/// `PATCH /admin/users/:id/role` — assign an RBAC role (by roleId) or a coarse
/// GlobalRole. This is how a user becomes staff or is promoted/demoted. The
/// server refuses to demote the last owner and syncs `globalRole`.
pub async fn set_role(
    auth: &AuthManager,
    user_id: &str,
    role: Option<&str>,
    role_id: Option<&str>,
) -> Result<AdminUser, PanelError> {
    let body = SetRoleBody { role, role_id };
    auth.authed_json(Method::PATCH, &format!("/admin/users/{user_id}/role"), Some(&body))
        .await
}
