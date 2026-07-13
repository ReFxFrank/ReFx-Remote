# Ecosystem sweep: Helios bot, hostnames, Pterodactyl remnants, local credentials

> Recon agent output, 2026-07-13. Source-grounded; file paths cited are relative to the named repo.

## Summary

HeliosDiscordBot integrated with the ReFx panel API but the entire integration was removed on 2026-07-02 (commits 21104a3 and 75fc3de); while it existed it hit https://api.refx.gg/api/v1/status (public) and /api/v1/status/nodes (Bearer token = a refx_-prefixed, status:read-scoped panel API key from env REFX_STATUS_TOKEN in .env), plus an inbound HMAC-SHA256 webhook (X-ReFx-Signature/X-ReFx-Delivery) — and the ReFxHosting backend still exposes all of this (status.controller.ts, status-read.guard.ts, api-key.service.ts, docs/27-status-bot-api.md). Production origins are https://api.refx.gg (API, /api/v1 prefix, port 4000) and https://refx.gg (web), baked into both mobile apps; a legacy panel.refxhosting.com fallback lingers only in ReFxCompanion's AppConfig.swift. Pterodactyl grep confirms NO project targets a Pterodactyl panel — ptla_ appears solely in ReFxHosting's migrate-away-from-Pterodactyl importer, ptlc_ nowhere — so refx.gg runs the custom platform. Credential-wise, the only real .env on disk is HeliosDiscordBot/.env (Discord/Postgres/Redis/Stripe-shaped keys, no ReFx tokens set), plus Apple provisioning profiles in ReFxCompanion/ci and test-fixture PEMs in ReFxHosting; ReFx-Remote itself is an empty directory.

## Key facts

- HeliosDiscordBot has NO live ReFx integration today: it was removed 2026-07-02 in commits 21104a3 ('drop the ReFx Hosting status surfaces') and 75fc3de ('remove the ReFx Alerts module entirely'); only a dead REFX_ALERTS Prisma enum value, stale SETUP.md rows, and commented .env lines remain.
- The removed Helios integration (recoverable via git show 8b511cc:packages/shared/src/refx.ts) called DEFAULT_REFX_STATUS_URL = 'https://api.refx.gg/api/v1/status' (public) and DEFAULT_REFX_NODES_URL = 'https://api.refx.gg/api/v1/status/nodes' (auth: 'authorization: Bearer <token>' with a status:read-scoped panel API key from env REFX_STATUS_TOKEN, stored plaintext in .env).
- Headless-client auth on the live backend: ReFxHosting panel API keys are formatted refx_<8-char-prefix><secret> (parsed by /^refx_(.{8})(.+)$/), SHA-256 hashed at rest, scope-based; presented as 'Authorization: Bearer <token>' or 'X-Api-Key: <token>' (ReFxHosting/apps/panel-api/src/auth/api-key.service.ts, src/status/status-read.guard.ts).
- GET /api/v1/status/nodes returns 401 body { statusCode: 401, message: 'A status:read API token is required' } and 403 body { statusCode: 403, message: 'Token lacks the status:read scope' }; rate limit ~30 req/min/token; contract documented in ReFxHosting/docs/27-status-bot-api.md.
- ReFxHosting sends outbound status webhooks with headers X-ReFx-Signature (sha256=<hex> HMAC-SHA256 over raw body), X-ReFx-Event, X-ReFx-Delivery; events incident.created/updated/resolved and component.status_changed (apps/panel-api/src/webhooks/webhook-delivery.processor.ts:47-49).
- Production origins baked into both shipped mobile apps: API = https://api.refx.gg, web = https://refx.gg (ReFxAndroid/app/build.gradle.kts:62-63; ReFxCompanion Config/Release.xcconfig). REST base = origin + /api/v1; Socket.IO console shares the API origin (namespace /ws/console).
- panel-api defaults: PORT 4000, API_PREFIX 'api/v1' (apps/panel-api/src/config/configuration.ts:103-104); /health, /metrics, /graphql, /docs are EXCLUDED from the prefix and live at root (main.ts:141-142).
- Legacy domain panel.refxhosting.com / refxhosting.com survives only in ReFxCompanion AppConfig.swift — resetToDefaults() (lines 59-62) still falls back to the OLD domain while init() (lines 29-33) uses refx.gg; no panel.refx.gg exists anywhere.
- Vanity/game hostname schemes: per-server vanity addresses <name>.<region>.rfx.refx.gg (vanity-address.service.ts:34) and per-node wildcard game domains like fra.refx.gg (node.dto.ts:80).
- Pterodactyl verdict: zero ptlc_ matches; ptla_ appears only in ReFxHosting's read-only Pterodactyl->ReFx migration importer; all pterodactyl/wings/pelican mentions are comparisons, migration tooling, or reused public Docker images (ghcr.io/pterodactyl/yolks) — no project targets a Pterodactyl panel, so refx.gg production runs the custom platform.
- Credential files on disk: only HeliosDiscordBot/.env (21 key names incl. DISCORD_TOKEN, ENCRYPTION_KEY, AUTH_SECRET — no REFX tokens set), two Apple .mobileprovision files in ReFxCompanion/ci, and committed test-fixture PEMs in ReFxHosting agent __fixtures__; no .env exists in ReFxHosting/ReFxAndroid/ReFxCompanion/ReFxPolyScanner/OpenFrank/TinyBiz.
- ReFx-Remote (the planned Tauri desktop repo directory) is completely empty.

