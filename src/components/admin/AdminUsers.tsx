import { useEffect, useRef, useState } from "react";
import {
  ipc,
  errorMessage,
  type AdminUser,
  type AdminCustomer,
  type OneTimeSecret,
  type PageMeta,
} from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";
import { money } from "../../lib/format";
import AdminUserDrawer from "./AdminUserDrawer";

type Tab = "users" | "customers";

export default function AdminUsers() {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  const canCreate = hasPermission(perms, "users.create");

  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [customers, setCustomers] = useState<AdminCustomer[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | undefined>();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<OneTimeSecret | null>(null);
  const searchTimer = useRef<number | null>(null);

  async function load(t = tab, p = page, query = q) {
    try {
      if (t === "users") {
        const res = await ipc.admin.usersList({ page: p, pageSize: 25, q: query.trim() || undefined });
        setUsers(res.users);
        setMeta(res.meta);
      } else {
        const res = await ipc.admin.customersList({ page: p, pageSize: 25, q: query.trim() || undefined });
        setCustomers(res.customers);
        setMeta(res.meta);
      }
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    void load(tab, 1, q);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function onSearch(v: string) {
    setQ(v);
    setPage(1);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => void load(tab, 1, v), 350);
  }

  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="inline-flex rounded-md border border-white/10 p-0.5">
          {(["users", "customers"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 text-sm capitalize ${
                tab === t ? "bg-primary/20 text-foreground" : "text-muted-foreground"
              }`}
            >
              {t === "users" ? "All users" : "Customers"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search by email or name…"
            className="refx-input w-64 rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
          />
          {canCreate && tab === "users" && (
            <button onClick={() => setCreating(true)} className="btn-primary rounded-md px-3 py-1.5 text-sm">
              New user
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      <div className="refx-card mt-4 overflow-x-auto">
        {tab === "users" ? (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-white/[0.06]">
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {users === null ? (
                <Loading cols={4} />
              ) : users.length === 0 ? (
                <Empty cols={4} />
              ) : (
                users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setOpenUser(u.id)}
                    className="cursor-pointer border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3 text-foreground">{u.email}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{u.globalRole ?? "CUSTOMER"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.state ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-white/[0.06]">
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Servers</th>
                <th className="px-4 py-2.5 font-medium">Active services</th>
                <th className="px-4 py-2.5 font-medium">Lifetime spend</th>
              </tr>
            </thead>
            <tbody>
              {customers === null ? (
                <Loading cols={4} />
              ) : customers.length === 0 ? (
                <Empty cols={4} />
              ) : (
                customers.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setOpenUser(c.id)}
                    className="cursor-pointer border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3 text-foreground">{c.email}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.servers ?? 0}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.activeServices ?? 0}</td>
                    <td className="px-4 py-3 text-muted-foreground">{money(c.lifetimeSpendMinor)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => {
              const p = page - 1;
              setPage(p);
              void load(tab, p, q);
            }}
            className="btn-ghost rounded px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => {
              const p = page + 1;
              setPage(p);
              void load(tab, p, q);
            }}
            className="btn-ghost rounded px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {openUser && (
        <AdminUserDrawer userId={openUser} onClose={() => setOpenUser(null)} onChanged={() => void load()} />
      )}

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            setCreated(s);
            void load();
          }}
          onError={setError}
        />
      )}

      {created && <CreatedReveal secret={created} onClose={() => setCreated(null)} />}
    </div>
  );
}

function Loading({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-muted-foreground">
        Loading…
      </td>
    </tr>
  );
}
function Empty({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-muted-foreground">
        No accounts match.
      </td>
    </tr>
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (s: OneTimeSecret) => void;
  onError: (m: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("CUSTOMER");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      // Password omitted → the server auto-generates and returns it once.
      const s = await ipc.admin.userCreate({
        email: email.trim(),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        role,
      });
      onCreated(s);
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight">New account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A strong password is generated and shown once. You can only create accounts below your own tier.
        </p>
        <div className="mt-4 grid gap-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-muted-foreground">First name</span>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Last name</span>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
              />
            </label>
          </div>
          <label className="text-sm">
            <span className="text-muted-foreground">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none"
            >
              {["CUSTOMER", "SUPPORT", "ADMIN"].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={() => void create()}
            disabled={!email.trim() || busy}
            className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create account"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreatedReveal({ secret, onClose }: { secret: OneTimeSecret; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight">Account created</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {secret.email}'s password is shown once — copy it now and share it securely.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 select-all rounded-md border border-white/10 bg-[rgba(7,13,24,0.7)] px-3 py-2 font-mono text-sm">
            {secret.password}
          </code>
          <button
            onClick={() =>
              void navigator.clipboard.writeText(secret.password).then(
                () => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                },
                () => setCopied(false),
              )
            }
            className="btn-ghost rounded-md px-3 py-2 text-sm"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="btn-primary rounded-md px-3 py-1.5 text-sm">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
