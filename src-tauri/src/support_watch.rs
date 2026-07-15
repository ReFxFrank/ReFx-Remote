//! Background support-ticket watcher for staff. Runs alongside the crash
//! monitor and fires a Windows notification when a new *unassigned* ticket
//! appears (needs triage) or the customer replies on a ticket assigned to the
//! signed-in staffer. Gated on the `support.read` permission — customers have
//! no support queue, so it never polls the admin endpoint for them.
//!
//! Design notes (each fixes a reviewed failure mode):
//! - **No state filter on the poll.** The ticket lifecycle is OPEN /
//!   PENDING_AGENT / PENDING_CUSTOMER / RESOLVED / CLOSED / ARCHIVED, and a
//!   customer reply moves an assigned ticket to PENDING_AGENT — an OPEN-only
//!   poll would never see the very thing this watcher exists for. Terminal
//!   states are excluded client-side.
//! - **"New ticket" = created after our high-water mark**, not merely "an id we
//!   haven't seen": a ticket cycling state (or scrolling back into the page)
//!   must not re-announce itself.
//! - **A reply alert requires the author to be the requester** — a colleague's
//!   public note on my ticket is not a customer reply.
//! - **Eviction is by absence over time** (a generation counter), never by
//!   absence from a single page, so a state flip can't reset dedup.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use tokio::sync::watch;
use tracing::debug;

use crate::panel::admin::support::{self, Ticket, TicketDetail, TicketFilter, TicketMessage};
use crate::panel::auth::AuthManager;
use crate::panel::perms;

const POLL: Duration = Duration::from_secs(30);
/// Forget a ticket after it's been absent from the poll for this many cycles
/// (~20 min). Long enough that a state flip or page jitter can't reset dedup.
const EVICT_AFTER_GENERATIONS: u64 = 40;

/// UI toggle; off until Settings enables it.
#[derive(Clone, Copy, Default)]
pub struct SupportPrefs {
    pub enabled: bool,
}

pub struct SupportWatcher {
    prefs: watch::Sender<SupportPrefs>,
}

impl SupportWatcher {
    pub fn set_prefs(&self, p: SupportPrefs) {
        let _ = self.prefs.send(p);
    }
}

/// Spawn the watcher loop. Returns a handle for updating the toggle.
pub fn spawn(app: AppHandle, auth: Arc<AuthManager>) -> SupportWatcher {
    let (tx, rx) = watch::channel(SupportPrefs::default());
    tauri::async_runtime::spawn(async move {
        run(app, auth, rx).await;
    });
    SupportWatcher { prefs: tx }
}

/// Per-ticket dedup state.
struct Seen {
    updated_at: Option<String>,
    last_gen: u64,
}

fn is_terminal(state: Option<&str>) -> bool {
    matches!(state, Some("RESOLVED") | Some("CLOSED") | Some("ARCHIVED"))
}

