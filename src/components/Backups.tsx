import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, errorMessage, type Backup } from "../lib/ipc";
import { fromMb } from "../lib/format";
import TypedConfirm from "./TypedConfirm";

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return fromMb(bytes / 1024 / 1024);
}
function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}
function stateColor(s: Backup["state"]): string {
  switch (s) {
    case "COMPLETED":
      return "text-emerald-400";
    case "FAILED":
      return "text-red-400";
    case "PENDING":
    case "IN_PROGRESS":
      return "text-amber-400";
    default:
      return "text-zinc-400";
  }
}

type Confirm =
  | { kind: "restore"; backup: Backup }
  | { kind: "delete"; backup: Backup }
  | null;

export default function Backups({
  serverId,
  serverName,
  canCreate,
  canRestore,
  canDelete,
}: {
  serverId: string;
  serverName: string;
  canCreate: boolean;
  canRestore: boolean;
  canDelete: boolean;
}) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  // Two separate error channels: a background poll must never wipe the error
  // from a user action (e.g. a create-cap 409 the user is still reading).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const seq = useRef(0);
  const error = actionError ?? loadError;

  const load = useCallback(async () => {
    const s = ++seq.current;
    try {
      const list = await ipc.backupsList(serverId);
      if (s === seq.current) {
        setBackups(list);
        setLoadError(null);
      }
    } catch (e) {
      if (s === seq.current) setLoadError(errorMessage(e));
    } finally {
      if (s === seq.current) setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Poll while any backup is still running, so progress/state advances.
  useEffect(() => {
    const running = backups.some((b) => b.state === "PENDING" || b.state === "IN_PROGRESS");
    if (!running) return;
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [backups, load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = window.prompt("Backup name:", `backup-${new Date().toISOString().slice(0, 10)}`);
    if (name == null) return;
    await run(async () => {
      await ipc.backupCreate(serverId, name.trim() || "backup");
      await load();
    });
  }

  async function toggleLock(b: Backup) {
    await run(async () => {
      await ipc.backupSetLocked(serverId, b.id, !b.isLocked);
      await load();
    });
  }

  async function download(b: Backup) {
    await run(async () => {
      await ipc.backupDownload(serverId, b.id, `${b.name ?? "backup"}.tar.gz`);
    });
  }

  function doConfirm() {
    if (!confirm) return;
    const { kind, backup } = confirm;
    setConfirm(null);
    void run(async () => {
      if (kind === "restore") await ipc.backupRestore(serverId, backup.id);
      else await ipc.backupDelete(serverId, backup.id);
      await load();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-xs">
        <span className="text-zinc-400">
          {backups.length} backup{backups.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="text-zinc-400 hover:text-zinc-200">
            Refresh
          </button>
          {canCreate && (
            <button
              onClick={() => void create()}
              disabled={busy}
              className="rounded bg-zinc-700 px-2 py-1 text-zinc-100 hover:bg-zinc-600 disabled:opacity-40"
            >
              Create backup
            </button>
          )}
        </div>
      </div>

      {error && <p className="border-b border-red-900 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-center text-sm text-zinc-500">Loading…</p>
        ) : backups.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">
            No backups yet.{canCreate ? " Create one to snapshot this server." : ""}
          </p>
        ) : (
          <ul>
            {backups.map((b) => (
              <li key={b.id} className="group border-b border-zinc-900 px-3 py-2 hover:bg-zinc-900/50">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-zinc-200">{b.name || "(unnamed)"}</span>
                      {b.isLocked && <span title="Locked" className="text-xs text-amber-400">🔒</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                      <span className={stateColor(b.state)}>
                        {b.state === "IN_PROGRESS"
                          ? `Backing up… ${Math.round(b.progressPct ?? 0)}%`
                          : b.state.charAt(0) + b.state.slice(1).toLowerCase()}
                      </span>
                      <span>· {fmtSize(b.sizeBytes)}</span>
                      {b.createdAt && <span>· {fmtDate(b.createdAt)}</span>}
                      {b.error && <span className="text-red-400">· {b.error}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs opacity-0 transition group-hover:opacity-100">
                    {b.state === "COMPLETED" && (
                      <button onClick={() => void download(b)} className="text-zinc-400 hover:text-zinc-200">
                        Download
                      </button>
                    )}
                    {canRestore && b.state === "COMPLETED" && (
                      <button
                        onClick={() => setConfirm({ kind: "restore", backup: b })}
                        className="text-amber-400 hover:text-amber-300"
                      >
                        Restore
                      </button>
                    )}
                    <button onClick={() => void toggleLock(b)} className="text-zinc-400 hover:text-zinc-200">
                      {b.isLocked ? "Unlock" : "Lock"}
                    </button>
                    {canDelete && (
                      <button
                        onClick={() => setConfirm({ kind: "delete", backup: b })}
                        disabled={b.isLocked}
                        className="text-red-400 hover:text-red-300 disabled:opacity-30"
                        title={b.isLocked ? "Unlock it first" : undefined}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirm?.kind === "restore" && (
        <TypedConfirm
          title="Restore this backup?"
          danger
          body={
            <p>
              Restoring <b>{confirm.backup.name || "this backup"}</b> overwrites the server's
              current files with the backup's contents. Anything created since the backup is lost.
            </p>
          }
          confirmWord={serverName}
          confirmLabel="Restore"
          onConfirm={doConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "delete" && (
        <TypedConfirm
          title="Delete this backup?"
          danger
          body={
            <p>
              Permanently delete <b>{confirm.backup.name || "this backup"}</b>. This can't be undone.
            </p>
          }
          confirmWord={serverName}
          confirmLabel="Delete"
          onConfirm={doConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
