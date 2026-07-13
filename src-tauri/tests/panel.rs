//! Client/auth tests against wiremock fixtures shaped exactly like the
//! bodies observed from production (docs/api-surface.md, live-verified
//! 2026-07-13). These test OUR code against real shapes — they do not
//! pretend to test the panel.

use reqwest::Method;
use serde_json::json;
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use refx_desktop_lib::panel::auth::{AuthManager, LoginOutcome};
use refx_desktop_lib::panel::client::PanelClient;
use refx_desktop_lib::panel::error::PanelError;
use refx_desktop_lib::panel::models::Profile;
use refx_desktop_lib::vault::Vault;

fn client(server: &MockServer) -> PanelClient {
    PanelClient::new(&server.uri()).expect("client")
}

fn manager(server: &MockServer) -> std::sync::Arc<AuthManager> {
    AuthManager::new(client(server), Vault::in_memory())
}

fn tokens_body(access: &str, refresh: &str) -> serde_json::Value {
    // Verbatim shape from live login (2026-07-13): expiresIn 900 in prod.
    json!({ "success": true, "data": {
        "accessToken": access, "refreshToken": refresh, "expiresIn": 900
    }})
}

fn profile_body(email: &str) -> serde_json::Value {
    json!({ "success": true, "data": {
        "id": "u-1", "email": email, "globalRole": "CUSTOMER",
        "mustChangePassword": false, "permissions": []
    }})
}

#[tokio::test]
async fn login_success_installs_session_and_profile_loads() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .and(body_partial_json(json!({"email": "t@x.com", "rememberMe": true})))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("A1", "R1")))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/auth/me"))
        .and(header("authorization", "Bearer A1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(profile_body("t@x.com")))
        .mount(&server)
        .await;

    let auth = manager(&server);
    let outcome = auth.login("t@x.com", "pw", None, true).await.unwrap();
    assert!(matches!(outcome, LoginOutcome::SignedIn));
    assert!(auth.is_signed_in().await);
    let profile: Profile = auth.profile().await.unwrap();
    assert_eq!(profile.email, "t@x.com");
}

#[tokio::test]
async fn login_mfa_branch_detected_via_flag_not_null_tokens() {
    // The landmine: panel sends EMPTY-STRING tokens + mfaRequired: true.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true, "data": {
                "accessToken": "", "refreshToken": "", "expiresIn": 0,
                "mfaRequired": true, "mfaToken": "MFA_T",
                "methods": ["totp", "recovery"]
            }})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/mfa/verify"))
        .and(body_partial_json(json!({"mfaToken": "MFA_T", "code": "123456"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("A2", "R2")))
        .mount(&server)
        .await;

    let auth = manager(&server);
    let outcome = auth.login("t@x.com", "pw", None, true).await.unwrap();
    match outcome {
        LoginOutcome::MfaRequired { methods } => {
            assert_eq!(methods, vec!["totp", "recovery"]);
        }
        other => panic!("expected MFA branch, got {other:?}"),
    }
    assert!(!auth.is_signed_in().await, "empty tokens must not be installed");

    auth.mfa_verify("123456", None).await.unwrap();
    assert!(auth.is_signed_in().await);
}

#[tokio::test]
async fn login_401_maps_to_invalid_credentials() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            // Verbatim error shape observed live.
            "statusCode": 401, "error": "UnauthorizedException",
            "message": "Unauthorized", "path": "/api/v1/auth/login",
            "timestamp": "2026-07-13T18:33:37.838Z"
        })))
        .mount(&server)
        .await;

    let auth = manager(&server);
    let err = auth.login("t@x.com", "wrong", None, true).await.unwrap_err();
    assert_eq!(err.code(), "INVALID_CREDENTIALS");
}

#[tokio::test]
async fn validation_error_collects_message_array() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            // The filter emits Nest's exception name: "Bad Request", not a
            // SCREAMING_SNAKE code.
            "statusCode": 400, "error": "Bad Request",
            "message": ["email must be an email", "password should not be empty"],
            "path": "/api/v1/auth/login", "timestamp": "2026-07-13T00:00:00.000Z"
        })))
        .mount(&server)
        .await;

    let c = client(&server);
    let err = c
        .json::<serde_json::Value, _>(
            Method::POST,
            "/auth/login",
            None,
            Some(&json!({"email": "nope"})),
        )
        .await
        .unwrap_err();
    match err {
        PanelError::Validation { messages } => assert_eq!(messages.len(), 2),
        other => panic!("expected Validation, got {other:?}"),
    }
}

#[tokio::test]
async fn expired_access_refreshes_once_and_retries() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("OLD", "R1")))
        .mount(&server)
        .await;
    // Stale access token → 401 (flat error shape).
    Mock::given(method("GET"))
        .and(path("/api/v1/auth/me"))
        .and(header("authorization", "Bearer OLD"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "statusCode": 401, "error": "UnauthorizedException",
            "message": "Unauthorized", "path": "/api/v1/auth/me",
            "timestamp": "2026-07-13T00:00:00.000Z"
        })))
        .mount(&server)
        .await;
    // Rotation: R1 → (NEW, R2).
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/refresh"))
        .and(body_partial_json(json!({"refreshToken": "R1"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("NEW", "R2")))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/auth/me"))
        .and(header("authorization", "Bearer NEW"))
        .respond_with(ResponseTemplate::new(200).set_body_json(profile_body("t@x.com")))
        .mount(&server)
        .await;

    let auth = manager(&server);
    auth.login("t@x.com", "pw", None, true).await.unwrap();
    let profile = auth.profile().await.unwrap();
    assert_eq!(profile.email, "t@x.com");
}

#[tokio::test]
async fn revoked_refresh_maps_to_session_expired_and_clears() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("OLD", "R1")))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/auth/me"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "statusCode": 401, "error": "UnauthorizedException",
            "message": "Unauthorized", "path": "/api/v1/auth/me",
            "timestamp": "2026-07-13T00:00:00.000Z"
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/refresh"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "statusCode": 401, "error": "UnauthorizedException",
            "message": "Unauthorized", "path": "/api/v1/auth/refresh",
            "timestamp": "2026-07-13T00:00:00.000Z"
        })))
        .mount(&server)
        .await;

    let auth = manager(&server);
    auth.login("t@x.com", "pw", None, true).await.unwrap();
    let err = auth.profile().await.unwrap_err();
    assert_eq!(err.code(), "SESSION_EXPIRED");
    assert!(!auth.is_signed_in().await, "session must be torn down locally");
}

