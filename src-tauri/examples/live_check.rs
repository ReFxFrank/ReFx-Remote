//! Live end-to-end auth verification against the real panel.
//!
//! Usage (test account only — never production customer credentials):
//!   RFX_EMAIL=... RFX_PASS=... cargo run --example live_check
//!
//! Prints statuses and the account email only — never tokens.

use refx_desktop_lib::panel::auth::{AuthManager, LoginOutcome};
use refx_desktop_lib::panel::client::PanelClient;
use refx_desktop_lib::vault::Vault;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let email = std::env::var("RFX_EMAIL").expect("set RFX_EMAIL");
    let password = std::env::var("RFX_PASS").expect("set RFX_PASS");

    // This example uses the REAL credential slot the app uses. Refuse to
    // clobber an existing signed-in session unless explicitly overridden.
    if Vault::keyring()
        .load_refresh_token()
        .expect("vault read")
        .is_some()
        && std::env::var("RFX_LIVE_OVERWRITE").is_err()
    {
        eprintln!(
            "refusing to run: a saved session exists in Windows Credential Manager \
             and this check would overwrite then clear it. Sign out of the app first, \
             or set RFX_LIVE_OVERWRITE=1 to proceed anyway."
        );
        std::process::exit(2);
    }

    // 1. Fresh sign-in, persisting to the real Windows Credential Manager.
    let auth = AuthManager::new(PanelClient::from_env().expect("client"), Vault::keyring());
    match auth
        .login(&email, &password, None, true)
        .await
        .expect("login")
    {
        LoginOutcome::SignedIn => println!("1. login: OK"),
        LoginOutcome::MfaRequired { methods } => {
            println!("1. login: MFA required ({methods:?}) — cannot continue headless");
            return;
        }
    }
    let p = auth.profile().await.expect("profile");
    println!("2. profile: {} ({})", p.email, p.global_role.as_deref().unwrap_or("?"));

    // 2. Simulated app relaunch: a brand-new manager must resume purely
    //    from the vaulted refresh token (one rotation).
    drop(auth);
    let auth2 = AuthManager::new(PanelClient::from_env().expect("client"), Vault::keyring());
    let resumed = auth2.bootstrap().await.expect("bootstrap");
    println!("3. relaunch resume from vault: {}", if resumed { "OK" } else { "FAILED" });
    assert!(resumed, "expected vaulted session to resume");
    let p2 = auth2.profile().await.expect("profile after resume");
    println!("4. profile after resume: {}", p2.email);

    // 3. Sign out: server-side revocation + vault cleared.
    auth2.logout().await.expect("logout");
    let empty = Vault::keyring().load_refresh_token().expect("vault read");
    println!("5. vault after logout: {}", if empty.is_none() { "EMPTY (OK)" } else { "STILL SET (BAD)" });
    assert!(empty.is_none());

    // 4. A third manager must now find nothing to resume.
    let auth3 = AuthManager::new(PanelClient::from_env().expect("client"), Vault::keyring());
    let resumed3 = auth3.bootstrap().await.expect("bootstrap after logout");
    println!("6. resume after logout: {}", if resumed3 { "RESUMED (BAD)" } else { "signed out (OK)" });
    assert!(!resumed3);

    println!("live check: ALL OK");
}
