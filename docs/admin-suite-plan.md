# Staff Admin Suite — build plan

Adds a **staff admin surface** to ReFx Desktop, reusing the existing architecture
(all network I/O in Rust behind `#[tauri::command]`s; React/TS frontend; permissive
serde decode; `TypedConfirm` for dangerous actions). Grounded in the real backend
source at `../ReFxHosting/apps/panel-api` and web admin at `../ReFxHosting/apps/web/app/(admin)`.

**Scale:** ~198 admin endpoints across ~25 screens — effectively a second app. Almost
all tabular CRUD + form dialogs + stat tiles; the only non-trivial ports are one node
heartbeat time-series chart and a few poll loops. No sockets, no uploads (staff avatar
is base64 data-URI), no iframes.

Scope decided with Frank (2026-07-13): **full suite, operations-first**; **full mutating
actions, guarded** (typed confirmation on destructive / money-moving actions).

## Foundation (Tier 0)
- **Staff signal:** `profile.permissions.length > 0` (the server's own test). Customers
  (empty permissions) never see any admin affordance.
- **Permission matcher:** mirror `common/permissions.ts` `hasPermission` exactly in
  `src/lib/perms.ts` + `src-tauri/src/panel/perms.rs` (shared test vectors). Hierarchy:
  `*` ⇒ all; exact; `area.*`; `area.manage` ⇒ every granular action in that area only
  (`payments.manage`/`roles.manage` are their own areas, NOT implied by `billing.manage`).
- **Navigation:** one window; a `Shell` between `App` and the views with a Customer|Admin
  toggle (staff only); admin sidebar nav filtered per-permission; `mustChangePassword`
  blocks everything with a forced-change screen.
- **Rust:** `panel/admin/` module tree mirroring the domain split; `commands_admin.rs`
  with `admin_*` commands; `ipc.ts` `admin` namespace; keep `docs/ipc-contract.md` in step.
- First screen: **Roles/RBAC** (`roles.manage`) — how staff are made.

## Tiers
- **Tier 0** foundation + Roles.
- **Tier 1** ops backbone: Servers oversight (reuses `ServerDetailPanel` for per-server
  management via staff `servers.manage` override), Users & Customers, Nodes & infra
  (first chart + polling), Support desk, Audit & alerts.
- **Tier 2** commerce/billing (invoices/refunds, subscriptions, payments, growth) —
  money doctrine below.
- **Tier 3** long tail: coupons, gift-cards, products/catalog, content/banners, public
  team page, platform settings.

## Money-moving doctrine (any tier)
Allowlist: `admin_user_credit_adjust`, `admin_invoice_refund`, `admin_server_vanity_strip`
(refund=credit), subscription comp/cancel-with-refund, gift-card issuance.
1. Rust re-checks the exact permission AND requires a `confirm_token` the user typed
   (e.g. `"<amount> <currency>"`); mismatch ⇒ `VALIDATION`, no wire call.
2. `TypedConfirm` UI: source→destination, amount in **major units + currency**, reason;
   submit gated on the typed match; single-flight.
3. No auto-retry, no bulk; dedupe in-flight by `(command, target_id)`.
4. Hide (not just disable) controls the caller lacks.
5. Confirm the effect (refetch balance/record) + link into Audit.
6. Surface footguns: deleting a server does NOT cancel its subscription; vanity-strip
   refund issues store credit.
7. The app never handles card/bank details; refunds/credits are staff acting on customer
   accounts through the panel's own authorized endpoints.

## Recorded decisions / risks
- Staff test is `permissions.length > 0`, not `globalRole` (matches server).
- `PATCH /admin/users/:id` (state) skips the rank guard the `ban`/`suspend` routes enforce;
  the web uses the guardless PATCH — desktop mirrors it (server still authoritative). Recorded.
- `GET /nodes/:id/capacity` is gated by coarse `GlobalRole.ADMIN`; degrade gracefully for
  non-ADMIN staff (no headroom hints), don't block resize.
- Confirm `NodeCapacity` units (cores vs millicores, MB vs MiB) before resize math ships.
- Live verification needs a **staff/admin account** (the `test@remote.com` account is a
  customer). Frank's own account is owner/admin. Scaffold builds against source-of-truth
  backend code; live-verify when a staff login is available.
