import { useEffect, useState } from "react";
import {
  ipc,
  errorMessage,
  type AdminNode,
  type NodeHeartbeat,
  type NodePing,
  type NodeBootstrapToken,
  type NodeRegion,
} from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";
import TypedConfirm from "../TypedConfirm";

function memPct(n: AdminNode): number | null {
  const hb = n.latestHeartbeat;
  if (hb?.memUsedMb != null && n.memoryMb) return (hb.memUsedMb / n.memoryMb) * 100;
  return null;
}
function diskPct(n: AdminNode): number | null {
  const hb = n.latestHeartbeat;
  if (hb?.diskUsedMb != null && n.diskMb) return (hb.diskUsedMb / n.diskMb) * 100;
  return null;
}

export default function AdminNodes() {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  const canManage = hasPermission(perms, "nodes.manage");
  const canLocations = hasPermission(perms, "locations.manage");

  const [nodes, setNodes] = useState<AdminNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manage, setManage] = useState<AdminNode | null>(null);

  async function load() {
    try {
      const res = await ipc.admin.nodesList({ pageSize: 100 });
      setNodes(res.nodes);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function toggleMaintenance(n: AdminNode) {
    try {
      await ipc.admin.nodeSetMaintenance(n.id, !n.maintenance);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="p-6">
      {error && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      <div className="refx-card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">Node</th>
              <th className="px-4 py-2.5 font-medium">Region</th>
              <th className="px-4 py-2.5 font-medium">Servers</th>
              <th className="px-4 py-2.5 font-medium">Health (CPU / MEM / DISK)</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {nodes === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading nodes…
                </td>
              </tr>
            ) : nodes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No nodes.
                </td>
              </tr>
            ) : (
              nodes.map((n) => (
                <tr key={n.id} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${n.latestHeartbeat ? "bg-success" : "bg-muted-foreground/50"}`} />
                      <span className="font-medium text-foreground">{n.name ?? n.id}</span>
                      {n.maintenance && (
                        <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">maintenance</span>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{n.fqdn ?? ""}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{n.region?.name ?? n.region?.code ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{n.servers ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex w-40 gap-1">
                      <Bar v={n.latestHeartbeat?.cpuPct} />
                      <Bar v={memPct(n)} />
                      <Bar v={diskPct(n)} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setManage(n)} className="btn-ghost rounded px-2 py-1 text-xs">
                      Manage
                    </button>
                    {canManage && (
                      <button
                        onClick={() => void toggleMaintenance(n)}
                        className="btn-ghost rounded px-2 py-1 text-xs"
                      >
                        {n.maintenance ? "Exit maint." : "Maintenance"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canLocations && <LocationsPanel onError={setError} />}

      {manage && (
        <NodeDrawer
          node={manage}
          canManage={canManage}
          onClose={() => {
            setManage(null);
            void load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function Bar({ v }: { v: number | null | undefined }) {
  const val = v == null ? null : Math.max(0, Math.min(100, v));
  const color = val == null ? "bg-white/[0.06]" : val >= 90 ? "bg-destructive" : val >= 70 ? "bg-warning" : "bg-primary";
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]" title={val == null ? "no data" : `${Math.round(val)}%`}>
      {val != null && <div className={`h-full rounded-full ${color}`} style={{ width: `${val}%` }} />}
    </div>
  );
}

function NodeDrawer({
  node,
  canManage,
  onClose,
  onError,
}: {
  node: AdminNode;
  canManage: boolean;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [hb, setHb] = useState<NodeHeartbeat[] | null>(null);
  const [ping, setPing] = useState<NodePing | null>(null);
  const [token, setToken] = useState<NodeBootstrapToken | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    ipc.admin.nodeHeartbeats(node.id).then(setHb).catch(() => setHb([]));
    let alive = true;
    const poll = () => {
      ipc.admin.nodePing(node.id).then((p) => alive && setPing(p)).catch(() => {});
    };
    poll();
    const t = window.setInterval(poll, 15000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [node.id]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  // CPU history, oldest→newest, for the sparkline (heartbeats arrive newest-first).
  const cpuSeries = (hb ?? [])
    .slice(0, 120)
    .map((h) => h.cpuPct)
    .filter((v): v is number => v != null)
    .reverse();

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-white/[0.06] bg-[#070b12]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">{node.name ?? node.id}</h2>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{node.fqdn ?? ""}</p>
          </div>
          <button onClick={onClose} className="btn-ghost rounded-md px-2.5 py-1.5 text-sm">
            Close
          </button>
        </header>

        <div className="flex flex-col gap-5 p-6">
          <div className="refx-card p-3">
            <div className="flex items-center justify-between">
              <span className="refx-eyebrow">Connectivity</span>
              <span className={`text-sm ${ping?.reachable ? "text-success" : "text-muted-foreground"}`}>
                {ping == null
                  ? "probing…"
                  : ping.reachable
                    ? `reachable · ${ping.ms != null ? `${Math.round(ping.ms)} ms` : "—"}`
                    : "unreachable"}
              </span>
            </div>
          </div>

          <div>
            <div className="refx-eyebrow mb-2">CPU (recent heartbeats)</div>
            <Sparkline series={cpuSeries} />
          </div>

          {canManage && (
            <div>
              <div className="refx-eyebrow mb-2">Agent</div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void act(() => ipc.admin.nodeRestartAgent(node.id))} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
                  Restart agent
                </button>
                <button onClick={() => void act(() => ipc.admin.nodeUpdateAgent(node.id))} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
                  Update agent
                </button>
                <button
                  onClick={() => void ipc.admin.nodeRotateBootstrap(node.id).then(setToken).catch((e) => onError(errorMessage(e)))}
                  className="btn-ghost rounded-md px-3 py-1.5 text-sm"
                >
                  Rotate bootstrap token
                </button>
              </div>
            </div>
          )}

          {canManage && (
            <div>
              <div className="refx-eyebrow mb-2">Danger zone</div>
              <button onClick={() => setConfirmDelete(true)} className="btn-danger rounded-md px-3 py-1.5 text-sm">
                Delete node
              </button>
              <p className="mt-2 text-xs text-muted-foreground">Blocked while the node still has servers.</p>
            </div>
          )}
        </div>
      </div>

      {token && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setToken(null)}>
          <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold tracking-tight">Bootstrap token</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Shown once (1h TTL, single-use). Use it on the node to (re)register the agent.
            </p>
            <code className="mt-3 block select-all break-all rounded-md border border-white/10 bg-[rgba(7,13,24,0.7)] px-3 py-2 font-mono text-xs">
              {token.bootstrapToken}
            </code>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => void navigator.clipboard.writeText(token.bootstrapToken)}
                className="btn-ghost rounded-md px-3 py-1.5 text-sm"
              >
                Copy
              </button>
              <button onClick={() => setToken(null)} className="btn-primary rounded-md px-3 py-1.5 text-sm">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <TypedConfirm
          title={`Delete node ${node.name ?? node.id}`}
          danger
          confirmWord={node.name ?? node.id}
          confirmLabel="Delete node"
          body="Soft-deletes the node. This is blocked while it still has servers — move or delete them first."
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void act(async () => {
              await ipc.admin.nodeDelete(node.id);
              onClose();
            });
          }}
        />
      )}
    </div>
  );
}

function Sparkline({ series }: { series: number[] }) {
  if (series.length < 2) {
    return <div className="text-sm text-muted-foreground">Not enough heartbeat data yet.</div>;
  }
  const w = 480;
  const h = 60;
  const max = Math.max(100, ...series);
  const step = w / (series.length - 1);
  const pts = series.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 60 }}>
      <polyline points={pts} fill="none" stroke="rgba(0,114,255,0.9)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function LocationsPanel({ onError }: { onError: (m: string) => void }) {
  const [locs, setLocs] = useState<NodeRegion[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");

  async function load() {
    try {
      setLocs(await ipc.admin.locationsList());
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!code.trim() || !name.trim()) return;
    try {
      await ipc.admin.locationCreate(code.trim(), name.trim(), country.trim() || undefined);
      setCode("");
      setName("");
      setCountry("");
      setAdding(false);
      await load();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  async function remove(id: string) {
    try {
      await ipc.admin.locationDelete(id);
      await load();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <div className="refx-card mt-6 p-4">
      <div className="flex items-center justify-between">
        <div className="refx-eyebrow">Locations</div>
        <button onClick={() => setAdding((a) => !a)} className="btn-ghost rounded-md px-3 py-1 text-sm">
          {adding ? "Cancel" : "Add location"}
        </button>
      </div>

      {adding && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Code" value={code} set={setCode} w="w-24" />
          <Field label="Name" value={name} set={setName} w="w-48" />
          <Field label="Country" value={country} set={setCountry} w="w-24" />
          <button onClick={() => void create()} className="btn-primary rounded-md px-3 py-1.5 text-sm">
            Create
          </button>
        </div>
      )}

      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {locs === null ? (
          <li className="text-muted-foreground">Loading…</li>
        ) : locs.length === 0 ? (
          <li className="text-muted-foreground">No locations.</li>
        ) : (
          locs.map((l) => (
            <li key={l.id} className="flex items-center justify-between rounded-md border border-white/[0.06] px-3 py-1.5">
              <span>
                <span className="text-foreground">{l.name ?? l.code}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{l.code}</span>
                {l.country && <span className="ml-2 text-xs text-muted-foreground">{l.country}</span>}
              </span>
              <button onClick={() => void remove(l.id)} className="text-xs text-destructive hover:underline">
                Delete
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function Field({ label, value, set, w }: { label: string; value: string; set: (s: string) => void; w: string }) {
  return (
    <label className="text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        className={`refx-input mt-0.5 block ${w} rounded-md px-2 py-1 text-sm text-foreground outline-none focus:border-primary/60`}
      />
    </label>
  );
}