## Findings

# Recon report — ReFx Desktop planning

All paths are relative to `C:\Users\frank\OneDrive\Desktop\ReFx-Products\` unless noted. Nothing was modified.

---

## TASK 1 — HeliosDiscordBot ↔ ReFx panel API

**Current state: HeliosDiscordBot has NO live ReFx integration.** It existed and was deliberately removed on 2026-07-02 in two commits (repo `HeliosDiscordBot`, git history):

- `75fc3de` — `feat!: remove the ReFx Alerts module entirely` (removed webhook receiver `/api/integrations/refx`, HMAC verify, fanout, dashboard module, `REFX_WEBHOOK_SECRET`)
- `21104a3` — `feat(status)!: drop the ReFx Hosting status surfaces` (removed `/refxstatus` command, `/status` page ReFx data, `packages/shared/src/refx.ts`)

**Remnants still in the working tree:**
- `HeliosDiscordBot/packages/database/prisma/schema.prisma:45-47` — `Module` enum keeps dead value `REFX_ALERTS` ("Legacy — the ReFx Alerts module was removed; Postgres cannot drop enum values")
- `HeliosDiscordBot/SETUP.md:171-172` — **stale** doc rows still listing `REFX_STATUS_*`, `REFX_NODES_URL` (bot) and `REFX_WEBHOOK_SECRET` (web) as optional env vars; the current `packages/shared/src/env.ts` schema contains no REFX_* keys
- `HeliosDiscordBot/.env` lines 60–76 — the old ReFx section survives as **comments only** (`# REFX_STATUS_URL=https://api.refx.gg/api/v1/status`, `# REFX_STATUS_TOKEN=`, `# REFX_NODES_URL=https://api.refx.gg/api/v1/status/nodes`, `# REFX_WEBHOOK_SECRET=`)

**How it authenticated when it existed** (from deleted `packages/shared/src/refx.ts`, recovered via `git show 8b511cc:packages/shared/src/refx.ts`):

- Base URLs (verbatim constants):
  - `export const DEFAULT_REFX_STATUS_URL = 'https://api.refx.gg/api/v1/status';` — public, unauthenticated
  - `export const DEFAULT_REFX_NODES_URL = 'https://api.refx.gg/api/v1/status/nodes';` — authenticated
- Auth: plain HTTP header `authorization: `Bearer ${token}`` where the token is a ReFx panel **API key with the `status:read` scope**, supplied via env var `REFX_STATUS_TOKEN` (stored only in `.env`, no encryption, optional). On 401/403 the client returned `null` and silently fell back to the public feed **without reading the error body**.
- Pinned real backend error bodies (commit `1ec1e13`, test `packages/shared/src/refx.test.ts`):
  - 401: `{ statusCode: 401, message: 'A status:read API token is required' }`
  - 403: `{ statusCode: 403, message: 'Token lacks the status:read scope' }`
  - These strings match the live guard in ReFxHosting exactly (see below).
