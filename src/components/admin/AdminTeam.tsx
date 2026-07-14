import { useEffect, useState } from "react";
import { ipc, errorMessage, type TeamMember } from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";

// Public "Meet the team" page curation — marketing entries, NOT RBAC staff.
// The whole screen (and every control) is gated behind content.manage.

function initials(name?: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function Avatar({ name, url, size = 36 }: { name?: string | null; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const src = url?.trim();
  const showImg = !!src && !broken;
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06] text-xs font-medium text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {showImg ? (
        <img src={src} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </div>
  );
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`h-5 w-9 shrink-0 rounded-full border transition disabled:opacity-50 ${
        checked ? "border-primary/60 bg-primary/80" : "border-white/10 bg-white/[0.06]"
      }`}
    >
      <span className={`block h-4 w-4 rounded-full bg-white transition ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

export default function AdminTeam() {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  const canManage = hasPermission(perms, "content.manage");

  const [rows, setRows] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [del, setDel] = useState<TeamMember | null>(null);

  async function load() {
    try {
      const list = await ipc.admin.staffList();
      // Order by sortOrder (server already orders by sortOrder then created;
      // a stable sort here keeps that ordering for equal sortOrder values).
      setRows([...list].sort((a, b) => a.sortOrder - b.sortOrder));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    if (canManage) void load();
  }, [canManage]);

  async function toggleActive(m: TeamMember) {
    try {
      await ipc.admin.staffUpdate(m.id, { isActive: !m.isActive });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove(m: TeamMember) {
    setDel(null);
    try {
      await ipc.admin.staffDelete(m.id);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!canManage) {
    return (
      <div className="p-6">
        <p className="rounded-md border border-white/[0.06] px-3 py-2 text-sm text-muted-foreground">
          You don't have permission to manage the team page.
        </p>
      </div>
    );
  }

  const activeCount = rows?.filter((m) => m.isActive).length ?? 0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Public “Meet the team” entries shown on the marketing site.</p>
        <button onClick={() => setCreating(true)} className="btn-primary rounded-md px-3 py-1.5 text-sm">
          Add member
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="refx-card mt-4 flex items-center gap-2 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">{activeCount} shown publicly</span>
          <span className="text-muted-foreground">/ {rows.length} total</span>
        </div>
      )}

      <div className="refx-card mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">Member</th>
              <th className="px-4 py-2.5 font-medium">Title</th>
              <th className="px-4 py-2.5 font-medium">Order</th>
              <th className="px-4 py-2.5 font-medium">Active</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No team members yet.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name} url={m.avatarUrl} />
                      <span className="font-medium text-foreground">{m.name ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{m.title ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{m.sortOrder}</td>
                  <td className="px-4 py-3">
                    <Switch checked={m.isActive} onChange={() => void toggleActive(m)} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(m)} className="btn-ghost rounded px-2 py-1 text-xs">
                      Edit
                    </button>
                    <button onClick={() => setDel(m)} className="btn-ghost rounded px-2 py-1 text-xs text-destructive">
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <StaffDialog
          member={editing}
          count={rows?.length ?? 0}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void load();
          }}
          onError={setError}
        />
      )}

      {del && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
          onClick={() => setDel(null)}
        >
          <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold tracking-tight text-destructive">Remove {del.name ?? "this member"}?</h2>
            <p className="mt-2 text-sm text-foreground/85">This removes them from the public Team page.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDel(null)} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button onClick={() => void remove(del)} className="btn-danger rounded-md px-3 py-1.5 text-sm">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StaffDialog({
  member,
  count,
  onClose,
  onSaved,
  onError,
}: {
  member: TeamMember | null;
  count: number;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const editing = !!member;
  const [name, setName] = useState(member?.name ?? "");
  const [title, setTitle] = useState(member?.title ?? "");
  const [bio, setBio] = useState(member?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(member?.avatarUrl ?? "");
  const [link, setLink] = useState(member?.link ?? "");
  // For create, prefill display order with the current member count.
  const [order, setOrder] = useState(String(member?.sortOrder ?? count));
  const [isActive, setIsActive] = useState(member?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length > 0 && title.trim().length > 0;
  const sortOrder = Math.max(0, Math.round(Number(order) || 0));

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      if (member) {
        await ipc.admin.staffUpdate(member.id, {
          name: name.trim(),
          title: title.trim(),
          bio: bio.trim(),
          avatarUrl: avatarUrl.trim(),
          link: link.trim(),
          isActive,
          sortOrder,
        });
      } else {
        await ipc.admin.staffCreate({
          name: name.trim(),
          title: title.trim(),
          bio: bio.trim() || undefined,
          avatarUrl: avatarUrl.trim() || undefined,
          link: link.trim() || undefined,
          isActive,
          sortOrder,
        });
      }
      onSaved();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="refx-panel refx-beam max-h-[90vh] w-full max-w-md overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold tracking-tight">{editing ? "Edit member" : "Add member"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Shown on the public Team page.</p>

        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-muted-foreground">Name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Founder"
                className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
              />
            </label>
          </div>

          <label className="text-sm">
            <span className="text-muted-foreground">Bio (optional)</span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="refx-input mt-1 w-full resize-y rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>

          <label className="text-sm">
            <span className="text-muted-foreground">Avatar URL (optional)</span>
            <div className="mt-1 flex items-center gap-3">
              <Avatar name={name} url={avatarUrl} />
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…"
                className="refx-input flex-1 rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
              />
            </div>
          </label>

          <label className="text-sm">
            <span className="text-muted-foreground">Profile link (optional)</span>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>

          <div className="grid grid-cols-2 items-end gap-3">
            <label className="text-sm">
              <span className="text-muted-foreground">Display order</span>
              <input
                value={order}
                onChange={(e) => setOrder(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
              />
            </label>
            <div className="flex items-center justify-between rounded-md border border-white/[0.06] px-3 py-2">
              <span className="text-sm text-muted-foreground">Active</span>
              <Switch checked={isActive} onChange={() => setIsActive((v) => !v)} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!valid || busy}
            className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Add member"}
          </button>
        </div>
      </div>
    </div>
  );
}
