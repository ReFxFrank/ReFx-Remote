# ReFxCompanion iOS client reference

> Recon agent output, 2026-07-13. Source-grounded; file paths cited are relative to the named repo.

## Summary

The SwiftUI iOS app (ReFxCompanion/ReFxHostingApp) targets the same custom ReFx Hosting backend: REST base is `<apiOrigin>/api/v1` with production origin `https://api.refx.gg` (web `https://refx.gg`), console is Socket.IO namespace `/ws/console` on the API origin authenticated via a CONNECT-payload `{ token }`, sign-in is `POST auth/login` -> optional MFA (`auth/mfa/verify` for TOTP/recovery, `auth/mfa/webauthn/login/options|verify` for passkeys with rpId `refx.gg`), and rotating refresh tokens via single-flight `POST auth/refresh`. Desktop-relevant extras found: full API-keys and sessions management screens (`account/api-keys`, `account/sessions`), push-token registration (`account/push-tokens` with `platform:"ios"`), a widget fed purely from an App Group snapshot of `GET /servers` (no widget-side network), locally-driven Live Activities (no push), a registered-but-unhandled `refxapp://` URL scheme, and an authoritative parity doc (`docs/ReFxParitySpec.md`) that corrects several wire-shape assumptions (UPPERCASE enum raws, `{data, meta}` pagination with no `hasMore` on the wire).

## Key facts

- Production origins: API https://api.refx.gg, web https://refx.gg (Config/Debug.xcconfig:10-13, Config/Release.xcconfig:4-7, AppConfig.swift:26-33); REST base is always <origin>/api/v1 (AppConfig.swift:37)
- AppConfig.resetToDefaults() contains stale legacy fallbacks https://panel.refxhosting.com and https://refxhosting.com (AppConfig.swift:57-62) — do not use these
- Console is Socket.IO (socket.io-client-swift >=16.1.0), namespace /ws/console on the API origin; auth via CONNECT payload {token} (gateway reads client.handshake.auth.token) plus an Authorization: Bearer extra header; events: emit subscribe{serverId}/command{command}, receive subscribed, error{message: unauthorized|forbidden}, console{line,stream}, stats(StatsFrame with state), power{state}; both transports allowed (ConsoleSocket.swift)
- On socket error message "unauthorized" the client refreshes the token once and reconnects; "forbidden" is terminal (no console permission)
- Auth flow: POST auth/login {email,password,totp?,rememberMe?} -> TokenResponse {accessToken,refreshToken,expiresIn,mfaRequired?,mfaToken?,methods?}; MFA via POST auth/mfa/verify {mfaToken,code,method: totp|recovery}; passkey 2FA via POST auth/mfa/webauthn/login/options {mfaToken} -> {challenge,rpId,allowCredentials[{id}],userVerification} then POST auth/mfa/webauthn/login/verify {mfaToken,response:<WebAuthn AuthenticationResponseJSON>}; refresh rotates (single-flight mandatory); logout body {refreshToken}
- Passkey rpId is refx.gg; iOS entitlements webcredentials:refx.gg + webcredentials:www.refx.gg; backend uses @simplewebauthn; passkey is second-factor only, no usernameless login
- Envelope: {success,data} for detail, {success,data:[E],meta:{page,pageSize,total,totalPages}} for lists — no hasMore on the wire (computed page<totalPages); error body {statusCode,error,message,path,timestamp} with message string-or-array (APIEnvelope.swift)
- Enum raw values are UPPERCASE SCREAMING_SNAKE_CASE (RUNNING, PENDING_PAYMENT, SWITCHING_GAME); exceptions lowercase: power signals start|stop|restart|kill, MFAMethod totp|recovery|webauthn (docs/ReFxParitySpec.md:20)
- Power endpoint body is {signal}, NOT {action}: POST servers/{id}/power (ServersService.swift:20-22)
- API keys screens/endpoints exist: GET/POST account/api-keys (create body {name,scopes} -> {key,prefix,id} shown once), DELETE account/api-keys/{id}; sessions: GET account/sessions -> {id,ip,userAgent,createdAt,expiresAt}, DELETE account/sessions/{id} (AccountService.swift, ApiKey.swift)
- Push tokens: POST account/push-tokens {token, platform:"ios"}, DELETE account/push-tokens/{token}; unregister before logout while still authenticated (AccountService.swift:58-66, AppSession.swift:126-133)
- Widget does no network: app publishes ServerSnapshot{total,attention,worst,updatedAt} to App Group group.com.refx.app key refx.widget.snapshot after each GET /servers; Live Activities are local-only (pushType:nil), driven by socket state changes, ended on app background/launch
- Deep links: only custom scheme refxapp:// (refxapp://servers from widgets) is registered and it has NO handler (security-findings.csv PLAT-2); no universal links/applinks; push taps route via userInfo keys type/serverId/invoiceId/ticketId
- Tokens stored in Keychain service com.refx.app.tokens, accounts refx.token.access / refx.token.refresh, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly; APIClient uses ephemeral URLSession (no disk cache), 30s/60s timeouts, 401 -> single-flight refresh -> retry once
- Billing pay flow: POST billing/invoices/{id}/pay?gateway= and POST billing/servers/{serverId}/pay return either paid:true or a hosted checkoutUrl to open in browser; POST billing/paypal/capture?token=
- Local dev backend: docker compose -f infra/docker/docker-compose.yml in the ReFxHosting repo; API on :4000, Swagger at <origin>/docs (README.md:74-88)
- docs/ReFxParitySpec.md is an authoritative source-cited parity spec (design tokens, component inventory, wire-shape corrections) built for the Android port and directly reusable for desktop

