# Resolved dependency versions (scaffold, 2026-07-13)

All versions resolved live at scaffold time per the build brief — none copied
from the brief or from model training data. The authoritative pins are
`package-lock.json` and `src-tauri/Cargo.lock` (both committed); this file is
the human-readable record.

## Toolchain

| Tool | Version |
|---|---|
| Node | 24.16.0 (npm 11.13.0) |
| Rust | 1.97.0 (stable-x86_64-pc-windows-msvc, rustup) |
| VS Build Tools 2022 | VCTools workload + recommended (installed via winget at scaffold time) |
| create-tauri-app template | react-ts |

## npm (top-level)

| Package | Version | Notes |
|---|---|---|
| @tauri-apps/api | 2.11.1 | |
| @tauri-apps/cli | 2.11.4 | dev |
| @tauri-apps/plugin-opener | 2.5.4 | open external links in system browser |
| react / react-dom | 19.2.7 | |
| typescript | 5.8.3 | `strict: true` |
| vite | 7.3.6 | |
| @vitejs/plugin-react | 4.7.0 | |
| tailwindcss / @tailwindcss/vite | 4.3.2 | Tailwind v4, vite plugin (no PostCSS config needed) |
| zustand | 5.0.14 | FE state |
| @xterm/xterm | 6.0.0 | scoped package, not legacy `xterm` |
| @xterm/addon-fit | 0.11.0 | |
| @xterm/addon-search | 0.16.0 | |
| @xterm/addon-webgl | 0.19.0 | |
| uplot | 1.6.32 | streaming stats charts |

## Rust (src-tauri, direct deps)

| Crate | Version | Features / notes |
|---|---|---|
| tauri | 2.x (lock-pinned) | |
| tauri-build | 2.x (lock-pinned) | |
| tauri-plugin-opener | 2.x | |
| tauri-plugin-single-instance | 2.4.2 | registered first in the builder |
| tauri-plugin-log | 2.8.0 | redaction layer lands in Phase 1 |
| serde / serde_json | 1.x | derive |
| tokio | 1.52.3 | rt-multi-thread, macros, sync, time |
| reqwest | 0.13.4 | `default-features = false`, features `rustls, http2, json, gzip`. **Note:** the old `rustls-tls` feature name is gone in 0.13; the `rustls` feature pulls the aws-lc-rs provider. |
| keyring | 4.1.4 | `windows-native-keyring-store` is on by default in v4 |
| thiserror | 2.0.18 | |
| tracing | 0.1.44 | |
| tracing-subscriber | 0.3.23 | env-filter |

## Deliberately deferred

- Socket.IO client crate — Phase 3 spike decides between `rust-socketio`
  and a hand-rolled Engine.IO v4 client over `tokio-tungstenite`
  (docs/decisions.md D-001). Do not add until the spike.
- SFTP crate (`russh` vs `ssh2`) — Phase 4.
- tauri-plugin-updater / -notification / -autostart / -deep-link — added in
  Phases 5–6 when wired, to keep the release build honest about what's used.
