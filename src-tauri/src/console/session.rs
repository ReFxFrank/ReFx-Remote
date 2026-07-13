//! One live-console session per open server: a hand-rolled Engine.IO v4 /
//! Socket.IO client over rustls `tokio-tungstenite`.
//!
//! Behaviour (docs/recon/realtime-protocol.md, D-004):
//! - Connect `wss://<origin>/socket.io/?EIO=4&transport=websocket`, read the
//!   Engine.IO OPEN, send Socket.IO CONNECT with `{token}` to `/ws/console`.
//! - On `Connected`, `subscribe {serverId}`; the gateway then streams
//!   `console` / `stats` / `power` for that server (no scrollback — we keep a
//!   Rust-side ring buffer so tab-switch / reconnect doesn't wipe history).
//! - Answer Engine.IO pings with pongs; a silent link past
//!   pingInterval+pingTimeout is treated as dead → reconnect.
//! - No in-socket re-auth on this backend: an `unauthorized` error means the
//!   access token expired → refresh once, reconnect a fresh socket.
//!   `forbidden`/suspended is terminal. Otherwise exponential backoff+jitter.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::json;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info};

use super::protocol::{self, Incoming};
use crate::panel::auth::AuthManager;

const NAMESPACE: &str = "/ws/console";
const RING_CAP: usize = 5000;
const BACKOFF_MIN: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// A connection must stay live at least this long to count as "stable" — a
/// stable drop resets backoff; a flap does not (avoids reconnect storms).
const STABILITY: Duration = Duration::from_secs(10);

#[derive(Clone, Serialize)]
pub struct ConsoleLine {
    pub line: String,
    pub stream: String,
    pub at: i64,
}

/// Where a session delivers what it observes. The app backs this with Tauri
/// event emits; the live-check example backs it with stdout — so the whole
/// session is verifiable headless against the real server.
pub trait ConsoleSink: Send + Sync + 'static {
    fn console(&self, server_id: &str, line: &ConsoleLine);
    fn stats(&self, server_id: &str, stats: &serde_json::Value);
    fn status(&self, server_id: &str, state: &str);
    fn conn(&self, server_id: &str, state: &str, detail: Option<&str>, attempt: Option<u32>);
}

/// Shared handle the manager keeps for an open session.
pub struct Session {
    stop: watch::Sender<bool>,
    buffer: Arc<Mutex<VecDeque<ConsoleLine>>>,
}

impl Session {
    /// Snapshot of buffered scrollback (for a freshly-mounted console view).
    pub fn history(&self) -> Vec<ConsoleLine> {
        self.buffer.lock().expect("buffer lock").iter().cloned().collect()
    }

    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }
}

/// Spawn the session task for `server_id`. Returns immediately.
pub fn spawn(
    sink: Arc<dyn ConsoleSink>,
    auth: Arc<AuthManager>,
    server_id: String,
) -> Session {
    let (stop_tx, stop_rx) = watch::channel(false);
    let buffer = Arc::new(Mutex::new(VecDeque::<ConsoleLine>::with_capacity(RING_CAP)));
    let task_buffer = buffer.clone();
    tauri::async_runtime::spawn(async move {
        run(sink, auth, server_id, stop_rx, task_buffer).await;
    });
    Session { stop: stop_tx, buffer }
}

enum Outcome {
    /// The socket dropped after being live. `stable` = it stayed live past
    /// the stability threshold (a healthy connection that dropped, vs a flap).
    Reconnect { stable: bool },
    Stopped,
}

enum SessionError {
    Unauthorized,
    Forbidden(String),
    SignedOut,
    Transport(String),
    /// The stop signal fired mid-read.
    Stopped,
}

