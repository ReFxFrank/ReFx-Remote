# Live console / Socket.IO realtime protocol

> Recon agent output, 2026-07-13. Source-grounded; file paths cited are relative to the named repo.

## Summary

The live console is a Socket.IO v4 gateway in panel-api at namespace "/ws/console" (default engine path /socket.io on port :4000), declared in apps/panel-api/src/agent/console.gateway.ts with `cors: { origin: true }` (any Origin accepted, so a Tauri client is fine at the WS layer). Auth is a single panel access-JWT that the Android app sends in two places at once — the Socket.IO CONNECT `auth: { token }` payload AND an `Authorization: Bearer` handshake header — which is all "dual-bearer" means; the gateway accepts either. Client→server events are `subscribe {serverId}` and `command {command}`; server→client events are `subscribed`, `console`, `stats`, `power`, and `error`. There is no server-side scrollback, no token-expiry warning, and no in-socket re-auth — clients keep their own FIFO buffer (2000 lines in both web and Android) and reconnect with a refreshed token after an `unauthorized` error. Console/stats/power data originates on the Go node-agent and reaches the gateway via HMAC-signed REST callbacks (POST /api/v1/agent/logs|stats|power-event), not the WS protocol in packages/shared/src/protocol.ts — that envelope protocol is only spoken on the agent's own (currently dormant, panel never mints its ticket) direct WS endpoint GET /ws/servers/{id}.

## Key facts

- Socket.IO gateway: namespace "/ws/console", default engine path /socket.io, on panel-api HTTP server port 4000 — apps/panel-api/src/agent/console.gateway.ts line 28: @WebSocketGateway({ namespace: "/ws/console", cors: { origin: true } }); Socket.IO v4 (@nestjs/platform-socket.io ^11.1.27).
- "Dual-bearer handshake" = ONE panel access JWT sent in TWO places: Socket.IO CONNECT auth payload { token } AND handshake header Authorization: Bearer <token>; the gateway reads auth.token first, header as fallback (console.gateway.ts lines 46-51; Android ConsoleSocket.kt lines 104-105).
- Handshake auth also re-checks the DB: user must be ACTIVE, not deleted, and not mustChangePassword; failure emits error {message:"unauthorized"} then disconnect(true) — it is a post-connect error event, not connect_error.
- Client→server events: subscribe {serverId} (joins room server:<id>, ack subscribed {serverId}) and command {command}; the web client's power emit has NO gateway handler — power is REST POST /api/v1/servers/:serverId/power {signal:"start"|"stop"|"restart"|"kill"}.
- Server→client events (complete list): subscribed, error {message}, console {type:'console', line, stream:'stdout'|'install', at:unixMillis}, stats (StatSample verbatim), power {type:'power', state}.
- WS stats frame fields actually sent by the Go agent every 5s: serverId, cpuPct, memUsedMb, diskUsedMb, netRxBytes, netTxBytes, state — NO memLimitMb, NO uptime, NO players (players?: declared panel-side but never sent).
- Richer stats via REST: GET /api/v1/servers/:id/stats returns LiveStats { state, cpuPct, memUsedMb, memTotalMb, diskUsedMb, netRxBytes, netTxBytes, players?, uptimeMs? }; GET /api/v1/servers/:id/stats/history?range=1h|6h|24h|7d|30d returns up to 5000 ServerStat rows.
- NO scrollback from the server on connect/subscribe and no console-history REST endpoint; web and Android both keep a client-side 2000-line FIFO (web persists to sessionStorage key refx.console.<serverId>). The agent primes docker logs --tail 250 only when it (re)attaches a console (server start / agent boot).
- Install, reinstall, and switch-game progress arrive on the SAME console event with stream:"install" (agent forwardInstall → POST /api/v1/agent/logs). Backup progress is DB-only (poll via REST); file ops have no realtime channel.
- Token lifetime: access JWT default 3600s (JWT_ACCESS_TTL), refresh 30d (JWT_REFRESH_TTL 2592000). Access claims: { sub, email, role, type:"access" }. No expiry warning is emitted and no in-socket re-auth exists; the token is only checked at handshake, so a live socket outlives expiry until reconnect, then gets error "unauthorized".
- Expiry convention (Android parity): on unauthorized, refresh ONCE via POST /api/v1/auth/refresh {refreshToken} → {accessToken, refreshToken, expiresIn}, tear down, open a NEW socket; second failure = session expired. forbidden is terminal. Reconnect: infinite, 2s→15s backoff.
- CORS: gateway reflects ANY origin (cors:{origin:true}) — tauri://localhost or missing Origin is accepted on the WS handshake. HTTP API CORS is CORS_ORIGINS env (default http://localhost:3000, wildcard refused in prod) — irrelevant to native HTTP clients, relevant only to webview fetches.
- Permission-string mismatch: WS command event checks "control.console" (console.gateway.ts line 110) while REST POST /servers/:id/command checks "console.command" — and packages/shared/src/permissions.ts only defines console.command (no control.console). Sub-users can hit REST but not WS commands; owners/admins unaffected.
- packages/shared/src/protocol.ts envelope {type, payload} with MessageType strings 'auth','auth.ok','auth.error','console.output','console.command','install.output','power.command','power.event','stats.subscribe','stats' describes the agent's OWN WS endpoint GET /ws/servers/{id} (first-frame auth JWT HMAC-signed with the node signingKey), which the panel never issues tickets for — dormant; desktop clients must use the panel Socket.IO gateway.
- Agent→panel feed is HMAC-signed REST (headers X-Refx-Node/X-Refx-Timestamp/X-Refx-Signature): POST /api/v1/agent/logs {lines:[{serverId,line,stream,at}]}, /agent/stats {stats:[...]}, /agent/power-event {serverId,state}, /agent/backup-progress; the panel fans these into the Socket.IO rooms.
- No throttling on the WS gateway or its command event; global ThrottlerGuard (60s/120 req default, Redis) covers HTTP only, and agent callbacks are @SkipThrottle.

