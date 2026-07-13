# ReFxAndroid client implementation reference

> Recon agent output, 2026-07-13. Source-grounded; file paths cited are relative to the named repo.

## Summary

ReFxAndroid (C:\Users\frank\OneDrive\Desktop\ReFx-Products\ReFxAndroid) is a feature-complete Kotlin/Compose client of the custom ReFx backend. Networking: Retrofit+OkHttp with base URL `<apiOrigin>/api/v1/` (default production origin `https://api.refx.gg`, web origin `https://refx.gg`, both runtime-overridable via DataStore), a custom EnvelopeConverterFactory that auto-unwraps `{success,data}` / throws on `{success:false,error}` and decodes paginated `{success,data:[…],meta:{…}}` whole for `Page<E>` targets, an AuthInterceptor adding `Authorization: Bearer <access>`, and an OkHttp Authenticator that on 401 refreshes once via bare-client `POST auth/refresh {refreshToken}` (response `{accessToken, refreshToken?}` inside the envelope; refresh token reused if not rotated) then retries, signing out on failure. Tokens (access_token, refresh_token only) live in EncryptedSharedPreferences file `refx_secure_tokens`. Live console is Socket.IO namespace `/ws/console` on the API origin with the access token passed BOTH as the `Authorization: Bearer` handshake header and the CONNECT `auth: {token}` payload; it emits `subscribe {serverId}` / `command {command}`, listens for `console/stats/power/error/subscribed`, refreshes-once on "unauthorized", treats "forbidden" as terminal, and caps output at 2000 FIFO lines. There is NO websocket/console-token endpoint — the socket reuses the normal access token. 21 Retrofit interfaces cover auth, account, servers, files, backups, databases, schedules, settings, sub-users, switch-game, upgrade, mods, modpacks, catalog/minecraft, workshop, voice, billing, orders, support, staff/admin, dashboard. Wire fixtures are inline Kotlin strings in app/src/test/java/gg/refx/android/*.kt (no .json files). Deep links: https app links for host refx.gg only (no custom scheme, URI not parsed in-app); FCM data payloads route by keys type/serverId/invoiceId/ticketId with substring matching (backend types server.state, billing.invoice, support.reply).

## Key facts

- Default production origins: DEFAULT_API_ORIGIN = "https://api.refx.gg", DEFAULT_WEB_ORIGIN = "https://refx.gg" (app/build.gradle.kts lines 62-63 and 74-75, same in debug and release); runtime-overridable via DataStore file refx_prefs keys api_origin / web_origin (core/storage/AppPreferences.kt), Retrofit rebuilt on change (app/AppContainer.kt)
- REST base URL = apiOrigin + "/api/v1/" (core/network/ApiConfig.kt: restBaseUrl)
- Envelope: success = {"success":true,"data":<T>}, error = {"success":false,"error":{"message","code"}}; EnvelopeConverterFactory auto-unwraps data, returns null for data:null/absent, throws ApiException(message,code) on success:false; paginated Page<E> targets decode the WHOLE object {success,data:[…],meta:{…}} so meta survives; bodies without a boolean success field decode directly as T (core/network/EnvelopeConverterFactory.kt)
- Page wire shape: { data:[E], meta:{ page, pageSize, total, totalPages } } — no hasMore/items on the wire; hasMore computed client-side page < totalPages (core/network/Pagination.kt)
- Auth header: Authorization: Bearer <access> added by AuthInterceptor when a token exists; no other custom headers (core/network/AuthInterceptor.kt)
- 401 flow: OkHttp Authenticator refreshes ONCE (gives up at responseCount>=2), synchronized so concurrent 401s reuse a fresh token; refresh = POST /api/v1/auth/refresh with bare client, body {"refreshToken":...}, response ApiEnvelope<{accessToken, refreshToken?}>, old refresh token reused when rotation absent; refresh failure -> tokens.clear() + session.signOut() (core/network/TokenAuthenticator.kt, TokenRefresher.kt)
- SecureTokenStore persists exactly two values: access_token and refresh_token in EncryptedSharedPreferences file refx_secure_tokens (AES256_GCM master key, AES256_SIV keys / AES256_GCM values) (core/storage/SecureTokenStore.kt)
- ConsoleSocket: Socket.IO namespace /ws/console on the API origin (URI = socketOrigin + "/ws/console", default engine path); token passed BOTH as extraHeaders Authorization: Bearer AND CONNECT auth payload {token}; confirmed against backend ReFxHosting/apps/panel-api/src/agent/console.gateway.ts (@WebSocketGateway namespace "/ws/console")
- ConsoleSocket events: emits subscribe {serverId} and command {command}; listens console {line, stream(stdout/stderr)}, stats (StatsFrame), power {state}, error {message}, subscribed; reconnection infinite with 2s->15s backoff, transports [websocket, polling], forceNew; error message containing 'unauthorized' -> refresh token once then reconnect (Failed("Session expired") on second/failed), 'forbidden' -> terminal Forbidden + teardown; FIFO line cap MAX_LINES = 2000 (core/realtime/ConsoleSocket.kt)
- There is NO console/websocket-token endpoint or fixture anywhere in ReFxAndroid — the socket reuses the normal access token
- Login: POST auth/login {email, password, totp?, rememberMe?} returns either {accessToken, refreshToken} or MFA challenge {mfaToken, methods}; then POST auth/mfa/verify {mfaToken, code, method('totp'|'recovery')}; POST auth/logout {refreshToken}; GET auth/me -> Account (data/api/AuthApi.kt, data/model/Auth.kt)
- 21 Retrofit interfaces in app/src/main/java/gg/refx/android/data/api: Auth, Account, Servers, Files, Backups, Databases, Schedules, ServerSettings, SubUsers, SwitchGame, Upgrade, Mods, Modpacks, Catalog, Workshop, Voice, Billing, Orders, Support, Dashboard, Staff — full route strings enumerated in findings
- Power: POST servers/{id}/power body {"signal": "start"|"stop"|"restart"|"kill"} (lowercase); command: POST servers/{id}/command {"command": ...}
- Wire fixtures are INLINE Kotlin strings in app/src/test/java/gg/refx/android/*.kt — no .json fixture files exist in the repo
- Server detail fixture (ServerDecodingTest.kt): {"id":"srv_1","shortId":"abcd","name":"My SMP","state":"RUNNING","cpuCores":2.0,"memoryMb":4096,"diskMb":20480,"template":{..."slug":"minecraft-java"...},"node":{"name":"node-1","fqdn":"n1.refx.gg"},"primaryAllocation":{"id":"a1","ip":"1.2.3.4","port":25565,"alias":"play.example.com","isPrimary":true}}
- Backup fixture (ServerSectionsDecodingTest.kt): {"id":"b1","name":"daily","state":"COMPLETED","bytes":1610612736}; BackupState raws PENDING/IN_PROGRESS/COMPLETED/FAILED
- ServerState wire raws: INSTALLING, OFFLINE, STARTING, RUNNING, STOPPING, CRASHED, SUSPENDED, REINSTALLING, SWITCHING_GAME, TRANSFERRING, PENDING_PAYMENT — SCREAMING_SNAKE, decoded permissively to UNKNOWN (data/model/Enums.kt)
- JSON decoding config: ignoreUnknownKeys, coerceInputValues, explicitNulls=false, isLenient, encodeDefaults; field names verbatim camelCase (core/network/RefxJson.kt)
- Deep links: single https App Links filter scheme https host refx.gg autoVerify (AndroidManifest.xml); NO custom refx:// scheme; the URI is never parsed — notification routing uses intent extras type/serverId/invoiceId/ticketId only
- FCM routing: data keys type/serverId/invoiceId/ticketId; backend types server.state, billing.invoice, support.reply; substring match: 'server'->Servers, 'invoice'/'billing'/'payment'->Billing, 'ticket'/'support'->Support, bare serverId->Servers, else dropped (core/push/PushRouter.kt); token registered on sign-in via POST account/push-tokens {token, platform:"android"}
- PURCHASING_ENABLED build flag: true on debug, false on release (Play compliance) — hides checkout/pay/upgrade UI (app/build.gradle.kts lines 61/73)
- iOS parity source app lives locally at C:\Users\frank\OneDrive\Desktop\ReFx-Products\ReFxCompanion\ReFxHostingApp (repo ReFxFrank/ReFxHostingApp)

## Findings

# ReFxAndroid recon — everything a desktop (Tauri) client author needs

All paths are relative to the repo root `C:\Users\frank\OneDrive\Desktop\ReFx-Products\ReFxAndroid` unless stated otherwise.

## 1. core/network — ApiClient

### 1.1 Origins / base URL — `app/src/main/java/gg/refx/android/core/network/ApiConfig.kt`

```kotlin
data class ApiConfig(
    val apiOrigin: String,
    val webOrigin: String,
) {
    /** REST base = origin + `/api/v1`. */
    val restBaseUrl: String get() = apiOrigin.trimEnd('/') + "/api/v1/"
    /** Socket origin == API origin; live console namespace path `/ws/console`. */
    val socketOrigin: String get() = apiOrigin.trimEnd('/')
    val consoleNamespace: String get() = "/ws/console"
    fun webUrl(path: String): String = webOrigin.trimEnd('/') + "/" + path.trimStart('/')
}
```

**Default production origin constants** — `app/build.gradle.kts` lines 62–63 (debug) and 74–75 (release), identical values in both build types:
```kotlin
buildConfigField("String", "DEFAULT_API_ORIGIN", "\"https://api.refx.gg\"")
buildConfigField("String", "DEFAULT_WEB_ORIGIN", "\"https://refx.gg\"")
```
Also `buildConfigField("boolean", "PURCHASING_ENABLED", ...)` — `true` on debug, `false` on release (Play compliance gate; hides checkout/pay/upgrade UI).

**Origin storage/selection** — `app/src/main/java/gg/refx/android/core/storage/AppPreferences.kt`: non-secret prefs in Jetpack DataStore file `refx_prefs`, keys `api_origin`, `web_origin`, `app_lock_enabled`. `config: Flow<ApiConfig>` falls back to `BuildConfig.DEFAULT_API_ORIGIN` / `DEFAULT_WEB_ORIGIN` when unset; `setOrigins(apiOrigin, webOrigin)` and `resetOrigins()` (removes the keys). Doc comment: "the overridable API/web origins (§3.1) ... Tokens live in [SecureTokenStore], never here."

`app/src/main/java/gg/refx/android/app/AppContainer.kt` (lines 87–125): holds `@Volatile var config` seeded from `ApiConfig(BuildConfig.DEFAULT_API_ORIGIN, BuildConfig.DEFAULT_WEB_ORIGIN)`, collects `preferences.config` and **rebuilds Retrofit** on origin change (`retrofit = ApiClientFactory.retrofit(newConfig.restBaseUrl, okHttpClient)`); every repository takes an `apiProvider` lambda so a rebuilt Retrofit takes effect without recreating repos.

### 1.2 Client stack — `app/src/main/java/gg/refx/android/core/network/ApiClientFactory.kt`

OkHttp: `connectTimeout 20s / readTimeout 30s / writeTimeout 30s`, `.addInterceptor(AuthInterceptor(tokens))`, `.authenticator(TokenAuthenticator(tokens, refresher, onSignedOut))`, optional `HttpLoggingInterceptor` at BASIC on debug. Retrofit: `baseUrl` + `EnvelopeConverterFactory(RefxJson, kotlinxFactory)` where the delegate is the kotlinx-serialization converter for `application/json`.

### 1.3 Request headers — `app/src/main/java/gg/refx/android/core/network/AuthInterceptor.kt`

Adds `Authorization: Bearer <access>` to every request when a token exists. Requests tagged with class `NoAuth` are sent without the header — but note: **no call site actually tags `NoAuth`** (grep found it only in AuthInterceptor/TokenAuthenticator themselves); login just works because no token exists yet, and the refresh call uses its own bare OkHttp client. No other custom headers (no API-version, no user-agent override) are set in code.

### 1.4 JSON config — `app/src/main/java/gg/refx/android/core/network/RefxJson.kt`

```kotlin
val RefxJson: Json = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    isLenient = true
    encodeDefaults = true
}
```
"Field names are used verbatim (camelCase, no snake_case conversion)".

### 1.5 Envelope + auto-unwrap

`app/src/main/java/gg/refx/android/core/network/ApiEnvelope.kt`:
```kotlin
@Serializable
data class ApiEnvelope<T>(
    val success: Boolean = true,
    val data: T? = null,
    val error: ApiErrorBody? = null,
)
@Serializable
data class ApiErrorBody(
    val message: String? = null,
    val code: String? = null,
)
```
Envelope shapes (doc comment): success `{ "success": true, "data": <T> }`; error `{ "success": false, "error": { "message", "code", ... } }`.

`app/src/main/java/gg/refx/android/core/network/EnvelopeConverterFactory.kt` — decode algorithm (response side only; request bodies delegate to kotlinx converter):
1. Blank body → `null`.
2. Parse to JsonElement. If it's an object **with a boolean `success` field**:
   - `success==true` and declared type is `Page<E>` → decode the WHOLE object as `Page` (so `meta` survives; `success` key ignored via ignoreUnknownKeys).
   - `success==true` otherwise → if `data` absent or `JsonNull` return `null` (void/no-content success must not throw); else decode `data` as `T`.
   - `success==false` → throw `ApiException(message = error.message ?: GENERIC_MESSAGE, code = error.code)`.
3. No `success` field → decode the whole element directly as `T` (covers bare `{data:[…],meta:{…}}` pages and bare objects).

Pagination — `app/src/main/java/gg/refx/android/core/network/Pagination.kt`: wire shape is `{ data: [E], meta: { page, pageSize, total, totalPages } }` — "there is **no** `hasMore` or `items` field on the wire"; `hasMore` computed client-side `meta.page < meta.totalPages`. `PageMeta` defaults: `page=1, pageSize=0, total=0, totalPages=0`.

Error surface — `app/src/main/java/gg/refx/android/core/network/ApiError.kt`: single `ApiException(message, code, status, cause)` extending IOException; `GENERIC_MESSAGE = "Something went wrong. Please try again."`; network error message `"Can't reach ReFx. Check your connection and try again."` with code `network_error`. `app/src/main/java/gg/refx/android/core/network/ApiCall.kt`: `apiCall {}` wrapper parses non-2xx error bodies as `ApiEnvelope` for `{success:false,error{...}}`, with per-status fallbacks: 401 "Your session has expired. Please sign in again.", 403 "You don't have permission to do that.", 404 "Not found.", 5xx "ReFx is having trouble right now. Please try again shortly."

### 1.6 401 refresh-once-retry — `app/src/main/java/gg/refx/android/core/network/TokenAuthenticator.kt` + `TokenRefresher.kt`

`TokenAuthenticator` (OkHttp `Authenticator`) on a 401:
- Returns null (give up) if request was tagged `NoAuth`, or if `responseCount(response) >= 2` (i.e., already retried once — counts priorResponse chain).
- Inside a `synchronized(lock)`: if another thread already rotated the token (current access != the `Authorization` header of the failed attempt), just retry with the newer token.
- Otherwise call `refresher.refresh(current.refreshToken)`. On `null`: `tokens.clear(); onSignedOut(); return null` (AppContainer wires `onSignedOut = { session.signOut() }`). On success: `tokens.save(refreshed)` and retry the request with `Authorization: Bearer <new access>`.

`TokenRefresher` (`app/src/main/java/gg/refx/android/core/network/TokenRefresher.kt`):
- Uses its **own bare OkHttpClient** (no interceptor/authenticator) "so it can never recurse into itself"; synchronous call.
- Endpoint: `POST <restBaseUrl>auth/refresh` i.e. `POST /api/v1/auth/refresh`, JSON body `{"refreshToken": "..."}` (`RefreshRequest(val refreshToken: String)`), content type `application/json; charset=utf-8`. NO Authorization header.
- Response decoded as `ApiEnvelope<RefreshResponse>` where `RefreshResponse(accessToken: String, refreshToken: String? = null)`; requires `success==true` and non-null data.
- Token rotation: `refreshToken = data.refreshToken ?: refreshToken` — "Some servers rotate the refresh token; reuse the old one if absent."
- Any non-2xx / parse failure / exception → returns null (caller signs out).
- Source NOTE verbatim: "the request/response keys (`refreshToken` → `accessToken`/`refreshToken`) are the expected `auth/refresh` shape; reconcile against the panel API once the backend repo is available."

### 1.7 Auth flow DTOs — `app/src/main/java/gg/refx/android/data/model/Auth.kt`

- `LoginRequest(email, password, totp: String? = null, rememberMe: Boolean? = null)` → `POST auth/login`.
- `LoginResponse(accessToken?, refreshToken?, mfaToken?, methods: List<MFAMethod>)` — union: token pair OR MFA challenge (`mfaRequired` when tokens null and mfaToken present).
- `MfaVerifyRequest(mfaToken, code, method /* "totp" | "recovery" */)` → `POST auth/mfa/verify` → `TokenResponse(accessToken, refreshToken)`.
- `LogoutRequest(refreshToken)` → `POST auth/logout` (best-effort; see `data/repo/AuthRepository.kt` — after login it persists tokens then calls `GET auth/me` for the Account).

## 2. core/storage — SecureTokenStore

`app/src/main/java/gg/refx/android/core/storage/SecureTokenStore.kt` — implements `TokenProvider` (`core/network/TokenProvider.kt`: `current(): TokenPair?`, `save`, `clear`, `isSignedIn = current() != null`). Backed by EncryptedSharedPreferences, MasterKey AES256_GCM (Android Keystore), key scheme AES256_SIV / value scheme AES256_GCM. **Exactly two persisted values:**
```kotlin
const val FILE_NAME = "refx_secure_tokens"
const val KEY_ACCESS = "access_token"
const val KEY_REFRESH = "refresh_token"
```
Nothing else is stored securely; origins/app-lock flag are in DataStore (`AppPreferences`), and the session state is in-memory (`core/session/SessionManager.kt`: Resolving when a token exists at startup, SignedIn(account) after `auth/me`, SignedOut on `signOut()` which also clears tokens).

## 3. core/realtime — ConsoleSocket

`app/src/main/java/gg/refx/android/core/realtime/ConsoleSocket.kt` (io.socket:socket.io-client, org.json):

- **URL**: `URI.create(config.socketOrigin + config.consoleNamespace)` = e.g. `https://api.refx.gg/ws/console`. `/ws/console` is the Socket.IO **namespace** (Socket.IO engine path is the default `/socket.io/` — no custom `path` is set in `IO.Options`). Cross-checked against the backend: `ReFxHosting/apps/panel-api/src/agent/console.gateway.ts` line 28: `@WebSocketGateway({ namespace: "/ws/console", cors: { origin: true } })`, and `ReFxHosting/apps/web/lib/ws.ts` line 71: `io(`${API_URL}/ws/console`, {...})`.
- **Dual-bearer handshake** — the SAME regular access token goes two places in `IO.Options`:
  ```kotlin
  auth = mapOf("token" to token)                                  // CONNECT auth payload { token }
  extraHeaders = mapOf("Authorization" to listOf("Bearer $token")) // handshake HTTP header
  ```
