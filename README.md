# ReFx Desktop

Native Windows app for [ReFx Hosting](https://refx.gg) customers: live console,
power controls, files, backups, and crash alerts for your game servers —
without opening the web panel.

- **Shell:** Tauri v2 (Rust core + WebView2) · React 19 + TypeScript + Vite + Tailwind
- **Backend:** the ReFx platform API at `api.refx.gg` (`/api/v1` REST + Socket.IO console)
- **Rule #1:** all network I/O and secrets live in the Rust core; the WebView
  only sees typed IPC commands and events ([docs/ipc-contract.md](docs/ipc-contract.md))

## Docs

| Doc | Purpose |
|---|---|
| [docs/api-surface.md](docs/api-surface.md) | The real backend contract (source-mined + live-verified) |
| [docs/decisions.md](docs/decisions.md) | Architecture decisions (D-001: revised design for the real backend) |
| [docs/ipc-contract.md](docs/ipc-contract.md) | WebView ⇄ Rust command/event surface |
| [docs/versions.md](docs/versions.md) | Pinned toolchain + dependency versions |
| [docs/todo-frank.md](docs/todo-frank.md) | Open items owned by Frank |
| [docs/roadmap.md](docs/roadmap.md) | Deliberately out of v1 scope |
| [docs/recon/](docs/recon/README.md) | Phase 0 recon reports (8 agents, cross-checked) |

## Develop

```bash
npm install
npm run tauri dev      # dev window (Vite on :1420)
npm run tauri build    # release build → src-tauri/target/release/bundle/{nsis,msi}
```

Rust checks:

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test  --manifest-path src-tauri/Cargo.toml
```

Prereqs: Node ≥ 24, Rust stable (MSVC), VS 2022 Build Tools (C++ workload).
CI mirrors these on `windows-latest` ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Security invariants

- No `fetch`/`WebSocket` in the WebView; CSP locked in `tauri.conf.json`.
- Credentials live in Windows Credential Manager (`keyring`), never in
  `localStorage`, logs, events, or this repo.
- Log redaction (Phase 1) scrubs `refx_…` API keys and JWT-shaped strings.
- Destructive server actions require typed confirmation; nothing auto-retries
  a mutation; nothing queues actions while offline.
