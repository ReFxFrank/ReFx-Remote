//! Background server monitor. Runs regardless of window visibility so the
//! tray stays live and crash alerts fire even when minimised to tray.
//!
//! Crash logic (brief §5, §9): a server going RUNNING → OFFLINE/CRASHED is a
//! crash ONLY if the user didn't just issue a power action (see
//! `PowerIntent`). Getting this wrong — crying "crashed" on a normal stop —
//! makes the feature worse than useless, so intent-suppression is central.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::watch;
use tracing::debug;

use crate::panel::auth::AuthManager;
use crate::panel::servers::{self, ServerState, ServerSummary};
use crate::state::PowerIntent;
use crate::tray;

const POLL: Duration = Duration::from_secs(20);

/// Notification toggles the UI can flip; defaults on. Read fresh each cycle.
#[derive(Clone, Copy)]
pub struct NotifyPrefs {
    pub crashed: bool,
    pub back_online: bool,
}

impl Default for NotifyPrefs {
    fn default() -> Self {
        Self { crashed: true, back_online: true }
    }
}

pub struct Monitor {
    prefs: watch::Sender<NotifyPrefs>,
}

impl Monitor {
    pub fn set_prefs(&self, p: NotifyPrefs) {
        let _ = self.prefs.send(p);
    }
}

/// Spawn the monitor loop. Returns a handle for updating preferences.
pub fn spawn(app: AppHandle, auth: Arc<AuthManager>, intent: Arc<PowerIntent>) -> Monitor {
    let (tx, rx) = watch::channel(NotifyPrefs::default());
    tauri::async_runtime::spawn(async move {
        run(app, auth, intent, rx).await;
    });
    Monitor { prefs: tx }
}

fn is_down(s: ServerState) -> bool {
    matches!(s, ServerState::Offline | ServerState::Crashed)
}

async fn run(
    app: AppHandle,
    auth: Arc<AuthManager>,
    intent: Arc<PowerIntent>,
    prefs: watch::Receiver<NotifyPrefs>,
) {
    let mut last: HashMap<String, ServerState> = HashMap::new();
    // Servers we've alerted as crashed, so we can announce their recovery once.
    let mut crashed: HashSet<String> = HashSet::new();
    let mut primed = false; // don't fire alerts on the very first snapshot

    loop {
        tokio::time::sleep(POLL).await;
        if !auth.is_signed_in().await {
            last.clear();
            crashed.clear();
            primed = false;
            tray::set_servers(&app, &[]);
            continue;
        }
        let page = match servers::list(&auth, None, 1, 100).await {
            Ok(p) => p,
            Err(e) => {
                debug!("monitor poll failed: {}", e.code());
                continue;
            }
        };
        tray::set_servers(&app, &page.data);

        let p = *prefs.borrow();
        let present: HashSet<String> = page.data.iter().map(|s| s.id.clone()).collect();

        for s in &page.data {
            if let Some(&prev) = last.get(&s.id) {
                if primed {
                    detect(&app, &intent, &mut crashed, s, prev, p);
                }
            }
            last.insert(s.id.clone(), s.state);
        }
        last.retain(|id, _| present.contains(id));
        crashed.retain(|id| present.contains(id));
        primed = true;
    }
}

fn detect(
    app: &AppHandle,
    intent: &PowerIntent,
    crashed: &mut HashSet<String>,
    s: &ServerSummary,
    prev: ServerState,
    prefs: NotifyPrefs,
) {
    let name = &s.name;
    // Crash: was up, now down. A user stop/restart/kill also produces this
    // edge, so a live intent means "this is the transition you asked for" —
    // suppress it AND consume the intent, so a *subsequent* down (e.g. a real
    // crash after a restart has brought the server back up, still inside the
    // 120s window) is no longer swallowed.
    if prev == ServerState::Running && is_down(s.state) {
        if intent.active(&s.id) {
            intent.clear(&s.id);
        } else {
            crashed.insert(s.id.clone());
            let _ = app.emit("status:crash", &s.id); // FE badge reacts sub-poll
            if prefs.crashed {
                notify(app, "Server crashed", &format!("{name} stopped unexpectedly."));
            }
        }
    }
    // Recovery: a previously-crashed server is running again.
    if s.state == ServerState::Running && crashed.remove(&s.id) && prefs.back_online {
        notify(app, "Server back online", &format!("{name} is running again."));
    }
    // Suspension is always worth surfacing.
    if prev != ServerState::Suspended && s.state == ServerState::Suspended {
        notify(app, "Server suspended", &format!("{name} was suspended — check billing on refx.gg."));
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}
