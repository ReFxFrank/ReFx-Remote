//! Billing & commerce admin (`/api/v1/admin/{billing,invoices,orders,payments}`).
//! SENSITIVE. Read is `billing.read`; mutations `billing.manage`; refunds
//! `billing.refund`; payments `payments.manage`. mark-paid and refund MOVE MONEY.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;
use crate::panel::servers::Paged;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingSummary {
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub revenue_minor: i64,
    #[serde(default)]
    pub outstanding_minor: i64,
    #[serde(default)]
    pub active_subscriptions: u64,
    #[serde(default)]
    pub open_invoices: u64,
    #[serde(default)]
    pub paid_invoices: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRef {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invoice {
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
    pub user: Option<UserRef>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub id: String,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub interval: Option<String>,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub current_period_end: Option<String>,
    #[serde(default)]
    pub user: Option<UserRef>,
    #[serde(default)]
    pub product: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: String,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub amount_minor: Option<i64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub failure_reason: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub invoice: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefundResult {
    #[serde(default)]
    pub refunded: bool,
    #[serde(default)]
    pub amount_minor: Option<i64>,
    #[serde(default)]
    pub full: Option<bool>,
}

/// `GET /admin/billing/summary` — headline KPIs.
pub async fn summary(auth: &AuthManager) -> Result<BillingSummary, PanelError> {
    auth.authed_json::<BillingSummary, ()>(Method::GET, "/admin/billing/summary", None)
        .await
}

/// `GET /admin/invoices` — every invoice, paginated.
pub async fn invoices(
    auth: &AuthManager,
    page: u32,
    page_size: u32,
    q: Option<&str>,
) -> Result<Paged<Invoice>, PanelError> {
    let mut path = format!("/admin/invoices?page={page}&pageSize={}", page_size.min(100));
    if let Some(q) = q.map(str::trim).filter(|s| !s.is_empty()) {
        path.push_str(&format!("&q={}", urlencoding::encode(q)));
    }
    let (data, meta) = auth
        .authed_paged::<Vec<Invoice>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

/// `POST /admin/invoices/:id/void` — void an unpaid invoice (non-money).
pub async fn invoice_void(auth: &AuthManager, id: &str) -> Result<Invoice, PanelError> {
    auth.authed_json::<Invoice, ()>(Method::POST, &format!("/admin/invoices/{id}/void"), None)
        .await
}

/// `POST /admin/invoices/:id/mark-paid` — MONEY (settlement).
pub async fn invoice_mark_paid(auth: &AuthManager, id: &str) -> Result<Invoice, PanelError> {
    auth.authed_json::<Invoice, ()>(Method::POST, &format!("/admin/invoices/{id}/mark-paid"), None)
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RefundBody {
    amount_minor: i64,
}

/// `POST /admin/invoices/:id/refund` — MONEY (real gateway refund).
pub async fn invoice_refund(auth: &AuthManager, id: &str, amount_minor: i64) -> Result<RefundResult, PanelError> {
    let body = RefundBody { amount_minor };
    auth.authed_json(Method::POST, &format!("/admin/invoices/{id}/refund"), Some(&body))
        .await
}

/// `DELETE /admin/invoices/:id` — permanent delete (204).
pub async fn invoice_delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/invoices/{id}"), None)
        .await
}

/// `GET /admin/orders` — subscriptions across the platform.
pub async fn orders(auth: &AuthManager, page: u32, page_size: u32) -> Result<Paged<Order>, PanelError> {
    let path = format!("/admin/orders?page={page}&pageSize={}", page_size.min(100));
    let (data, meta) = auth
        .authed_paged::<Vec<Order>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

/// `DELETE /admin/orders/:id` — delete a subscription (204; keeps invoices).
pub async fn order_delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/admin/orders/{id}"), None)
        .await
}

/// `GET /admin/payments` — raw payment ledger (payments.manage).
pub async fn payments(auth: &AuthManager, page: u32, page_size: u32) -> Result<Paged<Payment>, PanelError> {
    let path = format!("/admin/payments?page={page}&pageSize={}", page_size.min(100));
    let (data, meta) = auth
        .authed_paged::<Vec<Payment>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

/// `GET /admin/payments/gateways` — gateway configured status.
pub async fn gateways(auth: &AuthManager) -> Result<serde_json::Value, PanelError> {
    auth.authed_json::<serde_json::Value, ()>(Method::GET, "/admin/payments/gateways", None)
        .await
}