## Findings

All paths relative to `C:\Users\frank\OneDrive\Desktop\ReFx-Products\ReFxHosting` unless prefixed `[Android]` (= `C:\Users\frank\OneDrive\Desktop\ReFx-Products\ReFxAndroid`).

## 1. The gateway: location, namespace, transports

`apps/panel-api/src/agent/console.gateway.ts` line 28:

```ts
@WebSocketGateway({ namespace: "/ws/console", cors: { origin: true } })
export class ConsoleGateway implements OnGatewayConnection, OnGatewayDisconnect
```

- **Namespace**: `/ws/console`. **Engine path**: default `/socket.io` — no `path` option, and `apps/panel-api/src/main.ts` installs no custom WebSocket adapter (no `useWebSocketAdapter` call anywhere in main.ts), so Nest's default socket.io adapter attaches to the same HTTP server the API listens on.
- **Port**: panel-api listens on `PORT` default **4000** (`apps/panel-api/src/config/configuration.ts` line 103: `port: toInt(process.env.PORT, 4000)`); global HTTP prefix is `api/v1` (line 104) but the Socket.IO endpoint is NOT under the prefix — clients connect to `<origin>/ws/console` (web client: `io(\`${API_URL}/ws/console\`, ...)` with `API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"`, `apps/web/lib/api.ts` lines 95-97).
- **Socket.IO version**: server dep `"@nestjs/platform-socket.io": "^11.1.27"` (`apps/panel-api/package.json`) → Socket.IO v4 / Engine.IO protocol 4 (`EIO=4`).
- **Transports**: server side uses socket.io defaults (both polling and websocket; nothing restricts them). Web client passes `transports: ["websocket", "polling"]` (`apps/web/lib/ws.ts` line 73); Android identically `transports = arrayOf("websocket", "polling")` ([Android] `app/src/main/java/gg/refx/android/core/realtime/ConsoleSocket.kt` line 102).

## 2. The "dual-bearer" handshake — exactly two placements of ONE token

