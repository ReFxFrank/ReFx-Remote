# IPC contract — WebView ⇄ Rust core

The frontend never performs network I/O and never sees a credential. It talks
to the Rust core exclusively through the `#[tauri::command]`s and events below.
Keep this file in lock-step with `src-tauri/src/commands.rs`.

## Commands (FE → Rust)

| Command | Args | Returns | Since |
|---|---|---|---|
| `app_info` | — | `{ name, version }` | Phase 0 |
| `auth_status` | — | `{ signedIn: boolean, profile?: Profile }` — first call performs the lazy vault-resume bootstrap | Phase 1 |
| `auth_login` | `{ email, password, remember?, totp? }` | `{ status: "ok" }` \| `{ status: "mfa", methods: string[] }` | Phase 1 |
| `auth_mfa_verify` | `{ code, method? }` | `void` (then call `auth_status`) | Phase 1 |
| `auth_logout` | — | `void` — best-effort server revocation, always clears the vault | Phase 1 |
| `servers_list` | `{ q? }` | `{ servers: ServerSummary[], meta? }` — page 1, pageSize 100 | Phase 2 |
| `server_get` | `{ serverId }` | `ServerDetail` (= `ServerSummary` + `viewerPermissions: string[]`) | Phase 2 |
| `server_stats` | `{ serverId }` | `LiveStats` (503 from a down node → `SERVER_ERROR`) | Phase 2 |
| `server_power` | `{ serverId, signal: "start"\|"stop"\|"restart"\|"kill" }` | `void` (rejects `CONFLICT` while installing/etc.) | Phase 2 |
| `console_open` | `{ serverId }` | `ConsoleLine[]` — buffered scrollback; spawns the WS session if not already open. Subscribe to `console:{serverId}` **before** calling. | Phase 3 |
| `console_close` | `{ serverId }` | `void` — drops the session's socket + task | Phase 3 |
| `console_command` | `{ serverId, command }` | `void` — sent via REST `POST /command` (`console.command`; rejects `CONFLICT` if not running) | Phase 3 |

`ConsoleLine` = `{ line: string, stream: "stdout"|"install", at: number }`.

`Profile` = `{ id, email, firstName?, lastName?, globalRole?, mustChangePassword, totpEnabledAt?, permissions: string[] }`.
`ServerSummary` = `{ id, shortId?, name, description?, state, serverType?, cpuCores?, memoryMb?, diskMb?, slots?, suspendedAt?, createdAt?, template?: {id?,name?,slug?}, node?: {name?,fqdn?}, primaryAllocation?: {ip?,port?,alias?} }`. `state` is one of the panel's `ServerState` values or `UNKNOWN` (forward-compatible).
`LiveStats` = `{ state, cpuPct, memUsedMb, memTotalMb, diskUsedMb, netRxBytes, netTxBytes, players?, uptimeMs? }`.

## Errors

Commands reject with `IpcError` = `{ code, message, mfaMethods? }`.
`message` is already human-readable — render it verbatim. Codes the FE may
branch on: `NOT_SIGNED_IN`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`,
`MFA_REQUIRED`, `PASSWORD_CHANGE_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION`, `RATE_LIMITED`, `SERVER_ERROR`, `NETWORK`, `DECODE`, `VAULT`,
`OTHER`.

## Events (Rust → FE)

Emitted by an open console session (Phase 3), namespaced per server:

```
console:{server_id}   { line: string, stream: "stdout"|"install", at: number }
stats:{server_id}     { serverId, cpuPct, memUsedMb, diskUsedMb, netRxBytes, netTxBytes, state }
status:{server_id}    { state: "RUNNING"|"STARTING"|"STOPPING"|"OFFLINE"|"CRASHED"|… }
conn:{server_id}      { state: "connecting"|"live"|"retrying"|"failed"|"closed", detail?, attempt? }
```

Planned (later phases): `app:update-available { version, notes }`.

Note: `stats:{id}` (WS) is poorer than REST `server_stats` on this backend
(no `memTotalMb`/`players`/`uptimeMs`), so the detail-panel tiles stay on the
REST poll and the WS `stats` frames are currently informational — see
docs/decisions.md D-005.

## Invariants

- No `fetch`/`WebSocket` in the WebView. CSP (`tauri.conf.json`) allows
  `connect-src` only for `'self'` and Tauri's IPC origin.
- Tokens, passwords, and API keys never appear in command results, event
  payloads, or logs. The tracing pipeline scrubs `refx_…` keys, JWTs, and
  bearer headers from every record (`src-tauri/src/logging.rs`, unit-tested).
- Dev-only: `REFX_API_ORIGIN` env var overrides the panel origin (https
  enforced except for localhost).