## Findings

# iOS app recon — ReFxCompanion/ReFxHostingApp

All paths below are relative to `C:\Users\frank\OneDrive\Desktop\ReFx-Products\ReFxCompanion\ReFxHostingApp`.

## 1. Base URL / origin defaults

**Source of truth: `ReFxApp/Core/Storage/AppConfig.swift`**
- Init fallbacks (lines 26–33): apiOrigin fallback `"https://api.refx.gg"`, webOrigin fallback `"https://refx.gg"`. Values are seeded from Info.plist keys `ReFxAPIScheme`/`ReFxAPIHost`/`ReFxWebScheme`/`ReFxWebHost` (substituted from xcconfig).
- `var apiBaseURL: URL { apiOrigin.appendingPathComponent("api/v1") }` (line 37) — REST base is always `<origin>/api/v1`.
- `var socketOrigin: URL { apiOrigin }` (line 40) — Socket.IO connects to the API origin; namespace path added by the client.
- Runtime origin override (UserDefaults keys `refx.apiOriginOverride` / `refx.webOriginOverride`) is honored **in DEBUG only**; release always uses baked-in Info.plist/fallback (lines 69–77 comment). Note: `setAPIOrigin` exists (line 42) but no UI call site was found in `ReFxApp/` — the README's "Account → Connection settings" appears removed.
- **Internal inconsistency**: `resetToDefaults()` (lines 57–62) uses stale fallbacks `"https://panel.refxhosting.com"` and `"https://refxhosting.com"`, and the doc comment on line 36 says "e.g. `https://panel.refxhosting.com/api/v1`". The xcconfigs and all docs use `api.refx.gg`/`refx.gg`, so `panel.refxhosting.com` looks legacy.

**Build config** — `Config/Debug.xcconfig` (lines 10–13) and `Config/Release.xcconfig` (lines 4–7) both set:
```
API_SCHEME = https
API_HOST = api.refx.gg
WEB_SCHEME = https
WEB_HOST = refx.gg
```
Debug comment: to develop locally set `API_SCHEME = http`, `API_HOST = localhost:4000`; "Swagger: `<origin>/docs`". ATS in `ReFxApp/Resources/Info.plist` (lines 95–107) is HTTPS-only with a cleartext exception for `localhost` only.

Corroboration: `docs/AndroidPortPlan.md:60-61` — "API origin (prod): `https://api.refx.gg` · REST base = origin + `/api/v1`"; "Web origin (prod): `https://refx.gg`". `docs/ReFxParitySpec.md:16` confirms the same plus socket `/ws/console` and legal pages at `{web}/privacy|terms|support`.

## 2. Console socket (`ReFxApp/Core/Realtime/ConsoleSocket.swift`)

