//! One error type for everything the panel can throw at us, mapped to
//! (a) a stable machine code the frontend can branch on and
//! (b) a human sentence a non-technical gamer understands.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum PanelError {
    #[error("not signed in")]
    NotSignedIn,
    /// A 401 from the wire, message preserved — login 401s carry
    /// "Invalid credentials" / "Account banned" / "Account suspended".
    /// Auth flows remap this; it shouldn't normally escape to the UI.
    #[error("unauthorized: {message}")]
    Unauthorized { message: String },
    #[error("session expired")]
    SessionExpired,
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("MFA required")]
    MfaRequired { methods: Vec<String> },
    #[error("password change required")]
    PasswordChangeRequired,
    #[error("forbidden: {message}")]
    Forbidden { message: String },
    #[error("not found: {message}")]
    NotFound { message: String },
    #[error("validation failed: {}", messages.join("; "))]
    Validation { messages: Vec<String> },
    /// 409 — the action conflicts with current state (e.g. power while
    /// installing). The server message is user-appropriate; show it.
    #[error("conflict: {message}")]
    Conflict { message: String },
    #[error("rate limited")]
    RateLimited { retry_after_secs: Option<u64> },
    #[error("server error {status}: {message}")]
    Server { status: u16, message: String },
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("unexpected response shape: {0}")]
    Decode(String),
    #[error("credential store error: {0}")]
    Vault(String),
    #[error("{0}")]
    Other(String),
}

impl PanelError {
    /// Stable machine code for the IPC boundary.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotSignedIn => "NOT_SIGNED_IN",
            Self::Unauthorized { .. } => "UNAUTHORIZED",
            Self::SessionExpired => "SESSION_EXPIRED",
            Self::InvalidCredentials => "INVALID_CREDENTIALS",
            Self::MfaRequired { .. } => "MFA_REQUIRED",
            Self::PasswordChangeRequired => "PASSWORD_CHANGE_REQUIRED",
            Self::Forbidden { .. } => "FORBIDDEN",
            Self::NotFound { .. } => "NOT_FOUND",
            Self::Validation { .. } => "VALIDATION",
            Self::Conflict { .. } => "CONFLICT",
            Self::RateLimited { .. } => "RATE_LIMITED",
            Self::Server { .. } => "SERVER_ERROR",
            Self::Network(_) => "NETWORK",
            Self::Decode(_) => "DECODE",
            Self::Vault(_) => "VAULT",
            Self::Other(_) => "OTHER",
        }
    }

    /// Human sentence for the UI. No status codes, no crate names.
    pub fn user_message(&self) -> String {
        match self {
            Self::NotSignedIn => "You're not signed in.".into(),
            Self::Unauthorized { message }
                if !message.is_empty() && !message.eq_ignore_ascii_case("unauthorized") =>
            {
                message.clone()
            }
            Self::Unauthorized { .. } => {
                "Your session isn't valid anymore. Please sign in again.".into()
            }
            Self::SessionExpired => {
                "Your session has expired or was signed out from another device. Please sign in again.".into()
            }
            Self::InvalidCredentials => "That email or password isn't right.".into(),
            Self::MfaRequired { .. } => "Enter your two-factor code to finish signing in.".into(),
            Self::PasswordChangeRequired => {
                "Your account requires a password change. Please update it on refx.gg, then sign in here.".into()
            }
            Self::Forbidden { message } if !message.is_empty() && message != "forbidden" => {
                message.clone()
            }
            Self::Forbidden { .. } => "You don't have permission to do that.".into(),
            Self::NotFound { .. } => "That wasn't found — it may have been deleted.".into(),
            Self::Validation { messages } if !messages.is_empty() => messages.join(" "),
            Self::Validation { .. } => "The panel rejected that request as invalid.".into(),
            Self::Conflict { message } if !message.is_empty() => message.clone(),
            Self::Conflict { .. } => "That can't be done right now — the server is busy.".into(),
            Self::RateLimited { retry_after_secs } => match retry_after_secs {
                Some(s) => format!("Slow down a moment — try again in {s} seconds."),
                None => "Slow down a moment and try again.".into(),
            },
            Self::Server { .. } => "The panel hit a problem on its end. Try again shortly.".into(),
            Self::Network(_) => "Can't reach the panel right now. Check your connection.".into(),
            Self::Decode(_) => "The panel sent something this app didn't understand.".into(),
            Self::Vault(_) => "Couldn't access Windows Credential Manager.".into(),
            Self::Other(m) => m.clone(),
        }
    }
}

/// What crosses the IPC boundary on failure. Never contains a token,
/// a raw reqwest error chain, or anything else worth redacting.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mfa_methods: Option<Vec<String>>,
}

impl From<PanelError> for IpcError {
    fn from(e: PanelError) -> Self {
        let mfa_methods = match &e {
            PanelError::MfaRequired { methods } => Some(methods.clone()),
            _ => None,
        };
        IpcError {
            code: e.code(),
            message: e.user_message(),
            mfa_methods,
        }
    }
}
