//! Per-server live console sessions over Socket.IO v4
//! (`https://api.refx.gg`, namespace `/ws/console`, access JWT in the
//! CONNECT `auth.token`).
//!
//! One socket per open server (the `command` event targets the
//! last-subscribed server and no `unsubscribe` exists). The server sends no
//! scrollback — history lives in a Rust-side ring buffer. No in-socket
//! re-auth: on `error {"unauthorized"}`, refresh once via REST and open a
//! new socket; `forbidden` is terminal. Contract:
//! `docs/recon/realtime-protocol.md`.

mod protocol;
mod session;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::panel::auth::AuthManager;
// Re-exported so the live-check example can drive a session headless with a
// custom sink (see examples/console_live_check.rs).
pub use session::{spawn as spawn_session, ConsoleLine, ConsoleSink, Session};

/// Bridges [`ConsoleSink`] to Tauri events (`console:{id}`, `stats:{id}`,
/// `status:{id}`, `conn:{id}` — see docs/ipc-contract.md).
struct AppSink {
    app: AppHandle,
}

#[derive(Clone, Serialize)]
struct ConnEvent<'a> {
    state: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attempt: Option<u32>,
}

impl ConsoleSink for AppSink {
    fn console(&self, server_id: &str, line: &ConsoleLine) {
        let _ = self.app.emit(&format!("console:{server_id}"), line);
    }
    fn stats(&self, server_id: &str, stats: &serde_json::Value) {
        let _ = self.app.emit(&format!("stats:{server_id}"), stats);
    }
    fn status(&self, server_id: &str, state: &str) {
        let _ = self.app.emit(&format!("status:{server_id}"), json!({ "state": state }));
    }
    fn conn(&self, server_id: &str, state: &str, detail: Option<&str>, attempt: Option<u32>) {
        let _ = self
            .app
            .emit(&format!("conn:{server_id}"), ConnEvent { state, detail, attempt });
    }
}

/// How many recently-closed servers' scrollback to retain for a quick
/// tab-switch back. Bounds memory (≤ RETAINED × 5000 short lines).
const RETAINED_BUFFERS: usize = 12;

/// Owns the live-console sessions. One per open (subscribed) server. Sockets
/// are closed when a server goes off-screen (brief §7), but the last
/// scrollback is retained so switching back re-populates instantly.
pub struct ConsoleManager {
    sink: Arc<dyn ConsoleSink>,
    auth: Arc<AuthManager>,
    sessions: Mutex<HashMap<String, Session>>,
    /// Scrollback snapshots of closed sessions, keyed by server id.
    retained: Mutex<HashMap<String, Vec<ConsoleLine>>>,
}

impl ConsoleManager {
    pub fn new(app: AppHandle, auth: Arc<AuthManager>) -> Self {
        Self {
            sink: Arc::new(AppSink { app }),
            auth,
            sessions: Mutex::new(HashMap::new()),
            retained: Mutex::new(HashMap::new()),
        }
    }

    /// Open (or reuse) the console for a server. Returns the current
    /// scrollback so a freshly-mounted view starts populated; new lines then
    /// arrive on the `console:{id}` event. Idempotent.
    pub fn open(&self, server_id: &str) -> Vec<ConsoleLine> {
        let mut sessions = self.sessions.lock().expect("sessions lock");
        if let Some(existing) = sessions.get(server_id) {
            return existing.history();
        }
        // Fresh session; seed the view from the retained snapshot (if we
        // recently had this console open) so a tab-switch back isn't blank.
        let seed = self
            .retained
            .lock()
            .expect("retained lock")
            .remove(server_id)
            .unwrap_or_default();
        let session = spawn_session(self.sink.clone(), self.auth.clone(), server_id.to_string());
        sessions.insert(server_id.to_string(), session);
        seed
    }

    /// Close the console for a server: snapshot its scrollback for a possible
    /// quick return, then drop its socket and task.
    pub fn close(&self, server_id: &str) {
        let session = self.sessions.lock().expect("sessions lock").remove(server_id);
        if let Some(session) = session {
            let history = session.history();
            session.stop();
            if !history.is_empty() {
                let mut retained = self.retained.lock().expect("retained lock");
                if retained.len() >= RETAINED_BUFFERS && !retained.contains_key(server_id) {
                    if let Some(k) = retained.keys().next().cloned() {
                        retained.remove(&k);
                    }
                }
                retained.insert(server_id.to_string(), history);
            }
        }
    }

    /// Close every session (app shutdown).
    pub fn close_all(&self) {
        let mut sessions = self.sessions.lock().expect("sessions lock");
        for (_, s) in sessions.drain() {
            s.stop();
        }
    }
}