- Other options: `reconnection = true`, `reconnectionDelay = 2_000`, `reconnectionDelayMax = 15_000`, `reconnectionAttempts = Int.MAX_VALUE`, `transports = arrayOf("websocket", "polling")`, `forceNew = true`.
- **Emits**: on connect → `subscribe` with `JSONObject {"serverId": serverId}`; user input → `command` with `{"command": trimmed}` (blank commands dropped; an echo line `"> <cmd>"` with stream "input" is appended locally).
- **Listens**: `EVENT_CONNECT` (resets `didRefreshForAuth`, emits subscribe, state→Connected), `EVENT_DISCONNECT` (→Reconnecting unless Forbidden), `EVENT_CONNECT_ERROR`, `subscribed` (→Connected), `console` (payload object: `line` string, `stream` defaulting `"stdout"`; `"stderr"` marks error lines), `stats` (payload decoded as `StatsFrame`: `serverId?, cpuPct, memUsedMb, diskUsedMb, netRxBytes, netTxBytes, state?, players?` — no memTotalMb; see `data/model/Stats.kt`), `power` (payload `{state: "<ServerState raw>"}` → updates liveState), `error` (payload `{message}`).
- **Refresh-on-unauth**: server `error` whose message contains "unauthorized", or transport connect_error containing "unauthorized"/"401" → `refreshAndReconnect()`: refresh the token **once** per connection (`didRefreshForAuth` flag; reset on successful connect); failure or second occurrence → state `Failed("Session expired")`. Success → save tokens, teardown, reopen socket.
- **Forbidden is terminal**: server `error` message containing "forbidden" → state `Forbidden`, append stderr line "You don't have console access to this server.", and teardown (stop infinite reconnect). Connect events never downgrade Forbidden.
- **FIFO cap**: `MAX_LINES = 2000`; `append` keeps `combined.takeLast(MAX_LINES)`; a monotonic `appendCount` drives auto-scroll because list size saturates. Connection states: Idle/Connecting/Connected/Reconnecting/Forbidden/Failed(reason).
- Lifecycle: one socket per server-detail screen (`AppContainer.createConsoleSocket()`), `disconnect()` → Idle, `dispose()` tears down and cancels the IO scope.

