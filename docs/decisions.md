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

## D-007 (2026-07-13): Staff admin suite — architecture + build approach

Added a **full staff admin surface** (~25 screens, ~90 `admin_*` commands) built
against the real ReFxHosting backend source (`../ReFxHosting/apps/panel-api`),
reusing the existing architecture (all I/O in Rust `panel/admin/*.rs`; React
screens gated on `profile.permissions` via `src/lib/perms.ts`). Decisions:

- **Staff = `permissions.length > 0`** (the server's own test), not `globalRole`.
  The permission matcher is mirrored byte-for-byte in TS + Rust with shared test
  vectors; the server stays authoritative (403 backstop), the UI gate only hides
  dead-end controls (hide, don't disable, anything the caller lacks).
- **Reuse over re-port**: staff "Manage server" mounts the shipped
  console/files/backups components with any `serverId` (the `servers.manage`
  staff override authorizes them), gated on `servers.manage`.
- **Money doctrine**: `credit_adjust`/`invoice_refund`/`gift_card_create` bind a
  UI-typed amount to `amountMinor`, re-checked in the Rust command; `mark_paid`
  and vanity-refund require an explicit confirm. See admin-suite-plan.md.
- **`PATCH /admin/users/:id` state change deliberately skips the role-rank guard**
  the `ban`/`suspend` routes enforce (mirrors the web admin); server authoritative.
- **Build method**: the independent Tier-3 domains (content, settings, db-hosts,
  products, templates, team) were authored by parallel subagents — each writing
  its own new module/screen file from the backend source — then integrated and
  adversarially reviewed. Each tier got the implement → review → verify → fix loop
  the earlier phases used; the admin-review pass caught a permission-blind staff
  drawer + a forbidden-default-screen bug, both fixed.

Live verification still needs a **staff/admin login** (the `test@remote.com`
account is a customer); the suite is built against source-of-truth contracts.

## D-006 (2026-07-13): Phase 5 native surface + Phase 6 release engineering

**Native surface (Phase 5).** Tray, background crash monitor, `refx://` deep
links, and settings all live in Rust so they work with the window closed
(close-to-tray keeps the monitor alive). Decisions worth recording:

- **Crash-suppression is consume-on-suppress, not a fixed timer.** A user
  stop/restart/kill drives the same `RUNNING → OFFLINE/CRASHED` edge a crash
  does, so `PowerIntent` marks the server; the monitor suppresses the *first*
  such edge and then **clears** the mark. A genuine crash *after* a restart has
  brought the server back up (still inside the old 120 s window) is therefore
  detected, not swallowed. The 120 s deadline is only a safety cap for an
  action whose transition never materialises. `start` never marks intent (no
  down-transition to suppress), and a failed power call clears the mark so it
  suppresses nothing. (This was the central correctness point in the brief; the
  original pure-timer version had a permanent-miss hole caught in review.)
- **Deep-link inbox.** A `refx://` link can arrive before the servers screen's
  listener mounts (cold-start, or clicked while signed out). Rust buffers links
  in a queue and the frontend drains them once its listener is live and flips a
  `ready` flag (all under one lock, decided exactly once). Link ids are charset-
  validated before use so an external link can't smuggle a query/path segment
  into the authenticated API path.
- **Tray power failures surface as notifications** rather than failing silently;
  the tray gates items on server state only (viewer permissions aren't on the
  list payload), and the panel API is the real permission backstop.

**Auto-update (Phase 6).** Updater via **minisign-signed GitHub Releases**: the
release workflow publishes installers + `latest.json` to
`ReFxFrank/ReFx-Remote`, and the app checks `releases/latest/download/latest.json`
on launch, every 6 h, and on demand from the tray. The signature is verified
against a pubkey baked into `tauri.conf.json`; the private key is a GitHub
secret, never in the repo. **Authenticode (Azure Trusted Signing) is deferred**
and kept out of `tauri.conf.json` for now so unsigned local/CI builds still
succeed — it only affects SmartScreen on first install, independent of the
minisign update-integrity chain. See [todo-frank.md](todo-frank.md) §A–C.

## D-005 (2026-07-13): Detail-panel stat tiles stay on REST, not the WS stats frame

The brief (§6) says "when a websocket is open for a server, stop polling
`/resources`; the WS stats stream supersedes it." On **this** backend the WS
`stats` frame is strictly *poorer* than REST `GET /servers/:id/stats`: it
carries `{cpuPct, memUsedMb, diskUsedMb, netRx/TxBytes, state}` but **not**
`memTotalMb`, `players`, or `uptimeMs` (verified in recon + the live console
check). The guardrail's real intent is rate-limit avoidance, and a single
selected server's 5 s REST poll is ~12 req/min — negligible against the 120
budget. So the stat tiles keep polling REST (rich data, live-verified) while
the console session's `stats:{id}` events remain available but unused by the
tiles. Net: better UX, guardrail intent satisfied. The console session still
receives `stats`/`power` so a future compact pop-out stat line can use them.

## D-004 (2026-07-13): Phase 3 console client — hand-roll over rustls tokio-tungstenite

**Live-verified 2026-07-13** against the real "ttt" Minecraft server: the
hand-rolled client connected in 189 ms, and after a `start` the full Paper
boot log streamed line-by-line in real time (JVM start → plugin init → world
gen → spawn prep) alongside `stats` frames (mem 0→1049 MB) and a
`STATUS→STARTING` event. 60 console lines + 5 stats frames in 20 s. The
handshake/codec/ring-buffer all work end-to-end.


**Spike result (evidence-based).** Before committing, I connected `rust_socketio`
0.6 to the real `https://api.refx.gg/ws/console` with the test account's access
JWT (example `ws_spike.rs`, since removed). Observed, verbatim:

```
1. login OK, got access token (268 chars)
2. connecting to https://api.refx.gg/ws/console …
   [   0ms] socket OPEN                       # Engine.IO v4 handshake OK; JWT
                                              #   in CONNECT auth payload accepted
   [  22ms] event `error` -> {"message":"forbidden"}   # subscribe to a bogus
                                              #   server id → routed error
```

This confirms the whole handshake contract end-to-end: default engine path
`/socket.io`, namespace `/ws/console`, auth via the CONNECT `{token}` payload,
and bidirectional named-event routing — all exactly as docs/recon predicted.

**Decision: hand-roll a minimal Socket.IO/Engine.IO-v4 client** over the
existing `tokio-tungstenite` (rustls), NOT adopt `rust_socketio`. Reasons:

1. **TLS stack.** `rust_socketio` 0.6 hardwires `native-tls` (no rustls
   feature) and pulls a second `reqwest` (0.12) — both violate the brief's
   rustls-only / no-native-tls rule and bloat the build.
2. **Control over reconnect/refresh.** Phase 3 needs bespoke behavior the
   library fights: refresh the JWT and re-`auth` on the *same* socket without
   tearing down; single-flight token refresh shared with the REST layer;
   `conn:{id}` status events; a per-server ring buffer. Owning the loop is
   simpler than bending an opinionated client.
3. **The protocol is small and now proven.** Frames are just `40{auth}` /
   `42["event",arg]` / `41` over one WS; the spike showed the exact server
   behavior to test against.

The `Origin` header is a non-issue (gateway CORS reflects any origin — D-001).
Client lives in `src-tauri/src/console/`. **Still blocked on a live server**
for the acceptance criteria (output ≤1s, survives token refresh, reconnect on
wake) — see todo-frank #3.

## D-003 (2026-07-13): Phase 2 polling cadence — stay inside 120 req/min/IP

The panel throttles 120 requests/60s per IP; live stats have no WS feed yet
(that's Phase 3). To keep multi-server dashboards well under budget:

- **One `GET /servers` call per cycle** refreshes the whole list (name, state,
  IP, memory) — 10 s when focused, 30 s when blurred, paused when hidden to
  tray. That's ≤6 req/min regardless of server count.
- **`GET /servers/:id/stats` polls only the selected server** at 5 s (≤12
  req/min). Unselected rows show state from the list refresh, not per-row
  stats — so 100 servers cost the same as 1.
- Worst case (focused, one server selected) ≈ 18 req/min — 15% of budget,
  leaving headroom for auth refresh and user actions.
- Power actions use `POST /power` (authoritative `{accepted}`), never the WS
  `set state`. Optimistic UI shows the transition immediately and reconciles
  against the next list refresh; if unconfirmed after 30 s the UI says so
  rather than lying. Once Phase 3 opens a console socket for a server, its WS
  `stats`/`power` frames supersede polling for that server.

## D-002 (2026-07-13): Recon method

Live recon with credentials wasn't possible (none supplied); instead: 8-agent source recon over `ReFxHosting` @ ce9b32f (== public origin/main) + both mobile apps, adversarially cross-checked, plus unauthenticated live probes of production (`/health`, error/envelope/rate-limit headers, Engine.IO handshake) which matched source exactly. Confidence on the three perilous contracts (envelope, auth/refresh, console handshake): HIGH. Remaining live-verification items are listed at the end of [api-surface.md](api-surface.md).
