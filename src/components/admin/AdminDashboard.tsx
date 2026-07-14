import { useEffect, useState } from "react";
import { ipc, errorMessage, type AdminMetrics } from "../../lib/ipc";
import { money } from "../../lib/format";

export default function AdminDashboard() {
  const [m, setM] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ipc.admin.metrics().then(setM).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error)
    return (
      <div className="p-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      </div>
    );
  if (!m) return <div className="p-6 text-sm text-muted-foreground">Loading dashboard…</div>;

  const t = m.totals;
  const byState = Object.entries(m.serversByState ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Users" value={t?.users} />
        <Tile label="Servers" value={t?.servers} />
        <Tile label="Nodes online" value={t?.nodesOnline} />
        <Tile label="Open tickets" value={t?.openTickets} />
        <Tile label="Active subs" value={t?.activeSubscriptions} />
        <Tile label="MRR" value={t ? money(t.mrrMinor, t.mrrCurrency) : undefined} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="refx-card p-4">
          <div className="refx-eyebrow mb-3">Servers by state</div>
          {byState.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {byState.map(([s, n]) => (
                <li key={s} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{s}</span>
                  <span className="font-medium text-foreground">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="refx-card p-4">
          <div className="refx-eyebrow mb-3">Node health</div>
          {m.nodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No nodes reporting.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {m.nodes.map((n) => (
                <li key={n.id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-foreground">{n.name ?? n.id}</span>
                    <span className="text-xs text-muted-foreground">
                      CPU {pct(n.cpuPct)} · MEM {pct(n.memPct)} · DISK {pct(n.diskPct)}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Bar v={n.cpuPct} />
                    <Bar v={n.memPct} />
                    <Bar v={n.diskPct} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

function Tile({ label, value }: { label: string; value: number | string | null | undefined }) {
  return (
    <div className="refx-card p-3">
      <div className="refx-eyebrow">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-foreground">
        {value == null ? "—" : typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function Bar({ v }: { v: number | null | undefined }) {
  const val = Math.max(0, Math.min(100, v ?? 0));
  const color = val >= 90 ? "bg-destructive" : val >= 70 ? "bg-warning" : "bg-primary";
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${val}%` }} />
    </div>
  );
}
