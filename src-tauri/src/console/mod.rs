//! Per-server live console sessions over Socket.IO v4
//! (`https://api.refx.gg`, namespace `/ws/console`, access JWT in the
//! CONNECT `auth.token`).
//!
//! One socket per open server (the `command` event targets the
//! last-subscribed server and no `unsubscribe` exists). The server sends no
//! scrollback — history lives in a Rust-side ring buffer. No in-socket
//! re-auth: on `error {"unauthorized"}`, refresh once via REST and open a
//! new socket; `forbidden` is terminal. Contract:
//! `docs/recon/realtime-protocol.md`. Built in Phase 3.
