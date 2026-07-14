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
use serde::Serialize;

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
