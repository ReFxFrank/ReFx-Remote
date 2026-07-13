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

`Profile` = `{ id, email, firstName?, lastName?, globalRole?, mustChangePassword, totpEnabledAt?, permissions: string[] }`.

## Errors

Commands reject with `IpcError` = `{ code, message, mfaMethods? }`.
`message` is already human-readable — render it verbatim. Codes the FE may
branch on: `NOT_SIGNED_IN`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`,
`MFA_REQUIRED`, `PASSWORD_CHANGE_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION`, `RATE_LIMITED`, `SERVER_ERROR`, `NETWORK`, `DECODE`, `VAULT`,
`OTHER`.

## Events (Rust → FE)

None yet. Planned namespaces (Phase 2/3, from docs/decisions.md D-001):

```
console:{server_id}   { line: string, stream: "stdout"|"install", at: number }
stats:{server_id}     { cpuPct, memUsedMb, diskUsedMb, netRxBytes, netTxBytes, state }
status:{server_id}    { state: "RUNNING"|"STARTING"|"STOPPING"|"OFFLINE"|"CRASHED"|… }
conn:{server_id}      { state: "connecting"|"live"|"retrying"|"failed", detail?: string }
app:update-available  { version, notes }
```

## Invariants

- No `fetch`/`WebSocket` in the WebView. CSP (`tauri.conf.json`) allows
  `connect-src` only for `'self'` and Tauri's IPC origin.
- Tokens, passwords, and API keys never appear in command results, event
  payloads, or logs. The tracing pipeline scrubs `refx_…` keys, JWTs, and
  bearer headers from every record (`src-tauri/src/logging.rs`, unit-tested).
- Dev-only: `REFX_API_ORIGIN` env var overrides the panel origin (https
  enforced except for localhost).