There is only one token involved: the **panel access JWT**. "Dual-bearer" (Android's term) means the client sends that same token in **two redundant locations** so either transport path authenticates:

[Android] `ConsoleSocket.kt` lines 44-45 (doc) and 104-105 (code):
```kotlin
 * - Bearer is passed **two ways**: the `Authorization` handshake header AND the
 *   CONNECT auth payload `{ token }`.
...
auth = mapOf("token" to token)
extraHeaders = mapOf("Authorization" to listOf("Bearer $token"))
```

Panel side accepts either, auth-payload first (`console.gateway.ts` lines 46-51):
```ts
const token =
  (client.handshake.auth?.token as string) ||
  (client.handshake.headers?.authorization as string)?.replace(/^Bearer /, "");
```

Verification (lines 52-67): `jwt.verifyAsync(token, { secret })` against `jwt.accessSecret` (`JWT_ACCESS_SECRET`), then a **live DB re-check**: user must exist, `deletedAt: null`, `state === "ACTIVE"`, and `!mustChangePassword` — otherwise rejected. On any failure the gateway **emits `error` `{ message: "unauthorized" }` and calls `client.disconnect(true)`** (lines 70-71). Note this happens *after* a successful Socket.IO connect (there is no namespace middleware), so a rejected client sees a normal `connect` followed by `error` + `disconnect`, not `connect_error`. The web client (`apps/web/lib/ws.ts` line 72) sends only `auth: { token: tokens?.accessToken }` — the header is optional.

Access JWT claims, from `apps/panel-api/src/auth/auth.service.ts` lines 329-337:
```ts
const accessToken = await this.jwt.signAsync(
  { sub: user.id, email: user.email, role: user.globalRole, type: "access" },
  { secret: jwtCfg.accessSecret, expiresIn: jwtCfg.accessTtl },
);
```

## 3. Event surface (Socket.IO event names + payloads)

### Client → server
| Event | Payload | Handler / permission |
|---|---|---|
| `subscribe` | `{ serverId: string }` | `console.gateway.ts` line 80. Joins room `server:${serverId}` (line 173-175), sets `client.data.serverId`, replies `subscribed`. Access: ADMIN/OWNER role always; server owner; else active SubUser (any permission). A `SUSPENDED` server is forbidden to tenants (lines 139-163). |
| `command` | `{ command: string }` | line 99. Requires prior subscribe (uses `client.data.serverId` — the **last** subscribed id). Permission for sub-users: **`"control.console"`** (line 110). Forwards to the agent over signed REST `POST /api/v1/servers/{id}/command` (`agent.client.ts` lines 230-234). |
| `power` | `{ signal }` | **Emitted by the web client (`ws.ts` line 118-120) but there is NO `@SubscribeMessage("power")` on the gateway — it is a dead emit.** Power is REST-only: `POST /api/v1/servers/:serverId/power` body `{ signal: "start"|"stop"|"restart"|"kill" }` (`servers.controller.ts` lines 151-160, `PowerActionDto` in `servers/dto/server.dto.ts` lines 58-62), permission `control.power`. |

### Server → client
| Event | Payload (verbatim construction) | Source |
|---|---|---|
| `subscribed` | `{ serverId }` | gateway line 96 |
| `error` | `{ message: "unauthorized" }` (bad token) / `{ message: "forbidden" }` (no access / suspended / missing permission) | lines 70, 91, 113 |
| `console` | `{ type: 'console', line: string, stream: line.stream ?? 'stdout', at: number }` — `at` is unix **milliseconds** (agent sets `At: time.Now().UnixMilli()`) | fan-out in `agent-callbacks.controller.ts` lines 276-284; agent origin `apps/node-agent/internal/api/handlers_lifecycle.go` lines 284-289 |
| `stats` | The agent's `StatSample` relayed **verbatim**: `{ serverId, cpuPct, memUsedMb, diskUsedMb, netRxBytes, netTxBytes, state }` (see §6 for what's actually populated) | `agent-callbacks.controller.ts` line 258 `this.console.emitStats(s.serverId, s)` |
| `power` | `{ type: 'power', state: string }` — state is the agent's string (e.g. RUNNING/OFFLINE/CRASHED, uppercased against Prisma `ServerState`) | lines 300-304 |

**Console stream values**: `"stdout"` (live console forward), `"install"` (install / reinstall / **switch-game** progress — `forwardInstall` pushes to the panel with `Stream: "install"`, `handlers_lifecycle.go` lines 140-145), and the Go doc comment also names `"system"` (`internal/panel/client.go` line 237: `Stream string \`json:"stream"\` // "stdout" | "install" | "system"`) though no current sender uses "system". Android renders `stream == "stderr"` as error styling ([Android] ConsoleSocket.kt line 25) — the panel's `?? 'stdout'` default means stderr would only appear if the agent sent it (it currently doesn't; docker stdout/stderr are merged by `splitConsoleLines`).

