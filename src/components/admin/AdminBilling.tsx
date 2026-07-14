import { useEffect, useState } from "react";
import {
  ipc,
  errorMessage,
  type BillingSummary,
  type Invoice,
  type Order,
  type Payment,
  type PageMeta,
} from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";
import { money } from "../../lib/format";
import TypedConfirm from "../TypedConfirm";

type Tab = "overview" | "invoices" | "orders" | "payments";

export default function AdminBilling() {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  const canManage = hasPermission(perms, "billing.manage");
  const canRefund = hasPermission(perms, "billing.refund");
  const canPayments = hasPermission(perms, "payments.manage");

  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { k: Tab; label: string; show: boolean }[] = [
    { k: "overview", label: "Overview", show: true },
    { k: "invoices", label: "Invoices", show: true },
    { k: "orders", label: "Orders", show: true },
    { k: "payments", label: "Payments", show: canPayments },
  ];

  return (
    <div className="p-6">
      <div className="mb-4 inline-flex rounded-md border border-white/10 p-0.5">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`rounded px-3 py-1 text-sm ${tab === t.k ? "bg-primary/20 text-foreground" : "text-muted-foreground"}`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {tab === "overview" && <Overview />}
      {tab === "invoices" && <Invoices canManage={canManage} canRefund={canRefund} />}
      {tab === "orders" && <Orders canManage={canManage} />}
      {tab === "payments" && canPayments && <Payments />}
    </div>
  );
}

function Overview() {
  const [s, setS] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ipc.admin.billingSummary().then(setS).catch((e) => setError(errorMessage(e)));
  }, []);
  if (error) return <ErrorBox msg={error} />;
  if (!s) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="Revenue" value={money(s.revenueMinor, s.currency)} />
      <Tile label="Outstanding" value={money(s.outstandingMinor, s.currency)} />
      <Tile label="Active subs" value={s.activeSubscriptions} />
      <Tile label="Open invoices" value={s.openInvoices} />
      <Tile label="Paid invoices" value={s.paidInvoices} />
    </div>
  );
}

