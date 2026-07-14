//! Background server monitor. Runs regardless of window visibility so the
//! tray stays live and crash alerts fire even when minimised to tray.
//!
//! Two complementary crash signals:
//! 1. **The notification feed** (`/account/notifications`) — the backend writes
//!    a durable row the moment the node-agent reports CRASHED (the same source
//!    as mobile push). This catches crashes that auto-restart bounces back to
//!    RUNNING within seconds, which a 20s state poll would sail right past.
//! 2. **State transitions** — a server *observed* entering CRASHED. Covers the
//!    case the feed can't: the backend throttles repeat notices per
//!    server+state (30 min), so a second crash that trips the auto-restart
//!    loop-guard and stays down would otherwise be silent.
//!
//! A crash seen via the feed marks the server in the `crashed` set, so the
//! state path never double-alerts the same incident (and recovery still
//! announces "back online").
//!
//! Intent-suppression (brief §5, §9) still applies to the state path: a
//! departure the user just asked for is not a crash.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::watch;
use tracing::debug;

use crate::panel::auth::AuthManager;
use crate::panel::notifications::{self, AppNotification};
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
    // Notification-feed rows already seen (feed is newest-first, page 1).
    let mut seen_notices: HashSet<String> = HashSet::new();
    let mut notices_primed = false;

    loop {
        tokio::time::sleep(POLL).await;
        if !auth.is_signed_in().await {
            last.clear();
            crashed.clear();
            primed = false;
            seen_notices.clear();
            notices_primed = false;
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

        // The notification feed first: a crash row marks the server in
        // `crashed` BEFORE the state pass, so the same incident never
        // double-alerts even when both signals land in one tick.
        match notifications::list(&auth, 1, 20).await {
            Ok(rows) => {
                if notices_primed {
                    for row in rows.iter().filter(|r| !seen_notices.contains(&r.id)) {
                        handle_notice(&app, row, &page.data, &mut crashed, p);
                    }
                }
                seen_notices.clear();
                seen_notices.extend(rows.iter().map(|r| r.id.clone()));
                notices_primed = true;
            }
            Err(e) => debug!("notification feed poll failed: {}", e.code()),
        }

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

/// What a feed row is about, classified from the backend's fixed phrasing
/// (`Your server "NAME" has crashed.` / `… was suspended.`).
#[derive(Debug, PartialEq, Eq)]
enum Notice {
    Crash { server_name: String },
    Suspended,
    Other,
}

fn classify_notice(body: &str) -> Notice {
    if let Some(name) = quoted_name(body) {
        if body.ends_with("has crashed.") {
            return Notice::Crash { server_name: name };
        }
        if body.ends_with("was suspended.") {
            return Notice::Suspended;
        }
    }
    Notice::Other
}

/// The server name between the first pair of double quotes, if any.
fn quoted_name(body: &str) -> Option<String> {
    let start = body.find('"')? + 1;
    let end = start + body[start..].find('"')?;
    (end > start).then(|| body[start..end].to_string())
}

/// React to one previously-unseen notification-feed row.
fn handle_notice(
    app: &AppHandle,
    row: &AppNotification,
    servers: &[ServerSummary],
    crashed: &mut HashSet<String>,
    prefs: NotifyPrefs,
) {
    // EMAIL-channel rows are delivery records, not app-facing notices.
    if matches!(row.channel.as_deref(), Some(c) if c != "IN_APP") {
        return;
    }
    let body = row.body.as_deref().unwrap_or_default();
    match classify_notice(body) {
        Notice::Crash { server_name } => {
            if prefs.crashed {
                notify(app, "Server crashed", &format!("{server_name} crashed."));
            }
            // Mark it as already-alerted so the state pass doesn't re-alert; if
            // it's still down, recovery will announce "back online" later. An
            // auto-restarted server (already RUNNING) needs no recovery toast.
            if let Some(s) = servers.iter().find(|s| s.name == server_name) {
                if matches!(s.state, ServerState::Offline | ServerState::Crashed) {
                    crashed.insert(s.id.clone());
                }
            }
        }
        // The state pass owns suspension (the SUSPENDED state persists, so the
        // poll always observes it) — skip the row to avoid a double toast.
        Notice::Suspended => {}
        Notice::Other => {
            let title = row.title.as_deref().unwrap_or("ReFx");
            if !body.is_empty() {
                notify(app, title, body);
            }
        }
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

    // ── Notification-feed classification ────────────────────────────────

    use super::{classify_notice, Notice};

    #[test]
    fn crash_notice_is_classified_with_the_server_name() {
        assert_eq!(
            classify_notice(r#"Your server "Valheim — Midgard" has crashed."#),
            Notice::Crash { server_name: "Valheim — Midgard".into() },
        );
    }

    #[test]
    fn suspended_notice_is_classified_and_left_to_the_state_pass() {
        assert_eq!(
            classify_notice(r#"Your server "My Server" was suspended."#),
            Notice::Suspended,
        );
    }

    #[test]
    fn unrelated_notices_are_other() {
        assert_eq!(classify_notice("Your invoice #1042 is due."), Notice::Other);
        assert_eq!(classify_notice(""), Notice::Other);
        // Quoted but not a state phrase.
        assert_eq!(classify_notice(r#"Ticket "hello" was updated."#), Notice::Other);
    }

    #[test]
    fn a_quoted_crash_phrase_inside_a_name_does_not_confuse_the_parser() {
        // The name itself is the first quoted span; the suffix check still
        // requires the fixed backend phrasing at the end.
        assert_eq!(
            classify_notice(r#"Your server "has crashed" has crashed."#),
            Notice::Crash { server_name: "has crashed".into() },
        );
    }
}
