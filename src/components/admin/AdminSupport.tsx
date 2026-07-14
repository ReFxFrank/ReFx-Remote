import { useEffect, useState } from "react";
import {
  ipc,
  errorMessage,
  type Ticket,
  type TicketDetail,
  type SupportPerson,
  type CannedResponse,
} from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";
import TypedConfirm from "../TypedConfirm";

const STATES = ["OPEN", "PENDING_AGENT", "PENDING_CUSTOMER", "RESOLVED", "CLOSED", "ARCHIVED"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

export default function AdminSupport() {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  const canManage = hasPermission(perms, "support.manage");

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<SupportPerson[]>([]);

  async function loadList() {
    try {
      const res = await ipc.admin.ticketsList({
        pageSize: 50,
        q: q.trim() || undefined,
        ticketState: stateFilter || undefined,
        mine,
      });
      setTickets(res.tickets);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateFilter, mine]);

  useEffect(() => {
    ipc.admin.supportStaff().then(setStaff).catch(() => setStaff([]));
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <section className="flex w-96 shrink-0 flex-col border-r border-white/[0.06]">
        <div className="flex flex-col gap-2 border-b border-white/[0.06] p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void loadList()}
            placeholder="Search subjects…"
            className="refx-input rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
          />
          <div className="flex items-center gap-2">
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="refx-input flex-1 rounded-md px-2 py-1.5 text-sm outline-none"
            >
              <option value="">All open</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              Mine
            </label>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && <p className="p-3 text-sm text-destructive">{error}</p>}
          {tickets === null ? (
            <p className="p-3 text-sm text-muted-foreground">Loading…</p>
          ) : tickets.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No tickets.</p>
          ) : (
            <ul>
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelected(t.id)}
                    className={`w-full border-b border-white/[0.04] px-3 py-2.5 text-left ${
                      selected === t.id ? "bg-primary/10" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-foreground">{t.subject ?? "(no subject)"}</span>
                      {t.slaBreached && (
                        <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-[10px] text-destructive">
                          SLA
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>#{t.number ?? "—"}</span>
                      <span>· {t.state}</span>
                      <span>· {t.priority}</span>
                      {t.requester?.email && <span className="truncate">· {t.requester.email}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="min-h-0 flex-1">
        {selected ? (
          <TicketThread
            key={selected}
            ticketId={selected}
            staff={staff}
            canManage={canManage}
            onChanged={() => void loadList()}
            onError={setError}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a ticket.
          </div>
        )}
      </section>
    </div>
  );
}

function TicketThread({
  ticketId,
  staff,
  canManage,
  onChanged,
  onError,
}: {
  ticketId: string;
  staff: SupportPerson[];
  canManage: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [t, setT] = useState<TicketDetail | null>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function reload() {
    try {
      setT(await ipc.admin.ticketGet(ticketId));
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  useEffect(() => {
    void reload();
    ipc.admin.cannedResponses().then(setCanned).catch(() => setCanned([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    try {
      await ipc.admin.ticketReply(ticketId, body.trim(), internal);
      setBody("");
      setInternal(false);
      await reload();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  async function patch(patchObj: { ticketState?: string; priority?: string; assigneeId?: string }) {
    try {
      await ipc.admin.ticketUpdate(ticketId, patchObj);
      await reload();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  if (!t) return <div className="p-6 text-sm text-muted-foreground">Loading ticket…</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-white/[0.06] px-6 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">{t.subject}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              #{t.number} · {t.requester?.email ?? "—"} · opened {fmt(t.createdAt)}
            </p>
          </div>
        </div>
        {canManage && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select
              label="State"
              value={t.state ?? ""}
              options={STATES}
              onChange={(v) => void patch({ ticketState: v })}
            />
            <Select
              label="Priority"
              value={t.priority ?? ""}
              options={PRIORITIES}
              onChange={(v) => void patch({ priority: v })}
            />
            <select
              value={t.assigneeId ?? ""}
              onChange={(e) => void patch({ assigneeId: e.target.value })}
              className="refx-input rounded-md px-2 py-1 text-xs outline-none"
            >
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email ?? s.id}
                </option>
              ))}
            </select>
            <button onClick={() => void act(() => ipc.admin.ticketClose(ticketId))} className="btn-ghost rounded px-2 py-1 text-xs">
              Close
            </button>
            <button onClick={() => void act(() => ipc.admin.ticketArchive(ticketId))} className="btn-ghost rounded px-2 py-1 text-xs">
              Archive
            </button>
            <button onClick={() => setConfirmDelete(true)} className="btn-ghost rounded px-2 py-1 text-xs text-destructive">
              Delete
            </button>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <ul className="flex flex-col gap-3">
          {t.messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-lg border px-4 py-3 ${
                m.isInternal
                  ? "border-warning/30 bg-warning/[0.06]"
                  : "border-white/[0.06] bg-white/[0.02]"
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="text-foreground/90">{m.author?.email ?? m.authorId ?? "—"}</span>
                <span>· {fmt(m.createdAt)}</span>
                {m.isInternal && <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">internal note</span>}
              </div>
              <div className="whitespace-pre-wrap text-sm text-foreground/90">{m.body}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-white/[0.06] p-4">
        {canned.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {canned.slice(0, 6).map((c) => (
              <button
                key={c.id}
                onClick={() => setBody((b) => (b ? b + "\n\n" : "") + (c.body ?? ""))}
                className="rounded border border-white/10 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                title={c.body ?? ""}
              >
                {c.title ?? "snippet"}
              </button>
            ))}
          </div>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={internal ? "Internal note (not visible to the customer)…" : "Reply to the customer…"}
          rows={3}
          className="refx-input w-full resize-y rounded-md px-3 py-2 text-sm outline-none focus:border-primary/60"
        />
        <div className="mt-2 flex items-center justify-between">
          {canManage ? (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
              Internal note
            </label>
          ) : (
            <span />
          )}
          <button
            onClick={() => void send()}
            disabled={!body.trim() || sending}
            className="btn-primary rounded-md px-4 py-1.5 text-sm disabled:opacity-50"
          >
            {sending ? "Sending…" : internal ? "Add note" : "Send reply"}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <TypedConfirm
          title={`Delete ticket #${t.number}`}
          danger
          confirmWord="DELETE"
          confirmLabel="Delete ticket"
          body="Permanently deletes the ticket and all its messages. This can't be undone."
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void act(() => ipc.admin.ticketDelete(ticketId));
          }}
        />
      )}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="refx-input rounded-md px-2 py-1 text-xs outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