**There is NO console/websocket-token REST endpoint anywhere in the Android client** (grep for consoleToken/ws-token/websocket across `app/src/main` matches only the transports array). The socket authenticates with the ordinary access token.

## 4. All Retrofit service interfaces (`app/src/main/java/gg/refx/android/data/api/`)

All paths are relative to base `/api/v1/`. 21 interfaces:

**AuthApi.kt** — `POST auth/login` (LoginRequest→LoginResponse); `POST auth/mfa/verify` (MfaVerifyRequest→TokenResponse); `POST auth/logout` (LogoutRequest); `GET auth/me` (→Account).

**AccountApi.kt** — `GET account` (→Account, and separately decoded as OrderProfile); `PATCH account` (UpdateProfileBody, nulls omitted); `GET account/export` (→raw JsonElement, GDPR export); `DELETE account`; `GET account/notifications` (→List<AppNotification>); `GET account/notifications/unread-count` (→UnreadCount); `POST account/notifications/{id}/read`; `POST account/notifications/read-all`; `GET account/sessions` (→List<UserSession>); `DELETE account/sessions/{id}`; `POST account/password` (ChangePasswordRequest); `POST account/push-tokens` (PushTokenRequest); `DELETE account/push-tokens/{token}`; `GET account/api-keys`; `POST account/api-keys` (→CreatedApiKey); `DELETE account/api-keys/{id}`; `POST auth/mfa/totp/enroll` (→TotpEnrollment); `POST auth/mfa/totp/verify` (→RecoveryCodes); `DELETE auth/mfa/totp`.