- **Socket.IO, not raw WebSocket** — uses `socket.io-client-swift` (SPM, `from: 16.1.0`, declared in `project.yml:13-15`). Namespace: `manager.socket(forNamespace: "/ws/console")` (line 111), socketURL = API origin.
- **Handshake auth**: token sent as CONNECT-packet auth payload — `socket.connect(withPayload: ["token": token])` (line 116); header comment says this matches the gateway's `client.handshake.auth.token`. It ALSO sets `.extraHeaders(["Authorization": "Bearer \(token)"])` (line 109).
- **Transports**: both websocket and polling allowed deliberately — comment at lines 97–100: forcing websockets was the bug behind "console doesn't live-update".
- **Manager config**: `.reconnects(true)`, `.reconnectWait(2)`, `.reconnectWaitMax(15)`, `.reconnectAttempts(-1)`, `.compress`, `.handleQueue(DispatchQueue.main)`.
- **Protocol events**:
  - emit `"subscribe", ["serverId": serverId]` on connect (line 124)
  - emit `"command", ["command": trimmed]` (line 76)
  - on `"subscribed"` → connected (line 137)
  - on `"error"` with payload `{ message }`: `"unauthorized"` → refresh token once and reconnect (lines 141–151, 177–197); `"forbidden"` → terminal, "You don't have console access to this server."
  - on `"console"` → `{ line, stream }` where stream is `"stdout"`/`"stderr"` (lines 153–158)
  - on `"stats"` → decodes a `StatsFrame` (carries a `state` field, lines 160–167)
  - on `"power"` → `{ state }` raw `ServerState` (lines 169–174)
- Console buffer capped at 2000 lines (line 44). Token-expiry path: server disconnects with `error { message: "unauthorized" }`; the client refreshes once (`didRefreshForAuth` guard) then reconnects with the new token.

## 3. URL scheme / deep links / universal links

- `ReFxApp/Resources/Info.plist:32-42`: `CFBundleURLTypes` registers scheme **`refxapp`** (URL name `com.refx.app`), comment: "Deep-link scheme used by the Home Screen widget (refxapp://servers)".
- Widget and Live Activity both use `.widgetURL(URL(string: "refxapp://servers"))` (`ReFxWidget/ReFxWidget.swift:89`, `ReFxWidget/ServerOpLiveActivity.swift:56`).
- **The scheme is never handled**: `SECURITY_REVIEW.md:165` and `security-findings.csv` finding "PLAT-2" state the app has *no* `onOpenURL`/open-URL handler ("Won't-fix"; tapping the widget just opens the app). Grep for `onOpenURL` confirms zero handlers in app code.
- **No universal links**: `ReFxApp/Resources/ReFxApp.entitlements` has only `webcredentials:refx.gg` and `webcredentials:www.refx.gg` associated domains (passkeys), **no `applinks:`**. `docs/AndroidPortPlan.md:322` lists `https://refx.gg/...` app links only as an optional future item.
- Push-tap routing instead uses APNs `userInfo` keys `type`, `serverId`, `invoiceId`, `ticketId` routed by `PushRouter` (`ReFxApp/Core/Background/PushNotifications.swift:26-38, 136-148`).

## 4. Widget + Live Activities data flow

**Home Screen widget (`ReFxWidget/ReFxWidget.swift`, `Shared/ServerSnapshot.swift`, `ReFxApp/Core/Widget/WidgetBridge.swift`)**
- The widget does **zero network**. The app publishes a `ServerSnapshot { total, attention, worst, updatedAt }` to App Group `group.com.refx.app` under UserDefaults key `refx.widget.snapshot`, widget kind `"ReFxServersWidget"` (`Shared/ServerSnapshot.swift:17-20`), then `WidgetCenter.shared.reloadAllTimelines()` (`WidgetBridge.swift:16-17`).
- Publisher call sites: `ReFxApp/Features/Servers/ServersListViewModel.swift:46,73` — i.e., after each `GET /servers` list fetch in the app.
- Widget timeline policy: `.after(now + 30 min)` best-effort (`ReFxWidget.swift:23-24`). `SECURITY_REVIEW.md:211`: widget has "no Keychain/token access".
- `worst` severity order in `WidgetBridge.swift:23-25`: `crashed, suspended, pendingPayment, offline, installing, reinstalling, switchingGame, starting, stopping, transferring, running` (raw values UPPERCASE per parity spec, e.g. `"RUNNING"`, `"PENDING_PAYMENT"`).

**Live Activities (`ReFxApp/Core/Widget/LiveActivityManager.swift`, `Shared/ServerOpAttributes.swift`)**
- Started with `pushType: nil` (line 33) — **no push updates; updated only while the app is foreground**, driven by `ServerDetailViewModel.liveState` `didSet` (`ReFxApp/Features/Servers/ServerDetailViewModel.swift:15-21`), which itself is fed by the console socket's `power`/`stats` frames.
- Transitional states that trigger an activity: `installing, starting, stopping, reinstalling, switchingGame, transferring` (lines 11–13). Terminal state → update then `end(dismissalPolicy: .after(.now + 4))`.
- `endAll()` is called on launch and on backgrounding (`ReFxApp/App/ReFxAppApp.swift:35,56`) precisely because there is no push channel — otherwise the activity would freeze.
- `ContentState = { state: String, detail: String, finished: Bool }`; attributes `{ serverId, serverName, game }` (`Shared/ServerOpAttributes.swift:10-21`).