#[tokio::test]
async fn password_change_required_detected_from_real_wire_shape() {
    // The global exception filter DROPS the interceptor's `code` field —
    // the real body identifies itself only by the message.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/servers"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({
            "statusCode": 403, "error": "ForbiddenException",
            "message": "Password change required",
            "path": "/api/v1/servers", "timestamp": "2026-07-13T00:00:00.000Z"
        })))
        .mount(&server)
        .await;

    let c = client(&server);
    let err = c
        .json::<serde_json::Value, ()>(Method::GET, "/servers", Some("tok"), None)
        .await
        .unwrap_err();
    assert_eq!(err.code(), "PASSWORD_CHANGE_REQUIRED");
}

#[tokio::test]
async fn banned_account_message_survives_login_mapping() {
    // Correct credentials + banned account is also a 401 — the server's
    // message must reach the user instead of "wrong password".
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "statusCode": 401, "error": "UnauthorizedException",
            "message": "Account banned", "path": "/api/v1/auth/login",
            "timestamp": "2026-07-13T00:00:00.000Z"
        })))
        .mount(&server)
        .await;

    let auth = manager(&server);
    let err = auth.login("t@x.com", "pw", None, true).await.unwrap_err();
    assert_ne!(err.code(), "INVALID_CREDENTIALS");
    assert!(err.user_message().contains("banned"), "{}", err.user_message());
}

#[tokio::test]
async fn wrong_mfa_code_gets_a_friendly_error_not_not_signed_in() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true, "data": {
                "accessToken": "", "refreshToken": "", "expiresIn": 0,
                "mfaRequired": true, "mfaToken": "MFA_T", "methods": ["totp"]
            }})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/mfa/verify"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "statusCode": 401, "error": "UnauthorizedException",
            "message": "Invalid MFA code", "path": "/api/v1/auth/mfa/verify",
            "timestamp": "2026-07-13T00:00:00.000Z"
        })))
        .mount(&server)
        .await;

    let auth = manager(&server);
    auth.login("t@x.com", "pw", None, true).await.unwrap();
    let err = auth.mfa_verify("000000", None).await.unwrap_err();
    assert_ne!(err.code(), "NOT_SIGNED_IN");
    assert!(
        err.user_message().to_lowercase().contains("code"),
        "{}",
        err.user_message()
    );
}

#[tokio::test]
async fn recovery_method_is_forwarded_on_the_wire() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true, "data": {
                "accessToken": "", "refreshToken": "", "expiresIn": 0,
                "mfaRequired": true, "mfaToken": "MFA_T",
                "methods": ["totp", "recovery"]
            }})))
        .mount(&server)
        .await;
    // Expect the method field on the wire — the panel coerces an omitted
    // method to "totp", so recovery MUST be explicit.
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/mfa/verify"))
        .and(body_partial_json(json!({
            "mfaToken": "MFA_T", "code": "AAAA-BBBB", "method": "recovery"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("A3", "R3")))
        .expect(1)
        .mount(&server)
        .await;

    let auth = manager(&server);
    auth.login("t@x.com", "pw", None, true).await.unwrap();
    auth.mfa_verify("AAAA-BBBB", Some("recovery")).await.unwrap();
    assert!(auth.is_signed_in().await);
}

#[tokio::test]
async fn broken_vault_does_not_strand_a_rotated_token() {
    // The server rotates regardless of our disk; if the credential store
    // write fails we must adopt the new pair in memory anyway, or the next
    // refresh replays a burned token and the panel revokes ALL sessions.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("A1", "R1")))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/auth/me"))
        .and(header("authorization", "Bearer A1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(profile_body("t@x.com")))
        .mount(&server)
        .await;

    let auth = AuthManager::new(client(&server), Vault::broken());
    auth.login("t@x.com", "pw", None, true).await.unwrap();
    assert!(auth.is_signed_in().await, "session must survive a vault failure");
    let profile = auth.profile().await.unwrap();
    assert_eq!(profile.email, "t@x.com");
}

#[tokio::test]
async fn rate_limit_maps_with_retry_after() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/servers"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "42")
                .set_body_json(json!({
                    "statusCode": 429, "error": "ThrottlerException",
                    "message": "ThrottlerException: Too Many Requests",
                    "path": "/api/v1/servers", "timestamp": "2026-07-13T00:00:00.000Z"
                })),
        )
        .mount(&server)
        .await;

    let c = client(&server);
    let err = c
        .json::<serde_json::Value, ()>(Method::GET, "/servers", Some("tok"), None)
        .await
        .unwrap_err();
    match err {
        PanelError::RateLimited { retry_after_secs } => {
            assert_eq!(retry_after_secs, Some(42));
        }
        other => panic!("expected RateLimited, got {other:?}"),
    }
}