**ServersApi.kt** — `GET servers?page&pageSize&q` (→Page<Server>); `GET servers/{id}` (→Server); `POST servers/{id}/power` (PowerRequest `{signal}` — lowercase values start/stop/restart/kill per `data/model/Enums.kt` PowerSignal); `POST servers/{id}/command` (CommandRequest `{command}`); `GET servers/{id}/stats` (→LiveStats).

**FilesApi.kt** — `GET servers/{id}/files/list?path` (→List<FileEntry>); `GET servers/{id}/files/contents?path` (→FileContent); `POST servers/{id}/files/write` (WriteFileRequest `{path, content}`); `POST servers/{id}/files/mkdir` (MkdirRequest `{path}`); `POST servers/{id}/files/rename` (RenameRequest `{from, to}`); `POST servers/{id}/files/delete` (DeletePathsRequest `{paths:[…]}`); `GET servers/{id}/files/download-url?path` (→SignedUrl `{url}`).

**BackupsApi.kt** — `GET servers/{id}/backups?page&pageSize` (→Page<Backup>); `POST servers/{id}/backups` (CreateBackupRequest `{name}`); `POST servers/{id}/backups/{backupId}/restore`; `DELETE servers/{id}/backups/{backupId}`; `GET servers/{id}/backups/{backupId}/download` (→SignedUrl).

