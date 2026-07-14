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
| `settings_get` | — | `AppSettings` | Phase 5 |
| `settings_set` | `{ next: AppSettings }` | `void` — applies OS autostart when it changed (rejects `OTHER` if that write fails), updates monitor prefs, persists | Phase 5 |
| `copy_diagnostics` | — | `string` — last ~64 KB of the already-redacted log, for a support paste | Phase 5 |
| `deeplink_ready` | `{ ready: boolean }` | `OpenServerEvent[]` — servers screen calls `true` on mount (draining any buffered `refx://` link) and `false` on unmount | Phase 5 |

Phase 4 file/backup/startup/schedule/database commands are enumerated in `src-tauri/src/commands.rs` (`files_*`, `backups_*`/`backup_*`, `startup_get`, `variables_list`/`variable_set`, `schedules_list`/`schedule_*`, `databases_list`).

### Admin / staff (`commands_admin.rs`, `admin_*`)

Authorized server-side (403 → `FORBIDDEN`); the UI also gates on `profile.permissions`
via `src/lib/perms.ts` (mirror of the backend catalog). Exposed under `ipc.admin.*`.

| Command | Args | Returns | Perm | Since |
|---|---|---|---|---|
| `admin_roles_list` | — | `AdminRole[]` | `roles.manage` | Admin T0 |
| `admin_role_permissions` | — | `{ wildcard?, permissions: string[] }` | `roles.manage` | Admin T0 |
| `admin_role_create` | `{ key, name, description?, permissions: string[] }` | `AdminRole` | `roles.manage` | Admin T0 |
| `admin_role_update` | `{ id, name?, description?, permissions? }` | `AdminRole` | `roles.manage` | Admin T0 |
| `admin_role_delete` | `{ id }` | `void` (204; 400 if system/in-use) | `roles.manage` | Admin T0 |
| `admin_users_list` | `{ page?, pageSize?, q?, role?, accountState? }` | `{ users: AdminUser[], meta? }` | `users.read` | Admin T0 |
| `admin_user_set_role` | `{ userId, role?, roleId? }` | `AdminUser` | `roles.manage` | Admin T0 |

`AdminRole` = `{ id, key, name, description?, isSystem, permissions: string[], _count?: { users } }`.
`AdminUser` = `{ id, email, firstName?, lastName?, globalRole?, state?, roleId?, createdAt?, emailVerifiedAt? }`.

`ConsoleLine` = `{ line: string, stream: "stdout"|"install", at: number }`.
`AppSettings` = `{ notifyCrashed, notifyBackOnline, closeToTray, startWithWindows }` (all `boolean`).
`OpenServerEvent` = `{ id: string, console: boolean }`.

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

App-scoped events (Phase 5/6), emitted to the `main` window:

```
app:open-server    { id: string, console: boolean }   tray "Open" / refx:// deep link — jump to a server (and its console)
app:check-updates   (no payload)                        tray "Check for updates" — UpdateBanner runs a manual check
status:crash        "<serverId>"                        background monitor detected a crash — badge flips to CRASHED sub-poll
```

The auto-updater plugin emits its own `tauri://update*` events consumed by
`@tauri-apps/plugin-updater`; the app drives it via `check()` /
`downloadAndInstall()` in `src/lib/updater.ts` rather than listening directly.

Deep link: the app registers the `refx://` scheme. `refx://server/{id}` opens a
server; `refx://server/{id}/console` opens it on the console tab. `{id}` is
charset-validated (`[A-Za-z0-9_-]`, ≤64) before use.

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
