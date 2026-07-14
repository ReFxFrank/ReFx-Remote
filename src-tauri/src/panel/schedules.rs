//! Schedules (docs/recon/panel-api.md §5). Phase 4c does read, enable/disable,
//! and run-now (full CRUD is a stretch goal). Row shape from recon (the test
//! account has none to live-verify), decoded permissively.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use super::auth::AuthManager;
use super::error::PanelError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleTask {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub payload: Option<String>,
    #[serde(default)]
    pub time_offset_ms: Option<i64>,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub cron: Option<String>,
    #[serde(default, deserialize_with = "super::models::null_default")]
    pub is_active: bool,
    #[serde(default, deserialize_with = "super::models::null_default")]
    pub only_when_online: bool,
    #[serde(default)]
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub next_run_at: Option<String>,
    // Tolerate `"tasks": null` (a common empty-relation shape), not just an
    // absent key — otherwise one null row would fail the whole list.
    #[serde(default, deserialize_with = "super::models::null_default")]
    pub tasks: Vec<ScheduleTask>,
}

pub async fn list(auth: &AuthManager, id: &str) -> Result<Vec<Schedule>, PanelError> {
    auth.authed_json::<Vec<Schedule>, ()>(Method::GET, &format!("/servers/{id}/schedules"), None)
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveBody {
    is_active: bool,
}

pub async fn set_active(
    auth: &AuthManager,
    id: &str,
    schedule_id: &str,
    active: bool,
) -> Result<(), PanelError> {
    auth.authed_no_content(
        Method::PATCH,
        &format!("/servers/{id}/schedules/{schedule_id}"),
        Some(&ActiveBody { is_active: active }),
    )
    .await
}

pub async fn run_now(auth: &AuthManager, id: &str, schedule_id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(
        Method::POST,
        &format!("/servers/{id}/schedules/{schedule_id}/run"),
        None,
    )
    .await
}

/// One task to run when the schedule fires. `action` is `COMMAND` | `POWER` |
/// `BACKUP`; `payload` is the command text or power signal.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleTaskInput {
    pub action: String,
    pub payload: String,
}

/// Body for `POST /servers/:id/schedules`. A schedule with no tasks never does
/// anything, so the UI supplies at least one.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScheduleBody {
    pub name: String,
    pub cron: String,
    pub only_when_online: bool,
    pub is_active: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tasks: Vec<ScheduleTaskInput>,
}

/// Body for `PATCH /servers/:id/schedules/:scheduleId`. Only the fields sent
/// change; omitting `tasks` leaves an existing schedule's tasks untouched.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScheduleBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub only_when_online: Option<bool>,
}

/// `POST /servers/:id/schedules` — create a schedule (optionally with a task).
pub async fn create(
    auth: &AuthManager,
    id: &str,
    body: &CreateScheduleBody,
) -> Result<Schedule, PanelError> {
    auth.authed_json(Method::POST, &format!("/servers/{id}/schedules"), Some(body))
        .await
}

/// `PATCH /servers/:id/schedules/:scheduleId` — update schedule fields.
pub async fn update(
    auth: &AuthManager,
    id: &str,
    schedule_id: &str,
    body: &UpdateScheduleBody,
) -> Result<Schedule, PanelError> {
    auth.authed_json(
        Method::PATCH,
        &format!("/servers/{id}/schedules/{schedule_id}"),
        Some(body),
    )
    .await
}

/// `DELETE /servers/:id/schedules/:scheduleId`.
pub async fn delete(auth: &AuthManager, id: &str, schedule_id: &str) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(
        Method::DELETE,
        &format!("/servers/{id}/schedules/{schedule_id}"),
        None,
    )
    .await
}
