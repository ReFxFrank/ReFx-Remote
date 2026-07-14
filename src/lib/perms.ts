// Admin RBAC permission model — a faithful mirror of the backend catalog in
// ReFxHosting `apps/panel-api/src/common/permissions.ts`. The Rust side
// (`panel/perms.rs`) mirrors the same matcher for the money-command guards;
// keep all three in lock-step (shared test vectors live in both matchers).

export const WILDCARD = "*";

/** The 27 granular admin permission strings, in catalog order. */
export const ADMIN_PERMISSIONS = [
  "dashboard.read",
  "servers.read",
  "servers.manage",
  "nodes.read",
  "nodes.manage",
  "locations.manage",
  "users.read",
  "users.manage",
  "users.create",
  "users.suspend",
  "users.delete",
  "users.credit",
  "users.password",
  "users.verify-email",
  "billing.read",
  "billing.manage",
  "billing.refund",
  "payments.manage",
  "catalog.read",
  "catalog.manage",
  "content.read",
  "content.manage",
  "support.read",
  "support.manage",
  "audit.read",
  "settings.manage",
  "roles.manage",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/**
 * True if `perms` grants `required`. Hierarchy (each rung implies the next):
 *  - `*`            — owner: everything
 *  - exact match
 *  - `<area>.*`     — explicit area wildcard
 *  - `<area>.manage`— coarse "manage this area" implies every granular action
 *                     under it, but "manage" is not itself implied by anything
 *                     narrower, and payments.manage / roles.manage are their own
 *                     areas (NOT implied by billing.manage — the prefix scoping
 *                     handles that for free).
 */
export function hasPermission(perms: string[], required: string): boolean {
  if (perms.includes(WILDCARD) || perms.includes(required)) return true;
  const area = required.split(".")[0];
  if (perms.includes(`${area}.*`)) return true;
  if (required !== `${area}.manage` && perms.includes(`${area}.manage`)) {
    return true;
  }
  return false;
}

/** True if `perms` grants every one of `required`. */
export function hasAllPermissions(perms: string[], required: string[]): boolean {
  return required.every((r) => hasPermission(perms, r));
}

/** True if `perms` grants at least one of `required`. */
export function hasAnyPermission(perms: string[], required: string[]): boolean {
  return required.some((r) => hasPermission(perms, r));
}

/** A user is staff iff they hold any admin permission (the server's own test). */
export function isStaffPerms(perms: string[] | undefined | null): boolean {
  return (perms?.length ?? 0) > 0;
}

/** Grouping + labels for the role editor (UI only; not sent to the server). */
export const PERMISSION_GROUPS: {
  group: string;
  items: { key: AdminPermission; label: string; hint?: string }[];
}[] = [
  {
    group: "Overview",
    items: [{ key: "dashboard.read", label: "View dashboard" }],
  },
  {
    group: "Servers",
    items: [
      { key: "servers.read", label: "View all servers" },
      { key: "servers.manage", label: "Manage any server", hint: "Power, resize, transfer, suspend, delete." },
    ],
  },
  {
    group: "Infrastructure",
    items: [
      { key: "nodes.read", label: "View nodes" },
      { key: "nodes.manage", label: "Manage nodes" },
      { key: "locations.manage", label: "Manage locations" },
    ],
  },
  {
    group: "Users",
    items: [
      { key: "users.read", label: "View users" },
      { key: "users.manage", label: "Manage users", hint: "Implies every granular user action below." },
      { key: "users.create", label: "Create accounts" },
      { key: "users.suspend", label: "Suspend / ban / reactivate" },
      { key: "users.delete", label: "Delete / GDPR purge" },
      { key: "users.credit", label: "Adjust store credit", hint: "Money-moving." },
      { key: "users.password", label: "Reset / set passwords" },
      { key: "users.verify-email", label: "Verify email" },
    ],
  },
  {
    group: "Billing",
    items: [
      { key: "billing.read", label: "View billing" },
      { key: "billing.manage", label: "Manage billing", hint: "Implies refunds." },
      { key: "billing.refund", label: "Refund invoices", hint: "Money-moving." },
      { key: "payments.manage", label: "Manage payment gateways", hint: "Owner-level." },
    ],
  },
  {
    group: "Catalog & content",
    items: [
      { key: "catalog.read", label: "View catalog" },
      { key: "catalog.manage", label: "Manage catalog / products" },
      { key: "content.read", label: "View content" },
      { key: "content.manage", label: "Manage content / banners" },
    ],
  },
  {
    group: "Support & ops",
    items: [
      { key: "support.read", label: "View support tickets" },
      { key: "support.manage", label: "Manage support tickets" },
      { key: "audit.read", label: "View audit log" },
      { key: "settings.manage", label: "Manage platform settings" },
      { key: "roles.manage", label: "Manage roles & staff", hint: "Owner-level." },
    ],
  },
];
