import { useState } from "react";
import type { PowerSignal, ServerSummary } from "../lib/ipc";
import { useServers } from "../store/servers";
import { bytesRate, fromMb, pct, stateDot, stateLabel, uptime } from "../lib/format";
import PowerControls from "./PowerControls";
import Console from "./Console";

export default function ServerDetailPanel({ server }: { server: ServerSummary }) {
  const {
    selectedDetail,
    selectedStats,
    netRates,
    statsError,
    pending,
    actionError,
    clearActionError,
    power,
  } = useServers();
  const [copied, setCopied] = useState(false);

  // Gate power controls on the caller's effective permissions once the
  // detail has loaded; undefined while loading (assume allowed).
  const detailReady = selectedDetail && selectedDetail.id === server.id;
  const hasPerm = (...keys: string[]) =>
    !!detailReady &&
    selectedDetail!.viewerPermissions.some((p) => keys.includes(p) || p === "*");
  const canPower = detailReady
    ? hasPerm("control.power", "control.*")
    : undefined;
  // Command input: gate on console.command; while the detail is still loading
  // assume allowed (owner is the common case), with the 403 backstop.
  const canCommand = detailReady ? hasPerm("console.command", "console.*") : true;

  const alloc = server.primaryAllocation;
  const address = alloc?.ip ? `${alloc.ip}:${alloc.port}` : null;
  const p = pending[server.id];
  const stats = selectedStats;

  // Optimistic display: show the pending transition until the panel confirms.
  const shownState =
    p?.signal === "start"
      ? "STARTING"
      : p?.signal === "stop" || p?.signal === "kill"
        ? "STOPPING"
        : p?.signal === "restart"
          ? "STARTING"
          : server.state;

  const overdue = p && Date.now() - p.since > 30_000;

  function doPower(signal: PowerSignal) {
    clearActionError();
    void power(server.id, signal);
  }

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // Clipboard can be locked/denied in WebView2 — fail visibly, not silently.
        setCopied(false);
      },
    );
  }

  const memTotal = stats?.memTotalMb || server.memoryMb || 0;
  const diskTotal = server.diskMb || 0;

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full ${stateDot(shownState)}`} />
            <h1 className="truncate text-xl font-semibold">{server.name}</h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            {server.template?.name}
            {server.node?.name ? ` · ${server.node.name}` : ""} · {stateLabel(shownState)}
            {p ? " (waiting for the panel…)" : ""}
          </p>
        </div>
        {address && (
          <button
            onClick={copyAddress}
            className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-mono text-zinc-200 transition hover:border-zinc-500"
            title="Copy connect address"
          >
            {copied ? "Copied!" : address}
          </button>
        )}
      </div>

      {overdue && (
        <p className="mt-3 rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
          The panel hasn't confirmed this yet — it may still be working, or the
          server may have failed to change state.
        </p>
      )}
      {actionError && (
        <p className="mt-3 rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {actionError}
        </p>
      )}

      <div className="mt-5">
        <PowerControls
          state={server.state}
          serverName={server.name}
          busy={!!p}
          canPower={canPower}
          onPower={doPower}
        />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="CPU" value={stats ? `${stats.cpuPct.toFixed(0)}%` : "—"} />
        <Stat
          label="Memory"
          value={stats ? fromMb(stats.memUsedMb) : "—"}
          sub={memTotal ? `of ${fromMb(memTotal)}` : undefined}
          bar={stats && memTotal ? pct(stats.memUsedMb, memTotal) : undefined}
        />
        <Stat
          label="Disk"
          value={stats ? fromMb(stats.diskUsedMb) : "—"}
          sub={diskTotal ? `of ${fromMb(diskTotal)}` : undefined}
          bar={stats && diskTotal ? pct(stats.diskUsedMb, diskTotal) : undefined}
        />
        <Stat
          label="Network"
          value={netRates ? `↓ ${bytesRate(netRates.rxPerSec)}` : "—"}
          sub={netRates ? `↑ ${bytesRate(netRates.txPerSec)}` : "measuring…"}
        />
        <Stat
          label="Players"
          value={stats?.players != null ? String(stats.players) : "—"}
        />
        <Stat label="Uptime" value={stats ? (uptime(stats.uptimeMs) ?? "—") : "—"} />
      </div>

      {statsError && <p className="mt-3 text-xs text-zinc-500">{statsError}</p>}

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <Console key={server.id} serverId={server.id} canCommand={canCommand} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  bar,
}: {
  label: string;
  value: string;
  sub?: string;
  bar?: number;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-semibold">{value}</span>
        {sub && <span className="text-xs text-zinc-500">{sub}</span>}
      </div>
      {bar != null && (
        <div className="mt-2 h-1 overflow-hidden rounded bg-zinc-800">
          <div className="h-full bg-emerald-500" style={{ width: `${bar}%` }} />
        </div>
      )}
    </div>
  );
}