**Background refresh (`ReFxApp/Core/Background/BackgroundRefreshScheduler.swift`)**
- `BGAppRefreshTask` id `com.refx.app.refresh` (also in Info.plist `BGTaskSchedulerPermittedIdentifiers`), min interval 15 min. Polls `GET /servers?page=1&pageSize=100` and `GET account/notifications/unread-count`, diffs, and fires local notifications. Deliberately does **not** refresh tokens in background (lines 62–68) to avoid tripping refresh-token family-reuse detection.

## 5. API keys / sessions / (no device pairing)

- **API keys screen exists**: `ReFxApp/Features/Account/SecurityView.swift` (create with name+scopes, reveal-once, revoke). Service: `ReFxApp/Features/Account/AccountService.swift:84-95` — `GET account/api-keys`, `POST account/api-keys` body `{ name, scopes }` (`CreateApiKeyBody`, line 98), `DELETE account/api-keys/{id}`.
- Models `ReFxApp/Models/ApiKey.swift`: `ApiKey { id, name, prefix, scopes, lastUsedAt, expiresAt, createdAt }`; `CreatedApiKey { key, prefix, id }` — "the full key, shown once".
- **Sessions screen exists**: `ReFxApp/Features/Account/SessionsView.swift`; service `AccountService.swift:33-38` — `GET account/sessions` → `UserSession { id, ip, userAgent, createdAt, expiresAt }` (lines 115–123, "only active, non-revoked sessions are returned"), `DELETE account/sessions/{id}`.
- **Push token registration** (`AccountService.swift:58-66`): `POST account/push-tokens` body `{ token, platform: "ios" }`; `DELETE account/push-tokens/{token}`. On logout the app unregisters the push token *before* clearing auth (`AppSession.swift:126-133`).
- **No device pairing** of any kind — grep for "pair" only matches incidental uses (e.g. "token pair" in `KeychainService.swift`).
- Token storage: Keychain generic passwords, service `com.refx.app.tokens`, accounts `refx.token.access` / `refx.token.refresh`, accessibility `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (`ReFxApp/Core/Storage/KeychainService.swift:5-8, 28, 43`).

## 6. Sign-in end-to-end (incl. 2FA and passkeys)

Routes (`ReFxApp/Core/Auth/AuthAPI.swift`, all `@Public()` i.e. unauthenticated, except `me`):
1. `POST auth/login` body `LoginRequest { email, password, totp?, rememberMe? }` (`ReFxApp/Models/AuthModels.swift:28-33`). The iOS UI always sends `rememberMe: true` and `totp: nil` (`ReFxApp/Features/Auth/LoginView.swift:26-28`).
2. Response `TokenResponse { accessToken, refreshToken, expiresIn, mfaRequired?, mfaToken?, methods? }` (`AuthModels.swift:6-15`). If MFA needed, tokens are empty and `mfaToken` + `methods` populated; `methods` ∈ `totp | recovery | webauthn` (`MFAMethod`, lines 17–24).
3. TOTP/recovery second factor: `POST auth/mfa/verify` body `MFAVerifyRequest { mfaToken, code, method }` where method is the string `"totp"` or `"recovery"` (`AuthModels.swift:35-39`; `AuthStore.swift:59-64`). UI: `ReFxApp/Features/Auth/MFAView.swift` (6-digit numberPad or recovery-code toggle).
4. **Passkey second factor** (only offered when `methods.contains(.webauthn)`, `MFAView.swift:63-74`):
   - `POST auth/mfa/webauthn/login/options` body `{ mfaToken }` → `PasskeyOptions { challenge (base64url), rpId, allowCredentials: [{ id }], userVerification }` (`ReFxApp/Models/WebAuthn.swift:6-18`; server side is `@simplewebauthn generateAuthenticationOptions` per the comment).
   - OS assertion via `ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)` (`ReFxApp/Core/Auth/PasskeyAuthenticator.swift:33`). Requires entitlement `webcredentials:refx.gg` (+ `www.refx.gg`) AND the RP hosting `/.well-known/apple-app-site-association` (entitlements file comment says "verified live at both"; `README.md:157-162` says backend `RP_ID` must be `refx.gg`).
   - `POST auth/mfa/webauthn/login/verify` body `{ mfaToken, response }` where response is standard WebAuthn `AuthenticationResponseJSON`: `{ id, rawId, type: "public-key", response: { clientDataJSON, authenticatorData, signature, userHandle? }, clientExtensionResults: {} }`, all base64url no-padding (`WebAuthn.swift:21-47`; `AuthAPI.swift:50-54`). Orchestrated by `AppSession.completePasskey` (`ReFxApp/Core/Auth/AppSession.swift:106-124`).
5. `POST auth/refresh` body `{ refreshToken }` — **rotating**: reusing a refresh token revokes the whole session family, so `AuthStore` (an actor) serializes all concurrent 401s into a single-flight refresh (`ReFxApp/Core/Auth/AuthStore.swift:79-103`). `APIClient` retries the failed request exactly once after a successful refresh (`ReFxApp/Core/Networking/APIClient.swift:109-114`).
6. `POST auth/logout` body `{ refreshToken }`; `GET auth/me` → `CurrentUser` confirms role/profile.
7. TOTP management (authenticated): `POST auth/mfa/totp/enroll` → `{ otpauthUrl, secret }`; `POST auth/mfa/totp/verify` body `{ code }` → `{ recoveryCodes }`; `DELETE auth/mfa/totp` (`AccountService.swift:70-80`; models `ApiKey.swift:24-32`).
- No sign-up/registration endpoint in the app; signup/checkout link out to the web (`ReFxApp/Core/Networking/WebLink.swift:4`, "Decision #2: no IAP / no card entry"). No passkey-first (usernameless) login — passkey is second-factor only.

## 7. Endpoint spot-check vs expected /api/v1 domains

All paths are relative to `/api/v1` (per `ReFxApp/Core/Networking/Endpoint.swift:7`). Confirmed present:
- **auth**: `auth/login`, `auth/mfa/verify`, `auth/refresh`, `auth/logout`, `auth/me`, `auth/mfa/webauthn/login/options|verify`, `auth/mfa/totp/enroll|verify`, `DELETE auth/mfa/totp` (`ReFxApp/Core/Auth/AuthAPI.swift`; `AccountService.swift`)
- **servers** (`ReFxApp/Features/Servers/ServersService.swift`): `GET servers?page&pageSize&q`, `GET servers/{id}`, `POST servers/{id}/power` body `{ signal }` with signal ∈ lowercase `start|stop|restart|kill` (comment: "note the power body is `{ signal }`, not `{ action }`"), `POST servers/{id}/command` body `{ command }`, `GET servers/{id}/stats`
- **files** (`ReFxApp/Features/Servers/Files/FilesService.swift`): `GET servers/{id}/files/list`, `GET .../files/contents`, `POST .../files/write`, `POST .../files/mkdir` `{ path }`, `POST .../files/rename` `{ from, to }`, `POST .../files/delete` `{ paths }`, `GET .../files/download-url`
- **backups** (`ReFxApp/Features/Servers/Backups/BackupsService.swift`): `GET/POST servers/{id}/backups` (create body `{ name }`), `POST .../backups/{backupId}/restore`, `DELETE .../backups/{backupId}`, `GET .../backups/{backupId}/download`
- **schedules** (`ReFxApp/Features/Servers/Schedules/SchedulesService.swift`): `GET/POST servers/{id}/schedules`, `PATCH .../schedules/{scheduleId}` `{ isActive }`, `POST .../schedules/{scheduleId}/run`, `DELETE .../schedules/{scheduleId}`
- **billing** (`ReFxApp/Features/Billing/BillingService.swift`): `GET billing/credit`, `GET billing/invoices` (+`/{id}`), `POST billing/invoices/{id}/pay?gateway=`, `POST billing/servers/{serverId}/pay`, `POST billing/paypal/capture?token=`, `GET billing/subscriptions`, `POST billing/subscriptions/{id}/cancel|resume`, `GET billing/payment-methods`, `POST billing/payment-methods/{id}/default`, `DELETE billing/payment-methods/{id}`, `GET billing/config`. Paying without a saved card returns a hosted `checkoutUrl` handed to the browser.
- Also present: `dashboard`, `account/*` (incl. `account/export`, `DELETE account`), `support/tickets*`, `catalog/*` (products/templates/locations/nodes/minecraft-versions/minecraft-builds), `orders`, `billing/coupons/validate`, `billing/gift-cards/lookup`, `servers/{id}/databases|sub-users|workshop|mods|modpacks|voice|switch-game|startup|variables|reinstall|upgrade`, and a large `admin/*` staff surface (metrics, servers, nodes incl. `admin/nodes/{id}/restart-agent|update-agent|steam-cache/clear`, `admin/nodes/agent-latest`, users, audit-logs, alerts, products/tiers/prices, templates, coupons, gift-cards, orders, invoices, payments, roles, locations, settings/email|steam, payments/gateways/config).

## Wire envelope (desktop-critical)

`ReFxApp/Core/Networking/APIEnvelope.swift`:
- Success: `{ success: true, data: T }`; paginated: `{ success, data: [E], meta: { page, pageSize, total, totalPages } }`. **No `hasMore` and no `items` on the wire** — `hasMore` is computed client-side as `meta.page < meta.totalPages` (line 50). `APIClient.send` falls back to decoding `T` directly for unwrapped routes (`APIClient.swift:51-60`).
- Error body (from NestJS `AllExceptionsFilter`): `{ statusCode, error, message, path, timestamp }` where `message` is a string OR an array of validation strings (lines 53–75).
- Date decoding accepts ISO-8601 with/without fractional seconds, bare `yyyy-MM-dd`, and epoch seconds/milliseconds (`APIClient.swift:156-181`).
- `ReFxParitySpec.md:20`: data-model enum raw values are **UPPERCASE SCREAMING_SNAKE_CASE** (`RUNNING`, `SWITCHING_GAME`, `PENDING_PAYMENT`...); lowercase exceptions: `MFAMethod` (`totp|recovery|webauthn`), power signals (`start|stop|restart|kill`), `EmailTheme`, `PayPalMode`, `PlanChangeResult.Status`.

## Discrepancies / cautions noticed

1. **Stale fallback hostnames**: `AppConfig.resetToDefaults()` resets to `https://panel.refxhosting.com` / `https://refxhosting.com` while `init` and all configs use `https://api.refx.gg` / `https://refx.gg` (`AppConfig.swift:26-33` vs `57-62`). Do not copy `panel.refxhosting.com` into the desktop app.
2. **README Status is stale**: `README.md:49-51` says widget, Live Activity, and passkey login are "future work", but all three are implemented in code. Trust the code, not the README status list.
3. **`refxapp://` scheme is declared but unhandled** (PLAT-2 in `security-findings.csv`) — tapping the widget just foregrounds the app.
4. **platform field**: push-token body uses `platform: "ios"`; `ReFxParitySpec.md:23` confirms Android sends `"android"` — a desktop client would presumably need its own value (backend contract unverified).
5. The console socket sends the token BOTH as CONNECT auth payload and as an `Authorization: Bearer` extra header; the comment says the gateway reads `client.handshake.auth.token` (the payload) — replicate the payload at minimum.
6. `docs/ReFxParitySpec.md` (Android parity spec with `path:line` citations into this repo) and `docs/AndroidPortPlan.md` are high-value cross-references; §0 of the parity spec corrects exactly the kinds of assumptions a new client port tends to get wrong.

## Open questions

- Whether panel.refxhosting.com / refxhosting.com are live legacy hostnames or dead — they appear only in AppConfig.resetToDefaults() and one stale comment; could not verify from this repo
- Which credential the console gateway actually validates (CONNECT auth payload token vs the Authorization header the client also sends) — the iOS comment says handshake.auth.token, but the server code is in the ReFxHosting repo, not here
- Exact Socket.IO protocol/engine version expected by the backend (client is socket.io-client-swift >=16.1.0, implying Socket.IO v3/v4 EIO=4, but the repo never states it)
- Whether the backend's account/push-tokens endpoint accepts platform values other than "ios"/"android" (e.g. "windows"/"desktop") — AccountService comment historically called the endpoint "TBD"
- The full JSON field list of StatsFrame / LiveStats socket+REST payloads (models exist in ReFxApp/Models/Stats.swift but were not read in this pass)
- What the Android recon found — no Android output was available to me, so cross-app discrepancies are limited to what docs/ReFxParitySpec.md records (its Delta section corrects the Android scaffold, e.g. pagination hasMore and enum casing)
- Whether a runtime 'Connection settings' origin-override UI still exists anywhere — README mentions Account -> Connection settings but no call site for AppConfig.setAPIOrigin was found, and release builds ignore the override by design
