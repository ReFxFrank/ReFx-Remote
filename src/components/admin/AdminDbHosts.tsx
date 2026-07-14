import { useEffect, useState } from "react";
import { ipc, errorMessage, type DatabaseHost } from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";

function hostName(h: DatabaseHost): string {
  return h.name || h.host || h.id;
}

export default function AdminDbHosts() {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  const canManage = hasPermission(perms, "nodes.manage");

  const [hosts, setHosts] = useState<DatabaseHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DatabaseHost | null>(null);
  const [del, setDel] = useState<DatabaseHost | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function load() {
    try {
      setHosts(await ipc.admin.databaseHostsList());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3000);
  }

  async function test(h: DatabaseHost) {
    setTestingId(h.id);
    setError(null);
    setNotice(null);
    try {
      const res = await ipc.admin.databaseHostTest(h.id);
      if (res.ok) flash(`${hostName(h)} — connection OK`);
      else setError(`${hostName(h)} — connection failed`);
    } catch (e) {
      // Backend surfaces the real connection error message on failure.
      setError(errorMessage(e));
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          MySQL / MariaDB hosts that back customer databases.
        </p>
        {canManage && (
          <button onClick={() => setCreating(true)} className="btn-primary rounded-md px-3 py-1.5 text-sm">
            Add host
          </button>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {notice}
        </p>
      )}

      <div className="mt-4">
        {hosts === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hosts.length === 0 ? (
          <div className="refx-card p-8 text-center text-sm text-muted-foreground">No database hosts.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {hosts.map((h) => (
              <div key={h.id} className="refx-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{hostName(h)}</span>
                      {h.isActive === false ? (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          Disabled
                        </span>
                      ) : (
                        <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">Active</span>
                      )}
                      {h.engine && (
                        <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          {h.engine}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      admin {h.username ?? "—"}@{h.host ?? "—"}:{h.port ?? 3306} · public {h.publicHost ?? "—"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {h.databaseCount ?? 0} / {h.maxDatabases ?? "∞"} databases
                    </div>
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => void test(h)}
                        disabled={testingId === h.id}
                        className="btn-ghost rounded px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {testingId === h.id ? "Testing…" : "Test"}
                      </button>
                      <button onClick={() => setEditing(h)} className="btn-ghost rounded px-2 py-1 text-xs">
                        Edit
                      </button>
                      <button onClick={() => setDel(h)} className="btn-ghost rounded px-2 py-1 text-xs text-destructive">
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <HostDialog
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false);
            await load();
          }}
          onError={setError}
        />
      )}

      {editing && (
        <HostDialog
          host={editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
          onError={setError}
        />
      )}

      {del && (
        <ConfirmDelete
          host={del}
          onCancel={() => setDel(null)}
          onConfirm={async () => {
            const h = del;
            setDel(null);
            try {
              await ipc.admin.databaseHostDelete(h.id);
              await load();
            } catch (e) {
              // 400 (VALIDATION) when the host still owns databases — surface it.
              setError(errorMessage(e));
            }
          }}
        />
      )}
    </div>
  );
}

function HostDialog({
  host,
  onClose,
  onDone,
  onError,
}: {
  host?: DatabaseHost;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const isEdit = !!host;
  const [name, setName] = useState(host?.name ?? "");
  const [engine, setEngine] = useState(host?.engine ?? "mariadb");
  const [dbHost, setDbHost] = useState(host?.host ?? "");
  const [port, setPort] = useState(host?.port != null ? String(host.port) : "3306");
  const [username, setUsername] = useState(host?.username ?? "");
  const [password, setPassword] = useState("");
  const [publicHost, setPublicHost] = useState(host?.publicHost ?? "");
  const [maxDatabases, setMaxDatabases] = useState(host?.maxDatabases != null ? String(host.maxDatabases) : "500");
  const [busy, setBusy] = useState(false);

  // Password is write-only; on edit it is blank and only sent when re-typed.
  const valid =
    name.trim() !== "" &&
    dbHost.trim() !== "" &&
    username.trim() !== "" &&
    publicHost.trim() !== "" &&
    (isEdit || password !== "");

  async function submit() {
    if (!valid) return;
    setBusy(true);
    try {
      const portNum = port.trim() ? Number(port) : undefined;
      const maxNum = maxDatabases.trim() ? Number(maxDatabases) : undefined;
      if (isEdit && host) {
        await ipc.admin.databaseHostUpdate(host.id, {
          name: name.trim(),
          host: dbHost.trim(),
          port: portNum,
          username: username.trim(),
          password: password ? password : undefined,
          publicHost: publicHost.trim(),
          maxDatabases: maxNum,
        });
      } else {
        await ipc.admin.databaseHostCreate({
          name: name.trim(),
          engine,
          host: dbHost.trim(),
          port: portNum,
          username: username.trim(),
          password,
          publicHost: publicHost.trim(),
          maxDatabases: maxNum,
        });
      }
      onDone();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight">{isEdit ? "Edit host" : "Add database host"}</h2>
        <div className="mt-4 grid gap-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mariadb-eu-1"
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>

          {!isEdit && (
            <label className="text-sm">
              <span className="text-muted-foreground">Engine</span>
              <select
                value={engine ?? "mariadb"}
                onChange={(e) => setEngine(e.target.value)}
                className="refx-input mt-1 w-full rounded-md px-2 py-1.5 text-sm outline-none"
              >
                <option value="mariadb">MariaDB</option>
                <option value="mysql">MySQL</option>
              </select>
            </label>
          )}

          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-2 text-sm">
              <span className="text-muted-foreground">Admin host</span>
              <input
                value={dbHost}
                onChange={(e) => setDbHost(e.target.value)}
                placeholder="10.0.0.5"
                className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Port</span>
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
              />
            </label>
          </div>

          <label className="text-sm">
            <span className="text-muted-foreground">Admin user</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>

          <label className="text-sm">
            <span className="text-muted-foreground">
              Admin password {isEdit && <span className="text-xs">(leave blank to keep current)</span>}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>

          <label className="text-sm">
            <span className="text-muted-foreground">Public host</span>
            <input
              value={publicHost}
              onChange={(e) => setPublicHost(e.target.value)}
              placeholder="db-eu-1.refx.host"
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>

          <label className="text-sm">
            <span className="text-muted-foreground">Max databases</span>
            <input
              value={maxDatabases}
              onChange={(e) => setMaxDatabases(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!valid || busy}
            className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add host"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDelete({
  host,
  onCancel,
  onConfirm,
}: {
  host: DatabaseHost;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onCancel}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-destructive">Delete host {hostName(host)}</h2>
        <p className="mt-2 text-sm text-foreground/85">
          Removes this database host. This is blocked while it still owns databases — move or delete them first.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:text-white">
            Cancel
          </button>
          <button onClick={onConfirm} className="btn-danger rounded-md px-3 py-1.5 text-sm font-medium text-white">
            Delete host
          </button>
        </div>
      </div>
    </div>
  );
}
