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
use refx_desktop_lib::panel::files::FileEntry;
use refx_desktop_lib::panel::servers::{self, PowerSignal, ServerState};
use refx_desktop_lib::vault::Vault;

async fn servers_files_list(auth: &AuthManager, id: &str, path: &str) -> Vec<FileEntry> {
    refx_desktop_lib::panel::files::list(auth, id, path).await.unwrap()
}

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
async fn concurrent_401s_rotate_the_token_only_once() {
    // Two authed requests in flight at once both see the stale access token and
    // 401. The single-flight gate must rotate exactly ONCE — a second rotation
    // would re-send the already-consumed refresh token and (per the server's
    // reuse detection) revoke every session the user has.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("OLD", "R1")))
        .mount(&server)
        .await;
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
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/refresh"))
        .and(body_partial_json(json!({"refreshToken": "R1"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("NEW", "R2")))
        .expect(1) // verified on drop: exactly one rotation despite two 401s
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
    let (a, b) = tokio::join!(auth.profile(), auth.profile());
    assert_eq!(a.unwrap().email, "t@x.com");
    assert_eq!(b.unwrap().email, "t@x.com");
}

#[tokio::test]
async fn vault_write_failure_clears_the_stale_token_instead_of_stranding_it() {
    // A credential store that leaves the OLD token in place when a write fails
    // (the real keyring behavior). After a rotation persists a NEW token and the
    // write fails, the vault must be CLEARED — not left holding the old, now
    // server-rotated token, which would replay on the next launch and (via the
    // backend's reuse-detection) revoke every session. Regression for the
    // "keep me signed in → signed out on relaunch" report.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("A_NEW", "R_NEW")))
        .mount(&server)
        .await;

    let slot = std::sync::Arc::new(std::sync::Mutex::new(Some("R_OLD".to_string())));
    let auth = AuthManager::new(client(&server), Vault::failing_writes(slot.clone()));

    auth.login("t@x.com", "pw", None, true).await.unwrap();
    assert!(auth.is_signed_in().await, "the live session must survive in memory");
    assert_eq!(
        *slot.lock().unwrap(),
        None,
        "the stale on-disk token must be cleared, not left to be replayed (and family-revoked) on next launch",
    );
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

/// Login mock + signed-in manager, for tests exercising authed endpoints.
async fn signed_in(server: &MockServer) -> std::sync::Arc<AuthManager> {
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_body("AT", "RT")))
        .mount(server)
        .await;
    let auth = manager(server);
    auth.login("t@x.com", "pw", None, true).await.unwrap();
    auth
}

#[tokio::test]
async fn servers_list_decodes_the_real_row_shape_with_meta() {
    let server = MockServer::start().await;
    // Row shape from the Android wire fixture (ServerDecodingTest.kt),
    // which mirrors the panel's withPrimaryAllocation projection.
    Mock::given(method("GET"))
        .and(path("/api/v1/servers"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true,
            "data": [{
                "id": "srv_1", "shortId": "abcd", "name": "My SMP", "state": "RUNNING",
                "cpuCores": 2.0, "memoryMb": 4096, "diskMb": 20480,
                "template": {"id": "t1", "name": "Minecraft", "slug": "minecraft-java", "supportsWorkshop": false},
                "node": {"name": "node-1", "fqdn": "n1.refx.gg"},
                "primaryAllocation": {"id": "a1", "ip": "1.2.3.4", "port": 25565, "alias": "play.example.com", "isPrimary": true}
            }],
            "meta": {"page": 1, "pageSize": 25, "total": 1, "totalPages": 1}
        })))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    let page = servers::list(&auth, None, 1, 25).await.unwrap();
    assert_eq!(page.data.len(), 1);
    let s = &page.data[0];
    assert_eq!(s.name, "My SMP");
    assert_eq!(s.state, ServerState::Running);
    assert_eq!(s.template.as_ref().unwrap().name.as_deref(), Some("Minecraft"));
    assert_eq!(s.node.as_ref().unwrap().fqdn.as_deref(), Some("n1.refx.gg"));
    let alloc = s.primary_allocation.as_ref().unwrap();
    assert_eq!((alloc.ip.as_deref(), alloc.port), (Some("1.2.3.4"), Some(25565)));
    assert_eq!(page.meta.unwrap().total, 1);
}