/// The reconnect supervisor.
async fn run(
    sink: Arc<dyn ConsoleSink>,
    auth: Arc<AuthManager>,
    server_id: String,
    mut stop_rx: watch::Receiver<bool>,
    buffer: Arc<Mutex<VecDeque<ConsoleLine>>>,
) {
    let mut backoff = BACKOFF_MIN;
    let mut attempt: u32 = 0;
    // Tokens are refreshed at most once per unbroken run of `unauthorized`
    // handshakes: a second consecutive rejection of a freshly-minted token
    // means the account itself is blocked (e.g. mustChangePassword) — that's
    // terminal, not a refresh loop. Any live connection resets this.
    let mut refreshed_this_streak = false;

    while !*stop_rx.borrow() {
        sink.conn(&server_id, "connecting", None, (attempt > 0).then_some(attempt));

        match connect_once(&sink, &auth, &server_id, &mut stop_rx, &buffer).await {
            Ok(Outcome::Stopped) | Err(SessionError::Stopped) => break,
            Ok(Outcome::Reconnect { stable }) => {
                attempt = attempt.saturating_add(1);
                refreshed_this_streak = false; // a live connection clears the streak
                if stable {
                    backoff = BACKOFF_MIN; // healthy drop → retry promptly
                }
                // else: a flap — let backoff keep growing (set below).
            }
            Err(SessionError::Unauthorized) => {
                if refreshed_this_streak {
                    // Fresh token still rejected → the account is blocked, not
                    // an expired token. Terminal.
                    sink.conn(
                        &server_id,
                        "failed",
                        Some("Your session is no longer valid — sign in again."),
                        None,
                    );
                    break;
                }
                attempt = attempt.saturating_add(1);
                refreshed_this_streak = true;
                if let Err(e) = auth.refresh_access_token().await {
                    sink.conn(&server_id, "failed", Some(&e.user_message()), None);
                    break;
                }
                backoff = BACKOFF_MIN; // fall through to a short delay, then retry
            }
            Err(SessionError::Forbidden(msg)) => {
                sink.conn(&server_id, "failed", Some(&msg), None);
                break;
            }
            Err(SessionError::SignedOut) => {
                sink.conn(&server_id, "failed", Some("You're signed out."), None);
                break;
            }
            Err(SessionError::Transport(detail)) => {
                attempt = attempt.saturating_add(1);
                sink.conn(&server_id, "retrying", Some(&detail), Some(attempt));
            }
        }

        if *stop_rx.borrow() {
            break;
        }
        // Jitter derived from attempt (no RNG — Math.random is unavailable in
        // this build and determinism aids debugging).
        let jitter = Duration::from_millis(((attempt as u64 * 137) % 500) + 1);
        let wait = (backoff + jitter).min(BACKOFF_MAX);
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = stop_rx.changed() => {}
        }
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }

    sink.conn(&server_id, "closed", None, None);
    info!("console session ended for {server_id}");
}

/// One connection attempt: handshake, subscribe, then pump frames.
async fn connect_once(
    sink: &Arc<dyn ConsoleSink>,
    auth: &Arc<AuthManager>,
    server_id: &str,
    stop_rx: &mut watch::Receiver<bool>,
    buffer: &Arc<Mutex<VecDeque<ConsoleLine>>>,
) -> Result<Outcome, SessionError> {
    let token = auth.access_token().await.map_err(|_| SessionError::SignedOut)?;
    let origin = auth.origin().to_string();

    let mut req = ws_url(&origin)
        .into_client_request()
        .map_err(|e| SessionError::Transport(format!("bad ws url: {e}")))?;
    req.headers_mut().insert(
        "Origin",
        origin.parse().map_err(|_| SessionError::Transport("bad origin".into()))?,
    );

    // Time-bound the connect AND make it cancellable — a SYN blackhole or a
    // stalled TLS/WS upgrade must not park the task uninterruptibly (close()
    // would otherwise be ignored until the OS connect timeout).
    let mut ws = tokio::select! {
        _ = stop_rx.changed() => return Err(SessionError::Stopped),
        res = tokio::time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(req)) => {
            match res {
                Err(_) => return Err(SessionError::Transport("connect timed out".into())),
                Ok(Err(e)) => return Err(SessionError::Transport(format!("connect failed: {e}"))),
                Ok(Ok((ws, _))) => ws,
            }
        }
    };

    // 1. Engine.IO OPEN → heartbeat deadline.
    let open = read_frame(&mut ws, stop_rx, Duration::from_secs(15)).await?;
    let ping_deadline = match protocol::decode(&open, NAMESPACE) {
        Incoming::Open(o) => Duration::from_millis(o.ping_interval_ms + o.ping_timeout_ms),
        _ => Duration::from_secs(45),
    };

    // 2. Socket.IO CONNECT with the JWT.
    send(&mut ws, protocol::connect(NAMESPACE, &json!({ "token": token }))).await?;

    // 3. Await auth result. The gateway signals a bad token either as a
    //    CONNECT_ERROR or as an `error` EVENT — handle both.
    loop {
        let frame = read_frame(&mut ws, stop_rx, Duration::from_secs(15)).await?;
        match protocol::decode(&frame, NAMESPACE) {
            Incoming::Connected => break,
            Incoming::ConnectError(m) => return Err(classify_error(&m)),
            Incoming::Event { name, args } if name == "error" => {
                return Err(classify_error(&event_message(&args)));
            }
            Incoming::Ping => send(&mut ws, protocol::pong()).await?,
            _ => {}
        }
    }

    // 4. Subscribe; the gateway starts streaming for this server.
    send(
        &mut ws,
        protocol::event(NAMESPACE, "subscribe", &[json!({ "serverId": server_id })]),
    )
    .await?;
    sink.conn(server_id, "live", None, None);
    info!("console live for {server_id}");
    let live_at = std::time::Instant::now();
    let stable = || live_at.elapsed() >= STABILITY;

    // 5. Pump frames until the socket drops or an error tells us to stop.
    loop {
        let frame = match read_frame(&mut ws, stop_rx, ping_deadline).await {
            Ok(f) => f,
            Err(SessionError::Stopped) => return Ok(Outcome::Stopped),
            Err(SessionError::Transport(_)) => return Ok(Outcome::Reconnect { stable: stable() }),
            Err(e) => return Err(e),
        };
        match protocol::decode(&frame, NAMESPACE) {
            Incoming::Ping => send(&mut ws, protocol::pong()).await?,
            Incoming::Close => return Ok(Outcome::Reconnect { stable: stable() }),
            Incoming::Event { name, args } if name == "error" => {
                return Err(classify_error(&event_message(&args)));
            }
            Incoming::Event { name, args } => handle_event(sink, server_id, &name, &args, buffer),
            _ => {}
        }
    }
}

