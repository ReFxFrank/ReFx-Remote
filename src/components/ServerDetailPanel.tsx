import { useState } from "react";
import type { PowerSignal, ServerSummary } from "../lib/ipc";
import { useServers } from "../store/servers";
import { bytesRate, fromMb, pct, stateDot, stateLabel, uptime } from "../lib/format";
import PowerControls from "./PowerControls";
import Console from "./Console";
import Files from "./Files";
import Backups from "./Backups";
import Startup from "./Startup";
import Schedules from "./Schedules";
import Databases from "./Databases";

type Tab = "console" | "files" | "backups" | "startup" | "schedules" | "databases";
const TABS: Tab[] = ["console", "files", "backups", "startup", "schedules", "databases"];

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
  const canFileWrite = detailReady ? hasPerm("files.write", "files.*") : true;
  const canBackupCreate = detailReady ? hasPerm("backup.create", "backup.*") : true;
  const canBackupRestore = detailReady ? hasPerm("backup.restore", "backup.*") : true;
  const canBackupDelete = detailReady ? hasPerm("backup.delete", "backup.*") : true;
  const canSchedule = detailReady ? hasPerm("schedule.update", "schedule.*") : true;
  const canEditSettings = detailReady ? hasPerm("settings.update", "settings.*") : true;
  const [tab, setTab] = useState<Tab>("console");

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
          <div className="flex items-center gap-2.5">
            <span className={`h-3 w-3 rounded-full ${stateDot(shownState)}`} />
            <h1 className="truncate text-xl font-semibold tracking-tight">{server.name}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {server.template?.name}
            {server.node?.name ? ` · ${server.node.name}` : ""} · {stateLabel(shownState)}
            {p ? " (waiting for the panel…)" : ""}
          </p>
        </div>
        {address && (
          <button
            onClick={copyAddress}
            className="refx-input shrink-0 rounded-md px-3 py-1.5 font-mono text-sm text-foreground transition hover:border-primary/50"
            title="Copy connect address"
          >
            {copied ? "Copied!" : address}
          </button>
        )}
      </div>

      {overdue && (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          The panel hasn't confirmed this yet — it may still be working, or the
          server may have failed to change state.
        </p>
      )}
      {actionError && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
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

      {statsError && <p className="mt-3 text-xs text-muted-foreground">{statsError}</p>}

      <div className="mt-6 flex items-center gap-1 overflow-x-auto border-b border-white/[0.06]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-1.5 text-sm capitalize transition ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Both stay mounted (toggled via `hidden`) so switching tabs doesn't
          tear down an open file editor's unsaved work or churn the console
          socket. */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <div className={`flex min-h-0 flex-1 flex-col ${tab === "console" ? "" : "hidden"}`}>
          <Console key={server.id} serverId={server.id} canCommand={canCommand} />
        </div>
        <div className={`flex min-h-0 flex-1 flex-col ${tab === "files" ? "" : "hidden"}`}>
          <Files key={server.id} serverId={server.id} canWrite={canFileWrite} />
        </div>
        {/* Backups + the 4c tabs mount lazily on first open — avoids a fetch
            for every selected server before the user asks for it. */}
        {tab === "backups" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <Backups
              key={server.id}
              serverId={server.id}
              serverName={server.name}
              canCreate={canBackupCreate}
              canRestore={canBackupRestore}
              canDelete={canBackupDelete}
            />
          </div>
        )}
        {tab === "startup" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <Startup key={server.id} serverId={server.id} canEdit={canEditSettings} />
          </div>
        )}
        {tab === "schedules" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <Schedules key={server.id} serverId={server.id} canManage={canSchedule} />
          </div>
        )}
        {tab === "databases" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <Databases key={server.id} serverId={server.id} />
          </div>
        )}
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
    <div className="refx-card p-3">
      <div className="refx-eyebrow">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-lg font-semibold tracking-tight text-foreground">{value}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      {bar != null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[rgba(40,140,255,1)] to-[rgba(0,114,255,1)]"
            style={{ width: `${bar}%` }}
          />
        </div>
      )}
    </div>
  );
}
