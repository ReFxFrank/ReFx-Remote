import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ipc, errorMessage, type Database } from "../lib/ipc";
import { ConfirmDialog, Dialog } from "./Dialog";

type DbDialog =
  | { kind: "create" }
  | { kind: "delete"; db: Database }
  | { kind: "rotate"; db: Database };

export default function Databases({
  serverId,
  canManage,
}: {
  serverId: string;
  canManage: boolean;
}) {
  const [dbs, setDbs] = useState<Database[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DbDialog | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; password: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDbs(await ipc.databasesList(serverId));
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

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(label);
        window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
      },
      () => setCopied(null),
    );
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function doCreate(engine: string, name: string, remoteAccess: boolean) {
    setDialog(null);
    await run(async () => {
      const created = await ipc.databaseCreate(serverId, engine, name, remoteAccess);
      await load();
      if (created.password) setRevealed({ name: created.name || name, password: created.password });
    });
  }

  async function doDelete(db: Database) {
    setDialog(null);
    await run(async () => {
      await ipc.databaseDelete(serverId, db.id);
      await load();
    });
  }

  async function doRotate(db: Database) {
    setDialog(null);
    await run(async () => {
      const res = await ipc.databaseRotate(serverId, db.id);
      if (res.password) setRevealed({ name: db.name || "database", password: res.password });
    });
  }

  return (
    <div className="refx-panel min-h-0 flex-1 overflow-y-auto p-4">
      {canManage && (
        <div className="mb-3 flex justify-end">
          <button
            onClick={() => setDialog({ kind: "create" })}
            disabled={busy}
            className="btn-ghost rounded-md px-2.5 py-1 text-xs disabled:opacity-40"
          >
            New database
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
      ) : dbs.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted-foreground">
          No databases yet.{canManage ? " Create one to get connection details." : ""}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dbs.map((d) => {
            const host = d.host ?? "";
            const addr = host && d.port ? `${host}:${d.port}` : host;
            return (
              <li key={d.id} className="refx-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{d.name || "(database)"}</span>
                    {d.engine && (
                      <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {d.engine}
                      </span>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      <button
                        onClick={() => setDialog({ kind: "rotate", db: d })}
                        disabled={busy}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                      >
                        Rotate password
                      </button>
                      <button
                        onClick={() => setDialog({ kind: "delete", db: d })}
                        disabled={busy}
                        className="text-destructive/80 hover:text-destructive disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                  <Field id={d.id} label="Host" value={addr} onCopy={copy} copied={copied} />
                  <Field id={d.id} label="Database" value={d.name ?? ""} onCopy={copy} copied={copied} />
                  <Field id={d.id} label="Username" value={d.username ?? ""} onCopy={copy} copied={copied} />
                </dl>
                <p className="mt-2 text-[11px] text-muted-foreground/70">
                  The password is shown once, when the database is created or rotated.
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === "create" && (
        <NewDatabaseDialog busy={busy} onCreate={doCreate} onCancel={() => setDialog(null)} />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.db.name || "database"}?`}
          body="This permanently drops the database and everything in it. This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => void doDelete(dialog.db)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rotate" && (
        <ConfirmDialog
          title="Rotate password?"
          body="A new password is generated and shown once. Anything using the current password will stop working until it's updated."
          confirmLabel="Rotate"
          onConfirm={() => void doRotate(dialog.db)}
          onCancel={() => setDialog(null)}
        />
      )}
      {revealed && (
        <PasswordReveal
          name={revealed.name}
          password={revealed.password}
          onClose={() => setRevealed(null)}
        />
      )}
    </div>
  );
}

function NewDatabaseDialog({
  busy,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  onCreate: (engine: string, name: string, remoteAccess: boolean) => void;
  onCancel: () => void;
}) {
  const [engine, setEngine] = useState("MYSQL");
  const [name, setName] = useState("");
  const [remote, setRemote] = useState(false);
  const valid = /^[a-zA-Z0-9_]{1,48}$/.test(name);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    onCreate(engine, name, remote);
  }

  return (
    <Dialog title="New database" onClose={onCancel}>
      <form onSubmit={submit}>
        <label className="refx-eyebrow mt-4 block">Engine</label>
        <select
          value={engine}
          onChange={(e) => setEngine(e.target.value)}
          className="refx-input mt-2 w-full rounded-md px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60"
        >
          <option value="MYSQL">MySQL</option>
          <option value="MARIADB">MariaDB</option>
        </select>
        <label className="refx-eyebrow mt-4 block">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my_database"
          className="refx-input mt-2 w-full rounded-md px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary/60"
        />
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          Letters, numbers and underscores, up to 48 characters.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={remote}
            onChange={(e) => setRemote(e.target.checked)}
            className="h-4 w-4 rounded border-border bg-transparent accent-primary"
          />
          Allow remote access
        </label>
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
            disabled={!valid || busy}
            className="btn-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function PasswordReveal({
  name,
  password,
  onClose,
}: {
  name: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="Database password" onClose={onClose}>
      <p className="mt-2 text-sm text-muted-foreground">
        Save this password for <span className="font-medium text-foreground">{name}</span> now — it
        won't be shown again.
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-md border border-white/10 bg-[rgba(7,13,24,0.7)] px-3 py-2">
        <span className="flex-1 truncate font-mono text-sm text-foreground">{password}</span>
        <button
          onClick={() =>
            navigator.clipboard.writeText(password).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
          }
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="mt-5 flex justify-end">
        <button
          onClick={onClose}
          className="btn-primary rounded-md px-3 py-1.5 text-sm font-medium text-white"
        >
          Done
        </button>
      </div>
    </Dialog>
  );
}

function Field({
  id,
  label,
  value,
  onCopy,
  copied,
}: {
  id: string;
  label: string;
  value: string;
  onCopy: (token: string, text: string) => void;
  copied: string | null;
}) {
  if (!value) return null;
  // Token is scoped per database so two rows' identical field labels don't
  // both flip to "Copied!".
  const token = `${id}:${label}`;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className="truncate font-mono text-foreground/85">{value}</span>
        <button
          onClick={() => onCopy(token, value)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {copied === token ? "Copied!" : "Copy"}
        </button>
      </dd>
    </>
  );
}