- Inbound webhook (Helios web side, removed): `POST /api/integrations/refx`; verified timing-safe **HMAC-SHA256 of the raw body** against header `X-ReFx-Signature`; idempotency via `X-ReFx-Delivery` (Redis SET NX EX claimed after verify); events: `incident.created`, `incident.updated`, `incident.resolved`, `component.status_changed`; body shape `{ event, timestamp, data }` (zod discriminated union); shared secret env `REFX_WEBHOOK_SECRET` ("Generate with: openssl rand -hex 32"); receiver returned 503 when unset (fail closed).

**Backend counterpart — still live in ReFxHosting** (this is how headless clients authenticate today):

- `ReFxHosting/apps/panel-api/src/status/status.controller.ts` — `@Controller('status')` (global prefix `api/v1`, so full routes are `GET /api/v1/status`, `GET /api/v1/status/live`, `GET /api/v1/status/nodes`). `/status/nodes` is `@Public()` + guarded by `StatusReadGuard` and `StatusTokenThrottlerGuard`, `@Throttle({ default: { limit: 30, ttl: 60_000 } })` (~30 req/min/token).
- `ReFxHosting/apps/panel-api/src/status/status-read.guard.ts` — `extractStatusToken()` prefers `Authorization: Bearer <token>` ("the documented form for machine clients like Helios"), falls back to the panel's native `X-Api-Key` header. Throws `UnauthorizedException('A status:read API token is required')` (401) or `ForbiddenException('Token lacks the status:read scope')` (403 when scope `STATUS_READ` missing). Comment notes the JWT fallback "would reject a bearer-presented `refx_` key".
- **API key format** — `ReFxHosting/apps/panel-api/src/auth/api-key.service.ts:14-15,33-35,82`: "Keys are formatted `refx_<prefix><secret>`; we look up by prefix, compare a SHA-256 hash"; generation: `const prefix = this.crypto.token(6).slice(0, 8);` then `const plaintext = `refx_${prefix}${secret}`;`; parsing regex: `/^refx_(.{8})(.+)$/`. Keys carry scopes, expiry, IP allowlists; keys are SHA-256 **hashed** at rest (per `.claude/skills/refx-deploy/references/environments.md:106`).
- Documented contract: `ReFxHosting/docs/27-status-bot-api.md` — "Status bot API (Helios integration)". Auth: "present the token as `Authorization: Bearer <token>` **or** `X-Api-Key: <token>`"; token created under **Account → API keys** with only the **`STATUS_READ`** scope ("isolated to the status feed — it cannot read account, billing, server or admin data"). Includes a verbatim JSON example:
  ```jsonc
  { "success": true, "data": { "updatedAt": "2026-06-30T12:00:00.000Z",
    "regions": [{ "code": "ca-east", "name": "CA east", "status": "operational",
      "nodesUp": 2, "nodesTotal": 2,
      "nodes": [{ "name": "refx-ca-east-bhs", "status": "operational",
        "cpuPercent": 31.4, "memoryUsedMb": 18342, "memoryTotalMb": 65536,
        "memoryPercent": 28, "diskUsedGb": 220, "diskTotalGb": 960,
        "diskPercent": 23, "serversOnline": 12 }] }] } }
  ```
- Outbound webhook sender lives at `ReFxHosting/apps/panel-api/src/webhooks/webhook-delivery.processor.ts:47-49` — sets headers `X-ReFx-Signature` (`sha256=<hex>` HMAC-SHA256 over raw body, `webhook-signing.ts`), `X-ReFx-Event`, `X-ReFx-Delivery` (unique id, stable across retries). Configured under Admin → Status incidents → Status webhooks; signing secret shown once, AES-GCM encrypted at rest (`docs/27-status-bot-api.md:67-73`).
- Panel-api defaults confirmed: `ReFxHosting/apps/panel-api/src/config/configuration.ts:103-104` — `port: toInt(process.env.PORT, 4000)`, `apiPrefix: process.env.API_PREFIX ?? "api/v1"`; `main.ts:141-142` — `app.setGlobalPrefix(apiPrefix, { exclude: ["health", "metrics", "graphql", "docs"] })` (so `/health` is at root, NOT `/api/v1/health`).

