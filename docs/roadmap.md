# Roadmap — out of v1 scope

Per the brief, noted and moved past. Updated for the real backend.

## v2 candidates (desktop-side)

- **Billing / invoices / renewals** — the backend actually has these APIs (`/billing/*`, storefront `/catalog/*`, order wizard) unlike the brief's assumption, so a v2 billing surface is genuinely buildable. Kept out of v1 for scope, and note the Android Play-compliance purchasing gate as prior art for store-policy issues.
- **Support tickets** — full API exists (`/support/tickets…`); v2.
- **Ordering new servers / switch-game wizard parity** — switch-game API is in v1 scope read/write, but the buy-new-server checkout stays web.
- **Headless monitor mode** — tray-only mode authenticated by a `refx_` WRITE/READ API key (REST polling, no console) for users who don't want a stored session.
- **Passkey (WebAuthn) sign-in** — RP ID is `refx.gg`; desktop WebAuthn via Windows Hello is plausible but needs origin/RP thought; recovery codes cover the fallback today.
- **macOS/Linux builds** — keep code portable; Windows-only for v1.
- **Stats history charts** — `GET /servers/:id/stats/history?range=…` (up to 5000 points) is an easy, high-value later add.

## v2 candidates (panel-side, Frank's call — desktop ships without them)

- **Desktop push channel**: accept `platform: "windows"` on `/account/push-tokens` + a delivery path (or an account-level WS/SSE event stream) so crash alerts don't require a held socket. Insertion points: `account/dto/push-token.dto.ts`, `push/push.service.ts`, or a new gateway beside `agent/console.gateway.ts`.
- **Sub-user WS command fix**: gateway checks non-catalog `control.console`; either add it to the catalog or check `console.command`.
- **`unsubscribe` WS event + per-socket multi-server command routing** — would let desktop use one socket for N servers.
- **Server-side console scrollback** (small ring buffer on the agent, replayed on subscribe) — removes the blank-console-on-open experience everywhere (web/mobile/desktop all benefit).
- **Minimum-client-version endpoint** for update nudges.
- **Server rename route** (`PATCH /servers/:id`) — web already calls it; it 404s today.
