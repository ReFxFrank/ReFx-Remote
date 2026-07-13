# ReFx backend — real API surface (Phase 0 recon)

**Date:** 2026-07-13.
**Verdict first:** the backend is **NOT Pterodactyl** and never was. It is ReFx's own platform — NestJS `panel-api` + Next.js web + custom Go node-agent — live in production. The build brief's Appendix A (Pterodactyl Client API), Appendix B (Wings WS protocol), §2.3 auth design (paste a `ptlc_` key), and Appendix C (panel-side pairing for Pterodactyl) **do not apply**. This document replaces them.

Evidence tags used below:

- **[LIVE]** — observed against production `https://api.refx.gg` on 2026-07-13. Initially unauthenticated probes; later the same day an authenticated pass ran with the test account (login → me → servers → notifications → sessions → refresh → error-shape → logout): every contract below marked [LIVE-AUTH] was confirmed verbatim. Prod `expiresIn` is **900 s** (15 min access TTL). Refresh rotation confirmed (new token differs each time). `GET /account/notifications` returns a plain `data: []` array with no `meta`. A custom User-Agent shows verbatim in `GET /account/sessions`. The flat error shape confirmed with a garbage token. The test account has **no server yet**, so console/WS and server-scoped endpoints remain source-verified only.
- **[SOURCE]** — mined from `ReFxHosting` @ `ce9b32f` (local clone in sync with public `https://github.com/ReFxFrank/ReFxHosting` `origin/main`), including its e2e tests. Everything load-bearing was adversarially cross-checked; see [recon/parity-cross-check.md](recon/parity-cross-check.md).

Full per-domain endpoint inventory with DTOs and permission strings: [recon/panel-api.md](recon/panel-api.md). Realtime protocol in full: [recon/realtime-protocol.md](recon/realtime-protocol.md). Gaps and risks: [recon/gaps-and-risks.md](recon/gaps-and-risks.md).

---

## 1. Identity and hosts

| Thing | Value | Evidence |
|---|---|---|
| Web panel + storefront | `https://refx.gg` (also `www.refx.gg`) | [LIVE] 200, Next.js behind Caddy/Cloudflare; [SOURCE] `.env.production.example` |
| API origin | `https://api.refx.gg` | [LIVE]; [SOURCE] baked into both mobile apps as the default origin |
| REST base | `https://api.refx.gg/api/v1` (global prefix `api/v1`) | [LIVE] 401 on `/api/v1/servers`; [SOURCE] `main.ts:141` |
| Health | `GET https://api.refx.gg/health` — **root, not under the prefix** (`/api/v1/health` is 404) | [LIVE] `{"success":true,"data":{"status":"ok","uptime":…,"checks":{"database":"up"}}}` |
| Realtime | Socket.IO v4 at engine path `/socket.io` (default), namespace `/ws/console`, same origin | [LIVE] Engine.IO handshake OK (`pingInterval` 25000, `pingTimeout` 20000, upgrade `websocket`); [SOURCE] `console.gateway.ts:28` |
| `panel.refx.gg` | **does not resolve** — the brief's assumed hostname is wrong | [LIVE] NXDOMAIN |
| Big-file transfer | SFTP on the game node, port `2022` (`GET /servers/:id/sftp` for host/user; `POST /servers/:id/sftp/rotate` shows a password once) | [SOURCE] |

## 2. Global conventions