---

## TASK 2 — hostname sweep (node_modules/.git/build outputs excluded)

**Production ReFx origins (authoritative — baked into both shipped mobile apps):**

| Hostname | Role | Example file |
|---|---|---|
| `https://api.refx.gg` | Panel API origin (REST base = origin + `/api/v1`; Socket.IO console at same origin, namespace `/ws/console`) | `ReFxAndroid/app/build.gradle.kts:62` (`DEFAULT_API_ORIGIN`); `ReFxCompanion/ReFxHostingApp/Config/Release.xcconfig:5` (`API_HOST = api.refx.gg`); `ReFxCompanion/.../ReFxApp/Core/Storage/AppConfig.swift:29` |
| `https://refx.gg` | Web/marketing + dashboard origin | `ReFxAndroid/app/build.gradle.kts:63` (`DEFAULT_WEB_ORIGIN`); `Release.xcconfig:7` (`WEB_HOST = refx.gg`) |
| `www.refx.gg` | Associated-domain variant | `ReFxCompanion/ReFxHostingApp/ReFxApp/Resources/ReFxApp.entitlements` |

**Game/infra subdomains of refx.gg** (mostly examples/fixtures in docs, DTOs, and tests — treat as the naming scheme, not verified live hosts):

| Hostname | Example file |
|---|---|
| `fra.refx.gg` (example wildcard game domain: "Optional wildcard game domain (e.g. \"fra.refx.gg\") for branded per-server addresses. Requires a *.<domain> DNS record pointing at this node") | `ReFxHosting/apps/panel-api/src/nodes/dto/node.dto.ts:80` |
| `<name>.virginia.rfx.refx.gg` (vanity server addresses, e.g. `whatever.virginia.rfx.refx.gg`; wildcard node DNS) | `ReFxHosting/apps/panel-api/src/servers/vanity-address.service.ts:34` |
| `mc-7f3a.fra.refx.gg` | `ReFxHosting/docs/24-server-hostnames.md` |
| `apps.refx.gg` | `ReFxHosting/docs/27-web-hosting.md` |
| `smtp.refx.gg` | `ReFxAndroid/app/src/test/java/gg/refx/android/AdminSettingsContractTest.kt` |
| `ts.refx.gg` | `ReFxAndroid/.../ServerSectionsParityTest.kt` |
| `nyc.refx.gg`, `x1.nyc.refx.gg` | `ReFxHosting/apps/panel-api/src/servers/allocation-port.util.spec.ts` |
| `n1.refx.gg` | `ReFxAndroid/.../ServerDecodingTest.kt` |
| `play.refx.gg`, `mp.refx.gg`, `cb.refx.gg` | `ReFxAndroid/.../ScreenshotGalleryTest.kt` |
| `node1.refx.gg` | `ReFxHosting/docs/21-ovh-quickstart.md` |
| `fsn-1.refx.gg` | `ReFxCompanion/ReFxHostingApp/Tests/ReFxAppTests/AdminProvisioningTests.swift` |
| `edge1.refx.gg` | `ReFxAndroid/.../AdminProvisioningTest.kt` |
| `db.refx.gg` | `ReFxHosting/apps/web/app/(admin)/admin/database-hosts/page.tsx` |
| `app.refx.gg` | `ReFxHosting/apps/panel-api/.env.example` |
| `yourname.refx.gg` (placeholder) | `ReFxHosting/apps/web/app/(public)/tools/minecraft-srv-record/page.tsx` |