async fn run(app: AppHandle, auth: Arc<AuthManager>, prefs: watch::Receiver<SupportPrefs>) {
    // Cached identity: (user id, can-see-support). Re-resolved after a sign-out.
    let mut me: Option<(String, bool)> = None;
    let mut seen: HashMap<String, Seen> = HashMap::new();
    // Newest `createdAt` ever observed — the boundary for "genuinely new".
    let mut high_water_created: Option<String> = None;
    let mut generation: u64 = 0;
    let mut primed = false; // never alert on the first snapshot

    loop {
        tokio::time::sleep(POLL).await;

        if !auth.is_signed_in().await {
            me = None;
            seen.clear();
            high_water_created = None;
            primed = false;
            continue;
        }
        if !prefs.borrow().enabled {
            // Feature off: re-prime on re-enable so we don't fire a backlog.
            primed = false;
            continue;
        }

        if me.is_none() {
            match auth.profile().await {
                Ok(p) => {
                    let is_support = perms::has_permission(&p.permissions, "support.read");
                    me = Some((p.id, is_support));
                }
                Err(e) => {
                    debug!("support watch: profile fetch failed: {}", e.code());
                    continue;
                }
            }
        }
        let Some((my_id, is_support)) = me.clone() else {
            continue;
        };
        if !is_support {
            continue; // customers have no support queue to watch
        }

        // All states — terminal ones are filtered below. A customer reply moves
        // a ticket between active states, so a state-filtered poll misses it.
        let page = match support::tickets_list(&auth, 1, 100, &TicketFilter::default()).await {
            Ok(p) => p,
            Err(e) => {
                debug!("support watch poll failed: {}", e.code());
                continue;
            }
        };
        if page.meta.as_ref().is_some_and(|m| m.total > 100) {
            // No silent cap: past 100 tickets we only watch the first page.
            debug!("support watch: >100 tickets; watching the newest page only");
        }

        generation += 1;
        let mut next_high_water = high_water_created.clone();

        for t in &page.data {
            // Track the creation high-water mark across ALL rows (even
            // terminal), so nothing old can later masquerade as new.
            if t.created_at > next_high_water {
                next_high_water = t.created_at.clone();
            }
            if is_terminal(t.state.as_deref()) {
                seen.remove(&t.id);
                continue;
            }

            let prev = seen.get(&t.id).map(|s| s.updated_at.clone());
            if primed {
                match prev {
                    None => {
                        // First sighting. Genuinely new (created past the high-
                        // water mark) and unassigned → triage alert. A ticket
                        // re-entering after eviction fails the high-water test.
                        if t.assignee_id.is_none() && t.created_at > high_water_created {
                            notify(&app, "New support ticket", &label(t));
                        }
                    }
                    Some(prev_updated) => {
                        if t.assignee_id.as_deref() == Some(my_id.as_str())
                            && t.updated_at > prev_updated
                        {
                            // Assigned-to-me ticket changed: alert only if the
                            // requester's newest public message postdates our
                            // last snapshot (not my reply, a colleague's note,
                            // or a bare state/assignment change).
                            match support::ticket_get(&auth, &t.id).await {
                                Ok(detail) => {
                                    if let Some(m) = newest_from_requester(&detail, t, &my_id) {
                                        if m.created_at > prev_updated {
                                            notify(&app, "Ticket reply", &label(t));
                                        }
                                    }
                                }
                                Err(e) => {
                                    debug!("support watch: ticket fetch failed: {}", e.code())
                                }
                            }
                        }
                    }
                }
            }
            seen.insert(
                t.id.clone(),
                Seen { updated_at: t.updated_at.clone(), last_gen: generation },
            );
        }

        // Evict only after sustained absence — never on one page's contents.
        seen.retain(|_, s| s.last_gen + EVICT_AFTER_GENERATIONS >= generation);
        high_water_created = next_high_water;
        primed = true;
    }
}

fn label(t: &Ticket) -> String {
    let num = t.number.map(|n| format!("#{n} — ")).unwrap_or_default();
    let subject = t.subject.clone().unwrap_or_else(|| "(no subject)".into());
    format!("{num}{subject}")
}

