# Architecture decisions

## D-001 (PROPOSED, 2026-07-13): Revised architecture for the real backend

**Status: awaiting Frank's sign-off** — the build brief mandated stop-and-report if the panel turned out not to be Pterodactyl-compatible. It isn't; it's the ReFxHosting platform. This records what changes and what survives.

### What survives from the brief unchanged

- Tauri v2 + React/TS/Vite/Tailwind, xterm.js console, uPlot charts, Zustand.
- **All network I/O in Rust** — reason 1 (Wings origin checks) is obsolete (the gateway reflects any Origin), but reasons 2–3 (no CORS coupling to the deployment's `CORS_ORIGINS`, and credentials never entering the WebView) fully stand. Nothing changes in the module boundary: FE talks only to `#[tauri::command]`s and events.
- Secrets in Windows Credential Manager via `keyring`; redacting log subscriber; every §3 guardrail; the phase structure; the entire Phase 6 release-engineering plan (NSIS, tauri-plugin-updater, Azure Artifact Signing, tested end-to-end update).
- Destructive-action typed confirmations; no offline queuing of actions; optimistic-UI-with-reconciliation.

### What changes

| Area | Brief said | Reality / new design |
|---|---|---|
| Auth | Paste a `ptlc_` key; *never* build password login | **Email+password (+ MFA challenge) JWT login — the same first-class API the mobile apps use.** Rotating refresh token stored in Credential Manager (sliding 30/90-day TTL). The brief's prohibition targeted scraping Pterodactyl's HTML login; here login is a real API. Refresh handling must be atomic + single-flight (reuse outside a 60 s grace window revokes ALL the user's sessions). `rememberMe: true` by default. Redaction regexes change to: `refx_[A-Za-z0-9]+` and the JWT pattern. |
| Console transport | Wings WS, `Origin` spoofing, JWT-per-socket from a REST endpoint, `token expiring` dance | **Socket.IO v4 client in Rust** (`rust-socketio` or hand-rolled EIO4 over tokio-tungstenite — decide in Phase 1 with a spike; the handshake contract is small). Namespace `/ws/console`, access JWT in the CONNECT `auth.token`. No in-socket re-auth: on `error {message:"unauthorized"}`, refresh once via REST, reconnect a new socket. `forbidden` is terminal. **One socket per open server** (the `command` event targets the last-subscribed server; there is no unsubscribe). |
| Scrollback | Wings sends ~150 lines | **Server sends zero scrollback.** The Rust-side per-server ring buffer (5000 lines) is now the only history; persist per-server tail across app restarts if we want any continuity (web persists 2000 to sessionStorage). |
| Stats | Wings `stats` string-in-string | WS `stats` frames every ~5 s: `{serverId, cpuPct, memUsedMb, diskUsedMb, netRxBytes, netTxBytes, state}` — no double-parse, but also no mem limit/uptime; take limits from the server record and richer numbers from `GET /servers/:id/stats` on the detail screen. Rate budget: 120 req/min/IP globally — prefer WS, poll REST sparingly with backoff on unfocus (brief's cadence rules still apply, tightened). |
| Power | `POST /power` (same) | Same shape: `POST /servers/:id/power {signal}`. WS has no power handler — REST only. Crash alerts come from WS `power` events (state `CRASHED`), which also fixes the brief's crash-vs-user-stop problem: still track local stop intent. |
| Files > 32 MiB | Signed upload URLs | Panel upload is hard-capped at 32 MiB and `upload-url` is unusable by clients. **Big files go over SFTP (node port 2022)** — the Rust core needs an SFTP client (russh/ssh2) for uploads over the cap; that's a new v1 component. Downloads: signed relative URLs (prefix `apiOrigin + /api/v1`), Range-resumable. |
| Pairing (Appendix C) | RFC 8628 panel addition | Dropped. Login is the pairing. If Frank later wants push-to-desktop or device-flow, that's panel-side v2 work, tracked in roadmap. |
| Backup progress | WS backup events | DB-only: poll the backup row's `progressPct` while a backup runs. |
| Update feed | `latest.json` host TBD | GitHub Releases recommended, in a **dedicated repo** (node agents pull `/releases/latest` assets from `ReFxFrank/ReFxHosting` — don't share that stream). |

### Module shape (revised)

```
src-tauri/src/
  main.rs / state.rs / vault.rs / commands.rs / events.rs / tray.rs / updater.rs   (as briefed)
  panel/          # reqwest client for /api/v1: envelope unwrap, flat-error mapping,
                  # token store + single-flight refresh, rate-limit header adaptation
  console/        # Socket.IO session per open server: connect/subscribe/command,
                  # ring buffer, reconnect w/ refresh-once, conn-state events
  sftp/           # big-file transfers (russh), progress events
```

Event names to the FE stay as briefed (`console:{id}`, `stats:{id}`, `status:{id}`, `conn:{id}`, `app:update-available`) — payloads adjusted to the real stats/status fields.

### Why not API keys as primary auth

`refx_` keys authenticate REST (via `X-Api-Key`) but the console gateway only verifies access JWTs — an API-key desktop app would have no live console, which is the feature the app lives or dies on (brief §7). Keys remain interesting for a future headless "tray-only monitor mode."

## D-002 (2026-07-13): Recon method

Live recon with credentials wasn't possible (none supplied); instead: 8-agent source recon over `ReFxHosting` @ ce9b32f (== public origin/main) + both mobile apps, adversarially cross-checked, plus unauthenticated live probes of production (`/health`, error/envelope/rate-limit headers, Engine.IO handshake) which matched source exactly. Confidence on the three perilous contracts (envelope, auth/refresh, console handshake): HIGH. Remaining live-verification items are listed at the end of [api-surface.md](api-surface.md).