**Legacy domain (important inconsistency):** `panel.refxhosting.com` / `refxhosting.com` appear ONLY in `ReFxCompanion/ReFxHostingApp/ReFxApp/Core/Storage/AppConfig.swift` — the doc comment at line 36 ("Base for all REST calls, e.g. `https://panel.refxhosting.com/api/v1`") and, notably, `resetToDefaults()` at lines 59/62 falls back to `https://panel.refxhosting.com` / `https://refxhosting.com` while `init()` at lines 29/33 falls back to `https://api.refx.gg` / `https://refx.gg`. No `panel.refx.gg` exists anywhere in the tree.

**Adjacent (non-ReFx) deployed hostnames found in the same sweep:** `solari.gg` + `wiki.solari.gg` (HeliosDiscordBot's production identity "Solari" — `HeliosDiscordBot/SETUP.md`, `docker-compose.prod.yml`); `mtbtgpwzrbostweaanpr.supabase.co` (`OpenFrank/frontend/src/lib/supabase.ts`); `openjarvis.ai` / `pool.openjarvis.ai` (OpenFrank).

**Deploy topology confirmation** (`ReFxHosting/.claude/skills/refx-deploy/references/environments.md`): panel = Next.js web `:3000` + NestJS panel-api `:4000` behind a host-installed Caddy/nginx reverse proxy (apps bind loopback); Go node-agent host-installed on game nodes at `:8443` control + `:2022` SFTP, self-updates from GitHub Releases; images `ghcr.io/refxfrank/refxhosting-web` and `ghcr.io/refxfrank/refxhosting-panel-api`; deploys are manual (`infra/scripts/update-panel.sh`), no automated CD.

---

## TASK 3 — Pterodactyl remnants

**Verdict: NO project in the tree targets a Pterodactyl/Pelican panel as its backend.** Evidence:

- `ptlc_` (client API keys): **zero matches** anywhere.
- `ptla_` (application API keys): appears ONLY in ReFxHosting's **migration importer**, where Pterodactyl is a read-only *source* to migrate *away from*: `ReFxHosting/apps/panel-api/src/migration/sources/pterodactyl.source.ts:171` (`/** Application API key (ptla_...). */`) and `ReFxHosting/apps/panel-api/src/migration/README.md:37,44,66` (CLI: `--source pterodactyl --key ptla_xxxxxxxxxxxxxxxxxxxx`). The source file states "We read (never write)".
- `pterodactyl` (case-insensitive): confined to (a) marketing/comparison copy (`ReFxHosting/README.md:9` — "a production-grade, self-hostable alternative to **Pterodactyl**, **AMP**, and **GPortal**"), (b) "Pterodactyl-style" analogy comments (`transfers.service.ts:47`, `servers.service.ts:402`, `schema.prisma:441,754`), (c) migration docs (`docs/11-migration.md`, `docs/20-upgrade-migration.md`), (d) reuse of Pterodactyl's public Docker images in game templates: `ghcr.io/pterodactyl/yolks:java_17` (`ReFxHosting/database/seed/templates/project-zomboid.json:15`) and `ghcr.io/pterodactyl/installers:debian` (`pterodactyl.source.ts:388`), plus `arma3.json`'s "Mirror the proven upstream Pterodactyl egg's invocation" comment, (e) one mention outside ReFxHosting: `ReFxCompanion/ReFxHostingApp/docs/AndroidPortPlan.md:12` ("think GPortal/Pterodactyl-style") — descriptive only.
- `pelican`: single hit, `ReFxHosting/docs/egg-backlog.md:43` — templates were adapted "from canonical Pelican/Pterodactyl" eggs.
- `wings`: all ReFx hits are comparative comments, e.g. `apps/node-agent/README.md:8` — "It is **not** a Pterodactyl Wings clone. Wings is hard-wired to Docker"; `internal/runtime/runtime.go:4`; `internal/panel/client.go:125` ("keeps the Pterodactyl/Wings convention"). Remaining hits are unrelated literal words (TheFogCodex map data, a Minecraft mod config, Fortnite SDK headers).

Since both shipped mobile apps default to `https://api.refx.gg` and consume the custom `/api/v1` NestJS shapes (e.g. `{ success, data }` envelope), and Helios's removed integration called `https://api.refx.gg/api/v1/status` (the custom StatusController, not a Pterodactyl route), **refx.gg production runs the custom platform, not Pterodactyl**.

---

## TASK 4 — credential hygiene (key NAMES only, no values read or copied)

**Real secrets/credential files present:**

1. `HeliosDiscordBot/.env` — the only real `.env` in the entire tree. Key names (uncommented assignments only): `NODE_ENV`, `LOG_LEVEL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `DATABASE_URL`, `REDIS_PORT`, `REDIS_URL`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `OWNER_IDS`, `DEV_GUILD_ID`, `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`, `ENCRYPTION_KEY`, `AUTH_SECRET`, `AUTH_URL`, `WEB_PORT`. (Commented-out: `REFX_STATUS_URL`, `REFX_STATUS_TOKEN`, `REFX_NODES_URL`, `REFX_WEBHOOK_SECRET` — inert.)
2. `ReFxCompanion/ReFxHostingApp/ci/ReFx_AppStore.mobileprovision` and `ci/ReFx_Widget_AppStore.mobileprovision` — Apple App Store provisioning profiles (signing artifacts).
3. `ReFxHosting/apps/panel-api/src/agent/__fixtures__/test-agent.key.pem`, `test-agent.cert.pem`, `other-agent.cert.pem` — mTLS **test fixtures** committed to the repo (named as test material; not production keys, but they are private-key files on disk).

**No matches anywhere** for: keystores (`.jks`/`.keystore`/`keystore.properties`), `local.properties`, `google-services.json`, `AuthKey*.p8`, `.p12`, `*.tfvars`, `.npmrc`, `service-account*.json`, `id_rsa*`/`id_ed25519*`.

**Template files (no secrets, useful as credential-shape references):** `HeliosDiscordBot/.env.example`, `ReFxHosting/.env.example`, `ReFxHosting/.env.production.example`, `ReFxHosting/apps/panel-api/.env.example`, `ReFxHosting/apps/web/.env.example`, `ReFxPolyScanner/.env.example`, `ReFxPolyScanner/.env.docker.example`, `OpenFrank/deploy/docker/.env.example`, `TheFogCodex/.env.example`.

**ReFxHosting secret handling (from `.claude/skills/refx-deploy/references/environments.md:98-112`):** secrets live in env files (root `.env` — not committed, and indeed absent locally) plus AES-256-GCM-encrypted DB overrides (key `SECRETS_ENC_KEY` = 64 hex) for TOTP seeds, SFTP passwords, DB passwords, Stripe/PayPal keys, webhook signing secrets; refresh tokens / API keys / recovery codes are SHA-256 hashed. No external secret manager. Boot preflight (`apps/panel-api/src/config/preflight.ts`) blocks prod boot on placeholder/short JWT secrets or invalid `SECRETS_ENC_KEY`.

**Bonus context:** `ReFx-Remote/` (the intended Tauri desktop repo, `C:\Users\frank\OneDrive\Desktop\ReFx-Products\ReFx-Remote`) is currently **completely empty**.

## Open questions

- Whether api.refx.gg / refx.gg are actually deployed and live right now cannot be verified from source alone (no live requests were made); the deploy runbook's Nodes table is 'TODO(frank)', so the real production fleet is unknown to the repo.
- No API key with broader scopes than STATUS_READ was found in any client repo, so how a desktop app would authenticate for server CONTROL (start/stop/console/files) as a headless client is unestablished — the mobile apps use user login (JWT) + Socket.IO, not refx_ API keys; whether refx_ keys can carry server-control scopes suitable for a desktop app was not determined in this pass.
- Whether the commented-out REFX_STATUS_TOKEN / REFX_WEBHOOK_SECRET lines in HeliosDiscordBot/.env ever held real values (i.e., whether a status:read key was ever issued in production) cannot be determined from the file (values were not inspected beyond masking).
- The exact full list of scopes ApiKeyScope supports (beyond STATUS_READ) was not enumerated in this pass.
- squidfunnel.com and thetinymagicstudio.ca surfaced in the https hostname sweep but were not traced to specific files/projects (presumed TinyBiz-related, unverified).
