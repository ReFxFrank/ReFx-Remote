import { useCallback, useEffect, useState } from "react";
import { ipc, errorMessage, type Schedule } from "../lib/ipc";

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function Schedules({ serverId, canManage }: { serverId: string; canManage: boolean }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSchedules(await ipc.schedulesList(serverId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function act(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="refx-panel min-h-0 flex-1 overflow-y-auto p-4">
      {error && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {loading ? (
        <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
      ) : schedules.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted-foreground">
          No schedules. Create them on refx.gg — this app can enable/disable and run them.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {schedules.map((s) => (
            <li key={s.id} className="refx-card p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{s.name || "(unnamed)"}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        s.isActive ? "bg-success/15 text-success" : "bg-white/[0.06] text-muted-foreground"
                      }`}
                    >
                      {s.isActive ? "Active" : "Paused"}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground [&>*:not(:first-child)]:before:mr-2 [&>*:not(:first-child)]:before:content-['·']">
                    {s.cron && <span className="font-mono">{s.cron}</span>}
                    <span>next {fmtDate(s.nextRunAt)}</span>
                    {s.tasks.length > 0 && <span>{s.tasks.length} task{s.tasks.length === 1 ? "" : "s"}</span>}
                  </div>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <button
                      onClick={() => void act(s.id, () => ipc.scheduleRun(serverId, s.id))}
                      disabled={busyId === s.id}
                      className="btn-ghost rounded-md px-2.5 py-1 disabled:opacity-40"
                    >
                      Run now
                    </button>
                    <button
                      onClick={() => void act(s.id, () => ipc.scheduleSetActive(serverId, s.id, !s.isActive))}
                      disabled={busyId === s.id}
                      className="btn-ghost rounded-md px-2.5 py-1 disabled:opacity-40"
                    >
                      {s.isActive ? "Pause" : "Enable"}
                    </button>
                  </div>
                )}
              </div>
              {s.tasks.length > 0 && (
                <ul className="mt-2 border-t border-white/[0.05] pt-2 text-xs text-muted-foreground">
                  {[...s.tasks]
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                    .map((t, i) => (
                    <li key={t.id ?? i} className="flex items-center gap-2 py-0.5">
                      <span className="text-muted-foreground/70">+{Math.round((t.timeOffsetMs ?? 0) / 1000)}s</span>
                      <span className="font-medium text-foreground/85">{t.action}</span>
                      {t.payload && <span className="truncate font-mono">{t.payload}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