**DatabasesApi.kt** — `GET servers/{id}/databases`; `POST servers/{id}/databases` (CreateDatabaseRequest→ServerDatabase); `DELETE servers/{id}/databases/{dbId}`; `POST servers/{id}/databases/{dbId}/rotate` (→DatabasePassword).

**SchedulesApi.kt** — `GET servers/{id}/schedules`; `POST servers/{id}/schedules`; `PATCH servers/{id}/schedules/{sid}`; `POST servers/{id}/schedules/{sid}/run`; `DELETE servers/{id}/schedules/{sid}`.

**ServerSettingsApi.kt** — `GET servers/{id}/startup` (→StartupConfig); `GET servers/{id}/variables` (→List<ServerVariable>); `PATCH servers/{id}/variables` (UpdateVariableRequest); `POST servers/{id}/reinstall`.

**SubUsersApi.kt** — `GET servers/{id}/sub-users`; `POST servers/{id}/sub-users`; `PATCH servers/{id}/sub-users/{suid}`; `DELETE servers/{id}/sub-users/{suid}`.

**SwitchGameApi.kt** — `GET servers/{id}/switch-game/templates`; `POST servers/{id}/switch-game`.

**UpgradeApi.kt** — `GET servers/{id}/upgrade/options`; `POST servers/{id}/upgrade/preview` (UpgradeServerDTO→UpgradePreview); `POST servers/{id}/upgrade` (→PlanChangeResult); `DELETE servers/{id}/upgrade` (→CancelPlanChangeResult).

**ModsApi.kt** — `GET servers/{id}/mods/context`; `GET servers/{id}/mods/search?q`; `GET servers/{id}/mods/installed`; `POST servers/{id}/mods/install`; `DELETE servers/{id}/mods/{filename}` (filename pre-URL-encoded, `encoded = true`).

**ModpacksApi.kt** — `GET servers/{id}/modpacks/search?q` (empty q = featured); `GET servers/{id}/modpacks/versions?projectId`; `GET servers/{id}/modpacks/installed`; `POST servers/{id}/modpacks/install`; `POST servers/{id}/modpacks/uninstall`.