- **Success envelope** `{ "success": true, "data": <payload> }`; paginated responses spread a meta block: `{ "success": true, "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`. `null`/`undefined` handler returns pass through unwrapped; 204s have no body. [LIVE for `/health`; SOURCE `transform.interceptor.ts`]
- **Pagination params** `page` (default 1), `pageSize` (default 25, max 100), optional free-text `q`.
- **Error shape** — flat, always: `{ "statusCode", "error", "message", "path", "timestamp" }` where `message` is a string **or string array** (validation). [LIVE] e.g. `{"statusCode":401,"error":"UnauthorizedException","message":"Unauthorized","path":"/api/v1/servers","timestamp":"…"}`. There is **no** `{ success:false, error:{…} }` error envelope — the Android client parses one and consequently never shows real server messages. Do not copy.
- **The global exception filter drops interceptor-added fields.** The password-change interceptor *throws* `{ statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED', … }`, but the filter rebuilds the body as `{ statusCode: 403, error: "ForbiddenException", message: "Password change required", … }` — no `code` on the wire. Detect by status + message (the web client's `code` check is equally dead — don't copy it). Similarly, validation 400s carry `error: "Bad Request"` (Nest's exception name), not a SCREAMING_SNAKE code.
- **Login 401s carry meaning in `message`:** `"Invalid credentials"`, but also `"Account banned"` / `"Account suspended"` for *correct* credentials — surface the message, don't blanket-map 401→"wrong password".
- **Validation** — `whitelist: true, forbidNonWhitelisted: true`: an unknown body field is a 400, not ignored.
- **Rate limits** — global 120 req / 60 s per IP. [LIVE] headers observed: `X-Ratelimit-Limit: 120`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset` (seconds). Tighter per-route: login 10/min, `mfa/verify` 5/min, register 5/min, `status/nodes` 30/min/token. Exact 429 header set unverified (needs one live 429 — don't provoke it on prod; use the local compose stack).
- **Design consequence:** REST-polling stats for many servers will starve the 120/min budget (10 servers @ 5 s = the whole budget). Live stats must come from the websocket, which has no HTTP throttle.

## 3. Auth — how a desktop app signs in

There is **no** Pterodactyl-style paste-a-key flow, no OAuth, no device flow anywhere. Two real credential types exist, with **disjoint capabilities**:

### 3a. JWT session (what the mobile apps use — required for console)

- `POST /api/v1/auth/login` `{ email, password, totp?, rememberMe? }` → `{ accessToken, refreshToken, expiresIn }`.
- **MFA landmine:** when MFA is required the response is `{ accessToken: "", refreshToken: "", expiresIn: 0, mfaRequired: true, mfaToken, methods: ["totp"|"recovery"|"webauthn"] }` — **empty strings, not nulls**. Detect via `mfaRequired`/`mfaToken`. (The Android app keys off null tokens and MFA users cannot log in on Android — real shipped bug.) Complete with `POST /auth/mfa/verify` `{ mfaToken, code, method? }` (mfaToken TTL 300 s).
- **Access token:** ~1 h (code default 3600 s; prod env may still be 900 s — both values seen). Claims `{ sub, email, role, type:"access" }`.
- **Refresh:** `POST /api/v1/auth/refresh` `{ refreshToken }` (public route, no auth header) → new `{ accessToken, refreshToken, expiresIn }`. Rotating; **sliding TTL** — every rotation issues a fresh 30-day (90-day with `rememberMe: true`) expiry, so an active install effectively never re-logs-in.
- **Rotation hazard:** reusing an already-rotated refresh token outside a ~60 s grace window is treated as theft and **revokes every session the user has, on all devices**. The desktop client must persist the new refresh token atomically *before* using it, and single-flight refreshes (one at a time, ever).
- `POST /auth/logout` `{ refreshToken }` → 204. Sessions are listable/revocable: `GET /account/sessions` (fields `{ id, ip, userAgent, createdAt, expiresAt }`), `DELETE /account/sessions/:id` — send a distinctive User-Agent so the entry is recognizable.
- WebAuthn/passkey login routes exist (`POST /auth/mfa/webauthn/login/options|verify`) but RP ID is `refx.gg` — desktop passkey support is a v2 question.

### 3b. Scoped API keys (`refx_…`) — REST only, no console

- Minted at Account → API keys (`POST /api/v1/account/api-keys`, returns plaintext in the **`token`** field; the parallel `POST /auth/api-keys` returns it as **`key`** — different by design, both real).
- Format `refx_<8-char-prefix><secret>`, SHA-256 hashed at rest, scopes `READ` / `WRITE` / `ADMIN` / `STATUS_READ`, optional IP allowlist, optional expiry.
- Authenticate via **`X-Api-Key: <token>`** header on normal routes (a `refx_` key as `Authorization: Bearer` fails JWT verification everywhere except `GET /status/nodes`). WRITE scope can drive every mutating REST endpoint (power, command, files, backups) with the owner's full RBAC.
- **Hard limit:** the console websocket handshake verifies **only an access JWT**. An API-key-only client has no live console, no live stats, no realtime power events. So API keys are a "monitor/automation mode" credential, not the primary desktop auth.

## 4. Live console / realtime (Socket.IO, not Wings)

Full detail: [recon/realtime-protocol.md](recon/realtime-protocol.md).

- Connect: Socket.IO v4, `https://api.refx.gg`, namespace **`/ws/console`**, default path `/socket.io`, transports websocket+polling. Auth = the ordinary access JWT placed in the CONNECT payload `auth: { token }` (an `Authorization: Bearer` handshake header also works; mobile sends both — that's all "dual-bearer" means). **No separate console-token endpoint exists.**
- CORS on the gateway is `origin: true` (reflects anything) — a Tauri/native client with any or no Origin is accepted. [LIVE] the Engine.IO handshake answered curl with no Origin header. **The brief's Wings-origin rationale for Rust-side networking is obsolete** (the security rationale still stands).
- Auth failures arrive as a normal `connect` followed by `error {message:"unauthorized"}` + disconnect — not `connect_error`. Non-ACTIVE or must-change-password users are rejected at handshake.
- Client→server events: `subscribe { serverId }` (ack: `subscribed { serverId }`; joins room; SUSPENDED servers are forbidden for tenants) and `command { command }`.
- Server→client events (complete list): `subscribed`, `error {message}`, `console { type:'console', line, stream:'stdout'|'install', at:<unixMillis> }`, `stats { serverId, cpuPct, memUsedMb, diskUsedMb, netRxBytes, netTxBytes, state }` (every ~5 s; **no memLimit/uptime/players on the wire**), `power { type:'power', state }` (e.g. `RUNNING`/`OFFLINE`/`CRASHED`).
- **No scrollback is sent on connect** and no console-history REST endpoint exists. Web/Android keep a client-side 2000-line FIFO. The desktop app must keep its own ring buffer (the brief's 5000-line Rust-side buffer design still applies — it's now *more* important, not less).
- **No token-expiry events, no in-socket re-auth.** The token is checked only at handshake; a live socket outlives its token until the transport drops. On reconnect with a stale token: refresh once via REST, open a **new** socket. `forbidden` is terminal — don't retry it.
- **Multi-server quirk:** `command` targets the **last-subscribed** server on that socket (single scalar, no `unsubscribe` event exists). Use **one socket per open server**.
- Install / reinstall / **switch-game** progress arrives on the same `console` event with `stream:"install"`. **Backup progress and file-op progress have no realtime channel** — poll REST.
- Power is **REST-only**: `POST /api/v1/servers/:id/power` `{ signal: "start"|"stop"|"restart"|"kill" }` (the web client emits a `power` WS event that has no gateway handler — dead code, don't copy).
- Permission quirk: the WS `command` event checks the literal string `control.console`, which isn't in the grantable permission catalog (`console.command` is). Owners/admins are unaffected; sub-users must send commands via REST `POST /servers/:id/command`.

## 5. Desktop-relevant REST map (condensed)

All under `/api/v1`, Bearer access-JWT (or `X-Api-Key`), `{success,data}` envelope. Full inventory with DTOs: [recon/panel-api.md](recon/panel-api.md).

| Domain | Endpoints (abridged) |
|---|---|
| Servers | `GET /servers` (paginated), `GET /servers/:id`, `POST /servers/:id/power`, `POST /servers/:id/command`, `POST /servers/:id/reinstall`, `POST /servers/:id/switch-game`. **No rename route exists** (web calls `PATCH /servers/:id` and would 404). |
| Stats | `GET /servers/:id/stats` (richer than WS: adds `memTotalMb`, `players?`, `uptimeMs?`), `GET /servers/:id/stats/history?range=1h\|6h\|24h\|7d\|30d`. **`netRxBytes`/`netTxBytes` are cumulative lifetime counters** (the node-agent sums Docker Rx/Tx totals with no delta — verified in `apps/node-agent/internal/runtime/docker.go`), NOT a rate. Compute throughput client-side from consecutive samples and clamp counter resets (server restart zeroes them). |
| Variables/startup | `GET /servers/:id/variables`, `PUT /servers/:id/variables/:envName` `{ value }` (NOT the Android `PATCH …/variables` — that 404s), `PATCH /servers/:id/startup`, `PATCH /servers/:id/auto-restart` |
| Files | `GET /servers/:id/files?path=`, contents read/write, rename, delete, compress/decompress, mkdir; `POST /servers/:id/files/upload` raw body **≤ 32 MiB hard cap** ("Use SFTP for larger files"); `GET …/files/download-url` → **relative** signed URL — resolve as `apiOrigin + "/api/v1" + url` (Range-resumable, ~300 s TTL). **Ignore `POST …/files/upload-url`** — it returns a node-agent-internal path a client can't sign. |
| Backups | `GET/POST /servers/:id/backups` (`{name, mode?, ignoredFiles?}`), restore, `DELETE`, lock/unlock, `GET …/:backupId/download` → absolute S3 presigned URL **or** relative relay (same resolution rule). 25-backup cap: manual create hard-fails at cap; only scheduled backups rotate. Progress via polling (`progressPct` on the row), not WS. |
| Databases | `GET/POST/DELETE /servers/:id/databases`, password rotation; clean "unavailable" error when no DB host is configured |
| Schedules | `GET/POST /servers/:serverId/schedules`, `PATCH/DELETE …/:scheduleId`, `POST /servers/:id/schedules/:scheduleId/run` |
| Sub-users | `GET/POST/PATCH/DELETE /servers/:serverId/sub-users…` — note two controllers register overlapping routes with different permission strings (`subuser.*` vs `user.*`); treat behavior as unconfirmed until tested live |
| SFTP | `GET /servers/:id/sftp` → `{host, port, username}`; `POST /servers/:id/sftp/rotate` → one-time password |
| Account | `GET /auth/me` (profile + admin perms), `GET/POST/DELETE /account/api-keys`, `GET/DELETE /account/sessions`, notifications (below) |
| Game-specific | Minecraft version/loader (`PATCH /servers/:id/minecraft…`), Modrinth mods/modpacks search+install, workshop, voice — see inventory |
| Public | `GET /status`, `GET /status/live`, `GET /status/nodes` (STATUS_READ token), `GET /catalog/games…` (storefront) |

Per-server permission strings live in `ReFxHosting/packages/shared/src/permissions.ts` (wildcards like `files.*` honored). Owners have everything; sub-users carry a permission array; staff support-override exists panel-side. Gate UI on these but always handle 403 as backstop (brief guardrail unchanged).

## 6. Notifications / crash detection — what exists for desktop

- **No desktop push channel exists.** `POST /account/push-tokens` hard-rejects any platform except `ios`/`android`, and only APNs (iOS) is actually delivered today.
- Server state transitions generate: (a) an **in-app notification for the owner only**, only for `CRASHED` and `SUSPENDED`, throttled to one per server+state per 30 min; (b) push (`RUNNING`/`OFFLINE`/`CRASHED`) to iOS only.
- Notification REST: `GET /account/notifications` (**plain array**, not enveloped-paginated), `GET /account/notifications/unread-count`, `POST …/:id/read`, `POST …/read-all`, `DELETE …/:id`, `DELETE /account/notifications`.
- **Best desktop crash detection:** keep per-server sockets subscribed (tray mode) and watch `power` events — real-time and works for sub-users too. Track user-initiated stop intent locally to avoid false crash toasts (brief §9 logic unchanged). Fallback when sockets are down: poll `unread-count` / server state at a respectful cadence.

## 7. Landmines — verified client-vs-server mismatches (do NOT copy from the mobile apps)

The Android app ships four real bugs against this backend; the iOS app is the cleaner reference. Details: [recon/parity-cross-check.md](recon/parity-cross-check.md).

1. **MFA detection** — panel sends empty-string tokens + `mfaRequired: true`; Android checks for nulls → MFA users can't sign in on Android. Key off `mfaRequired`.
2. **Variable update** — correct contract is `PUT /servers/:serverId/variables/:envName` `{ value }`; Android's `PATCH /servers/{id}/variables` 404s.
3. **API-key mint field** — `/account/api-keys` returns plaintext as `token`; `/auth/api-keys` returns `key`. Android reads `key` from the `token` endpoint → decode failure.
4. **Signed URLs are relative** — resolve non-`https?://` URLs as `apiOrigin + "/api/v1" + url`; Android's https-only opener makes its file downloads always fail.
5. **Error envelope** — parse the flat error shape (§2); Android's `{success:false,error:{…}}` parser never matches, so users only ever see generic fallback messages.

## 8. Still needs live verification

Resolved 2026-07-13 with the test account [LIVE-AUTH]:

- ~~Production `JWT_ACCESS_TTL`~~ → **900 s** (login and refresh both return `expiresIn: 900`).
- ~~`GET /account/notifications` shape~~ → plain array, no `meta` block.
- ~~Sessions wire shape / UA rendering~~ → `{ id, ip, userAgent, createdAt, expiresAt }`, custom UA rendered verbatim.
- ~~Refresh rotation~~ → confirmed rotating; `POST /auth/logout` → 204.
- Per-route throttle headers confirmed: login responds with `X-Ratelimit-Limit: 10 / Reset: 60` (route-level override of the global 120).

Still open (needs a server attached to the test account, or the local compose stack):

- WS `/ws/console` handshake + `subscribe`/`console`/`stats`/`power` events against a real running server (confirm stats field set; `players` absent today).
- Which of the duplicate sub-user controllers wins at runtime.
- Exact 429 response headers from `@nestjs/throttler` v6 (test against the local stack, not prod).
- SFTP password scoping (per-server vs per-user) — rotating from desktop may break the user's saved FileZilla credentials; check before shipping a "rotate" button.
