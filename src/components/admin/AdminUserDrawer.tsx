import { useEffect, useState } from "react";
import {
  ipc,
  errorMessage,
  type AdminUser,
  type AdminUserDetail,
  type OneTimeSecret,
} from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";
import { money } from "../../lib/format";
import TypedConfirm from "../TypedConfirm";

export default function AdminUserDrawer({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  const can = (p: string) => hasPermission(perms, p);

  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<OneTimeSecret | null>(null);
  const [confirm, setConfirm] = useState<null | "delete" | "purge">(null);
  const [creditOpen, setCreditOpen] = useState(false);

  async function reload() {
    try {
      setUser(await ipc.admin.userGet(userId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function afterMutation(u?: AdminUser) {
    if (u && user) setUser({ ...user, ...u });
    else void reload();
    onChanged();
  }

  async function setState(s: "ACTIVE" | "SUSPENDED" | "BANNED") {
    try {
      afterMutation(await ipc.admin.userSetState(userId, s));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function verifyEmail() {
    try {
      afterMutation(await ipc.admin.userVerifyEmail(userId));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function sendReset() {
    try {
      await ipc.admin.userSendPasswordReset(userId);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function setTempPassword() {
    try {
      setSecret(await ipc.admin.userSetPassword(userId));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const fullName = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") : "";

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-white/[0.06] bg-[#070b12]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">{user?.email ?? "…"}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {fullName || "—"} · {user?.globalRole ?? "CUSTOMER"} · {user?.state ?? ""}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost rounded-md px-2.5 py-1.5 text-sm">
            Close
          </button>
        </header>

        {error && (
          <p className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        )}

        {!user ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-5 p-6">
            {/* Account actions */}
            {can("users.suspend") && (
              <Section title="Account">
                <div className="flex flex-wrap gap-2">
                  {user.state !== "ACTIVE" && (
                    <button onClick={() => void setState("ACTIVE")} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
                      Reactivate
                    </button>
                  )}
                  {user.state !== "SUSPENDED" && (
                    <button onClick={() => void setState("SUSPENDED")} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
                      Suspend
                    </button>
                  )}
                  {user.state !== "BANNED" && (
                    <button onClick={() => void setState("BANNED")} className="btn-danger rounded-md px-3 py-1.5 text-sm">
                      Ban
                    </button>
                  )}
                  {can("users.verify-email") && !user.emailVerifiedAt && (
                    <button onClick={() => void verifyEmail()} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
                      Verify email
                    </button>
                  )}
                </div>
              </Section>
            )}

            {/* Password */}
            {can("users.password") && (
              <Section title="Password">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void sendReset()} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
                    Email reset link
                  </button>
                  <button onClick={() => void setTempPassword()} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
                    Set temporary password
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  A temporary password forces a change on next login and signs the user out everywhere.
                </p>
              </Section>
            )}

            {/* Store credit */}
            <Section title="Store credit">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Balance:{" "}
                  <span className="font-medium text-foreground">{money(user.creditBalanceMinor)}</span>
                </span>
                {can("users.credit") && (
                  <button onClick={() => setCreditOpen(true)} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
                    Adjust credit…
                  </button>
                )}
              </div>
            </Section>

            {/* Servers */}
            <Section title={`Servers (${user.ownedServers.length})`}>
              {user.ownedServers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No servers.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {user.ownedServers.map((s) => (
                    <li key={s.id} className="flex items-center justify-between">
                      <span className="text-foreground">{s.name ?? s.id}</span>
                      <span className="text-xs text-muted-foreground">{s.state ?? ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Invoices */}
            {can("billing.read") && user.invoices.length > 0 && (
              <Section title="Recent invoices">
                <ul className="flex flex-col gap-1 text-sm">
                  {user.invoices.slice(0, 8).map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between">
                      <span className="text-foreground">#{inv.number ?? inv.id.slice(0, 8)}</span>
                      <span className="text-xs text-muted-foreground">
                        {money(inv.totalMinor, inv.currency)} · {inv.state ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Danger zone */}
            {can("users.delete") && (
              <Section title="Danger zone">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setConfirm("delete")} className="btn-danger rounded-md px-3 py-1.5 text-sm">
                    Delete account
                  </button>
                  <button onClick={() => setConfirm("purge")} className="btn-danger rounded-md px-3 py-1.5 text-sm">
                    GDPR purge
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Both are blocked while the user still owns servers. Purge anonymizes personal data
                  but keeps invoices.
                </p>
              </Section>
            )}
          </div>
        )}
      </div>

      {secret && <SecretReveal secret={secret} onClose={() => setSecret(null)} />}

      {creditOpen && user && (
        <CreditDialog
          userEmail={user.email}
          onClose={() => setCreditOpen(false)}
          onDone={() => {
            setCreditOpen(false);
            void reload();
            onChanged();
          }}
          onError={setError}
          userId={userId}
        />
      )}

      {confirm && user && (
        <TypedConfirm
          title={confirm === "delete" ? `Delete ${user.email}` : `GDPR purge ${user.email}`}
          danger
          confirmWord={user.email}
          confirmLabel={confirm === "delete" ? "Delete account" : "Purge account"}
          body={
            confirm === "delete"
              ? "Soft-deletes and tombstones the account. Blocked while it still owns servers."
              : "Anonymizes personal data and wipes auth material (sessions, keys, cards). Invoices are retained. This can't be undone."
          }
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const kind = confirm;
            setConfirm(null);
            try {
              if (kind === "delete") await ipc.admin.userDelete(userId);
              else await ipc.admin.userPurge(userId);
              onChanged();
              onClose();
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="refx-eyebrow mb-2">{title}</div>
      {children}
    </div>
  );
}

function SecretReveal({ secret, onClose }: { secret: OneTimeSecret; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight">Temporary password</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Shown once — copy it now and share it securely. It won't be retrievable again.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 select-all rounded-md border border-white/10 bg-[rgba(7,13,24,0.7)] px-3 py-2 font-mono text-sm">
            {secret.password}
          </code>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(secret.password).then(
                () => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                },
                () => setCopied(false),
              );
            }}
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

function CreditDialog({
  userId,
  userEmail,
  onClose,
  onDone,
  onError,
}: {
  userId: string;
  userEmail: string;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [mode, setMode] = useState<"grant" | "deduct">("grant");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const parsed = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(parsed) && parsed > 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    try {
      const minor = Math.round(parsed * 100) * (mode === "deduct" ? -1 : 1);
      await ipc.admin.userCreditAdjust(
        userId,
        minor,
        amount.trim(), // confirm_amount — re-verified Rust-side against amountMinor
        mode === "deduct" ? "ADJUSTMENT" : "ADMIN_GRANT",
        note.trim() || undefined,
      );
      onDone();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight">Adjust store credit</h2>
        <p className="mt-1 text-sm text-muted-foreground">{userEmail}</p>

        <div className="mt-4 inline-flex rounded-md border border-white/10 p-0.5">
          {(["grant", "deduct"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1 text-sm capitalize ${
                mode === m ? "bg-primary/20 text-foreground" : "text-muted-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm">
          <span className="text-muted-foreground">Amount (major units, e.g. 5.00)</span>
          <input
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
          />
        </label>
        <label className="mt-3 block text-sm">
          <span className="text-muted-foreground">Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
          />
        </label>

        <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          This {mode === "deduct" ? "removes" : "adds"} <strong>{valid ? money(Math.round(parsed * 100)) : "—"}</strong>{" "}
          {mode === "deduct" ? "from" : "to"} the account's store credit. The amount is re-verified before it's applied.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!valid || busy}
            className={`${mode === "deduct" ? "btn-danger" : "btn-primary"} rounded-md px-3 py-1.5 text-sm disabled:opacity-50`}
          >
            {busy ? "Applying…" : mode === "deduct" ? "Deduct credit" : "Grant credit"}
          </button>
        </div>
      </div>
    </div>
  );
}