**CatalogApi.kt** (public/unauthenticated on server; bearer sent anyway) — `GET catalog/products`; `GET catalog/templates`; `GET catalog/locations?cpuCores&memoryMb&diskMb`; `GET catalog/nodes?regionId&cpuCores&memoryMb&diskMb`; `GET catalog/minecraft-versions?loader`; `GET catalog/minecraft-builds?loader&version`; plus `PATCH servers/{id}/minecraft` (MinecraftUpdateRequest `{loader, version, loaderVersion?}` — null loaderVersion omitted; triggers REINSTALLING).

**WorkshopApi.kt** — `GET servers/{id}/workshop`; `POST servers/{id}/workshop` (AddWorkshopRequest); `PATCH servers/{id}/workshop/{modId}` (WorkshopEnabledRequest); `DELETE servers/{id}/workshop/{modId}`; `POST servers/{id}/workshop/apply` (reinstalls with current selection).

**VoiceApi.kt** — `GET servers/{id}/voice`; `GET servers/{id}/voice/status`; `POST servers/{id}/voice/accept-license`; `POST servers/{id}/voice/rename`.

**BillingApi.kt** — `GET billing/credit`; `GET billing/invoices?page&pageSize` (→Page<Invoice>); `GET billing/invoices/{id}`; `POST billing/invoices/{id}/pay?gateway=`; `POST billing/servers/{serverId}/pay?gateway=` (pay PENDING_PAYMENT server); `POST billing/paypal/capture?token=`; `GET billing/subscriptions`; `POST billing/subscriptions/{id}/cancel?atPeriodEnd=` (only ever sent as `false`; default omits query); `POST billing/subscriptions/{id}/resume`; `GET billing/payment-methods`; `POST billing/payment-methods/{id}/default`; `DELETE billing/payment-methods/{id}`; `GET billing/config`.

**OrdersApi.kt** — `POST orders` (CreateOrderBody→OrderResult); `POST billing/coupons/validate`; `POST billing/gift-cards/lookup`.

**SupportApi.kt** — `GET support/tickets?page&pageSize&mine&state` (→Page<Ticket>); `GET support/tickets/{id}` (→TicketDetail); `POST support/tickets`; `POST support/tickets/{id}/messages`; `PATCH support/tickets/{id}`; `POST support/tickets/{id}/assign`.

**DashboardApi.kt** — `GET dashboard` (→DashboardSummary).

**StaffApi.kt** (admin, role-gated server-side) — `GET admin/metrics`; `GET admin/billing/summary`; `GET admin/servers?page&pageSize&q` / `POST admin/servers` / `DELETE admin/servers/{id}`; `GET admin/users?page&pageSize&q` / `GET admin/users/{id}` / `PATCH admin/users/{id}` / `PATCH admin/users/{id}/role` / `POST admin/users/{id}/verify-email` / `POST admin/users/{id}/credit`; `GET admin/nodes?page&pageSize` / `GET admin/nodes/{id}` / `POST admin/nodes` / `GET admin/nodes/{id}/ping` / `POST admin/nodes/{id}/restart-agent` / `POST admin/nodes/{id}/update-agent` / `POST admin/nodes/{id}/steam-cache/clear` / `GET admin/nodes/agent-latest`; products & pricing: `GET/POST admin/products`, `GET/PATCH/DELETE admin/products/{id}`, `POST admin/products/{productId}/tiers`, `DELETE admin/tiers/{tierId}`, `POST admin/products/{productId}/prices`, `POST admin/products/{productId}/tiers/{tierId}/prices`, `DELETE admin/prices/{priceId}`; `GET/POST admin/locations`, `PATCH/DELETE admin/locations/{id}`; `GET admin/templates`, `PATCH/DELETE admin/templates/{id}`; `GET/POST admin/coupons`, `PATCH/DELETE admin/coupons/{id}`; `GET/POST admin/gift-cards`, `PATCH admin/gift-cards/{id}`; `GET admin/roles`, `GET admin/roles/permissions`, `POST admin/roles`, `PATCH/DELETE admin/roles/{id}`; `GET admin/invoices?page&pageSize&state`, `POST admin/invoices/{id}/void`, `POST admin/invoices/{id}/mark-paid`, `DELETE admin/invoices/{id}`; `GET admin/orders?page&pageSize&q`, `DELETE admin/orders/{id}`; `GET admin/payments?page&pageSize&q`; settings: `GET/PATCH admin/settings/email`, `POST admin/settings/email/test`, `GET/PATCH admin/settings/steam`, `GET/PATCH admin/payments/gateways/config`; `GET admin/audit-logs?page&pageSize`; `GET/POST admin/alerts`, `PATCH/DELETE admin/alerts/{id}`.

## 5. Wire-contract fixtures (inline Kotlin strings — there are NO .json fixture files in the repo)

All fixtures live inline in `app/src/test/java/gg/refx/android/*.kt` (20 test classes; README claims "155+ wire-contract and UI tests").

**Server detail** — `app/src/test/java/gg/refx/android/ServerDecodingTest.kt` (verbatim):
```json
{"id":"srv_1","shortId":"abcd","name":"My SMP","state":"RUNNING",
 "cpuCores":2.0,"memoryMb":4096,"diskMb":20480,
 "template":{"id":"t1","name":"Minecraft","slug":"minecraft-java","supportsWorkshop":false},
 "node":{"name":"node-1","fqdn":"n1.refx.gg"},
 "primaryAllocation":{"id":"a1","ip":"1.2.3.4","port":25565,"alias":"play.example.com","isPrimary":true}}
```
LiveStats fixture (same file): `{"state":"RUNNING","cpuPct":42.5,"memUsedMb":1024.0,"memTotalMb":4096.0,"diskUsedMb":5000.0,"netRxBytes":10.0,"netTxBytes":20.0,"players":3,"uptimeMs":1000.0}`.

