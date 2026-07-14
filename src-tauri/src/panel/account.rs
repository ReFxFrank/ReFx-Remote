//! Customer account operations. Currently the self-service password change,
//! which is deliberately reachable while the account is locked for a required
//! password change.
//!
//! The backend's `PasswordChangeInterceptor` 403s every authenticated route
//! except a short allow-list (`GET /auth/me`, `POST /auth/refresh`,
//! `POST /auth/logout`, `POST /account/password`), so a customer whose password
//! was reset by an admin can reach exactly this endpoint to unblock themselves
//! without leaving the app.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::panel::auth::AuthManager;
use crate::panel::error::PanelError;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangePasswordBody<'a> {
    current_password: &'a str,
    new_password: &'a str,
}

/// `POST /account/password` — change the signed-in user's password. The backend
/// returns 204 and clears `mustChangePassword`. Reachable while the account is
/// locked for a required password change.
pub async fn change_password(
    auth: &AuthManager,
    current_password: &str,
    new_password: &str,
) -> Result<(), PanelError> {
    let body = ChangePasswordBody { current_password, new_password };
    auth.authed_no_content(Method::POST, "/account/password", Some(&body))
        .await
}

// ── TOTP two-factor management ──────────────────────────────────────────

/// The secret + otpauth URL to add to an authenticator app when enrolling.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpEnrollment {
    #[serde(default)]
    pub otpauth_url: Option<String>,
    #[serde(default)]
    pub secret: Option<String>,
}

/// The one-time recovery codes returned once, on successful enrollment.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCodes {
    #[serde(default)]
    pub recovery_codes: Vec<String>,
}

#[derive(Serialize)]
struct TotpVerifyBody<'a> {
    code: &'a str,
}

/// `POST /auth/mfa/totp/enroll` — begin TOTP enrollment. Returns the secret and
/// otpauth URL to add to an authenticator; not active until verified.
pub async fn totp_enroll(auth: &AuthManager) -> Result<TotpEnrollment, PanelError> {
    auth.authed_json::<TotpEnrollment, ()>(Method::POST, "/auth/mfa/totp/enroll", None)
        .await
}

/// `POST /auth/mfa/totp/verify` — confirm enrollment with a code from the app.
/// Returns the one-time recovery codes to save.
pub async fn totp_verify(auth: &AuthManager, code: &str) -> Result<RecoveryCodes, PanelError> {
    auth.authed_json(Method::POST, "/auth/mfa/totp/verify", Some(&TotpVerifyBody { code }))
        .await
}

/// `DELETE /auth/mfa/totp` — turn off TOTP two-factor.
pub async fn totp_disable(auth: &AuthManager) -> Result<(), PanelError> {
    auth.authed_no_content::<()>(Method::DELETE, "/auth/mfa/totp", None)
        .await
}
