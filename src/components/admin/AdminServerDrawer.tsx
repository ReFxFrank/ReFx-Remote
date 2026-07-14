import { useState } from "react";
import { ipc, errorMessage, type AdminServer, type PowerSignal } from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";
import { stateDot, stateLabel } from "../../lib/format";
import PowerControls from "../PowerControls";
import Console from "../Console";
import Files from "../Files";
import Backups from "../Backups";
import Startup from "../Startup";
import Schedules from "../Schedules";
import Databases from "../Databases";

type Tab = "console" | "files" | "backups" | "startup" | "schedules" | "databases";
const TABS: Tab[] = ["console", "files", "backups", "startup", "schedules", "databases"];

/**
 * Staff "Manage" surface for any server. Reuses the customer per-server
 * components (all serverId-driven, store-independent) with staff permissions —
 * the panel API's `servers.manage` override authorizes them, with 403 as the
 * backstop. Distinct from the customer `ServerDetailPanel`, which is bound to the
 * customer's own polling store.
 */
export default function AdminServerDrawer({
  server,
  onClose,
}: {
  server: AdminServer;
  onClose: () => void;
}) {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  // Staff can act on any server only with servers.manage; a servers.read-only
  // staffer (e.g. the support role) gets a view-only drawer instead of enabled
  // controls that would all dead-end in 403.
  const canManage = hasPermission(perms, "servers.manage");
  const [tab, setTab] = useState<Tab>("console");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function power(signal: PowerSignal) {
    setPending(signal);
    setError(null);
    try {
      await ipc.serverPower(server.id, signal);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      // No live poll here; the fleet list refreshes on close.
      window.setTimeout(() => setPending(null), 1500);
    }
  }

  const owner = server.owner;

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="ml-auto flex h-full w-full max-w-4xl flex-col border-l border-white/[0.06] bg-[#070b12]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className={`h-2.5 w-2.5 rounded-full ${stateDot(server.state)}`} />
              <h2 className="truncate text-lg font-semibold tracking-tight">{server.name}</h2>
              <span className="text-sm text-muted-foreground">{stateLabel(server.state)}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {owner?.email ?? "unknown owner"}
              {server.node?.name ? ` · ${server.node.name}` : ""}
              {server.template?.name ? ` · ${server.template.name}` : ""}
              {server.primaryAllocation?.ip
                ? ` · ${server.primaryAllocation.ip}:${server.primaryAllocation.port}`
                : ""}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost rounded-md px-2.5 py-1.5 text-sm">
            Close
          </button>
        </header>

        <div className="border-b border-white/[0.06] px-6 py-3">
          <PowerControls
            state={server.state}
            serverName={server.name}
            busy={!!pending}
            canPower={canManage}
            onPower={(s) => void power(s)}
          />
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex items-center gap-1 overflow-x-auto border-b border-white/[0.06] px-6">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm capitalize transition ${
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-6">
          <div className={`flex min-h-0 flex-1 flex-col ${tab === "console" ? "" : "hidden"}`}>
            <Console key={server.id} serverId={server.id} canCommand={canManage} />
          </div>
          <div className={`flex min-h-0 flex-1 flex-col ${tab === "files" ? "" : "hidden"}`}>
            <Files key={server.id} serverId={server.id} canWrite={canManage} />
          </div>
          {tab === "backups" && (
            <Backups
              key={server.id}
              serverId={server.id}
              serverName={server.name}
              canCreate={canManage}
              canRestore={canManage}
              canDelete={canManage}
            />
          )}
          {tab === "startup" && <Startup key={server.id} serverId={server.id} canEdit={canManage} />}
          {tab === "schedules" && <Schedules key={server.id} serverId={server.id} canManage={canManage} />}
          {tab === "databases" && <Databases key={server.id} serverId={server.id} canManage={canManage} />}
        </div>
      </div>
    </div>
  );
}
