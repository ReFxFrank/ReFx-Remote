//! Application state managed by Tauri.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::Mutex as AsyncMutex;

use crate::panel::auth::AuthManager;
use crate::panel::client::PanelClient;
use crate::panel::error::PanelError;
use crate::vault::Vault;

/// How long after a user-initiated power action we suppress crash alerts for
/// that server — a stop/restart legitimately drives it offline, and we never
/// want to cry "crashed" over the user's own action.
const INTENT_WINDOW: Duration = Duration::from_secs(120);

/// Tracks servers the user just issued a power action on, so the background
/// monitor doesn't misread the resulting offline transition as a crash.
#[derive(Default)]
pub struct PowerIntent {
    deadlines: Mutex<HashMap<String, Instant>>,
}

impl PowerIntent {
    pub fn mark(&self, server_id: &str) {
        self.deadlines
            .lock()
            .expect("intent lock")
            .insert(server_id.to_string(), Instant::now() + INTENT_WINDOW);
    }

    /// True if a user power action is still "in effect" for this server.
    pub fn active(&self, server_id: &str) -> bool {
        let mut map = self.deadlines.lock().expect("intent lock");
        let now = Instant::now();
        map.retain(|_, &mut deadline| deadline > now);
        map.contains_key(server_id)
    }

    /// Drop the mark for a server. Called when the suppressed transition has
    /// been observed (so a *later* crash re-arms detection) or when the power
    /// request failed (so it never suppresses anything at all).
    pub fn clear(&self, server_id: &str) {
        self.deadlines.lock().expect("intent lock").remove(server_id);
    }
}

/// Deep links / tray "Open" requests that arrive before the servers screen has
/// mounted its `app:open-server` listener (notably cold-start-by-deep-link, and
/// links clicked while signed out). `route` buffers here when `ready` is false;
/// the frontend drains it once its listener is live and flips `ready`.
#[derive(Default)]
pub struct DeepLinkInbox {
    pub ready: bool,
    /// Links buffered before the frontend was ready, oldest first. A queue (not
    /// a single slot) so two links clicked while signed out both survive.
    pub pending: Vec<serde_json::Value>,
}

pub struct AppState {
    pub auth: Arc<AuthManager>,
    pub intent: Arc<PowerIntent>,
    pub deeplink: Mutex<DeepLinkInbox>,
    bootstrap: AsyncMutex<Option<bool>>,
}

impl AppState {
    pub fn new() -> Result<Self, PanelError> {
        let client = PanelClient::from_env()?;
        Ok(Self::with_auth(AuthManager::new(client, Vault::keyring())))
    }

    pub fn with_auth(auth: Arc<AuthManager>) -> Self {
        Self {
            auth,
            intent: Arc::new(PowerIntent::default()),
            deeplink: Mutex::new(DeepLinkInbox::default()),
            bootstrap: AsyncMutex::new(None),
        }
    }

    /// True once a session (resumed or fresh) exists. Serialized so concurrent
    /// callers can't double-rotate the vaulted token.
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
                tracing::warn!("session resume failed, will retry: {}", e.code());
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::PowerIntent;

    #[test]
    fn mark_makes_intent_active() {
        let intent = PowerIntent::default();
        assert!(!intent.active("s1"));
        intent.mark("s1");
        assert!(intent.active("s1"));
        // Independent per server.
        assert!(!intent.active("s2"));
    }

    #[test]
    fn clear_removes_intent() {
        // Consume-on-suppress + clear-on-failure both rely on clear() actually
        // re-arming crash detection for that server.
        let intent = PowerIntent::default();
        intent.mark("s1");
        assert!(intent.active("s1"));
        intent.clear("s1");
        assert!(!intent.active("s1"));
        // Clearing an unmarked server is a harmless no-op.
        intent.clear("never-marked");
    }
}