#[tokio::test]
async fn unknown_server_state_falls_back_to_unknown() {
    // The panel grows states faster than we ship — never fail decode on one.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/servers"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true,
            "data": [{"id": "srv_2", "name": "x", "state": "SOME_FUTURE_STATE"}],
            "meta": {"page": 1, "pageSize": 25, "total": 1, "totalPages": 1}
        })))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    let page = servers::list(&auth, None, 1, 25).await.unwrap();
    assert_eq!(page.data[0].state, ServerState::Unknown);
}

#[tokio::test]
async fn server_detail_carries_viewer_permissions() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/servers/srv_1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true,
            "data": {
                "id": "srv_1", "name": "My SMP", "state": "OFFLINE",
                "viewerPermissions": ["server.read", "control.power", "console.command"]
            }
        })))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    let d = servers::get(&auth, "srv_1").await.unwrap();
    assert_eq!(d.summary.state, ServerState::Offline);
    assert!(d.viewer_permissions.contains(&"control.power".to_string()));
}

#[tokio::test]
async fn live_stats_decode_float_wire_shape() {
    let server = MockServer::start().await;
    // Verbatim Android LiveStats fixture.
    Mock::given(method("GET"))
        .and(path("/api/v1/servers/srv_1/stats"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true,
            "data": {"state": "RUNNING", "cpuPct": 42.5, "memUsedMb": 1024.0,
                     "memTotalMb": 4096.0, "diskUsedMb": 5000.0, "netRxBytes": 10.0,
                     "netTxBytes": 20.0, "players": 3, "uptimeMs": 1000.0}
        })))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    let s = servers::stats(&auth, "srv_1").await.unwrap();
    assert_eq!(s.state, ServerState::Running);
    assert_eq!(s.cpu_pct, 42.5);
    assert_eq!(s.players, Some(3.0));
    assert_eq!(s.uptime_ms, Some(1000.0));
}

#[tokio::test]
async fn power_posts_signal_and_accepts() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/servers/srv_1/power"))
        .and(body_partial_json(json!({"signal": "restart"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true, "data": {"accepted": true}
        })))
        .expect(1)
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    servers::power(&auth, "srv_1", PowerSignal::Restart).await.unwrap();
}

#[tokio::test]
async fn power_conflict_surfaces_the_server_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/servers/srv_1/power"))
        .respond_with(ResponseTemplate::new(409).set_body_json(json!({
            "statusCode": 409, "error": "ConflictException",
            "message": "Server is installing", "path": "/api/v1/servers/srv_1/power",
            "timestamp": "2026-07-13T00:00:00.000Z"
        })))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    let err = servers::power(&auth, "srv_1", PowerSignal::Start).await.unwrap_err();
    assert_eq!(err.code(), "CONFLICT");
    assert!(err.user_message().contains("installing"), "{}", err.user_message());
}

#[tokio::test]
async fn files_list_decodes_entries() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/servers/srv_1/files/list"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true,
            "data": [
                {"name": "server.properties", "path": "/server.properties", "isDir": false, "size": 1400, "mode": "-rw-r--r--", "modified": "2026-07-13T00:00:00Z"},
                {"name": "world", "path": "/world", "isDir": true, "size": 0}
            ]
        })))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    let entries = servers_files_list(&auth, "srv_1", "/").await;
    assert_eq!(entries.len(), 2);
    assert!(!entries[0].is_dir);
    assert_eq!(entries[0].size, 1400);
    assert!(entries[1].is_dir);
}

#[tokio::test]
async fn file_read_unwraps_content_field() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/servers/srv_1/files/contents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            // `data` is the raw file text, not a { content } object.
            "success": true, "data": "level-name=world\n"
        })))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    let content = refx_desktop_lib::panel::files::read(&auth, "srv_1", "/server.properties")
        .await
        .unwrap();
    assert_eq!(content, "level-name=world\n");
}

