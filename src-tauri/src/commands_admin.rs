//! Staff/admin `#[tauri::command]` surface — `admin_*`. Every command is
//! authorized server-side (403 → `IpcError::Forbidden`); the frontend gates the
//! UI on `profile.permissions`. Keep `docs/ipc-contract.md` in lock-step.
//!
//! Nothing here returns a token/password EXCEPT the deliberate one-time
//! pass-throughs documented in the contract (created passwords, bootstrap
//! tokens) — none of those exist in this Tier-0 slice yet.

use serde::Serialize;
use tauri::State;

use crate::panel::admin::{
    billing, catalog, content, dbhosts, nodes, platform, products, roles, servers as admin_servers,
    settings, support, team, templates, users,
};
use crate::panel::error::IpcError;
use crate::panel::models::PageMeta;
use crate::state::AppState;

fn validation(msg: impl Into<String>) -> IpcError {
    IpcError { code: "VALIDATION", message: msg.into(), mfa_methods: None }
}

// ── Roles / RBAC (roles.manage) ────────────────────────────────────────

#[tauri::command]
pub async fn admin_roles_list(state: State<'_, AppState>) -> Result<Vec<roles::Role>, IpcError> {
    roles::list(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_role_permissions(
    state: State<'_, AppState>,
) -> Result<roles::PermissionCatalog, IpcError> {
    roles::permission_catalog(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_role_create(
    state: State<'_, AppState>,
    key: String,
    name: String,
    description: Option<String>,
    permissions: Vec<String>,
) -> Result<roles::Role, IpcError> {
    roles::create(&state.auth, &key, &name, description.as_deref(), &permissions)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn admin_role_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    permissions: Option<Vec<String>>,
) -> Result<roles::Role, IpcError> {
    roles::update(
        &state.auth,
        &id,
        name.as_deref(),
        description.as_deref(),
        permissions.as_deref(),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn admin_role_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    roles::delete(&state.auth, &id).await.map_err(Into::into)
}

// ── Users (users.read + granular users.*) ──────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserList {
    pub users: Vec<users::AdminUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn admin_users_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
    q: Option<String>,
    role: Option<String>,
    account_state: Option<String>,
) -> Result<AdminUserList, IpcError> {
    let page = users::list(
        &state.auth,
        page.unwrap_or(1),
        page_size.unwrap_or(25),
        q.as_deref(),
        role.as_deref(),
        account_state.as_deref(),
    )
    .await?;
    Ok(AdminUserList { users: page.data, meta: page.meta })
}

#[tauri::command]
pub async fn admin_user_set_role(
    state: State<'_, AppState>,
    user_id: String,
    role: Option<String>,
    role_id: Option<String>,
) -> Result<users::AdminUser, IpcError> {
    users::set_role(&state.auth, &user_id, role.as_deref(), role_id.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn admin_user_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<users::UserDetail, IpcError> {
    users::get(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_user_create(
    state: State<'_, AppState>,
    email: String,
    password: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    role: Option<String>,
    email_verified: Option<bool>,
) -> Result<users::OneTimeSecret, IpcError> {
    users::create(
        &state.auth,
        &email,
        password.as_deref(),
        first_name.as_deref(),
        last_name.as_deref(),
        role.as_deref(),
        email_verified.unwrap_or(true),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn admin_user_set_state(
    state: State<'_, AppState>,
    id: String,
    account_state: String,
) -> Result<users::AdminUser, IpcError> {
    users::set_state(&state.auth, &id, &account_state).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_user_verify_email(
    state: State<'_, AppState>,
    id: String,
) -> Result<users::AdminUser, IpcError> {
    users::verify_email(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_user_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    users::delete(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_user_purge(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    users::purge(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_user_send_password_reset(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, IpcError> {
    users::send_password_reset(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_user_set_password(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
) -> Result<users::OneTimeSecret, IpcError> {
    users::set_password(&state.auth, &id, password.as_deref()).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_user_credit_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<users::CreditLedger, IpcError> {
    users::credit_get(&state.auth, &id).await.map_err(Into::into)
}

/// Grant/deduct store credit — MONEY. Defense-in-depth: the UI collects the
/// amount the staffer typed as `confirm_amount` (major units); we require it to
/// match `amount_minor` exactly, so a UI bug can't fire an unintended amount.
#[tauri::command]
pub async fn admin_user_credit_adjust(
    state: State<'_, AppState>,
    id: String,
    amount_minor: i64,
    reason: Option<String>,
    note: Option<String>,
    confirm_amount: String,
) -> Result<users::CreditBalance, IpcError> {
    let validation = |m: &str| IpcError {
        code: "VALIDATION",
        message: m.to_string(),
        mfa_methods: None,
    };
    if amount_minor == 0 {
        return Err(validation("Amount can't be zero."));
    }
    let typed: f64 = confirm_amount
        .trim()
        .parse()
        .map_err(|_| validation("Type the amount to confirm."))?;
    let typed_minor = (typed * 100.0).round() as i64;
    if typed_minor != amount_minor.abs() {
        return Err(validation("The typed amount doesn't match — nothing was charged."));
    }
    users::credit_adjust(&state.auth, &id, amount_minor, reason.as_deref(), note.as_deref())
        .await
        .map_err(Into::into)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminCustomerList {
    pub customers: Vec<users::AdminCustomer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn admin_customers_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
    q: Option<String>,
) -> Result<AdminCustomerList, IpcError> {
    let page = users::customers_list(&state.auth, page.unwrap_or(1), page_size.unwrap_or(25), q.as_deref())
        .await?;
    Ok(AdminCustomerList { customers: page.data, meta: page.meta })
}

// ── Fleet server oversight (servers.read / servers.manage) ─────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminServerList {
    pub servers: Vec<admin_servers::AdminServer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn admin_servers_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
    q: Option<String>,
) -> Result<AdminServerList, IpcError> {
    let page = admin_servers::list(
        &state.auth,
        page.unwrap_or(1),
        page_size.unwrap_or(50),
        q.as_deref(),
    )
    .await?;
    Ok(AdminServerList { servers: page.data, meta: page.meta })
}

#[tauri::command]
pub async fn admin_server_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    admin_servers::delete(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_resize(
    state: State<'_, AppState>,
    id: String,
    cpu_cores: Option<f64>,
    memory_mb: Option<u64>,
    swap_mb: Option<i64>,
    disk_mb: Option<u64>,
) -> Result<admin_servers::AdminServer, IpcError> {
    let body = admin_servers::ResizeBody { cpu_cores, memory_mb, swap_mb, disk_mb };
    admin_servers::resize(&state.auth, &id, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_transfer(
    state: State<'_, AppState>,
    id: String,
    to_node_id: String,
) -> Result<admin_servers::ServerTransfer, IpcError> {
    admin_servers::transfer(&state.auth, &id, &to_node_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_transfers(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<admin_servers::ServerTransfer>, IpcError> {
    admin_servers::transfers(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_voice_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<admin_servers::VoiceStatus, IpcError> {
    admin_servers::voice_get(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_voice_enable(
    state: State<'_, AppState>,
    id: String,
) -> Result<admin_servers::VoiceStatus, IpcError> {
    admin_servers::voice_enable(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_voice_disable(
    state: State<'_, AppState>,
    id: String,
) -> Result<admin_servers::VoiceStatus, IpcError> {
    admin_servers::voice_disable(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_suspend(
    state: State<'_, AppState>,
    id: String,
    reason: Option<String>,
) -> Result<serde_json::Value, IpcError> {
    admin_servers::suspend(&state.auth, &id, reason.as_deref()).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_unsuspend(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, IpcError> {
    admin_servers::unsuspend(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_server_reinstall(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, IpcError> {
    admin_servers::reinstall(&state.auth, &id).await.map_err(Into::into)
}

/// Strip a server's vanity address. `refund_credit` issues store credit — a
/// money-moving action, so the caller must pass an explicit `confirm` that the
/// UI collected via typed confirmation.
#[tauri::command]
pub async fn admin_server_vanity_strip(
    state: State<'_, AppState>,
    id: String,
    refund_credit: bool,
    confirm: bool,
) -> Result<serde_json::Value, IpcError> {
    if refund_credit && !confirm {
        return Err(IpcError {
            code: "VALIDATION",
            message: "Refund not confirmed.".into(),
            mfa_methods: None,
        });
    }
    admin_servers::vanity_strip(&state.auth, &id, refund_credit).await.map_err(Into::into)
}

// ── Platform observability (audit.read / dashboard.read) ───────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogList {
    pub entries: Vec<platform::AuditLog>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_audit_logs(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
    actor_id: Option<String>,
    target_type: Option<String>,
    target_id: Option<String>,
    action: Option<String>,
    from: Option<String>,
    to: Option<String>,
) -> Result<AuditLogList, IpcError> {
    let filter = platform::AuditFilter {
        actor_id: actor_id.as_deref(),
        target_type: target_type.as_deref(),
        target_id: target_id.as_deref(),
        action: action.as_deref(),
        from: from.as_deref(),
        to: to.as_deref(),
    };
    let page = platform::audit_logs(&state.auth, page.unwrap_or(1), page_size.unwrap_or(50), &filter)
        .await?;
    Ok(AuditLogList { entries: page.data, meta: page.meta })
}

#[tauri::command]
pub async fn admin_metrics(state: State<'_, AppState>) -> Result<platform::AdminMetrics, IpcError> {
    platform::metrics(&state.auth).await.map_err(Into::into)
}

// ── Support desk (support.read / support.manage) ───────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketList {
    pub tickets: Vec<support::Ticket>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn admin_tickets_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
    q: Option<String>,
    ticket_state: Option<String>,
    priority: Option<String>,
    mine: Option<bool>,
) -> Result<TicketList, IpcError> {
    let filter = support::TicketFilter {
        q: q.as_deref(),
        state: ticket_state.as_deref(),
        priority: priority.as_deref(),
        mine: mine.unwrap_or(false),
    };
    let page = support::tickets_list(&state.auth, page.unwrap_or(1), page_size.unwrap_or(25), &filter)
        .await?;
    Ok(TicketList { tickets: page.data, meta: page.meta })
}

#[tauri::command]
pub async fn admin_ticket_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<support::TicketDetail, IpcError> {
    support::ticket_get(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_ticket_reply(
    state: State<'_, AppState>,
    id: String,
    body: String,
    is_internal: bool,
) -> Result<support::TicketMessage, IpcError> {
    support::ticket_reply(&state.auth, &id, &body, is_internal).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_ticket_update(
    state: State<'_, AppState>,
    id: String,
    ticket_state: Option<String>,
    priority: Option<String>,
    assignee_id: Option<String>,
    category_id: Option<String>,
) -> Result<support::Ticket, IpcError> {
    let update = support::TicketUpdate {
        state: ticket_state.as_deref(),
        priority: priority.as_deref(),
        assignee_id: assignee_id.as_deref(),
        category_id: category_id.as_deref(),
    };
    support::ticket_update(&state.auth, &id, &update).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_ticket_assign(
    state: State<'_, AppState>,
    id: String,
    assignee_id: String,
) -> Result<support::Ticket, IpcError> {
    support::ticket_assign(&state.auth, &id, &assignee_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_ticket_close(state: State<'_, AppState>, id: String) -> Result<support::Ticket, IpcError> {
    support::ticket_close(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_ticket_archive(state: State<'_, AppState>, id: String) -> Result<support::Ticket, IpcError> {
    support::ticket_archive(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_ticket_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    support::ticket_delete(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_support_staff(state: State<'_, AppState>) -> Result<Vec<support::Person>, IpcError> {
    support::staff(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_canned_responses(
    state: State<'_, AppState>,
) -> Result<Vec<support::CannedResponse>, IpcError> {
    support::canned_list(&state.auth).await.map_err(Into::into)
}

// ── Infrastructure: nodes + locations ──────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeList {
    pub nodes: Vec<nodes::Node>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn admin_nodes_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<NodeList, IpcError> {
    let page = nodes::list(&state.auth, page.unwrap_or(1), page_size.unwrap_or(100)).await?;
    Ok(NodeList { nodes: page.data, meta: page.meta })
}

#[tauri::command]
pub async fn admin_node_get(state: State<'_, AppState>, id: String) -> Result<nodes::Node, IpcError> {
    nodes::get(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_node_regions(state: State<'_, AppState>) -> Result<Vec<nodes::Region>, IpcError> {
    nodes::regions(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_node_heartbeats(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<nodes::Heartbeat>, IpcError> {
    nodes::heartbeats(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_node_ping(state: State<'_, AppState>, id: String) -> Result<nodes::Ping, IpcError> {
    nodes::ping(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_node_set_maintenance(
    state: State<'_, AppState>,
    id: String,
    maintenance: bool,
) -> Result<nodes::Node, IpcError> {
    nodes::set_maintenance(&state.auth, &id, maintenance).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_node_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    nodes::delete(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_node_restart_agent(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, IpcError> {
    nodes::restart_agent(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_node_update_agent(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, IpcError> {
    nodes::update_agent(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_node_rotate_bootstrap(
    state: State<'_, AppState>,
    id: String,
) -> Result<nodes::BootstrapToken, IpcError> {
    nodes::rotate_bootstrap(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_locations_list(state: State<'_, AppState>) -> Result<Vec<nodes::Region>, IpcError> {
    nodes::locations(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_location_create(
    state: State<'_, AppState>,
    code: String,
    name: String,
    country: Option<String>,
) -> Result<nodes::Region, IpcError> {
    nodes::location_create(&state.auth, &code, &name, country.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn admin_location_update(
    state: State<'_, AppState>,
    id: String,
    code: Option<String>,
    name: Option<String>,
    country: Option<String>,
) -> Result<nodes::Region, IpcError> {
    nodes::location_update(&state.auth, &id, code.as_deref(), name.as_deref(), country.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn admin_location_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    nodes::location_delete(&state.auth, &id).await.map_err(Into::into)
}

// ── Billing & commerce (billing.read/manage/refund, payments.manage) ───

#[tauri::command]
pub async fn admin_billing_summary(
    state: State<'_, AppState>,
) -> Result<billing::BillingSummary, IpcError> {
    billing::summary(&state.auth).await.map_err(Into::into)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceList {
    pub invoices: Vec<billing::Invoice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn admin_invoices_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
    q: Option<String>,
) -> Result<InvoiceList, IpcError> {
    let page = billing::invoices(&state.auth, page.unwrap_or(1), page_size.unwrap_or(50), q.as_deref())
        .await?;
    Ok(InvoiceList { invoices: page.data, meta: page.meta })
}

#[tauri::command]
pub async fn admin_invoice_void(
    state: State<'_, AppState>,
    id: String,
) -> Result<billing::Invoice, IpcError> {
    billing::invoice_void(&state.auth, &id).await.map_err(Into::into)
}

/// Settle an invoice off-platform — MONEY. Requires an explicit typed confirm
/// from the UI (invoice number), passed as `confirm`.
#[tauri::command]
pub async fn admin_invoice_mark_paid(
    state: State<'_, AppState>,
    id: String,
    confirm: bool,
) -> Result<billing::Invoice, IpcError> {
    if !confirm {
        return Err(validation("Mark-paid not confirmed."));
    }
    billing::invoice_mark_paid(&state.auth, &id).await.map_err(Into::into)
}

/// Issue a real gateway refund — MONEY. `amount_minor` is the exact amount to
/// refund; `confirm_amount` is the major-unit string the user typed and must
/// bind to it, so a UI bug can't refund an unintended amount.
#[tauri::command]
pub async fn admin_invoice_refund(
    state: State<'_, AppState>,
    id: String,
    amount_minor: i64,
    confirm_amount: String,
) -> Result<billing::RefundResult, IpcError> {
    if amount_minor <= 0 {
        return Err(validation("Refund amount must be positive."));
    }
    let typed: f64 = confirm_amount
        .trim()
        .parse()
        .map_err(|_| validation("Type the amount to confirm."))?;
    if (typed * 100.0).round() as i64 != amount_minor {
        return Err(validation("The typed amount doesn't match — nothing was refunded."));
    }
    billing::invoice_refund(&state.auth, &id, amount_minor).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_invoice_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    billing::invoice_delete(&state.auth, &id).await.map_err(Into::into)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderList {
    pub orders: Vec<billing::Order>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn admin_orders_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<OrderList, IpcError> {
    let page = billing::orders(&state.auth, page.unwrap_or(1), page_size.unwrap_or(50)).await?;
    Ok(OrderList { orders: page.data, meta: page.meta })
}

#[tauri::command]
pub async fn admin_order_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    billing::order_delete(&state.auth, &id).await.map_err(Into::into)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentList {
    pub payments: Vec<billing::Payment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PageMeta>,
}

#[tauri::command]
pub async fn admin_payments_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<PaymentList, IpcError> {
    let page = billing::payments(&state.auth, page.unwrap_or(1), page_size.unwrap_or(50)).await?;
    Ok(PaymentList { payments: page.data, meta: page.meta })
}

#[tauri::command]
pub async fn admin_payment_gateways(state: State<'_, AppState>) -> Result<serde_json::Value, IpcError> {
    billing::gateways(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_growth(
    state: State<'_, AppState>,
    days: Option<u32>,
) -> Result<serde_json::Value, IpcError> {
    billing::growth(&state.auth, days.unwrap_or(30).clamp(1, 3650)).await.map_err(Into::into)
}

// ── Catalog: coupons + gift cards (billing.manage) ─────────────────────

#[tauri::command]
pub async fn admin_coupons_list(state: State<'_, AppState>) -> Result<Vec<catalog::Coupon>, IpcError> {
    catalog::coupons(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_coupon_create(
    state: State<'_, AppState>,
    code: String,
    kind: String,
    value: f64,
    description: Option<String>,
    max_redemptions: Option<i64>,
    expires_at: Option<String>,
) -> Result<catalog::Coupon, IpcError> {
    let body = catalog::CouponBody {
        code: Some(&code),
        kind: Some(&kind),
        value: Some(value),
        description: description.as_deref(),
        max_redemptions,
        expires_at: expires_at.as_deref(),
    };
    catalog::coupon_create(&state.auth, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_coupon_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    catalog::coupon_delete(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_gift_cards_list(state: State<'_, AppState>) -> Result<Vec<catalog::GiftCard>, IpcError> {
    catalog::gift_cards(&state.auth).await.map_err(Into::into)
}

/// Issue a gift card — creates stored value (money-adjacent). The UI-typed
/// amount must bind to `balance_minor`, so a UI bug can't issue the wrong value.
#[tauri::command]
pub async fn admin_gift_card_create(
    state: State<'_, AppState>,
    balance_minor: i64,
    confirm_amount: String,
    note: Option<String>,
    expires_at: Option<String>,
) -> Result<catalog::GiftCard, IpcError> {
    if balance_minor <= 0 {
        return Err(validation("Balance must be positive."));
    }
    let typed: f64 = confirm_amount
        .trim()
        .parse()
        .map_err(|_| validation("Type the amount to confirm."))?;
    if (typed * 100.0).round() as i64 != balance_minor {
        return Err(validation("The typed amount doesn't match — no gift card was issued."));
    }
    let body = catalog::GiftCardBody { balance_minor, note: note.as_deref(), expires_at: expires_at.as_deref() };
    catalog::gift_card_create(&state.auth, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_gift_card_set_active(
    state: State<'_, AppState>,
    id: String,
    is_active: bool,
) -> Result<catalog::GiftCard, IpcError> {
    let body = catalog::GiftCardUpdate { is_active: Some(is_active), ..Default::default() };
    catalog::gift_card_update(&state.auth, &id, &body).await.map_err(Into::into)
}

// ═══════════════════════════════════════════════════════════════════════
// Tier 3: content, settings, database hosts, products, team
// ═══════════════════════════════════════════════════════════════════════

// ── Content: global alerts (content.read read / content.manage writes) ──

#[tauri::command]
pub async fn admin_alerts_list(
    state: State<'_, AppState>,
) -> Result<Vec<content::GlobalAlert>, IpcError> {
    content::alerts(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_alert_create(
    state: State<'_, AppState>,
    severity: Option<String>,
    title: String,
    body: String,
    is_active: Option<bool>,
    starts_at: Option<String>,
    ends_at: Option<String>,
) -> Result<content::GlobalAlert, IpcError> {
    let payload = content::AlertBody {
        severity: severity.as_deref(),
        title: Some(&title),
        body: Some(&body),
        is_active,
        starts_at: starts_at.as_deref(),
        ends_at: ends_at.as_deref(),
    };
    content::alert_create(&state.auth, &payload).await.map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_alert_update(
    state: State<'_, AppState>,
    id: String,
    severity: Option<String>,
    title: Option<String>,
    body: Option<String>,
    is_active: Option<bool>,
    starts_at: Option<String>,
    ends_at: Option<String>,
) -> Result<content::GlobalAlert, IpcError> {
    let payload = content::AlertBody {
        severity: severity.as_deref(),
        title: title.as_deref(),
        body: body.as_deref(),
        is_active,
        starts_at: starts_at.as_deref(),
        ends_at: ends_at.as_deref(),
    };
    content::alert_update(&state.auth, &id, &payload).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_alert_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    content::alert_delete(&state.auth, &id).await.map_err(Into::into)
}

// ── Content: homepage alerts (content.manage) ──────────────────────────

#[tauri::command]
pub async fn admin_homepage_alerts_list(
    state: State<'_, AppState>,
) -> Result<Vec<content::HomepageAlert>, IpcError> {
    content::homepage_alerts(&state.auth).await.map_err(Into::into)
}

// `type` is a Rust keyword; the param is `alert_type` (JS key `alertType`).
// The HomepageAlert response still serializes the field as `type`.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_homepage_alert_create(
    state: State<'_, AppState>,
    alert_type: Option<String>,
    title: String,
    body: String,
    is_active: Option<bool>,
    starts_at: Option<String>,
    ends_at: Option<String>,
    cta_label: Option<String>,
    cta_url: Option<String>,
    dismissible: Option<bool>,
    priority: Option<i64>,
) -> Result<content::HomepageAlert, IpcError> {
    let payload = content::HomepageAlertBody {
        type_: alert_type.as_deref(),
        title: Some(&title),
        body: Some(&body),
        is_active,
        starts_at: starts_at.as_deref(),
        ends_at: ends_at.as_deref(),
        cta_label: cta_label.as_deref(),
        cta_url: cta_url.as_deref(),
        dismissible,
        priority,
    };
    content::homepage_alert_create(&state.auth, &payload).await.map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_homepage_alert_update(
    state: State<'_, AppState>,
    id: String,
    alert_type: Option<String>,
    title: Option<String>,
    body: Option<String>,
    is_active: Option<bool>,
    starts_at: Option<String>,
    ends_at: Option<String>,
    cta_label: Option<String>,
    cta_url: Option<String>,
    dismissible: Option<bool>,
    priority: Option<i64>,
) -> Result<content::HomepageAlert, IpcError> {
    let payload = content::HomepageAlertBody {
        type_: alert_type.as_deref(),
        title: title.as_deref(),
        body: body.as_deref(),
        is_active,
        starts_at: starts_at.as_deref(),
        ends_at: ends_at.as_deref(),
        cta_label: cta_label.as_deref(),
        cta_url: cta_url.as_deref(),
        dismissible,
        priority,
    };
    content::homepage_alert_update(&state.auth, &id, &payload).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_homepage_alert_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), IpcError> {
    content::homepage_alert_delete(&state.auth, &id).await.map_err(Into::into)
}

// ── Content: status incidents (content.manage) ─────────────────────────

#[tauri::command]
pub async fn admin_incidents_list(
    state: State<'_, AppState>,
) -> Result<Vec<content::StatusIncident>, IpcError> {
    content::incidents(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_incident_create(
    state: State<'_, AppState>,
    title: String,
    impact: String,
    components: Vec<String>,
    body: String,
    status: Option<String>,
    notify: Option<bool>,
) -> Result<content::StatusIncident, IpcError> {
    let payload = content::IncidentCreate {
        title: &title,
        impact: &impact,
        components: &components,
        body: &body,
        status: status.as_deref(),
        notify,
    };
    content::incident_create(&state.auth, &payload).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_incident_add_update(
    state: State<'_, AppState>,
    id: String,
    status: String,
    body: String,
) -> Result<content::StatusIncident, IpcError> {
    let payload = content::IncidentUpdateBody { status: &status, body: &body };
    content::incident_add_update(&state.auth, &id, &payload).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_incident_update(
    state: State<'_, AppState>,
    id: String,
    title: Option<String>,
    impact: Option<String>,
    status: Option<String>,
    components: Option<Vec<String>>,
) -> Result<content::StatusIncident, IpcError> {
    let payload = content::IncidentPatch {
        title: title.as_deref(),
        impact: impact.as_deref(),
        status: status.as_deref(),
        components: components.as_deref(),
    };
    content::incident_update(&state.auth, &id, &payload).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_incident_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    content::incident_delete(&state.auth, &id).await.map_err(Into::into)
}

// ── Platform settings (settings.manage) ────────────────────────────────

#[tauri::command]
pub async fn admin_settings_email_get(
    state: State<'_, AppState>,
) -> Result<settings::EmailConfig, IpcError> {
    settings::email_get(&state.auth).await.map_err(Into::into)
}

/// Apply SMTP edits. `password` is write-only — a blank/omitted value keeps the
/// stored one. Returns nothing; the screen should refetch the masked config.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_settings_email_update(
    state: State<'_, AppState>,
    host: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    password: Option<String>,
    from: Option<String>,
    secure: Option<bool>,
    theme: Option<String>,
) -> Result<(), IpcError> {
    let body = settings::EmailUpdate { host, port, user, password, from, secure, theme };
    settings::email_update(&state.auth, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_settings_email_test(
    state: State<'_, AppState>,
    to: String,
) -> Result<settings::TestEmailResult, IpcError> {
    settings::email_test(&state.auth, &to).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_settings_steam_get(
    state: State<'_, AppState>,
) -> Result<settings::SteamConfig, IpcError> {
    settings::steam_get(&state.auth).await.map_err(Into::into)
}

/// Apply Steam edits. `api_key`, `password`, `guard_code` are write-only —
/// omitted values keep the stored ones. Returns nothing; refetch after.
#[tauri::command]
pub async fn admin_settings_steam_update(
    state: State<'_, AppState>,
    api_key: Option<String>,
    username: Option<String>,
    password: Option<String>,
    guard_code: Option<String>,
) -> Result<(), IpcError> {
    let body = settings::SteamUpdate { api_key, username, password, guard_code };
    settings::steam_update(&state.auth, &body).await.map_err(Into::into)
}

/// Run the steamcmd login probe on a node (caches machine-auth there). Consumes
/// the staged Guard code on success.
#[tauri::command]
pub async fn admin_settings_steam_verify(
    state: State<'_, AppState>,
    node_id: String,
    guard_code: Option<String>,
) -> Result<settings::SteamVerifyResult, IpcError> {
    settings::steam_verify(&state.auth, &node_id, guard_code.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn admin_settings_vanity_get(
    state: State<'_, AppState>,
) -> Result<settings::VanityConfig, IpcError> {
    settings::vanity_get(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_settings_vanity_update(
    state: State<'_, AppState>,
    enabled: Option<bool>,
    fee_minor: Option<i64>,
    reserved_words: Option<Vec<String>>,
) -> Result<settings::VanityConfig, IpcError> {
    let body = settings::VanityUpdate { enabled, fee_minor, reserved_words };
    settings::vanity_update(&state.auth, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_settings_referrals_get(
    state: State<'_, AppState>,
) -> Result<settings::ReferralConfig, IpcError> {
    settings::referrals_get(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_settings_referrals_update(
    state: State<'_, AppState>,
    enabled: Option<bool>,
    reward_minor: Option<i64>,
) -> Result<settings::ReferralConfig, IpcError> {
    let body = settings::ReferralUpdate { enabled, reward_minor };
    settings::referrals_update(&state.auth, &body).await.map_err(Into::into)
}

// 1) Add `pub mod dbhosts;` to src-tauri/src/panel/admin/mod.rs
// 2) Add `dbhosts` to the import in commands_admin.rs:
//    use crate::panel::admin::{billing, catalog, dbhosts, nodes, platform, roles, servers as admin_servers, support, users};
// 3) Paste these wrappers (list returns a plain Vec, like coupons — no list-wrapper struct needed):

// ── Database hosts (nodes.read / nodes.manage) ─────────────────────────

#[tauri::command]
pub async fn admin_database_hosts_list(
    state: State<'_, AppState>,
) -> Result<Vec<dbhosts::DatabaseHost>, IpcError> {
    dbhosts::list(&state.auth).await.map_err(Into::into)
}

/// Register a host. `password` is the write-only admin credential (encrypted
/// server-side, never returned).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_database_host_create(
    state: State<'_, AppState>,
    name: String,
    engine: Option<String>,
    host: String,
    port: Option<u16>,
    username: String,
    password: String,
    public_host: String,
    max_databases: Option<i64>,
    is_active: Option<bool>,
) -> Result<dbhosts::DatabaseHost, IpcError> {
    let body = dbhosts::CreateHostBody {
        name: &name,
        engine: engine.as_deref(),
        host: &host,
        port,
        username: &username,
        password: &password,
        public_host: &public_host,
        max_databases,
        is_active,
    };
    dbhosts::create(&state.auth, &body).await.map_err(Into::into)
}

/// Partial update. Omit `password` to keep the current one (engine is immutable).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_database_host_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    public_host: Option<String>,
    max_databases: Option<i64>,
    is_active: Option<bool>,
) -> Result<dbhosts::DatabaseHost, IpcError> {
    let body = dbhosts::UpdateHostBody {
        name: name.as_deref(),
        host: host.as_deref(),
        port,
        username: username.as_deref(),
        password: password.as_deref(),
        public_host: public_host.as_deref(),
        max_databases,
        is_active,
    };
    dbhosts::update(&state.auth, &id, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_database_host_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    dbhosts::delete(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_database_host_test(
    state: State<'_, AppState>,
    id: String,
) -> Result<dbhosts::TestResult, IpcError> {
    dbhosts::test(&state.auth, &id).await.map_err(Into::into)
}

// ── Catalog: products, hardware tiers + prices (catalog.read / catalog.manage) ──

#[tauri::command]
pub async fn admin_products_list(
    state: State<'_, AppState>,
) -> Result<Vec<products::Product>, IpcError> {
    products::list(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_product_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<products::Product, IpcError> {
    products::get(&state.auth, &id).await.map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_product_create(
    state: State<'_, AppState>,
    product_type: String,
    name: String,
    slug: String,
    billing_model: Option<String>,
    description: Option<String>,
    is_active: Option<bool>,
    game_template_id: Option<String>,
    allowed_template_ids: Option<Vec<String>>,
    min_slots: Option<i64>,
    max_slots: Option<i64>,
    slot_step: Option<i64>,
    cpu_per_slot: Option<f64>,
    memory_mb_per_slot: Option<i64>,
    disk_mb_per_slot: Option<i64>,
) -> Result<products::Product, IpcError> {
    let body = products::ProductBody {
        r#type: Some(&product_type),
        name: Some(&name),
        slug: Some(&slug),
        billing_model: billing_model.as_deref(),
        description: description.as_deref(),
        is_active,
        game_template_id: game_template_id.as_deref(),
        allowed_template_ids: allowed_template_ids.as_deref(),
        min_slots,
        max_slots,
        slot_step,
        cpu_per_slot,
        memory_mb_per_slot,
        disk_mb_per_slot,
        ..Default::default()
    };
    products::create(&state.auth, &body).await.map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_product_update(
    state: State<'_, AppState>,
    id: String,
    product_type: Option<String>,
    name: Option<String>,
    slug: Option<String>,
    billing_model: Option<String>,
    description: Option<String>,
    is_active: Option<bool>,
    game_template_id: Option<String>,
    allowed_template_ids: Option<Vec<String>>,
    min_slots: Option<i64>,
    max_slots: Option<i64>,
    slot_step: Option<i64>,
    cpu_per_slot: Option<f64>,
    memory_mb_per_slot: Option<i64>,
    disk_mb_per_slot: Option<i64>,
) -> Result<products::Product, IpcError> {
    let body = products::ProductBody {
        r#type: product_type.as_deref(),
        name: name.as_deref(),
        slug: slug.as_deref(),
        billing_model: billing_model.as_deref(),
        description: description.as_deref(),
        is_active,
        game_template_id: game_template_id.as_deref(),
        allowed_template_ids: allowed_template_ids.as_deref(),
        min_slots,
        max_slots,
        slot_step,
        cpu_per_slot,
        memory_mb_per_slot,
        disk_mb_per_slot,
        ..Default::default()
    };
    products::update(&state.auth, &id, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_product_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    products::delete(&state.auth, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_price_create(
    state: State<'_, AppState>,
    product_id: String,
    amount_minor: i64,
    interval: Option<String>,
    currency: Option<String>,
    is_active: Option<bool>,
) -> Result<products::Price, IpcError> {
    let body = products::PriceBody {
        amount_minor: Some(amount_minor),
        interval: interval.as_deref(),
        currency: currency.as_deref(),
        is_active,
        ..Default::default()
    };
    products::price_create(&state.auth, &product_id, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_tier_price_create(
    state: State<'_, AppState>,
    product_id: String,
    tier_id: String,
    amount_minor: i64,
    interval: Option<String>,
    currency: Option<String>,
    is_active: Option<bool>,
) -> Result<products::Price, IpcError> {
    let body = products::PriceBody {
        amount_minor: Some(amount_minor),
        interval: interval.as_deref(),
        currency: currency.as_deref(),
        is_active,
        ..Default::default()
    };
    products::tier_price_create(&state.auth, &product_id, &tier_id, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_price_update(
    state: State<'_, AppState>,
    price_id: String,
    amount_minor: Option<i64>,
    interval: Option<String>,
    currency: Option<String>,
    is_active: Option<bool>,
) -> Result<products::Price, IpcError> {
    let body = products::PriceBody {
        amount_minor,
        interval: interval.as_deref(),
        currency: currency.as_deref(),
        is_active,
        ..Default::default()
    };
    products::price_update(&state.auth, &price_id, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_price_delete(state: State<'_, AppState>, price_id: String) -> Result<(), IpcError> {
    products::price_delete(&state.auth, &price_id).await.map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_tier_create(
    state: State<'_, AppState>,
    product_id: String,
    name: String,
    cpu_cores: f64,
    memory_mb: i64,
    disk_mb: i64,
    description: Option<String>,
    recommended_players: Option<i64>,
    is_recommended: Option<bool>,
    is_active: Option<bool>,
    sort_order: Option<i64>,
) -> Result<products::HardwareTier, IpcError> {
    let body = products::TierBody {
        name: Some(&name),
        description: description.as_deref(),
        cpu_cores: Some(cpu_cores),
        memory_mb: Some(memory_mb),
        disk_mb: Some(disk_mb),
        recommended_players,
        is_recommended,
        is_active,
        sort_order,
    };
    products::tier_create(&state.auth, &product_id, &body).await.map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_tier_update(
    state: State<'_, AppState>,
    tier_id: String,
    name: Option<String>,
    description: Option<String>,
    cpu_cores: Option<f64>,
    memory_mb: Option<i64>,
    disk_mb: Option<i64>,
    recommended_players: Option<i64>,
    is_recommended: Option<bool>,
    is_active: Option<bool>,
    sort_order: Option<i64>,
) -> Result<products::HardwareTier, IpcError> {
    let body = products::TierBody {
        name: name.as_deref(),
        description: description.as_deref(),
        cpu_cores,
        memory_mb,
        disk_mb,
        recommended_players,
        is_recommended,
        is_active,
        sort_order,
    };
    products::tier_update(&state.auth, &tier_id, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_tier_delete(state: State<'_, AppState>, tier_id: String) -> Result<(), IpcError> {
    products::tier_delete(&state.auth, &tier_id).await.map_err(Into::into)
}

// ── Team (public "Meet the team" page — content.manage) ────────────────

#[tauri::command]
pub async fn admin_staff_list(state: State<'_, AppState>) -> Result<Vec<team::TeamMember>, IpcError> {
    team::list(&state.auth).await.map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_staff_create(
    state: State<'_, AppState>,
    name: String,
    title: String,
    bio: Option<String>,
    avatar_url: Option<String>,
    link: Option<String>,
    is_active: Option<bool>,
    sort_order: Option<i64>,
) -> Result<team::TeamMember, IpcError> {
    let body = team::TeamMemberCreate {
        name: &name,
        title: &title,
        bio: bio.as_deref(),
        avatar_url: avatar_url.as_deref(),
        link: link.as_deref(),
        is_active,
        sort_order,
    };
    team::create(&state.auth, &body).await.map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn admin_staff_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    title: Option<String>,
    bio: Option<String>,
    avatar_url: Option<String>,
    link: Option<String>,
    is_active: Option<bool>,
    sort_order: Option<i64>,
) -> Result<team::TeamMember, IpcError> {
    let body = team::TeamMemberUpdate {
        name: name.as_deref(),
        title: title.as_deref(),
        bio: bio.as_deref(),
        avatar_url: avatar_url.as_deref(),
        link: link.as_deref(),
        is_active,
        sort_order,
    };
    team::update(&state.auth, &id, &body).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_staff_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    team::delete(&state.auth, &id).await.map_err(Into::into)
}

// ── Server templates (catalog.read) ────────────────────────────────────

#[tauri::command]
pub async fn admin_templates_list(
    state: State<'_, AppState>,
) -> Result<Vec<templates::GameTemplate>, IpcError> {
    templates::list(&state.auth).await.map_err(Into::into)
}

#[tauri::command]
pub async fn admin_template_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<templates::GameTemplate, IpcError> {
    templates::get(&state.auth, &id).await.map_err(Into::into)
}
