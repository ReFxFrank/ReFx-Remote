//! `refx://` deep links. Supports `refx://server/{uuid}` and
//! `refx://server/{uuid}/console` — opening the app straight to a server (or
//! its console). Routed both from the deep-link plugin and from the
//! single-instance argv (a link clicked while the app is already running).

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

pub fn register(app: &AppHandle) {
    use tauri_plugin_deep_link::DeepLinkExt;
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            route(&handle, url.as_str());
        }
    });
    // Cold-start: the app was launched by a deep link.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            route(app, url.as_str());
        }
    }
}

/// A server id is a short opaque token (UUID or slug). Constrain it to a safe
/// charset so an externally-clicked link can't smuggle a query string or extra
/// path segment into the authenticated API path it ultimately reaches.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Parse and act on a single `refx://…` URL. Unknown or malformed shapes are
/// ignored.
pub fn route(app: &AppHandle, url: &str) {
    let Some(rest) = url.strip_prefix("refx://server/") else {
        return;
    };
    let mut parts = rest.trim_end_matches('/').split('/');
    let Some(id) = parts.next().filter(|s| valid_id(s)) else {
        return;
    };
    let console = parts.next() == Some("console");

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }

    let payload = json!({ "id": id, "console": console });
    // If the servers screen's listener is live, emit straight to it; otherwise
    // buffer so a cold-start (or signed-out) deep link isn't dropped. Decided
    // under the lock so a link racing frontend-ready is handled exactly once.
    let emit_now = {
        let state = app.state::<crate::state::AppState>();
        let mut inbox = state.deeplink.lock().expect("deeplink lock");
        if inbox.ready {
            true
        } else {
            inbox.pending.push(payload.clone());
            false
        }
    };
    if emit_now {
        let _ = app.emit_to("main", "app:open-server", payload);
    }
}

/// Scan a process argv for a `refx://` URL (single-instance forwards these).
pub fn route_from_argv(app: &AppHandle, argv: &[String]) {
    for arg in argv {
        if arg.starts_with("refx://") {
            route(app, arg);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::valid_id;

    #[test]
    fn accepts_uuid_and_slug_ids() {
        assert!(valid_id("3f9c1a2b-4d5e-6789-abcd-ef0123456789"));
        assert!(valid_id("srv_ABC123"));
        assert!(valid_id("a"));
    }

    #[test]
    fn rejects_query_path_and_traversal() {
        // An externally-clicked link must not smuggle a query string or extra
        // path/host segment into the authenticated API path.
        assert!(!valid_id(""));
        assert!(!valid_id("x?foo=bar"));
        assert!(!valid_id("x/extra"));
        assert!(!valid_id(".."));
        assert!(!valid_id("a b"));
        assert!(!valid_id("x%2f..%2fadmin"));
        assert!(!valid_id(&"a".repeat(65)));
    }
}