**Paginated list page (enveloped)** — `app/src/test/java/gg/refx/android/EnvelopeConverterTest.kt` (verbatim; element type is a test Dummy, not Server — no full Page<Server> JSON fixture exists):
```json
{"success":true,
 "data":[{"state":"RUNNING","name":"alpha"}],
 "meta":{"page":1,"pageSize":25,"total":30,"totalPages":2}}
```
Bare (un-enveloped) page from `EnvelopeDecodingTest.kt`:
```json
{"data":[{"state":"RUNNING","name":"a"},{"state":"OFFLINE","name":"b"}],
 "meta":{"page":1,"pageSize":25,"total":40,"totalPages":2}}
```
Success/error envelopes (same files): `{"success":true,"data":{"state":"RUNNING","name":"alpha"}}`; `{"success":false,"error":{"message":"Nope","code":"forbidden"}}`; void success `{"success":true,"data":null}` and `{"success":true}` both decode to null.

**Backup** — `app/src/test/java/gg/refx/android/ServerSectionsDecodingTest.kt` (verbatim):
```json
{"id":"b1","name":"daily","state":"COMPLETED","bytes":1610612736}
```
(Backup model fields: `id, name?, state, bytes?, checksum?, isLocked=false, createdAt?, completedAt?` — `data/model/Backups.kt`.)

**Account (order-profile subset of `GET account`)** — `app/src/test/java/gg/refx/android/OrderCheckoutDecodingTest.kt` lines 176–178 (verbatim):
```json
{ "id": "u1", "email": "a@b.c", "emailVerifiedAt": "2026-06-01T00:00:00Z",
  "addressLine1": "1 Main St", "city": "Austin", "region": "TX",
  "postalCode": "78701", "country": "US", "creditBalanceMinor": 250 }
```
No full `Account` JSON fixture exists; the `Account` DTO from `GET auth/me` (`data/model/Account.kt`) is: `id, email, firstName?, lastName?, globalRole (default CUSTOMER), avatarUrl?, creditBalanceMinor?: Long, permissions?: List<String>, totpEnabledAt?: String (ISO-8601; non-null ⇒ TOTP enabled)`.

**Account security fixtures** — `app/src/test/java/gg/refx/android/AccountSecurityDecodingTest.kt` (verbatim): session `{ "id": "s1", "ip": "203.0.113.7", "userAgent": "Firefox on macOS", "createdAt": "2026-06-25T12:00:00Z", "expiresAt": "2026-07-25T12:00:00Z" }` ("Wire name is `ip` (NOT `ipAddress`); no `current`/`lastSeenAt` exist"); created API key `{ "key": "rfx_ab12cd34_full_secret", "prefix": "rfx_ab12", "id": "k1" }` ("Server returns exactly { key, prefix, id }"); recovery codes `{ "recoveryCodes": ["aaaa-bbbb", "cccc-dddd"] }`.

**Console/websocket token response** — DOES NOT EXIST. There is no such endpoint or fixture anywhere in the Android repo; the console socket authenticates with the regular access token dual-passed (header + CONNECT auth payload). See §3.

**File listing** — NO JSON fixture exists in the tests (grep for FileEntry/files/list in `app/src/test` returned nothing). The wire shape is defined by `data/model/Files.kt`: `GET servers/{id}/files/list?path=` returns (after envelope unwrap) a JSON array of `FileEntry { name, path, isDir (default false), size (Long, default 0), mode?, modifiedAt? (raw string, "server format varies") }`; `FileContent { content (default ""), encoding? }`; `SignedUrl { url }`.

**Voice info** (bonus, `ServerSectionsParityTest.kt` verbatim): `{"address":"ts.refx.gg:9987","voicePort":9987,"slots":32,"ready":true,"queryAdmin":"serveradmin","queryPassword":"secret","privilegeKey":"token123","licenseAccepted":false}`.

## 6. Enums, hostnames, deep links, push

**Enum wire values** (`app/src/main/java/gg/refx/android/data/model/Enums.kt`): decoded permissively (unknown → UNKNOWN via `PermissiveEnumSerializer`). ServerState raws: `INSTALLING, OFFLINE, STARTING, RUNNING, STOPPING, CRASHED, SUSPENDED, REINSTALLING, SWITCHING_GAME, TRANSFERRING, PENDING_PAYMENT`. UserRole: `PENDING_CUSTOMER, CUSTOMER, SUPPORT, ADMIN, OWNER` (SUPPORT/ADMIN/OWNER see the Staff tab). Lowercase exceptions: MFAMethod (`totp/recovery/webauthn`), EmailTheme (`dark/light`), PayPalMode (`sandbox/live`), PowerSignal (`start/stop/restart/kill`). BackupState: `PENDING, IN_PROGRESS, COMPLETED, FAILED`. Full lists for Ticket/Invoice/Payment/Subscription/Node/etc. in that file.

**Production hostnames**: `https://api.refx.gg` (API) and `https://refx.gg` (web) — `app/build.gradle.kts` lines 62–63/74–75. Docs reference `https://refx.gg/privacy`, `/terms`, `/support`, `support@refx.gg` (`docs/play-store-listing.md` lines 56–59, `docs/play-data-safety.md` lines 8–10, `docs/compliance.md` lines 60–61). Test-only hosts (fixtures, not production): n1.refx.gg, ts.refx.gg, smtp.refx.gg, edge1.refx.gg, play.refx.gg.