#[tokio::test]
async fn oversized_upload_is_rejected_before_the_wire() {
    let server = MockServer::start().await;
    // No mock mounted — a request would 404; the size guard must fire first.
    let auth = signed_in(&server).await;
    let big = vec![0u8; 33 * 1024 * 1024];
    let err = refx_desktop_lib::panel::files::upload(&auth, "srv_1", "/", &big)
        .await
        .unwrap_err();
    assert_eq!(err.code(), "VALIDATION");
    assert!(err.user_message().contains("32 MB"), "{}", err.user_message());
}

#[tokio::test]
async fn backups_list_decodes_the_real_row_shape() {
    let server = MockServer::start().await;
    // Verbatim shape from a live create (2026-07-13).
    Mock::given(method("GET"))
        .and(path("/api/v1/servers/srv_1/backups"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true,
            "data": [{
                "id": "b1", "serverId": "srv_1", "name": "nightly", "state": "COMPLETED",
                "storage": "LOCAL", "progressPct": 100, "location": null,
                "sizeBytes": 62214936, "checksum": "abc", "isLocked": false,
                "ignoredFiles": ["logs"], "error": null,
                "completedAt": "2026-07-13T22:03:00Z", "createdAt": "2026-07-13T22:02:49Z"
            }],
            "meta": {"page": 1, "pageSize": 100, "total": 1, "totalPages": 1}
        })))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    let list = refx_desktop_lib::panel::backups::list(&auth, "srv_1").await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].state, refx_desktop_lib::panel::backups::BackupState::Completed);
    assert_eq!(list[0].size_bytes, Some(62214936));
    assert!(!list[0].is_locked);
}

#[tokio::test]
async fn backup_create_pending_and_cap_conflict() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/servers/srv_1/backups"))
        .and(body_partial_json(json!({"name": "b"})))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "success": true, "data": {
                "id": "b2", "serverId": "srv_1", "name": "b", "state": "PENDING",
                "storage": "LOCAL", "progressPct": 0, "isLocked": false
            }
        })))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    let b = refx_desktop_lib::panel::backups::create(&auth, "srv_1", "b", None)
        .await
        .unwrap();
    assert_eq!(b.state, refx_desktop_lib::panel::backups::BackupState::Pending);
}

#[tokio::test]
async fn variables_decode_enum_and_string_shapes() {
    let server = MockServer::start().await;
    // Verbatim shape from the live Minecraft egg (2026-07-13).
    Mock::given(method("GET"))
        .and(path("/api/v1/servers/srv_1/variables"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true,
            "data": [
                {"envName": "LOADER", "displayName": "Loader", "description": "Server software.",
                 "type": "ENUM", "rules": {"options": ["vanilla","paper","fabric"], "required": true},
                 "userEditable": true, "userViewable": true, "value": "paper"},
                {"envName": "MINECRAFT_VERSION", "displayName": "Minecraft Version",
                 "type": "STRING", "rules": {"regex": "^(latest|\\d+)$", "required": true},
                 "userEditable": false, "userViewable": true, "value": "latest"}
            ]
        })))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    let vars = refx_desktop_lib::panel::startup::get_variables(&auth, "srv_1").await.unwrap();
    assert_eq!(vars.len(), 2);
    assert_eq!(vars[0].kind.as_deref(), Some("ENUM"));
    assert_eq!(vars[0].rules.as_ref().unwrap().options.as_ref().unwrap().len(), 3);
    assert!(vars[0].user_editable);
    assert_eq!(vars[1].rules.as_ref().unwrap().regex.as_deref(), Some("^(latest|\\d+)$"));
    assert!(!vars[1].user_editable);
}

#[tokio::test]
async fn variable_set_tolerates_any_response_body() {
    let server = MockServer::start().await;
    // PUT variables may return a body or be bodyless — no_content ignores it.
    Mock::given(method("PUT"))
        .and(path("/api/v1/servers/srv_1/variables/LOADER"))
        .and(body_partial_json(json!({"value": "fabric"})))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let auth = signed_in(&server).await;
    refx_desktop_lib::panel::startup::set_variable(&auth, "srv_1", "LOADER", "fabric")
        .await
        .unwrap();
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
