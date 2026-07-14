import { useEffect, useState } from "react";
import { ipc, errorMessage, type AdminRole, type AdminUser } from "../../lib/ipc";
import { PERMISSION_GROUPS, WILDCARD } from "../../lib/perms";

export default function Roles() {
  const [roles, setRoles] = useState<AdminRole[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminRole | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminRole | null>(null);

  async function reload() {
    try {
      setRoles(await ipc.admin.rolesList());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function doDelete(role: AdminRole) {
    setConfirmDelete(null);
    try {
      await ipc.admin.roleDelete(role.id);
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Roles</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            RBAC roles control what each staff member can do. System roles can't be deleted, but
            their name and permissions are editable (Owner always keeps full access).
          </p>
        </div>
        <button onClick={() => setEditing("new")} className="btn-primary rounded-md px-3 py-1.5 text-sm">
          New role
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      <div className="refx-card mt-5 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Access</th>
              <th className="px-4 py-2.5 font-medium">Users</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {roles === null ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  Loading roles…
                </td>
              </tr>
            ) : (
              roles.map((r) => {
                const isOwner = r.key === "owner" || r.permissions.includes(WILDCARD);
                return (
                  <tr key={r.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{r.name}</span>
                        {r.isSystem && (
                          <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            system
                          </span>
                        )}
                      </div>
                      {r.description && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{r.description}</div>
                      )}
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">{r.key}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isOwner ? "Full access" : `${r.permissions.length} permission${r.permissions.length === 1 ? "" : "s"}`}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r._count?.users ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditing(r)}
                        className="btn-ghost rounded px-2 py-1 text-xs"
                      >
                        Edit
                      </button>
                      {!r.isSystem && (
                        <button
                          onClick={() => setConfirmDelete(r)}
                          disabled={(r._count?.users ?? 0) > 0}
                          title={(r._count?.users ?? 0) > 0 ? "Reassign its users first" : undefined}
                          className="btn-ghost rounded px-2 py-1 text-xs text-destructive disabled:opacity-40"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <AssignRole roles={roles ?? []} onError={setError} />

      {editing && (
        <RoleEditor
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
          onError={setError}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete role "${confirmDelete.name}"?`}
          body="This can't be undone. Any users must be reassigned to another role first."
          confirmLabel="Delete role"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void doDelete(confirmDelete)}
        />
      )}
    </div>
  );
}

function RoleEditor({
  role,
  onClose,
  onSaved,
  onError,
}: {
  role: AdminRole | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const isOwner = role?.key === "owner" || (role?.permissions.includes(WILDCARD) ?? false);
  const [key, setKey] = useState(role?.key ?? "");
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role?.permissions.filter((p) => p !== WILDCARD) ?? []),
  );
  const [busy, setBusy] = useState(false);

  function toggle(p: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const perms = [...selected];
      if (role) {
        await ipc.admin.roleUpdate(role.id, {
          name: name.trim(),
          description: description.trim() || null,
          // Owner stays wildcard regardless of the checkboxes.
          permissions: isOwner ? [WILDCARD] : perms,
        });
      } else {
        await ipc.admin.roleCreate(key.trim(), name.trim(), description.trim() || null, perms);
      }
      onSaved();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        className="refx-panel refx-beam flex max-h-[85vh] w-full max-w-lg flex-col p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold tracking-tight">{role ? `Edit ${role.name}` : "New role"}</h2>

        <div className="mt-4 grid gap-3">
          {!role && (
            <label className="text-sm">
              <span className="text-muted-foreground">Key</span>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g. billing-agent"
                className="refx-input mt-1 w-full rounded-md px-3 py-1.5 font-mono text-sm outline-none focus:border-primary/60"
              />
            </label>
          )}
          <label className="text-sm">
            <span className="text-muted-foreground">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
        </div>

        <div className="refx-eyebrow mt-4">Permissions</div>
        {isOwner ? (
          <p className="mt-2 text-sm text-muted-foreground">
            The Owner role always has full access to everything and can't be scoped.
          </p>
        ) : (
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-md border border-white/[0.06] p-3">
            {PERMISSION_GROUPS.map((g) => (
              <div key={g.group} className="mb-3 last:mb-0">
                <div className="refx-eyebrow pb-1">{g.group}</div>
                {g.items.map((it) => (
                  <label key={it.key} className="flex items-start gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(it.key)}
                      onChange={() => toggle(it.key)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="text-foreground">{it.label}</span>
                      {it.hint && <span className="ml-1 text-xs text-muted-foreground">— {it.hint}</span>}
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy || !name.trim() || (!role && !key.trim())}
            className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? "Saving…" : role ? "Save changes" : "Create role"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignRole({ roles, onError }: { roles: AdminRole[]; onError: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AdminUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  async function search() {
    const query = q.trim();
    if (!query) return;
    setSearching(true);
    try {
      const res = await ipc.admin.usersList({ q: query, pageSize: 10 });
      setResults(res.users);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setSearching(false);
    }
  }

  async function assign(user: AdminUser, roleId: string) {
    if (!roleId) return;
    setAssigningId(user.id);
    try {
      const updated = await ipc.admin.userSetRole(user.id, null, roleId);
      setResults((rs) => rs?.map((u) => (u.id === user.id ? { ...u, ...updated } : u)) ?? null);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <div className="refx-card mt-6 p-4">
      <div className="refx-eyebrow">Assign a role</div>
      <p className="mt-1 text-sm text-muted-foreground">
        Search an account by email or name, then set its role. This is how someone becomes staff.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
          placeholder="Search users…"
          className="refx-input flex-1 rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
        />
        <button onClick={() => void search()} disabled={searching} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {results && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {results.length === 0 ? (
            <li className="py-2 text-sm text-muted-foreground">No matching accounts.</li>
          ) : (
            results.map((u) => (
              <li key={u.id} className="flex items-center gap-3 rounded-md border border-white/[0.06] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">{u.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"} · {u.globalRole ?? "CUSTOMER"}
                  </div>
                </div>
                <select
                  defaultValue={u.roleId ?? ""}
                  disabled={assigningId === u.id}
                  onChange={(e) => void assign(u, e.target.value)}
                  className="refx-input rounded-md px-2 py-1 text-sm outline-none"
                >
                  <option value="" disabled>
                    Set role…
                  </option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="refx-panel refx-beam w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`${danger ? "btn-danger" : "btn-primary"} rounded-md px-3 py-1.5 text-sm`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
