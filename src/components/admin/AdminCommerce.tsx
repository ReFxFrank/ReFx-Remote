import { useEffect, useState } from "react";
import {
  ipc,
  errorMessage,
  type Coupon,
  type GiftCard,
  type GrowthReport,
} from "../../lib/ipc";
import { money } from "../../lib/format";
import TypedConfirm from "../TypedConfirm";

// ── Growth (billing.read) ──────────────────────────────────────────────

export function AdminGrowth() {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<GrowthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setR(null);
    ipc.admin.growth(days).then(setR).catch((e) => setError(errorMessage(e)));
  }, [days]);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center gap-2">
        {[7, 30, 90, 365].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded px-3 py-1 text-sm ${days === d ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {d}d
          </button>
        ))}
      </div>
      {error && <ErrorBox msg={error} />}
      {!r ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Signups" value={r.totals?.signups ?? 0} />
            <Tile label="First-time payers" value={r.totals?.payers ?? 0} />
            <Tile label="Revenue" value={money(r.totals?.revenueMinor ?? 0)} />
            <Tile label="Referral credit issued" value={money(r.referral?.creditIssuedMinor ?? 0)} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="refx-card p-4">
              <div className="refx-eyebrow mb-3">By channel</div>
              {(r.channels?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No data.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Channel</th>
                      <th className="py-1 font-medium">Signups</th>
                      <th className="py-1 font-medium">Payers</th>
                      <th className="py-1 font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.channels!.map((c) => (
                      <tr key={c.channel} className="border-t border-white/[0.04]">
                        <td className="py-1.5 text-foreground">{c.channel || "(direct)"}</td>
                        <td className="py-1.5 text-muted-foreground">{c.signups}</td>
                        <td className="py-1.5 text-muted-foreground">{c.payers}</td>
                        <td className="py-1.5 text-muted-foreground">{money(c.revenueMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="refx-card p-4">
              <div className="refx-eyebrow mb-3">Top landing pages</div>
              {(r.landings?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No data.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {r.landings!.map((l) => (
                    <li key={l.landing} className="flex items-center justify-between">
                      <span className="truncate font-mono text-xs text-foreground/90">{l.landing || "/"}</span>
                      <span className="text-muted-foreground">{l.signups}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Coupons (billing.manage) ───────────────────────────────────────────

export function AdminCoupons() {
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [del, setDel] = useState<Coupon | null>(null);

  async function load() {
    try {
      setRows(await ipc.admin.couponsList());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Discount codes applied at checkout.</p>
        <button onClick={() => setAdding(true)} className="btn-primary rounded-md px-3 py-1.5 text-sm">
          New coupon
        </button>
      </div>
      {error && <ErrorBox msg={error} />}
      <div className="refx-card mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 font-medium">Discount</th>
              <th className="px-4 py-2.5 font-medium">Redemptions</th>
              <th className="px-4 py-2.5 font-medium">Expires</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <RowN>Loading…</RowN>
            ) : rows.length === 0 ? (
              <RowN>No coupons.</RowN>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3 font-mono text-foreground">{c.code}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.kind === "PERCENT" ? `${c.value}%` : money(Math.round((c.value ?? 0)), c.currency)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.timesRedeemed ?? 0}
                    {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setDel(c)} className="btn-ghost rounded px-2 py-1 text-xs text-destructive">
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <CouponDialog
          onClose={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await load();
          }}
          onError={setError}
        />
      )}
      {del && (
        <TypedConfirm
          title={`Delete coupon ${del.code}`}
          danger
          confirmWord={del.code ?? "DELETE"}
          confirmLabel="Delete coupon"
          body="Past redemptions are kept; the code stops working immediately."
          onCancel={() => setDel(null)}
          onConfirm={async () => {
            const c = del;
            setDel(null);
            try {
              await ipc.admin.couponDelete(c.id);
              await load();
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
      )}
    </div>
  );
}

function CouponDialog({
  onClose,
  onDone,
  onError,
}: {
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [value, setValue] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [busy, setBusy] = useState(false);

  const num = Number(value);
  const valid = code.trim().length >= 2 && Number.isFinite(num) && num > 0 && (kind !== "PERCENT" || num <= 100);

  async function create() {
    if (!valid) return;
    setBusy(true);
    try {
      await ipc.admin.couponCreate({
        code: code.trim().toUpperCase(),
        kind,
        // FIXED coupons take the value in minor units.
        value: kind === "FIXED" ? Math.round(num * 100) : num,
        maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : undefined,
      });
      onDone();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight">New coupon</h2>
        <div className="mt-4 grid gap-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SUMMER25"
              className="refx-input mt-1 w-full rounded-md px-3 py-1.5 font-mono text-sm outline-none focus:border-primary/60"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-muted-foreground">Type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "PERCENT" | "FIXED")}
                className="refx-input mt-1 w-full rounded-md px-2 py-1.5 text-sm outline-none"
              >
                <option value="PERCENT">Percent off</option>
                <option value="FIXED">Fixed amount off</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">{kind === "PERCENT" ? "Percent (1–100)" : "Amount (e.g. 5.00)"}</span>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
              />
            </label>
          </div>
          <label className="text-sm">
            <span className="text-muted-foreground">Max redemptions (blank = unlimited)</span>
            <input
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value.replace(/[^0-9]/g, ""))}
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
            onClick={() => void create()}
            disabled={!valid || busy}
            className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create coupon"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Gift cards (billing.manage; issuance = stored value) ───────────────

export function AdminGiftCards() {
  const [rows, setRows] = useState<GiftCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<GiftCard | null>(null);

  async function load() {
    try {
      setRows(await ipc.admin.giftCardsList());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function toggle(g: GiftCard) {
    try {
      await ipc.admin.giftCardSetActive(g.id, !(g.isActive ?? true));
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Stored-value codes. Issuing one creates a liability — the amount is re-verified before issue.
        </p>
        <button onClick={() => setIssuing(true)} className="btn-primary rounded-md px-3 py-1.5 text-sm">
          Issue gift card
        </button>
      </div>
      {error && <ErrorBox msg={error} />}
      <div className="refx-card mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 font-medium">Balance</th>
              <th className="px-4 py-2.5 font-medium">Note</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <RowN>Loading…</RowN>
            ) : rows.length === 0 ? (
              <RowN>No gift cards.</RowN>
            ) : (
              rows.map((g) => (
                <tr key={g.id} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3 font-mono text-foreground">{g.code}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {money(g.balanceMinor, g.currency)}
                    {g.initialBalanceMinor != null && g.initialBalanceMinor !== g.balanceMinor
                      ? ` of ${money(g.initialBalanceMinor, g.currency)}`
                      : ""}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{g.note ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{g.isActive === false ? "Disabled" : "Active"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => void toggle(g)} className="btn-ghost rounded px-2 py-1 text-xs">
                      {g.isActive === false ? "Enable" : "Disable"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {issuing && (
        <GiftCardDialog
          onClose={() => setIssuing(false)}
          onDone={async (g) => {
            setIssuing(false);
            setIssued(g);
            await load();
          }}
          onError={setError}
        />
      )}

      {issued && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setIssued(null)}>
          <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold tracking-tight">Gift card issued</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {money(issued.balanceMinor, issued.currency)} — share the code with the recipient.
            </p>
            <code className="mt-3 block select-all rounded-md border border-white/10 bg-[rgba(7,13,24,0.7)] px-3 py-2 text-center font-mono text-lg tracking-wider">
              {issued.code}
            </code>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => issued.code && void navigator.clipboard.writeText(issued.code)}
                className="btn-ghost rounded-md px-3 py-1.5 text-sm"
              >
                Copy
              </button>
              <button onClick={() => setIssued(null)} className="btn-primary rounded-md px-3 py-1.5 text-sm">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GiftCardDialog({
  onClose,
  onDone,
  onError,
}: {
  onClose: () => void;
  onDone: (g: GiftCard) => void;
  onError: (m: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const num = Number(amount);
  const valid = Number.isFinite(num) && num > 0;
  const matches = typed.trim() === amount.trim() && valid;

  async function issue() {
    if (!matches) return;
    setBusy(true);
    try {
      // Pass the independently re-typed value (not `amount`) so the Rust
      // amount-binding verifies the human's confirmation, not the same number.
      const g = await ipc.admin.giftCardCreate(Math.round(num * 100), typed.trim(), note.trim() || undefined);
      onDone(g);
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight">Issue gift card</h2>
        <p className="mt-1 text-sm text-muted-foreground">Creates stored value the recipient can spend at checkout.</p>
        <label className="mt-4 block text-sm">
          <span className="text-muted-foreground">Amount (e.g. 25.00)</span>
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
        <p className="mt-3 text-sm text-muted-foreground">
          Type <span className="font-mono text-foreground">{amount || "…"}</span> to confirm.
        </p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1 w-full rounded-md border border-white/10 bg-[rgba(7,13,24,0.7)] px-3 py-2 font-mono text-sm outline-none focus:border-primary/60"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={() => void issue()}
            disabled={!matches || busy}
            className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-40"
          >
            {busy ? "Issuing…" : `Issue ${valid ? money(Math.round(num * 100)) : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── shared bits ────────────────────────────────────────────────────────

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="refx-card p-3">
      <div className="refx-eyebrow">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
function ErrorBox({ msg }: { msg: string }) {
  return (
    <p className="my-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
      {msg}
    </p>
  );
}
function RowN({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
