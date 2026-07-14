//! Session management: login (+ MFA challenge), rotating refresh, sign-out.
//!
//! The two hazards this file exists to contain (docs/api-surface.md §3a):
//!
//! 1. **Rotation is destructive on misuse.** Reusing an already-rotated
//!    refresh token outside a ~60s grace window revokes EVERY session the
//!    user has, on all devices. Therefore: refreshes are single-flight
//!    (one mutex-guarded refresh at a time), and the new refresh token is
//!    persisted to the vault *before* it is ever used.
//! 2. **The MFA login branch sends empty-string tokens** with
//!    `mfaRequired: true` — detected via `TokenResponse::needs_mfa`, never
//!    via null/absent tokens.

use std::sync::Arc;

use reqwest::Method;
use tokio::sync::{Mutex, RwLock};
use tracing::{info, warn};

use super::client::PanelClient;
use super::error::PanelError;
use super::models::{LoginBody, MfaVerifyBody, Profile, RefreshBody, TokenResponse};
use crate::vault::Vault;

#[derive(Clone)]
struct Tokens {
    access: String,
    refresh: String,
}

/// Outcome of a login attempt, IPC-safe (no tokens).
#[derive(Debug)]
pub enum LoginOutcome {
    SignedIn,
    MfaRequired { methods: Vec<String> },
}

pub struct AuthManager {
    client: PanelClient,
    vault: Vault,
    tokens: RwLock<Option<Tokens>>,
    /// Serializes refreshes; also protects the "did someone else already
    /// refresh while I waited" check.
    refresh_gate: Mutex<()>,
    /// mfaToken held between login() and mfa_verify(). Never leaves Rust.
    pending_mfa: Mutex<Option<String>>,
}

impl AuthManager {
    pub fn new(client: PanelClient, vault: Vault) -> Arc<Self> {
        Arc::new(Self {
            client,
            vault,
            tokens: RwLock::new(None),
            refresh_gate: Mutex::new(()),
            pending_mfa: Mutex::new(None),
        })
    }

    pub fn client(&self) -> &PanelClient {
        &self.client
    }

    /// App start: resume the session from the vaulted refresh token, if any.
    /// Costs one rotation per launch (TTL is sliding, so that's fine).
    pub async fn bootstrap(&self) -> Result<bool, PanelError> {
        let Some(refresh) = self.vault.load_refresh_token()? else {
            return Ok(false);
        };
        match self.rotate(&refresh).await {
            Ok(()) => Ok(true),
            Err(PanelError::NotSignedIn) | Err(PanelError::SessionExpired) => {
                // Revoked remotely (or rotation-theft cleanup). Not an error
                // loop — clear and present sign-in.
                warn!("vaulted session no longer valid; clearing");
                self.vault.clear()?;
                Ok(false)
            }
            Err(e) => Err(e),
        }
    }

    pub async fn login(
        &self,
        email: &str,
        password: &str,
        totp: Option<&str>,
        remember: bool,
    ) -> Result<LoginOutcome, PanelError> {
        let res: Result<TokenResponse, PanelError> = self
            .client
            .json(
                Method::POST,
                "/auth/login",
                None,
                Some(&LoginBody {
                    email,
                    password,
                    totp,
                    remember_me: remember,
                }),
            )
            .await;
        let tokens = match res {
            Ok(t) => t,
            // Login's 401 means bad credentials — except the panel also
            // 401s "Account banned" / "Account suspended" with correct
            // credentials; surface those messages instead of lying.
            Err(PanelError::Unauthorized { message }) => {
                let generic = message.is_empty()
                    || message.eq_ignore_ascii_case("unauthorized")
                    || message.eq_ignore_ascii_case("invalid credentials");
                return Err(if generic {
                    PanelError::InvalidCredentials
                } else {
                    PanelError::Other(message)
                });
            }
            Err(e) => return Err(e),
        };

        if tokens.needs_mfa() {
            let methods = tokens.methods.clone();
            *self.pending_mfa.lock().await = tokens.mfa_token;
            return Ok(LoginOutcome::MfaRequired { methods });
        }
        self.install(tokens).await?;
        info!("signed in");
        Ok(LoginOutcome::SignedIn)
    }

