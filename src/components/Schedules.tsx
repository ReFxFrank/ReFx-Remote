import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ipc, errorMessage, type Schedule } from "../lib/ipc";
import { ConfirmDialog, Dialog } from "./Dialog";

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

type SchedDialog =
  | { kind: "create" }
  | { kind: "edit"; schedule: Schedule }
  | { kind: "delete"; schedule: Schedule };

type CreateFields = {
  name: string;
  cron: string;
  onlyWhenOnline: boolean;
  isActive: boolean;
  taskAction: string;
  taskPayload: string;
};
type EditFields = { name: string; cron: string; onlyWhenOnline: boolean };

export default function Schedules({ serverId, canManage }: { serverId: string; canManage: boolean }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<SchedDialog | null>(null);

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

  async function save(fn: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function doCreate(f: CreateFields) {
    setDialog(null);
    void save(async () => {
      await ipc.scheduleCreate(serverId, f);
    });
  }
  function doUpdate(id: string, f: EditFields) {
    setDialog(null);
    void save(async () => {
      await ipc.scheduleUpdate(serverId, id, f);
    });
  }
  function doDelete(id: string) {
    setDialog(null);
    void save(() => ipc.scheduleDelete(serverId, id));
  }

  return (
    <div className="refx-panel min-h-0 flex-1 overflow-y-auto p-4">
      {canManage && (
        <div className="mb-3 flex justify-end">
          <button
            onClick={() => setDialog({ kind: "create" })}
            disabled={saving}
            className="btn-ghost rounded-md px-2.5 py-1 text-xs disabled:opacity-40"
          >
            New schedule
          </button>
        </div>
      )}
      {error && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {loading ? (
        <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
      ) : schedules.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted-foreground">
          No schedules yet.{canManage ? " Create one to automate commands, restarts, and more." : ""}
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
                    <button
                      onClick={() => setDialog({ kind: "edit", schedule: s })}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDialog({ kind: "delete", schedule: s })}
                      className="text-destructive/80 hover:text-destructive"
                    >
                      Delete
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
                        <span className="text-muted-foreground/70">
                          +{Math.round((t.timeOffsetMs ?? 0) / 1000)}s
                        </span>
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

      {(dialog?.kind === "create" || dialog?.kind === "edit") && (
        <ScheduleDialog
          schedule={dialog.kind === "edit" ? dialog.schedule : undefined}
          busy={saving}
          onCreate={doCreate}
          onUpdate={doUpdate}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.schedule.name || "schedule"}?`}
          body="This removes the schedule and its tasks. This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => doDelete(dialog.schedule.id)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

const CRON_HINT = "minute hour day month weekday — e.g. 0 4 * * * runs every day at 4:00";

function ScheduleDialog({
  schedule,
  busy,
  onCreate,
  onUpdate,
  onCancel,
}: {
  schedule?: Schedule;
  busy: boolean;
  onCreate: (f: CreateFields) => void;
  onUpdate: (id: string, f: EditFields) => void;
  onCancel: () => void;
}) {
  const editing = !!schedule;
  const [name, setName] = useState(schedule?.name ?? "");
  const [cron, setCron] = useState(schedule?.cron ?? "0 4 * * *");
  const [onlyWhenOnline, setOnlyWhenOnline] = useState(schedule?.onlyWhenOnline ?? false);
  const [isActive, setIsActive] = useState(schedule?.isActive ?? true);
  const [action, setAction] = useState<"COMMAND" | "POWER">("COMMAND");
  const [command, setCommand] = useState("");
  const [signal, setSignal] = useState("restart");

  const cronValid = cron.trim().split(/\s+/).length === 5;
  const taskValid = editing || action === "POWER" || command.trim().length > 0;
  const valid = name.trim().length > 0 && cronValid && taskValid && !busy;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    if (editing) {
      onUpdate(schedule!.id, { name: name.trim(), cron: cron.trim(), onlyWhenOnline });
    } else {
      onCreate({
        name: name.trim(),
        cron: cron.trim(),
        onlyWhenOnline,
        isActive,
        taskAction: action,
        taskPayload: action === "COMMAND" ? command.trim() : signal,
      });
    }
  }

  const input =
    "refx-input mt-2 w-full rounded-md px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60";

  return (
    <Dialog title={editing ? "Edit schedule" : "New schedule"} onClose={onCancel}>
      <form onSubmit={submit}>
        <label className="refx-eyebrow mt-4 block">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nightly restart"
          className={input}
        />

        <label className="refx-eyebrow mt-4 block">Schedule (cron)</label>
        <input value={cron} onChange={(e) => setCron(e.target.value)} className={`${input} font-mono`} />
        <p className="mt-1 text-[11px] text-muted-foreground/70">{CRON_HINT}</p>
        {!cronValid && cron.trim() && (
          <p className="mt-1 text-[11px] text-warning">Cron needs 5 space-separated fields.</p>
        )}

        {!editing && (
          <>
            <label className="refx-eyebrow mt-4 block">Action</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as "COMMAND" | "POWER")}
              className={input}
            >
              <option value="COMMAND">Send a command</option>
              <option value="POWER">Power action</option>
            </select>
            {action === "COMMAND" ? (
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="say Restarting soon"
                className={`${input} font-mono`}
              />
            ) : (
              <select value={signal} onChange={(e) => setSignal(e.target.value)} className={input}>
                <option value="start">Start</option>
                <option value="restart">Restart</option>
                <option value="stop">Stop</option>
                <option value="kill">Kill</option>
              </select>
            )}
          </>
        )}

        <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyWhenOnline}
            onChange={(e) => setOnlyWhenOnline(e.target.checked)}
            className="h-4 w-4 rounded border-border bg-transparent accent-primary"
          />
          Only run when the server is online
        </label>
        {!editing && (
          <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-transparent accent-primary"
            />
            Active
          </label>
        )}
        {editing && (
          <p className="mt-3 text-[11px] text-muted-foreground/70">
            To change what a schedule does, delete it and create a new one.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="btn-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {editing ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