**Deep-link scheme/routes** (`app/src/main/AndroidManifest.xml` lines 35–40): a single https App Links intent-filter `android:scheme="https" android:host="refx.gg"` with `autoVerify="true"` ("Verification handled by assetlinks.json on refx.gg"). There is **no custom URI scheme** (no `refx://`), and `MainActivity.routeFromIntent` (`app/src/main/java/gg/refx/android/app/MainActivity.kt`) reads only intent **extras** (type/serverId/invoiceId/ticketId) — the app-link URI path is never parsed; app links just open the app.

**FCM push routing** (`app/src/main/java/gg/refx/android/core/push/PushRouter.kt`, `app/src/main/java/gg/refx/android/app/push/ReFxMessagingService.kt`): data-payload keys `type`, `serverId`, `invoiceId`, `ticketId` (constants KEY_TYPE etc.); title/body from `message.notification` falling back to data `title`/`body`. Backend notification types (comment in ReFxMessagingService): `server.state`, `billing.invoice`, `support.reply`. Routing is lowercased **substring** match on `type`: contains "server" → Servers tab; "invoice"/"billing"/"payment" → Billing (under Account tab); "ticket"/"support" → Support; bare serverId with no type → Servers; otherwise null (e.g. `marketing.promo` is dropped — `PushRouterTest.kt`). Cold launch: MainActivity seeds PushRouter from the launch intent when `savedInstanceState == null`; warm: `onNewIntent`. Token registration (`app/src/main/java/gg/refx/android/app/push/PushTokenRegistrar.kt`): register on the SignedIn transition and on FCM `onNewToken` via `POST account/push-tokens` body `{"token": ..., "platform": "android"}` (`data/model/Push.kt`); unregister on sign-out via `DELETE account/push-tokens/{token}`.

## 7. Misc client behaviors worth mirroring

- Repos always call APIs through `apiProvider` lambdas so origin changes (Retrofit rebuild) apply immediately (`app/src/main/java/gg/refx/android/app/AppContainer.kt`).
- `Page` dedupe on infinite scroll: page N+1 may re-include items from page N; the servers list dedupes by id (`app/src/test/java/gg/refx/android/ServersListViewModelTest.kt`).
- "Needs attention" server states: SUSPENDED, CRASHED, PENDING_PAYMENT (`data/model/Server.kt`).
- Section gating (`app/src/test/java/gg/refx/android/ServerSectionTest.kt`): Minecraft/Mods/Modpacks for slug == "minecraft" or prefix "minecraft-"; Voice (and hidden Console) for slug prefix "teamspeak"; Workshop gated by `template.supportsWorkshop`.
- `connectionString` = `(alias ?? ip) + ":" + port` from `primaryAllocation`.
- iOS parity source of truth: `ReFxFrank/ReFxHostingApp` (local copy at `C:\Users\frank\OneDrive\Desktop\ReFx-Products\ReFxCompanion\ReFxHostingApp`) — README.md "Notes".

## Open questions

- No console/websocket-token REST endpoint exists in the Android client and no 'websocket token response' fixture exists — the Socket.IO handshake reuses the regular access token (dual-passed). If the desktop plan assumed a Pterodactyl-style GET .../websocket token endpoint, that assumption does not match this backend/client.
- No verbatim JSON fixture for a real servers-list page (Page<Server>) exists — the enveloped page fixtures in EnvelopeConverterTest.kt/EnvelopeDecodingTest.kt use a test Dummy element type; the Server element shape must be taken from ServerDecodingTest.kt + data/model/Server.kt.
- No JSON fixture for a file listing (List<FileEntry>) or for FileContent exists in the Android tests; the shape is only defined by data/model/Files.kt. FileEntry.modifiedAt is a raw string because 'server format varies' — exact server format not determinable from this repo.
- No full Account (GET auth/me) JSON fixture exists — only the OrderProfile subset of GET account (OrderCheckoutDecodingTest.kt). Account field list comes from the DTO, not a captured response.
- TokenRefresher source carries the note that the auth/refresh request/response keys are 'the expected auth/refresh shape; reconcile against the panel API once the backend repo is available' — verify against ReFxHosting panel-api before relying on rotation semantics (the client tolerates both rotated and non-rotated refresh tokens).
- Whether POST auth/refresh returns its payload inside the {success,data} envelope was inferred from the client decoding (ApiEnvelope<RefreshResponse>); confirm against ReFxHosting panel-api auth controller.
- The console 'stats' event payload was only verified via the client-side StatsFrame model (serverId?, cpuPct, memUsedMb, diskUsedMb, netRxBytes, netTxBytes, state?, players?) — exact backend emission shape (and any extra fields) should be confirmed in ReFxHosting/apps/panel-api/src/agent/console.gateway.ts.
- The https app link (host refx.gg) opens the app but the URI path is never parsed by MainActivity — the intended app-link routes (if any) are not implemented in the Android client, so there is no route table to copy for the desktop app.
- The parity spec documents referenced throughout code comments (e.g. 'parity spec §3/§5', 'server-sections spec', 'account-security spec', 'billing-checkout spec', 'staff-admin spec') were not found in this repo — they presumably live in the iOS repo (ReFxCompanion/ReFxHostingApp/docs) and were not extracted here.
