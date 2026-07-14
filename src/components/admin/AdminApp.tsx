import { useMemo } from "react";
import { useAuth } from "../../store/auth";
import { useNav, type AdminScreen } from "../../store/nav";
import { hasPermission, type AdminPermission } from "../../lib/perms";
import { LogoWordmark } from "../Logo";
import Roles from "./Roles";

type NavItem = { screen: AdminScreen; label: string; perm: AdminPermission; ready?: boolean };
type NavGroup = { group: string; items: NavItem[] };

// The full staff nav. Items are permission-gated; screens not yet implemented
// (ready !== true) render a placeholder. Tiers fill these in.
const NAV: NavGroup[] = [
  { group: "Overview", items: [{ screen: "dashboard", label: "Dashboard", perm: "dashboard.read" }] },
  { group: "Fleet", items: [{ screen: "servers", label: "Servers", perm: "servers.read" }] },
  {
    group: "People",
    items: [{ screen: "users", label: "Users & customers", perm: "users.read" }],
  },
  {
    group: "Infrastructure",
    items: [
      { screen: "nodes", label: "Nodes", perm: "nodes.read" },
      { screen: "locations", label: "Locations", perm: "locations.manage" },
      { screen: "database-hosts", label: "Database hosts", perm: "nodes.manage" },
      { screen: "templates", label: "Templates", perm: "catalog.read" },
    ],
  },
  {
    group: "Support & ops",
    items: [
      { screen: "support", label: "Support", perm: "support.read" },
      { screen: "audit", label: "Audit log", perm: "audit.read" },
    ],
  },
  {
    group: "Commerce",
    items: [
      { screen: "invoices", label: "Invoices", perm: "billing.read" },
      { screen: "subscriptions", label: "Subscriptions", perm: "billing.read" },
      { screen: "payments", label: "Payments", perm: "payments.manage" },
      { screen: "growth", label: "Growth", perm: "billing.read" },
      { screen: "coupons", label: "Coupons", perm: "catalog.manage" },
      { screen: "gift-cards", label: "Gift cards", perm: "catalog.manage" },
      { screen: "products", label: "Products", perm: "catalog.read" },
    ],
  },
  {
    group: "Platform",
    items: [
      { screen: "content", label: "Content & banners", perm: "content.read" },
      { screen: "team", label: "Team page", perm: "content.manage" },
      { screen: "roles", label: "Roles & staff", perm: "roles.manage", ready: true },
      { screen: "settings", label: "Settings", perm: "settings.manage" },
    ],
  },
];

export default function AdminApp() {
  const profile = useAuth((s) => s.profile);
  const { adminScreen, goAdmin, setView } = useNav();
  const perms = profile?.permissions ?? [];

  // Filter the nav to what this staffer can see.
  const groups = useMemo(
    () =>
      NAV.map((g) => ({
        ...g,
        items: g.items.filter((it) => hasPermission(perms, it.perm)),
      })).filter((g) => g.items.length > 0),
    [perms],
  );

  const current = groups.flatMap((g) => g.items).find((it) => it.screen === adminScreen);

  return (
    <div className="flex h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-[rgba(7,11,18,0.6)]">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3.5">
          <LogoWordmark height={16} />
          <span className="refx-eyebrow">Staff</span>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.map((g) => (
            <div key={g.group} className="mb-3">
              <div className="refx-eyebrow px-2 pb-1">{g.group}</div>
              {g.items.map((it) => (
                <button
                  key={it.screen}
                  onClick={() => goAdmin(it.screen)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition ${
                    it.screen === adminScreen
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                  }`}
                >
                  <span>{it.label}</span>
                  {!it.ready && <span className="text-[10px] text-muted-foreground/60">soon</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button
          onClick={() => setView("customer")}
          className="btn-ghost m-2 rounded-md px-3 py-2 text-sm"
        >
          ← Back to my servers
        </button>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3">
          <h1 className="text-base font-semibold tracking-tight">{current?.label ?? "Admin"}</h1>
          <span className="text-sm text-muted-foreground">{profile?.email}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AdminScreenView screen={adminScreen} ready={current?.ready} />
        </div>
      </main>
    </div>
  );
}

function AdminScreenView({ screen, ready }: { screen: AdminScreen; ready?: boolean }) {
  if (screen === "roles") return <Roles />;
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <div className="refx-eyebrow">{ready ? "Not available" : "Coming soon"}</div>
        <p className="mt-2 text-sm text-muted-foreground">
          This section is being built. The operational tools (servers, users, nodes, support,
          audit) land first, then billing and the rest.
        </p>
      </div>
    </div>
  );
}