fn handle_event(
    sink: &Arc<dyn ConsoleSink>,
    server_id: &str,
    name: &str,
    args: &[serde_json::Value],
    buffer: &Arc<Mutex<VecDeque<ConsoleLine>>>,
) {
    let arg0 = args.first().cloned().unwrap_or(serde_json::Value::Null);
    match name {
        "console" => {
            let line = ConsoleLine {
                line: arg0.get("line").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                stream: arg0.get("stream").and_then(|v| v.as_str()).unwrap_or("stdout").to_string(),
                at: arg0.get("at").and_then(|v| v.as_i64()).unwrap_or(0),
            };
            {
                let mut b = buffer.lock().expect("buffer lock");
                if b.len() >= RING_CAP {
                    b.pop_front();
                }
                b.push_back(line.clone());
            }
            sink.console(server_id, &line);
        }
        "stats" => sink.stats(server_id, &arg0),
        "power" => {
            let state = arg0.get("state").and_then(|v| v.as_str()).unwrap_or_default();
            sink.status(server_id, state);
        }
        other => debug!("unhandled console event `{other}`"),
    }
}

fn event_message(args: &[serde_json::Value]) -> String {
    args.first()
        .and_then(|v| v.get("message"))
        .and_then(|m| m.as_str())
        .unwrap_or_default()
        .to_string()
}

fn classify_error(msg: &str) -> SessionError {
    let m = msg.to_lowercase();
    if m.contains("unauthorized") {
        SessionError::Unauthorized
    } else if m.contains("forbidden") || m.contains("suspend") {
        SessionError::Forbidden(if msg.is_empty() {
            "You don't have access to this server's console.".into()
        } else {
            msg.to_string()
        })
    } else {
        SessionError::Transport(msg.to_string())
    }
}

type Ws = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

/// Read one Engine.IO text frame with a heartbeat deadline; honours the stop
/// signal. Timeout / closed stream → `Transport` (reconnect). Stop → `Stopped`.
async fn read_frame(
    ws: &mut Ws,
    stop_rx: &mut watch::Receiver<bool>,
    deadline: Duration,
) -> Result<String, SessionError> {
    loop {
        tokio::select! {
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    return Err(SessionError::Stopped);
                }
            }
            res = tokio::time::timeout(deadline, ws.next()) => {
                return match res {
                    Err(_) => Err(SessionError::Transport("heartbeat timeout".into())),
                    Ok(None) => Err(SessionError::Transport("stream closed".into())),
                    Ok(Some(Ok(Message::Text(t)))) => Ok(t.to_string()),
                    Ok(Some(Ok(Message::Close(_)))) => Err(SessionError::Transport("closed".into())),
                    Ok(Some(Ok(_))) => continue, // ping/pong/binary/frame — keep reading
                    Ok(Some(Err(e))) => Err(SessionError::Transport(format!("ws error: {e}"))),
                };
            }
        }
    }
}

async fn send(ws: &mut Ws, text: String) -> Result<(), SessionError> {
    ws.send(Message::Text(text.into()))
        .await
        .map_err(|e| SessionError::Transport(format!("send failed: {e}")))
}

fn ws_url(origin: &str) -> String {
    let base = origin
        .strip_prefix("https://")
        .map(|h| format!("wss://{h}"))
        .or_else(|| origin.strip_prefix("http://").map(|h| format!("ws://{h}")))
        .unwrap_or_else(|| origin.to_string());
    format!("{base}/socket.io/?EIO=4&transport=websocket")
}

#[cfg(test)]
mod tests {
    use super::ws_url;

    #[test]
    fn builds_wss_url() {
        assert_eq!(
            ws_url("https://api.refx.gg"),
            "wss://api.refx.gg/socket.io/?EIO=4&transport=websocket"
        );
        assert_eq!(
            ws_url("http://localhost:4000"),
            "ws://localhost:4000/socket.io/?EIO=4&transport=websocket"
        );
    }
}
