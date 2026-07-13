//! Wire types for the ReFx panel API. Shapes are the ones observed in
//! docs/api-surface.md — success envelope `{ success, data, meta? }`,
//! flat error body, camelCase fields.

use serde::{Deserialize, Serialize};

/// Success envelope. `meta` present only on paginated responses.
#[derive(Debug, Deserialize)]
pub struct Envelope<T> {
    #[serde(default)]
    pub success: bool,
    pub data: Option<T>,
    #[serde(default)]
    pub meta: Option<PageMeta>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    pub page: u32,
    pub page_size: u32,
    pub total: u64,
    pub total_pages: u32,
}

/// The panel's only error body shape (all-exceptions filter):
/// `{ statusCode, error, message: string | string[], path, timestamp, code? }`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    #[serde(default)]
    pub status_code: u16,
    #[serde(default)]
    pub error: String,
    #[serde(default)]
    pub message: MessageField,
    /// Only set by specific interceptors, e.g. `PASSWORD_CHANGE_REQUIRED`.
    #[serde(default)]
    pub code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum MessageField {
    One(String),
    Many(Vec<String>),
}

impl Default for MessageField {
    fn default() -> Self {
        MessageField::One(String::new())
    }
}

impl MessageField {
    pub fn joined(&self) -> String {
        match self {
            MessageField::One(s) => s.clone(),
            MessageField::Many(v) => v.join(" "),
        }
    }
    pub fn list(&self) -> Vec<String> {
        match self {
            MessageField::One(s) => vec![s.clone()],
            MessageField::Many(v) => v.clone(),
        }
    }
}

/// `POST /auth/login`, `POST /auth/mfa/verify`, `POST /auth/refresh`.
///
/// MFA landmine (docs/api-surface.md §3a): when MFA is required the panel
/// sends **empty-string** tokens plus `mfaRequired: true` — detect via
/// `mfaRequired`/`mfaToken`, never via null/absent tokens.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub expires_in: u64,
    #[serde(default)]
    pub mfa_required: bool,
    #[serde(default)]
    pub mfa_token: Option<String>,
    #[serde(default)]
    pub methods: Vec<String>,
}

impl TokenResponse {
    pub fn needs_mfa(&self) -> bool {
        self.mfa_required || self.mfa_token.as_deref().is_some_and(|t| !t.is_empty())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginBody<'a> {
    pub email: &'a str,
    pub password: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totp: Option<&'a str>,
    pub remember_me: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaVerifyBody<'a> {
    pub mfa_token: &'a str,
    pub code: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<&'a str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshBody<'a> {
    pub refresh_token: &'a str,
}

/// `GET /auth/me` — subset the app needs; unknown fields ignored.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub global_role: Option<String>,
    #[serde(default)]
    pub must_change_password: bool,
    #[serde(default)]
    pub totp_enabled_at: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}
