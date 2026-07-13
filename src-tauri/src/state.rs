//! Application state managed by Tauri.

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::panel::auth::AuthManager;
use crate::panel::client::PanelClient;
use crate::panel::error::PanelError;
use crate::vault::Vault;

pub struct AppState {
    pub auth: Arc<AuthManager>,
    /// Session-resume result. `None` = not yet attempted OR last attempt
    /// failed transiently (offline at launch) — in that case the next
    /// `auth_status` call retries instead of caching "signed out" forever.
    bootstrap: Mutex<Option<bool>>,
}

impl AppState {
    pub fn new() -> Result<Self, PanelError> {
        let client = PanelClient::from_env()?;
        Ok(Self::with_auth(AuthManager::new(client, Vault::keyring())))
    }

    pub fn with_auth(auth: Arc<AuthManager>) -> Self {
        Self {
            auth,
            bootstrap: Mutex::new(None),
        }
    }

    /// True once a session (resumed or fresh) exists. Serialized by the
    /// mutex so concurrent callers can't double-rotate the vaulted token.
    pub async fn ensure_bootstrapped(&self) -> bool {
        let mut slot = self.bootstrap.lock().await;
        if let Some(done) = *slot {
            return done;
        }
        match self.auth.bootstrap().await {
            Ok(resumed) => {
                *slot = Some(resumed);
                resumed
            }
            Err(e) => {
                // Transient (network/vault) — leave the slot empty so the
                // next call retries with the still-vaulted token.
                tracing::warn!("session resume failed, will retry: {}", e.code());
                false
            }
        }
    }
}