function Invoices({ canManage, canRefund }: { canManage: boolean; canRefund: boolean }) {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | undefined>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [refund, setRefund] = useState<Invoice | null>(null);
  const [markPaid, setMarkPaid] = useState<Invoice | null>(null);
  const [del, setDel] = useState<Invoice | null>(null);

  async function load(p = page) {
    try {
      const res = await ipc.admin.invoicesList({ page: p, pageSize: 50 });
      setRows(res.invoices);
      setMeta(res.meta);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div>
      {error && <ErrorBox msg={error} />}
      <div className="refx-card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">Invoice</th>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Total</th>
              <th className="px-4 py-2.5 font-medium">State</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <Row5>Loading…</Row5>
            ) : rows.length === 0 ? (
              <Row5>No invoices.</Row5>
            ) : (
              rows.map((inv) => {
                const paid = inv.state === "PAID";
                const open = inv.state === "OPEN";
                return (
                  <tr key={inv.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-4 py-3 text-foreground">#{inv.number ?? inv.id.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{inv.user?.email ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{money(inv.totalMinor, inv.currency)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{inv.state ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        {canManage && open && (
                          <button onClick={() => setMarkPaid(inv)} className="btn-ghost rounded px-2 py-1 text-xs">
                            Mark paid
                          </button>
                        )}
                        {canManage && !paid && (
                          <button onClick={() => void act(() => ipc.admin.invoiceVoid(inv.id))} className="btn-ghost rounded px-2 py-1 text-xs">
                            Void
                          </button>
                        )}
                        {canRefund && paid && (
                          <button onClick={() => setRefund(inv)} className="btn-ghost rounded px-2 py-1 text-xs">
                            Refund
                          </button>
                        )}
                        {canManage && (
                          <button onClick={() => setDel(inv)} className="btn-ghost rounded px-2 py-1 text-xs text-destructive">
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} meta={meta} onPage={(p) => { setPage(p); void load(p); }} />

      {markPaid && (
        <TypedConfirm
          title={`Mark invoice #${markPaid.number ?? ""} as paid`}
          confirmWord={String(markPaid.number ?? markPaid.id.slice(0, 8))}
          confirmLabel="Mark paid"
          body={
            <>
              Records an off-platform settlement of {money(markPaid.totalMinor, markPaid.currency)}. This
              provisions the reserved server and reactivates the subscription. Only do this once you've
              confirmed real payment was received.
            </>
          }
          onCancel={() => setMarkPaid(null)}
          onConfirm={() => {
            const inv = markPaid;
            setMarkPaid(null);
            void act(() => ipc.admin.invoiceMarkPaid(inv.id, true));
          }}
        />
      )}

      {refund && (
        <RefundDialog
          invoice={refund}
          onClose={() => setRefund(null)}
          onDone={async () => { setRefund(null); await load(); }}
          onError={setError}
        />
      )}

      {del && (
        <TypedConfirm
          title={`Delete invoice #${del.number ?? ""}`}
          danger
          confirmWord={String(del.number ?? del.id.slice(0, 8))}
          confirmLabel="Delete invoice"
          body="Permanently deletes the invoice and its payments. Deleting a PAID invoice erases a revenue record. This can't be undone."
          onCancel={() => setDel(null)}
          onConfirm={() => {
            const inv = del;
            setDel(null);
            void act(() => ipc.admin.invoiceDelete(inv.id));
          }}
        />
      )}
    </div>
  );
}

function RefundDialog({
  invoice,
  onClose,
  onDone,
  onError,
}: {
  invoice: Invoice;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const paidMajor = ((invoice.amountPaidMinor ?? invoice.totalMinor ?? 0) / 100).toFixed(2);
  const [amount, setAmount] = useState(paidMajor);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const amountNum = Number(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const matches = typed.trim() === amount.trim();

  async function submit() {
    if (!validAmount || !matches) return;
    setBusy(true);
    try {
      await ipc.admin.invoiceRefund(invoice.id, Math.round(amountNum * 100), amount.trim());
      onDone();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight text-destructive">Refund invoice #{invoice.number}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Issues a <strong>real gateway refund</strong> to the customer's payment method. Paid:{" "}
          {money(invoice.amountPaidMinor ?? invoice.totalMinor, invoice.currency)}.
        </p>
        <label className="mt-4 block text-sm">
          <span className="text-muted-foreground">Refund amount ({(invoice.currency ?? "USD").toUpperCase()})</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
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
            onClick={() => void submit()}
            disabled={!validAmount || !matches || busy}
            className="btn-danger rounded-md px-3 py-1.5 text-sm disabled:opacity-40"
          >
            {busy ? "Refunding…" : `Refund ${validAmount ? money(Math.round(amountNum * 100), invoice.currency) : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Orders({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<Order[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | undefined>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState<Order | null>(null);

  async function load(p = page) {
    try {
      const res = await ipc.admin.ordersList({ page: p, pageSize: 50 });
      setRows(res.orders);
      setMeta(res.meta);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {error && <ErrorBox msg={error} />}
      <div className="refx-card overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">State</th>
              <th className="px-4 py-2.5 font-medium">Interval</th>
              <th className="px-4 py-2.5 font-medium">Renews</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <Row5>Loading…</Row5>
            ) : rows.length === 0 ? (
              <Row5>No orders.</Row5>
            ) : (
              rows.map((o) => (
                <tr key={o.id} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3 text-foreground">{o.user?.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{o.state ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{o.interval ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(o.currentPeriodEnd)}</td>
                  <td className="px-4 py-3 text-right">
                    {canManage && (
                      <button onClick={() => setDel(o)} className="btn-ghost rounded px-2 py-1 text-xs text-destructive">
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} meta={meta} onPage={(p) => { setPage(p); void load(p); }} />

      {del && (
        <TypedConfirm
          title="Delete order"
          danger
          confirmWord="DELETE"
          confirmLabel="Delete order"
          body="Deletes the subscription/order. Invoice history is preserved. Blocked if it still has live servers."
          onCancel={() => setDel(null)}
          onConfirm={async () => {
            const o = del;
            setDel(null);
            try {
              await ipc.admin.orderDelete(o.id);
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

function Payments() {
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | undefined>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  async function load(p = page) {
    try {
      const res = await ipc.admin.paymentsList({ page: p, pageSize: 50 });
      setRows(res.payments);
      setMeta(res.meta);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {error && <ErrorBox msg={error} />}
      <div className="refx-card overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Gateway</th>
              <th className="px-4 py-2.5 font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <Row5 cols={4}>Loading…</Row5>
            ) : rows.length === 0 ? (
              <Row5 cols={4}>No payments.</Row5>
            ) : (
              rows.map((p) => (
                <tr key={p.id} className="border-b border-white/[0.04] last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDate(p.createdAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.gateway ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{money(p.amountMinor, p.currency)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.state ?? "—"}
                    {p.failureReason ? ` · ${p.failureReason}` : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} meta={meta} onPage={(p) => { setPage(p); void load(p); }} />
    </div>
  );
}

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
    <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
      {msg}
    </p>
  );
}
function Row5({ children, cols = 5 }: { children: React.ReactNode; cols?: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
function Pager({ page, meta, onPage }: { page: number; meta?: PageMeta; onPage: (p: number) => void }) {
  const total = meta?.totalPages ?? 1;
  if (total <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-sm">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="btn-ghost rounded px-3 py-1 disabled:opacity-40">
        Previous
      </button>
      <span className="text-muted-foreground">
        Page {page} of {total}
      </span>
      <button disabled={page >= total} onClick={() => onPage(page + 1)} className="btn-ghost rounded px-3 py-1 disabled:opacity-40">
        Next
      </button>
    </div>
  );
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}