    pub async fn mfa_verify(&self, code: &str, method: Option<&str>) -> Result<(), PanelError> {
        let mfa_token = self
            .pending_mfa
            .lock()
            .await
            .clone()
            .ok_or(PanelError::Other(
                "No sign-in in progress — start over from the sign-in screen.".into(),
            ))?;
        let tokens: TokenResponse = match self
            .client
            .json(
                Method::POST,
                "/auth/mfa/verify",
                None,
                Some(&MfaVerifyBody {
                    mfa_token: &mfa_token,
                    code,
                    method,
                }),
            )
            .await
        {
            Ok(t) => t,
            // Wrong code or expired 5-minute challenge — both come back 401.
            Err(PanelError::Unauthorized { .. }) => {
                return Err(PanelError::Other(
                    "That code isn't right, or it took too long — try again.".into(),
                ));
            }
            Err(e) => return Err(e),
        };
        if tokens.needs_mfa() || tokens.access_token.is_empty() {
            return Err(PanelError::Decode("mfa verify returned no tokens".into()));
        }
        *self.pending_mfa.lock().await = None;
        self.install(tokens).await?;
        info!("signed in (mfa)");
        Ok(())
    }

    pub async fn logout(&self) -> Result<(), PanelError> {
        // Hold the refresh gate so an in-flight refresh can't re-install a
        // fresh token pair after we clear — that would silently resurrect
        // the session the user just signed out of.
        let _gate = self.refresh_gate.lock().await;
        *self.pending_mfa.lock().await = None;
        let refresh = { self.tokens.read().await.as_ref().map(|t| t.refresh.clone()) };
        if let Some(refresh) = refresh {
            // Best-effort server-side revocation; local cleanup regardless.
            let _ = self
                .client
                .no_content(
                    Method::POST,
                    "/auth/logout",
                    None,
                    Some(&RefreshBody {
                        refresh_token: &refresh,
                    }),
                )
                .await;
        }
        *self.tokens.write().await = None;
        if let Err(e) = self.vault.clear() {
            // The server-side session is already revoked above, so a dead
            // token lingering in the store is hygiene, not access.
            warn!("credential store clear failed on sign-out: {}", e.code());
        }
        info!("signed out");
        Ok(())
    }

    pub async fn is_signed_in(&self) -> bool {
        self.tokens.read().await.is_some()
    }

    /// Whether a refresh token is persisted (a resumable session exists on
    /// disk), even if it isn't loaded into memory. Lets the UI tell "offline at
    /// launch" (vault still holds a token) apart from "signed out" — a 401
    /// during resume clears the vault, a network error does not.
    pub fn has_vaulted_session(&self) -> bool {
        matches!(self.vault.load_refresh_token(), Ok(Some(_)))
    }

    /// Current access token for opening a console websocket. Errors if
    /// signed out.
    pub async fn access_token(&self) -> Result<String, PanelError> {
        self.current_access().await
    }

    /// Force one rotation, e.g. when a websocket handshake was rejected with
    /// `unauthorized` and we want a fresh token before reconnecting. Returns
    /// the new access token. Single-flight via the same gate as 401 refresh.
    pub async fn refresh_access_token(&self) -> Result<String, PanelError> {
        let current = self.current_access().await?;
        self.refresh_after_401(&current).await?;
        self.current_access().await
    }

    /// The panel origin (scheme+host) for building the websocket URL.
    pub fn origin(&self) -> &str {
        self.client.origin()
    }

    /// Authenticated GET/POST/… with refresh-once-retry on 401.
    pub async fn authed_json<T, B>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<T, PanelError>
    where
        T: serde::de::DeserializeOwned,
        B: serde::Serialize + ?Sized,
    {
        let access = self.current_access().await?;
        match self
            .client
            .json(method.clone(), path, Some(&access), body)
            .await
        {
            Err(PanelError::Unauthorized { .. }) => {
                self.refresh_after_401(&access).await?;
                let access = self.current_access().await?;
                self.client.json(method, path, Some(&access), body).await
            }
            other => other,
        }
    }

    /// Authed request where success is a bodyless 2xx (e.g. DELETE) — do NOT
    /// try to decode an envelope. Refresh-once-retry on 401.
    pub async fn authed_no_content<B>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<(), PanelError>
    where
        B: serde::Serialize + ?Sized,
    {
        let access = self.current_access().await?;
        match self
            .client
            .no_content(method.clone(), path, Some(&access), body)
            .await
        {
            Err(PanelError::Unauthorized { .. }) => {
                self.refresh_after_401(&access).await?;
                let access = self.current_access().await?;
                self.client.no_content(method, path, Some(&access), body).await
            }
            other => other,
        }
    }

    /// Authed raw-body upload with refresh-once-retry.
    pub async fn upload_bytes<T>(&self, path: &str, bytes: &[u8]) -> Result<T, PanelError>
    where
        T: serde::de::DeserializeOwned,
    {
        let access = self.current_access().await?;
        match self.client.post_bytes(path, &access, bytes).await {
            Err(PanelError::Unauthorized { .. }) => {
                self.refresh_after_401(&access).await?;
                let access = self.current_access().await?;
                self.client.post_bytes(path, &access, bytes).await
            }
            other => other,
        }
    }

