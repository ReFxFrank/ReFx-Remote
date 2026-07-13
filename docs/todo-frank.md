# TODO(frank) register — updated after Phase 0 recon (2026-07-13)

The brief's original register, resolved where recon could resolve it. Items marked ✅ need no action; items marked **DECIDE** block the next phase.

| # | Item | Status |
|---|---|---|
| 1 | Does the ReFx mobile app already have a backend/BFF and auth flow? | ✅ **Yes.** Two apps (iOS `ReFxCompanion/ReFxHostingApp`, Android `ReFxAndroid`) run against your own `panel-api` with JWT login → optional MFA → rotating refresh. The desktop app should reuse this flow. §2.3 Mode A (paste `ptlc_` key) and Appendix C (RFC 8628 pairing) are moot as written. |
| 2 | Panel hostname + software | ✅ Web `https://refx.gg`, API `https://api.refx.gg` (`/api/v1`), software = **your own ReFxHosting platform** (NestJS panel-api + Go node-agent), live in production. `panel.refx.gg` does not exist. |
| 3 | Scratch API key + test server for recon | **PARTIALLY RESOLVED** (2026-07-13): test account provided and live-verified: login/refresh/rotation, sessions, notifications, error shape, and the **servers-list decode** (empty list) all confirmed against prod. ⛔ **BLOCKER for Phase 3+: the test account has zero servers.** Attach one throwaway game server (any egg — a small Minecraft or a bot template is ideal) so we can live-verify: the console websocket (`/ws/console` handshake, `console`/`stats`/`power` events, token refresh across 30 min), power transitions, live stats frames, files, and backups. Phase 3 (live console) is the app's marquee feature and its acceptance criteria (output within 1s, survives token refresh, reconnect on wake) **cannot be verified without a running server** — I'll scaffold the client but must stop at live verification per the brief's guardrails. An MFA-enabled variant of the account would also let me exercise the Phase 1 MFA path live. |
| 4 | Path of the API-key creation page | ✅ Account → API keys on refx.gg; API: `POST /api/v1/account/api-keys` (plaintext returned in `token`). Note: API keys can't open the console socket, so this is secondary for desktop. |
| 5 | Brand assets: logo SVG, 1024px icon, accent color, final product name | **PROVIDE** (unchanged; blocks Phase 6). Candidate sources: the mobile apps' asset catalogs — say if we should lift from there. |
| 6 | Update feed host | ✅ **RESOLVED** (2026-07-13): dedicated repo `https://github.com/ReFxFrank/ReFx-Remote` — code + CI + GitHub Releases for installers and `latest.json`, cleanly separated from the node-agent release stream. |
| 7 | Azure Artifact Signing account | **START NOW** (unchanged — still the longest-lead item; nothing in recon changes this). |
| 8 | Ship one-click pairing or paste-a-key for v1? | **Reframed.** Neither: v1 auth = email+password (+ MFA) JWT login, same as mobile. The brief forbade password login for Pterodactyl-specific reasons (no token endpoint, HTML scraping) that don't apply — your backend has a first-class login API. Confirm you're OK overriding the brief on this. Optional panel-side work if you want it (v2): a `desktop` platform value for push tokens + a Windows push channel, and/or a device-flow pairing endpoint — but the desktop app does not need either to ship. |
| 9 | EULA / privacy policy URLs | **PROVIDE** (Phase 6). `apps/web/lib/legal.ts` references legal@refx.gg — are there live /legal pages to link? |
| 10 | Support link for "Copy diagnostics" | **PROVIDE** (Phase 5). Support tickets exist in the panel — deep-link to refx.gg support, or mailto support@refx.gg? |

## New decisions surfaced by recon

| # | Decision | Recommendation |
|---|---|---|
| 11 | Approve the revised architecture in [decisions.md](decisions.md) (auth = JWT login; console = Socket.IO client in Rust; SFTP for >32 MiB files; crash alerts via WS `power` events). | Approve — it's the only design the real backend supports. |
| 12 | The recon found **4 shipped bugs in ReFxAndroid** against production (MFA login broken, variable update 404s, API-key create decode failure, file downloads always fail) and 2 panel-side quirks (WS `command` permission string `control.console` not grantable to sub-users; no server-rename route though web calls one). | Fix separately from the desktop project — see [recon/parity-cross-check.md](recon/parity-cross-check.md). |
| 13 | Desktop User-Agent string (shows in Account → Sessions). | e.g. `ReFxDesktop/1.0.0 (Windows NT; x64)` — pick the final product name first (item 5). |
