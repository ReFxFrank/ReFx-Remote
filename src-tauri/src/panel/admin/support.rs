//! Support desk, staff side (`/api/v1/support/*`). Nav gates on `support.read`;
//! workflow mutations (update/assign/archive/delete/canned) require `support.manage`.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;
use crate::panel::servers::Paged;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub global_role: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MsgCount {
    #[serde(default)]
    pub messages: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub id: String,
    #[serde(default)]
    pub number: Option<i64>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub requester_id: Option<String>,
    #[serde(default)]
    pub assignee_id: Option<String>,
    #[serde(default)]
    pub requester: Option<Person>,
    #[serde(default)]
    pub assignee: Option<Person>,
    #[serde(default)]
    pub sla_breached: Option<bool>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default, rename = "_count")]
    pub count: Option<MsgCount>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketMessage {
    pub id: String,
    #[serde(default)]
    pub author_id: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub is_internal: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub author: Option<Person>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketDetail {
    pub id: String,
    #[serde(default)]
    pub number: Option<i64>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub requester: Option<Person>,
    #[serde(default)]
    pub assignee: Option<Person>,
    #[serde(default)]
    pub assignee_id: Option<String>,
    #[serde(default)]
    pub sla_breached: Option<bool>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub messages: Vec<TicketMessage>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CannedResponse {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Default)]
pub struct TicketFilter<'a> {
    pub q: Option<&'a str>,
    pub state: Option<&'a str>,
    pub priority: Option<&'a str>,
    pub mine: bool,
}

/// `GET /support/tickets` — staff ticket queue.
pub async fn tickets_list(
    auth: &AuthManager,
    page: u32,
    page_size: u32,
    filter: &TicketFilter<'_>,
) -> Result<Paged<Ticket>, PanelError> {
    let mut path = format!("/support/tickets?page={page}&pageSize={}", page_size.min(100));
    if let Some(q) = filter.q.map(str::trim).filter(|s| !s.is_empty()) {
        path.push_str(&format!("&q={}", urlencoding::encode(q)));
    }
    if let Some(s) = filter.state.filter(|s| !s.is_empty()) {
        path.push_str(&format!("&state={}", urlencoding::encode(s)));
    }
    if let Some(p) = filter.priority.filter(|s| !s.is_empty()) {
        path.push_str(&format!("&priority={}", urlencoding::encode(p)));
    }
    if filter.mine {
        path.push_str("&mine=true");
    }
    let (data, meta) = auth
        .authed_paged::<Vec<Ticket>, ()>(Method::GET, &path, None)
        .await?;
    Ok(Paged { data, meta })
}

/// `GET /support/tickets/:id` — full thread (staff see internal notes).
pub async fn ticket_get(auth: &AuthManager, id: &str) -> Result<TicketDetail, PanelError> {
    auth.authed_json::<TicketDetail, ()>(Method::GET, &format!("/support/tickets/{id}"), None)
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplyBody<'a> {
    body: &'a str,
    is_internal: bool,
}

/// `POST /support/tickets/:id/messages` — public reply or (staff) internal note.
pub async fn ticket_reply(
    auth: &AuthManager,
    id: &str,
    body: &str,
    is_internal: bool,
) -> Result<TicketMessage, PanelError> {
    let payload = ReplyBody { body, is_internal };
    auth.authed_json(Method::POST, &format!("/support/tickets/{id}/messages"), Some(&payload))
        .await
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TicketUpdate<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<&'a str>,
}

/// `PATCH /support/tickets/:id` — staff workflow fields.
pub async fn ticket_update(auth: &AuthManager, id: &str, update: &TicketUpdate<'_>) -> Result<Ticket, PanelError> {
    auth.authed_json(Method::PATCH, &format!("/support/tickets/{id}"), Some(update))
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssignBody<'a> {
    assignee_id: &'a str,
}

/// `POST /support/tickets/:id/assign` — assign to a staff member.
pub async fn ticket_assign(auth: &AuthManager, id: &str, assignee_id: &str) -> Result<Ticket, PanelError> {
    let body = AssignBody { assignee_id };
    auth.authed_json(Method::POST, &format!("/support/tickets/{id}/assign"), Some(&body))
        .await
}

/// `POST /support/tickets/:id/close`.
pub async fn ticket_close(auth: &AuthManager, id: &str) -> Result<Ticket, PanelError> {
    auth.authed_json::<Ticket, ()>(Method::POST, &format!("/support/tickets/{id}/close"), None)
        .await
}

/// `POST /support/tickets/:id/archive` (400 if not RESOLVED/CLOSED).
pub async fn ticket_archive(auth: &AuthManager, id: &str) -> Result<Ticket, PanelError> {
    auth.authed_json::<Ticket, ()>(Method::POST, &format!("/support/tickets/{id}/archive"), None)
        .await
}

/// `DELETE /support/tickets/:id` — permanent delete (204).
pub async fn ticket_delete(auth: &AuthManager, id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, &format!("/support/tickets/{id}"), None)
        .await
}

/// `GET /support/staff` — assignee picker directory.
pub async fn staff(auth: &AuthManager) -> Result<Vec<Person>, PanelError> {
    auth.authed_json::<Vec<Person>, ()>(Method::GET, "/support/staff", None)
        .await
}

/// `GET /support/canned-responses` — reusable reply snippets.
pub async fn canned_list(auth: &AuthManager) -> Result<Vec<CannedResponse>, PanelError> {
    auth.authed_json::<Vec<CannedResponse>, ()>(Method::GET, "/support/canned-responses", None)
        .await
}
