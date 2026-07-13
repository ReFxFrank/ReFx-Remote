//! Minimal Engine.IO v4 + Socket.IO codec — only the slice ReFx's
//! `/ws/console` namespace uses. Hand-rolled (not `rust_socketio`) to keep
//! the build rustls-only; see docs/decisions.md D-004. The exact frames were
//! confirmed against production in the Phase 3 spike.
//!
//! Engine.IO packet = one char type prefix + payload:
//!   0 open · 1 close · 2 ping · 3 pong · 4 message · 5 upgrade · 6 noop
//! A Socket.IO packet rides inside an Engine.IO `message` (`4`) frame:
//!   4 <sio-type> [namespace,] [json]
//! Socket.IO types: 0 CONNECT · 1 DISCONNECT · 2 EVENT · 3 ACK · 4 CONNECT_ERROR

/// A decoded inbound frame we care about.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    /// Engine.IO OPEN — carries the session parameters.
    Open(OpenPayload),
    /// Server heartbeat; we must answer with a pong.
    Ping,
    Pong,
    /// Socket.IO CONNECT ack for our namespace (auth succeeded).
    Connected,
    /// Socket.IO CONNECT_ERROR (auth/namespace rejected).
    ConnectError(String),
    /// A namespaced event: `[name, arg0, arg1, …]`.
    Event { name: String, args: Vec<serde_json::Value> },
    /// Engine.IO CLOSE.
    Close,
    /// Anything we don't model — kept for logging, never fatal.
    Other(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenPayload {
    pub sid: String,
    pub ping_interval_ms: u64,
    pub ping_timeout_ms: u64,
}

/// Decode one Engine.IO frame (text). `namespace` is the SIO namespace we're
/// attached to (e.g. `/ws/console`); events/connect for other namespaces are
/// reported as `Other`.
pub fn decode(frame: &str, namespace: &str) -> Incoming {
    let mut chars = frame.chars();
    let eio = match chars.next() {
        Some(c) => c,
        None => return Incoming::Other(String::new()),
    };
    let rest = &frame[eio.len_utf8()..];
    match eio {
        '0' => match serde_json::from_str::<serde_json::Value>(rest) {
            Ok(v) => Incoming::Open(OpenPayload {
                sid: v.get("sid").and_then(|s| s.as_str()).unwrap_or_default().to_string(),
                ping_interval_ms: v.get("pingInterval").and_then(|n| n.as_u64()).unwrap_or(25000),
                ping_timeout_ms: v.get("pingTimeout").and_then(|n| n.as_u64()).unwrap_or(20000),
            }),
            Err(_) => Incoming::Other(frame.to_string()),
        },
        '1' => Incoming::Close,
        '2' => Incoming::Ping,
        '3' => Incoming::Pong,
        '4' => decode_socketio(rest, namespace),
        _ => Incoming::Other(frame.to_string()),
    }
}

fn decode_socketio(rest: &str, namespace: &str) -> Incoming {
    let mut chars = rest.chars();
    let sio = match chars.next() {
        Some(c) => c,
        None => return Incoming::Other(rest.to_string()),
    };
    let after = &rest[sio.len_utf8()..];
    // Optional `<namespace>,` prefix; default namespace `/` has none.
    let (ns, payload) = split_namespace(after);
    // Ignore frames for a namespace we're not attached to.
    if !ns.is_empty() && ns != namespace {
        return Incoming::Other(rest.to_string());
    }
    match sio {
        '0' => Incoming::Connected,
        '1' => Incoming::Other(rest.to_string()), // DISCONNECT
        '2' => decode_event(payload),
        '4' => Incoming::ConnectError(
            serde_json::from_str::<serde_json::Value>(payload)
                .ok()
                .and_then(|v| {
                    v.get("message")
                        .and_then(|m| m.as_str())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| payload.to_string()),
        ),
        _ => Incoming::Other(rest.to_string()),
    }
}

/// A namespace prefix looks like `/ws/console,` and always starts with `/`.
/// Everything up to the first comma is the namespace; the rest is the JSON
/// payload. With no leading `/`, there is no namespace prefix.
fn split_namespace(s: &str) -> (&str, &str) {
    if s.starts_with('/') {
        if let Some(comma) = s.find(',') {
            return (&s[..comma], &s[comma + 1..]);
        }
        // Namespace with no payload (e.g. bare CONNECT ack `/ws/console`).
        return (s, "");
    }
    ("", s)
}

fn decode_event(payload: &str) -> Incoming {
    // Strip an optional numeric ack id between the type and the `[`.
    let json_start = payload.find('[').unwrap_or(0);
    let json = &payload[json_start..];
    match serde_json::from_str::<Vec<serde_json::Value>>(json) {
        Ok(mut arr) if !arr.is_empty() => {
            let name = match arr.remove(0) {
                serde_json::Value::String(s) => s,
                other => other.to_string(),
            };
            Incoming::Event { name, args: arr }
        }
        _ => Incoming::Other(payload.to_string()),
    }
}

// ── Encoders ───────────────────────────────────────────────────────────

/// Engine.IO pong (answers a server ping).
pub fn pong() -> String {
    "3".to_string()
}

/// Socket.IO CONNECT with an auth payload for a namespace:
/// `40/ws/console,{"token":"…"}`.
pub fn connect(namespace: &str, auth: &serde_json::Value) -> String {
    format!("40{namespace},{auth}")
}

/// Socket.IO EVENT for a namespace: `42/ws/console,["subscribe",{…}]`.
pub fn event(namespace: &str, name: &str, args: &[serde_json::Value]) -> String {
    let mut arr = Vec::with_capacity(args.len() + 1);
    arr.push(serde_json::Value::String(name.to_string()));
    arr.extend_from_slice(args);
    let json = serde_json::to_string(&arr).unwrap_or_else(|_| "[]".into());
    format!("42{namespace},{json}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const NS: &str = "/ws/console";

    #[test]
    fn decodes_open() {
        let f = r#"0{"sid":"abc","upgrades":[],"pingInterval":25000,"pingTimeout":20000}"#;
        match decode(f, NS) {
            Incoming::Open(o) => {
                assert_eq!(o.sid, "abc");
                assert_eq!(o.ping_interval_ms, 25000);
                assert_eq!(o.ping_timeout_ms, 20000);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn decodes_ping_and_pong() {
        assert_eq!(decode("2", NS), Incoming::Ping);
        assert_eq!(decode("3", NS), Incoming::Pong);
    }

    #[test]
    fn decodes_namespaced_connect_ack() {
        assert_eq!(decode(r#"40/ws/console,{"sid":"xyz"}"#, NS), Incoming::Connected);
        // bare ack with no payload
        assert_eq!(decode("40/ws/console", NS), Incoming::Connected);
    }

    #[test]
    fn decodes_connect_error() {
        // This is the exact frame the spike observed for a bad subscribe.
        match decode(r#"44/ws/console,{"message":"forbidden"}"#, NS) {
            Incoming::ConnectError(m) => assert_eq!(m, "forbidden"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn decodes_console_event() {
        let f = r#"42/ws/console,["console",{"type":"console","line":"hi","stream":"stdout","at":123}]"#;
        match decode(f, NS) {
            Incoming::Event { name, args } => {
                assert_eq!(name, "console");
                assert_eq!(args[0]["line"], "hi");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn decodes_error_event_not_connect_error() {
        // The gateway emits `error` as a normal EVENT after connect, not a
        // CONNECT_ERROR — the spike saw `42/ws/console,["error",…]`.
        match decode(r#"42/ws/console,["error",{"message":"forbidden"}]"#, NS) {
            Incoming::Event { name, args } => {
                assert_eq!(name, "error");
                assert_eq!(args[0]["message"], "forbidden");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn ignores_other_namespace() {
        assert!(matches!(
            decode(r#"42/other,["console",{}]"#, NS),
            Incoming::Other(_)
        ));
    }

    #[test]
    fn encodes_connect_and_event() {
        assert_eq!(
            connect(NS, &json!({ "token": "T" })),
            r#"40/ws/console,{"token":"T"}"#
        );
        assert_eq!(
            event(NS, "subscribe", &[json!({ "serverId": "s1" })]),
            r#"42/ws/console,["subscribe",{"serverId":"s1"}]"#
        );
    }
}
