//! Staff/admin `#[tauri::command]` surface — `admin_*`. Every command is
//! authorized server-side (403 → `IpcError::Forbidden`); the frontend gates the
//! UI on `profile.permissions`. Keep `docs/ipc-contract.md` in lock-step.
//!
//! Nothing here returns a token/password EXCEPT the deliberate one-time
//! pass-throughs documented in the contract (created passwords, bootstrap
//! tokens) — none of those exist in this Tier-0 slice yet.

use serde::Serialize;
use tauri::State;

use crate::panel::admin::{platform, roles, servers as admin_servers, support, users};
use crate::panel::error::IpcError;
use crate::panel::models::PageMeta;
use crate::state::AppState;

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
