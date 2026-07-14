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

/// What (if anything) to announce for one server this poll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Alert {
    None,
    Crashed,
    BackOnline,
    Suspended,
}

/// The full outcome of classifying one state transition: the alert plus the
/// bookkeeping the caller must apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Decision {
    alert: Alert,
    /// Consume the pending power-intent (the user's action took effect).
    consume_intent: bool,
    /// Add this server to the crashed set.
    mark_crashed: bool,
    /// Remove this server from the crashed set.
    clear_crashed: bool,
}

/// Pure crash/recovery/suspension classifier — the load-bearing logic, kept
/// side-effect-free so it can be unit-tested exhaustively.
///
/// The pivotal rule: a real crash is the backend reporting `CRASHED`. A clean
/// stop lands in `OFFLINE`, which is exactly what a stop from refx.gg, a
/// schedule, an admin, or another device produces — those must NOT alert. The
/// power-intent still suppresses a crash the *user* caused here (e.g. a Kill),
/// and is consumed the moment their action takes effect so a *later* crash
/// (e.g. a bad restart within the intent window) is still reported.
fn decide(prev: ServerState, cur: ServerState, intent_active: bool, was_crashed: bool) -> Decision {
    let just_crashed = cur == ServerState::Crashed && prev != ServerState::Crashed;
    // A power action is "settled" only once the server reaches a stable state:
    // RUNNING again (a restart completed) or OFFLINE/CRASHED (a stop/kill
    // completed) — never a transient STOPPING/STARTING. Consuming the intent on
    // a transient state would drop it before a multi-poll kill
    // (RUNNING → STOPPING → CRASHED, observed across two polls) reaches CRASHED,
    // then misfire a "crash" alert for the user's own kill.
    let settled = matches!(
        cur,
        ServerState::Running | ServerState::Offline | ServerState::Crashed
    );
    let user_initiated = intent_active && settled && cur != prev;

    let mut d = Decision {
        alert: Alert::None,
        consume_intent: user_initiated,
        mark_crashed: false,
        clear_crashed: false,
    };

    if cur == ServerState::Running && was_crashed {
        // A previously-crashed server is running again.
        d.alert = Alert::BackOnline;
        d.clear_crashed = true;
    } else if just_crashed && !user_initiated && !was_crashed {
        // A genuine, unexpected crash we haven't already announced.
        d.alert = Alert::Crashed;
        d.mark_crashed = true;
    } else if prev != ServerState::Suspended && cur == ServerState::Suspended {
        d.alert = Alert::Suspended;
    }
    d
}

fn detect(
    app: &AppHandle,
    intent: &PowerIntent,
    crashed: &mut HashSet<String>,
    s: &ServerSummary,
    prev: ServerState,
    prefs: NotifyPrefs,
) {
    let d = decide(prev, s.state, intent.active(&s.id), crashed.contains(&s.id));
    if d.consume_intent {
        intent.clear(&s.id);
    }
    if d.mark_crashed {
        crashed.insert(s.id.clone());
    }
    if d.clear_crashed {
        crashed.remove(&s.id);
    }
    let name = &s.name;
    match d.alert {
        Alert::Crashed => {
            let _ = app.emit("status:crash", &s.id); // FE badge reacts sub-poll
            if prefs.crashed {
                notify(app, "Server crashed", &format!("{name} stopped unexpectedly."));
            }
        }
        Alert::BackOnline => {
            if prefs.back_online {
                notify(app, "Server back online", &format!("{name} is running again."));
            }
        }
        Alert::Suspended => {
            notify(app, "Server suspended", &format!("{name} was suspended — check billing on refx.gg."));
        }
        Alert::None => {}
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

#[cfg(test)]
mod tests {
    use super::{decide, Alert};
    use crate::panel::servers::ServerState::*;

    #[test]
    fn clean_remote_stop_is_not_a_crash() {
        // A stop from refx.gg, a schedule, an admin, or another device:
        // RUNNING → OFFLINE with no local intent. This is the false positive.
        let d = decide(Running, Offline, false, false);
        assert_eq!(d.alert, Alert::None);
        assert!(!d.mark_crashed);
    }

    #[test]
    fn backend_crashed_is_a_crash() {
        let d = decide(Running, Crashed, false, false);
        assert_eq!(d.alert, Alert::Crashed);
        assert!(d.mark_crashed);
    }

    #[test]
    fn user_kill_is_suppressed_and_consumes_intent() {
        // The user issued Kill here (intent active); even landing in CRASHED, no alert.
        let d = decide(Running, Crashed, true, false);
        assert_eq!(d.alert, Alert::None);
        assert!(d.consume_intent);
        assert!(!d.mark_crashed);
    }

    #[test]
    fn crash_seen_via_offline_then_crashed_still_fires() {
        // Backend flips RUNNING → OFFLINE → CRASHED across two polls.
        assert_eq!(decide(Running, Offline, false, false).alert, Alert::None);
        assert_eq!(decide(Offline, Crashed, false, false).alert, Alert::Crashed);
    }

    #[test]
    fn already_crashed_does_not_realert() {
        // A known-crashed server flapping OFFLINE → CRASHED must not re-alert.
        assert_eq!(decide(Offline, Crashed, false, true).alert, Alert::None);
    }

    #[test]
    fn recovery_fires_and_clears() {
        let d = decide(Crashed, Running, false, true);
        assert_eq!(d.alert, Alert::BackOnline);
        assert!(d.clear_crashed);
    }

    #[test]
    fn graceful_stop_via_stopping_is_silent() {
        assert_eq!(decide(Running, Stopping, false, false).alert, Alert::None);
        assert_eq!(decide(Stopping, Offline, false, false).alert, Alert::None);
    }

    #[test]
    fn restart_consumes_intent_when_settled_so_a_later_crash_is_reported() {
        // Transient STOPPING keeps the intent (the server hasn't settled)...
        assert!(!decide(Running, Stopping, true, false).consume_intent);
        // ...it's consumed once the server settles back to RUNNING.
        assert!(decide(Starting, Running, true, false).consume_intent);
        // ...so a crash after it's back up (intent cleared) fires.
        assert_eq!(decide(Running, Crashed, false, false).alert, Alert::Crashed);
    }

    #[test]
    fn multi_poll_user_kill_is_not_a_false_crash() {
        // A Kill observed across polls: RUNNING → STOPPING → CRASHED.
        let stopping = decide(Running, Stopping, true, false);
        assert!(!stopping.consume_intent); // intent survives the transient state
        assert_eq!(stopping.alert, Alert::None);
        let crashed = decide(Stopping, Crashed, true, false);
        assert_eq!(crashed.alert, Alert::None); // the user's own kill, not a crash
        assert!(crashed.consume_intent); // consumed at the settled down state
    }

    #[test]
    fn suspension_is_surfaced() {
        assert_eq!(decide(Running, Suspended, false, false).alert, Alert::Suspended);
    }
}
