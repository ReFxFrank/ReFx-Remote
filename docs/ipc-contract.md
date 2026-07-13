# IPC contract — WebView ⇄ Rust core

The frontend never performs network I/O and never sees a credential. It talks
to the Rust core exclusively through the `#[tauri::command]`s and events below.
Keep this file in lock-step with `src-tauri/src/commands.rs` and
`src-tauri/src/events.rs` (the latter arrives in Phase 2).

## Commands (FE → Rust)

| Command | Args | Returns | Since |
|---|---|---|---|
| `app_info` | — | `{ name: string, version: string }` | Phase 0 |

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
  payloads, or logs (redaction layer lands in Phase 1 with patterns
  `refx_[A-Za-z0-9]+` and JWT-shaped strings).