/// The newest public message authored by the ticket's requester (the
/// customer). Falls back to "any non-internal message from a CUSTOMER-role
/// author other than me" when the requester id isn't hydrated.
fn newest_from_requester<'a>(
    detail: &'a TicketDetail,
    ticket: &Ticket,
    my_id: &str,
) -> Option<&'a TicketMessage> {
    let requester_id = ticket
        .requester_id
        .as_deref()
        .or(detail.requester.as_ref().map(|p| p.id.as_str()));
    detail
        .messages
        .iter()
        .filter(|m| !m.is_internal)
        .filter(|m| match requester_id {
            Some(rid) => m.author_id.as_deref() == Some(rid),
            // Requester unknown: accept non-me customer-role authors only.
            None => {
                m.author_id.as_deref() != Some(my_id)
                    && m.author
                        .as_ref()
                        .and_then(|a| a.global_role.as_deref())
                        .is_some_and(|r| r.contains("CUSTOMER"))
            }
        })
        .max_by(|a, b| a.created_at.cmp(&b.created_at))
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    // See monitor::notify — never swallow the result, so a Windows toast failure
    // (or silent OS suppression) is visible in the diagnostics log.
    match app.notification().builder().title(title).body(body).show() {
        Ok(()) => tracing::info!("notification shown: {title}"),
        Err(e) => tracing::warn!("notification show failed ({title}): {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::panel::admin::support::Person;

    fn msg(id: &str, author: &str, role: &str, internal: bool, at: &str) -> TicketMessage {
        TicketMessage {
            id: id.into(),
            author_id: Some(author.into()),
            body: None,
            is_internal: internal,
            created_at: Some(at.into()),
            author: Some(Person {
                id: author.into(),
                email: None,
                first_name: None,
                last_name: None,
                global_role: Some(role.into()),
                avatar_url: None,
            }),
        }
    }

    fn detail(messages: Vec<TicketMessage>) -> TicketDetail {
        TicketDetail {
            id: "t1".into(),
            number: None,
            subject: None,
            state: None,
            priority: None,
            requester: None,
            assignee: None,
            assignee_id: None,
            sla_breached: None,
            created_at: None,
            messages,
        }
    }

    fn ticket(requester: Option<&str>) -> Ticket {
        Ticket {
            id: "t1".into(),
            number: None,
            subject: None,
            state: None,
            priority: None,
            requester_id: requester.map(Into::into),
            assignee_id: None,
            requester: None,
            assignee: None,
            sla_breached: None,
            created_at: None,
            updated_at: None,
            count: None,
        }
    }

    #[test]
    fn a_colleagues_public_reply_is_not_a_customer_reply() {
        // Staff colleague "sam" replies publicly on my ticket — must NOT match.
        let d = detail(vec![
            msg("m1", "cust", "CUSTOMER", false, "2026-07-14T10:00:00Z"),
            msg("m2", "sam", "SUPPORT", false, "2026-07-14T12:00:00Z"),
        ]);
        let t = ticket(Some("cust"));
        assert_eq!(newest_from_requester(&d, &t, "me").unwrap().id, "m1");
    }

    #[test]
    fn my_own_replies_and_internal_notes_never_match() {
        let d = detail(vec![
            msg("m1", "cust", "CUSTOMER", false, "2026-07-14T10:00:00Z"),
            msg("m2", "me", "SUPPORT", false, "2026-07-14T11:00:00Z"),
            msg("m3", "me", "SUPPORT", true, "2026-07-14T12:00:00Z"),
        ]);
        let t = ticket(Some("cust"));
        assert_eq!(newest_from_requester(&d, &t, "me").unwrap().id, "m1");
    }

    #[test]
    fn the_requesters_latest_reply_wins() {
        let d = detail(vec![
            msg("m1", "cust", "CUSTOMER", false, "2026-07-14T10:00:00Z"),
            msg("m2", "me", "SUPPORT", false, "2026-07-14T11:00:00Z"),
            msg("m3", "cust", "CUSTOMER", false, "2026-07-14T13:00:00Z"),
        ]);
        let t = ticket(Some("cust"));
        assert_eq!(newest_from_requester(&d, &t, "me").unwrap().id, "m3");
    }

    #[test]
    fn unknown_requester_falls_back_to_customer_role_authors() {
        let d = detail(vec![
            msg("m1", "someone", "CUSTOMER", false, "2026-07-14T10:00:00Z"),
            msg("m2", "sam", "SUPPORT", false, "2026-07-14T12:00:00Z"),
        ]);
        let t = ticket(None);
        assert_eq!(newest_from_requester(&d, &t, "me").unwrap().id, "m1");
    }

    #[test]
    fn none_when_the_requester_never_wrote_publicly() {
        let d = detail(vec![msg("m1", "me", "SUPPORT", false, "2026-07-14T10:00:00Z")]);
        let t = ticket(Some("cust"));
        assert!(newest_from_requester(&d, &t, "me").is_none());
    }

    #[test]
    fn terminal_states_are_recognized() {
        assert!(is_terminal(Some("RESOLVED")));
        assert!(is_terminal(Some("CLOSED")));
        assert!(is_terminal(Some("ARCHIVED")));
        assert!(!is_terminal(Some("OPEN")));
        assert!(!is_terminal(Some("PENDING_AGENT")));
        assert!(!is_terminal(Some("PENDING_CUSTOMER")));
        assert!(!is_terminal(None));
    }
}