    /// Stream a panel-origin signed URL to a local file (no auth — the URL
    /// carries an HMAC). Exposed for file downloads.
    pub async fn download_to(&self, url: &str, dest: &std::path::Path) -> Result<u64, PanelError> {
        self.client.download(url, dest).await
    }

    /// Like [`Self::download_to`] but also accepts a public https host (S3/R2
    /// presigned backup URLs).
    pub async fn download_offsite_to(
        &self,
        url: &str,
        dest: &std::path::Path,
    ) -> Result<u64, PanelError> {
        self.client.download_offsite(url, dest).await
    }

    /// Paginated variant of [`Self::authed_json`].
    pub async fn authed_paged<T, B>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<(T, Option<super::models::PageMeta>), PanelError>
    where
        T: serde::de::DeserializeOwned,
        B: serde::Serialize + ?Sized,
    {
        let access = self.current_access().await?;
        match self
            .client
            .json_with_meta(method.clone(), path, Some(&access), body)
            .await
        {
            Err(PanelError::Unauthorized { .. }) => {
                self.refresh_after_401(&access).await?;
                let access = self.current_access().await?;
                self.client
                    .json_with_meta(method, path, Some(&access), body)
                    .await
            }
            other => other,
        }
    }

    pub async fn profile(&self) -> Result<Profile, PanelError> {
        self.authed_json::<Profile, ()>(Method::GET, "/auth/me", None)
            .await
    }

    // ── internals ──────────────────────────────────────────────────────

    async fn current_access(&self) -> Result<String, PanelError> {
        self.tokens
            .read()
            .await
            .as_ref()
            .map(|t| t.access.clone())
            .ok_or(PanelError::NotSignedIn)
    }

    /// Persist-then-install a fresh token pair. Vault write happens BEFORE
    /// the new refresh token is usable anywhere, so a crash can't strand us
    /// with a rotated-away token on disk.
    ///
    /// If the vault write fails we MUST still adopt the new pair in memory:
    /// the server has already rotated, so keeping the old refresh token
    /// "current" arms the reuse-detection trap that revokes every session
    /// the user has. Worst case of adopting anyway is a signed-out state on
    /// next launch — annoying, not destructive.
    async fn install(&self, t: TokenResponse) -> Result<(), PanelError> {
        if t.access_token.is_empty() || t.refresh_token.is_empty() {
            return Err(PanelError::Decode("token response missing tokens".into()));
        }
        if let Err(e) = self.vault.store_refresh_token(&t.refresh_token) {
            warn!(
                "vault persist failed; session continues in memory only: {}",
                e.code()
            );
        }
        *self.tokens.write().await = Some(Tokens {
            access: t.access_token,
            refresh: t.refresh_token,
        });
        Ok(())
    }

    /// Refresh triggered by a 401 on `failed_access`. Single-flight: if
    /// another task already rotated while we waited on the gate, skip.
    async fn refresh_after_401(&self, failed_access: &str) -> Result<(), PanelError> {
        let _gate = self.refresh_gate.lock().await;
        {
            let cur = self.tokens.read().await;
            match cur.as_ref() {
                None => return Err(PanelError::NotSignedIn),
                Some(t) if t.access != failed_access => return Ok(()), // already refreshed
                Some(_) => {}
            }
        }
        let refresh = self
            .tokens
            .read()
            .await
            .as_ref()
            .map(|t| t.refresh.clone())
            .ok_or(PanelError::NotSignedIn)?;
        self.rotate(&refresh).await
    }

    /// One rotation against `/auth/refresh`. On 401 the session is gone
    /// (revoked remotely / family-revoked): clear local state.
    ///
    /// A network error here is retried once, immediately: the response may
    /// have been lost AFTER the server rotated, and the server's ~60s
    /// concurrent-refresh grace window exists precisely so a client can
    /// re-send the same token right away. (This is the one deliberate
    /// exception to the "never auto-retry a mutation" rule — NOT retrying
    /// risks the burned token later triggering revoke-all-sessions.)
    async fn rotate(&self, refresh: &str) -> Result<(), PanelError> {
        let mut retried = false;
        let res: Result<TokenResponse, PanelError> = loop {
            let attempt = self
                .client
                .json(
                    Method::POST,
                    "/auth/refresh",
                    None,
                    Some(&RefreshBody {
                        refresh_token: refresh,
                    }),
                )
                .await;
            match attempt {
                Err(PanelError::Network(e)) if !retried => {
                    retried = true;
                    warn!("refresh network error; retrying within grace window: {e}");
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
                other => break other,
            }
        };
        match res {
            Ok(t) => self.install(t).await,
            Err(PanelError::Unauthorized { .. }) => {
                *self.tokens.write().await = None;
                self.vault.clear()?;
                Err(PanelError::SessionExpired)
            }
            Err(e) => Err(e),
        }
    }
}