**Install/switch-game progress therefore arrives on the same `console` event with `stream: "install"`. Backup progress is NOT emitted over WS at all** — `POST /agent/backup-progress` only updates the `Backup` row (`state`, `progressPct` 0-100 converted from the agent's 0-1 `progress` fraction, `sizeBytes`, `checksum`, `error`, `location`, `storage`) (`agent-callbacks.controller.ts` lines 307-347); clients must poll backups via REST. **File-operation progress has no realtime channel either** — file ops are synchronous signed REST relays (`agent.client.ts` §files). The only WS events a desktop client will ever receive are: `subscribed`, `error`, `console`, `stats`, `power` (the complete list of `.emit(` calls in panel-api src, verified by grep).

## 4. Scrollback behavior

**The gateway sends NO scrollback on connect or subscribe** — `subscribe` only joins the room and acks. There is no console-history REST endpoint in `servers.controller.ts` (the only console-adjacent route is one-shot `POST :id/command`). Both existing clients keep purely client-side buffers:
- Web: `apps/web/lib/console-hub.ts` — `MAX_LINES = 2000` FIFO, persisted to `sessionStorage` under key `` `refx.console.${serverId}` `` and replayed on remount; one shared socket per server, closed after `IDLE_CLOSE_MS = 5 * 60 * 1000` with no subscribers.
- Android: `MAX_LINES = 2000` FIFO, starts empty ([Android] ConsoleSocket.kt line 257).

Incidental history does exist upstream: when the agent (re)attaches a server's console (on `start`/`restart` power actions and on agent boot via `StartRunningForwarders`, `handlers_lifecycle.go` lines 196-201, 210-216), `AttachConsole` primes the stream with `docker logs --tail 250` before the live attach (`apps/node-agent/internal/runtime/docker.go` lines 762-789: `Tail: "250"` — "prime the stream with the container's recent log history (tail)"). Those 250 lines flow through `/agent/logs` to whoever is in the room **at that moment only** — a client connecting later gets nothing.

## 5. Token lifetime, expiry, refresh

`apps/panel-api/src/config/configuration.ts` lines 123-135:
```ts
accessTtl: toInt(process.env.JWT_ACCESS_TTL, 3600),     // 1h default ("was 15m")
refreshTtl: toInt(process.env.JWT_REFRESH_TTL, 2592000), // 30 days
```
- The token is verified **once, at the Socket.IO handshake**. There is no expiry timer, no "expiring soon" emission, and no in-band re-auth message (the gateway's only `@SubscribeMessage` handlers are `subscribe` and `command`). A connected socket **outlives its token's expiry** until the transport drops.
- On any (auto-)reconnect the handshake re-runs; an expired token then yields `error {message:"unauthorized"}` + server-side disconnect.
- Client convention (Android, "refresh-on-unauth", ConsoleSocket.kt lines 173-219): on an `error` containing "unauthorized" (or a transport error containing "unauthorized"/"401"), refresh **once** via the REST refresh endpoint, then tear down and open a **new** socket with the fresh token; a second failure → terminal "Session expired". A `forbidden` error is terminal (stops reconnection). Reconnect policy: infinite attempts, 2s → 15s backoff (`reconnectionDelay = 2_000`, `reconnectionDelayMax = 15_000`).
- Refresh endpoint: `POST /api/v1/auth/refresh` body `{ refreshToken }` (`apps/panel-api/src/auth/auth.controller.ts` lines 170-179, `@Public()`), returns `TokenResponseDto { accessToken, refreshToken, expiresIn, mfaRequired?, mfaToken?, ... }` (`auth/dto/auth.dto.ts` lines 231-256). Refresh tokens rotate (sessions table, `sid` claim).

## 6. Stats: what a desktop client actually gets

**Over the WS `stats` event** — the relayed `StatSample` (`agent-callbacks.controller.ts` lines 77-86 interface; Go sender `apps/node-agent/internal/panel/client.go` lines 218-226 `ServerStat`):
```go
type ServerStat struct {
    ServerID   string  `json:"serverId"`
    CPUPct     float64 `json:"cpuPct"`
    MemUsedMB  int64   `json:"memUsedMb"`
    DiskUsedMB int64   `json:"diskUsedMb"`
    NetRxBytes int64   `json:"netRxBytes"`
    NetTxBytes int64   `json:"netTxBytes"`
    State      string  `json:"state"`
}
```
The panel's `StatSample` interface also declares `players?: number | null`, but the Go agent never sends it, so it is absent on the wire. **No `memLimitMb`, no `diskLimitMb`, no uptime in WS stats frames** (the web `mapStats` defaults those to 0 — `apps/web/lib/ws.ts` lines 45-57). Cadence: agent pushes a batch every **5 s** default (`apps/node-agent/internal/stats/stats.go` line 50 `StatInterval = 5 * time.Second`). The `state` field rides in every sample, and both web and Android use it to keep the status badge live.

**Over REST** (richer): `GET /api/v1/servers/:id/stats` (`apps/panel-api/src/stats/stats.controller.ts` lines 15-19, permission `server.read`) proxies live to the agent and returns `LiveStats` (`agent.client.ts` lines 94-104):
```ts
export interface LiveStats {
  state: string; cpuPct: number; memUsedMb: number; memTotalMb: number;
  diskUsedMb: number; netRxBytes: number; netTxBytes: number;
  players?: number | null; uptimeMs?: number;
}
```
History: `GET /api/v1/servers/:id/stats/history?range=1h|6h|24h|7d|30d` → newest 5000 `ServerStat` rows chronological (`stats.service.ts` lines 7-13, 40-52). Node-level heartbeats (every 15 s: cpuPct, memUsedMb, diskUsedMb, netRxBytes, netTxBytes, containers, agentVersion) exist but are admin/node telemetry, not per-server.

## 7. Origin/CORS on the upgrade — desktop-client viability

- **Gateway**: `cors: { origin: true }` (`console.gateway.ts` line 28) — the socket.io CORS layer **reflects any Origin** on the polling/upgrade handshake. A `tauri://localhost` origin, an `http://tauri.localhost` origin, or **no Origin header at all** (native socket client) will not be rejected. There is no other origin validation on the WS path.
- **HTTP API**: `app.enableCors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true })` (`main.ts` lines 136-139) with `corsOrigins: toList(process.env.CORS_ORIGINS) || ["http://localhost:3000"]` (`configuration.ts` line 113). Production preflight refuses `"*"` and warns/aborts on misconfig (`config/preflight.ts` lines 107-121). CORS only gates browser-engine fetches: a Tauri app calling the REST API through the Rust HTTP plugin (or any non-browser client) is unaffected; a fetch from the Tauri **webview** would need the deployment's `CORS_ORIGINS` to include the Tauri origin. The API also runs helmet (CSP disabled) and `trust proxy` = 1 hop.
- **Throttling**: `ThrottlerGuard` is a global `APP_GUARD` (`app.module.ts` line 157; defaults `THROTTLE_TTL=60`, `THROTTLE_LIMIT=120`, Redis-backed) for HTTP; the gateway declares no guard/throttle of its own and no rate limit is visible on `command` events. Agent callbacks are `@SkipThrottle()`.

## 8. Panel ↔ node-agent protocol (packages/shared) and the dormant direct-WS path

`packages/shared/src/protocol.ts` defines the JSON envelope `{ "type": <MessageType>, "payload": <object> }` with:
```ts
export const MessageType = {
  AUTH: 'auth', AUTH_OK: 'auth.ok', AUTH_ERROR: 'auth.error',
  CONSOLE_OUTPUT: 'console.output', CONSOLE_COMMAND: 'console.command',
  INSTALL_OUTPUT: 'install.output',
  POWER_COMMAND: 'power.command', POWER_EVENT: 'power.event',
  STATS_SUBSCRIBE: 'stats.subscribe', STATS: 'stats',
} as const;
```
Payload types: `AuthPayload { ticket, serverId }` ("Short-lived ticket issued by the panel for this server/connection"), `ConsoleOutputPayload { line, stream: 'stdout'|'stderr', ts }`, `ConsoleCommandPayload { command }`, `PowerCommandPayload { action: 'start'|'stop'|'restart'|'kill' }`, `PowerEventPayload { state }`, and `ResourceStats { cpuPct, memUsedMb, memLimitMb, diskUsedMb, netRxBytes, netTxBytes, players?, uptimeSec? }`.

**Reality check — this protocol is NOT what browser/desktop clients speak.** The actual data path is: agent → panel via HMAC-signed REST callbacks (`X-Refx-Node` / `X-Refx-Timestamp` / `X-Refx-Signature` headers; routes `POST /api/v1/agent/register|heartbeat|stats|logs|power-event|backup-progress`, `GET /api/v1/agent/servers|backup-storage` — `agent-callbacks.controller.ts`), and panel → clients via the Socket.IO events in §3. The envelope protocol IS implemented on the agent's own WS endpoint: `GET /ws/servers/{id}` (`apps/node-agent/internal/api/server.go` line 111), Go message types in `apps/node-agent/internal/ws/protocol.go` (`"console.output"` `{line}`, `"stats"`, `"power.event"` `{state}`, `"install.output"` `{line, done}`, `"error"` `{message}`, `"auth.ok"`; inbound `"auth"` `{token}`, `"console.command"` `{command}`, `"power.command"` `{action}`, `"stats.subscribe"`). Its hub (`internal/ws/hub.go`): first frame must be `auth` within 10 s carrying a JWT HMAC-signed with the node's signing key, optionally scoped by a `"server"` claim (lines 106-133); `CheckOrigin` always true ("The panel performs origin checks; the agent trusts the JWT", line 53); stats stream ticks every 3 s per subscriber; 30 s ping. **No code in panel-api mints that ticket JWT** (grep for ticket/consoleTicket/signAsync-with-server-claim finds nothing), so the direct agent WS is currently unreachable by design — a desktop client should ignore it and use the panel gateway.

## 9. Adjacent REST routes a desktop console needs
- `POST /api/v1/servers/:serverId/power` `{ signal }` — permission `control.power`.
- `POST /api/v1/servers/:id/command` `{ command }` (`SendCommandDto`, `servers/dto/server.dto.ts` lines 219-223) — permission **`console.command`**. Note the permission-string mismatch with the WS path: the gateway's `command` event checks **`control.console`** (`console.gateway.ts` line 110), a string that does NOT exist in the canonical list `packages/shared/src/permissions.ts` (which has `CONSOLE_COMMAND: 'console.command'`, `POWER: 'control.power'`, etc.). Owners/admins are unaffected (early-return), but a sub-user granted `console.command` can use the REST command route yet will get `forbidden` on the WS `command` event.
- `POST /api/v1/servers/:serverId/reinstall`, `POST /api/v1/servers/:serverId/switch-game` `{ templateId, ... }` — progress then streams back over the `console` event with `stream: "install"`.
- All HTTP routes sit under the `api/v1` global prefix (`main.ts` line 141) and require `Authorization: Bearer <accessToken>`; the global response envelope is `{ success, data }` (TransformInterceptor) except agent callbacks which are `@RawResponse()`.

## Open questions

- The console stream value "stderr" is styled by clients (Android isError) and typed in shared ConsoleOutputPayload, but no current agent code sends stream:"stderr" (senders use "stdout" and "install"; "system" is documented in internal/panel/client.go line 237 but unused) — whether stderr will ever appear on the wire could not be confirmed.
- The short-lived "ticket" JWT for the agent's direct WS endpoint (packages/shared/src/protocol.ts AuthPayload.ticket; verified in apps/node-agent/internal/ws/hub.go against the node signingKey) is minted nowhere in panel-api — it is unclear whether this direct-to-agent console path is planned, deprecated, or intentionally dormant.
- Whether the globally-registered ThrottlerGuard (APP_GUARD) binds to WS message handlers in this NestJS version was not proven from source; the gateway itself declares no guard, and no WS rate limiting is visible, but I did not trace Nest's guard-binding behavior for gateways.
- players in the WS stats frame: panel's StatSample interface allows it and persists s.players ?? null, but the Go ServerStat struct has no players field — if a future agent adds it the panel will relay it; current agents never send it. LiveStats (REST) does declare players?: number|null but I did not verify which games' agent stats handler actually populates it.
- packages/shared/src/protocol.ts ResourceStats includes memLimitMb and uptimeSec, but neither reaches the panel WS stats event today; the shared type overstates the live frame. Desktop UI needing mem limit should take it from the server's own record (limits) or REST LiveStats.memTotalMb.
- Exact production CORS_ORIGINS / PANEL_URL values are deployment env config, not in the repo — the tauri webview-fetch question (if the desktop app uses webview fetch instead of native HTTP) depends on that deployment value.
