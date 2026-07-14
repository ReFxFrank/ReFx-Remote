import { useEffect, useState, type ReactNode } from "react";
import {
  ipc,
  errorMessage,
  type AlertSeverity,
  type GlobalAlert,
  type HomepageAlertType,
  type HomepageAlert,
  type IncidentImpact,
  type IncidentStatusStage,
  type StatusIncident,
} from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";

// ── constants ──────────────────────────────────────────────────────────

const SEVERITIES: AlertSeverity[] = ["INFO", "WARNING", "CRITICAL"];
const HOMEPAGE_TYPES: HomepageAlertType[] = ["INFO", "SUCCESS", "WARNING", "DANGER", "PROMO"];
const IMPACTS: IncidentImpact[] = ["MAINTENANCE", "DEGRADED", "OUTAGE"];
const STAGES: IncidentStatusStage[] = ["INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"];
const COMPONENTS = ["panel-api", "web", "nodes", "ios-app"];

type Tab = "alerts" | "homepage" | "incidents";

// ── shared bits ────────────────────────────────────────────────────────

type Tone = "info" | "success" | "warning" | "danger" | "promo" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  info: "bg-primary/20 text-primary",
  success: "bg-success/20 text-success",
  warning: "bg-warning/20 text-warning",
  danger: "bg-destructive/20 text-destructive",
  promo: "bg-primary/20 text-primary",
  muted: "bg-white/[0.06] text-muted-foreground",
};

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

function severityTone(s: AlertSeverity | null | undefined): Tone {
  return s === "CRITICAL" ? "danger" : s === "WARNING" ? "warning" : "info";
}
function homepageTone(t: HomepageAlertType | null | undefined): Tone {
  switch (t) {
    case "SUCCESS":
      return "success";
    case "WARNING":
      return "warning";
    case "DANGER":
      return "danger";
    case "PROMO":
      return "promo";
    default:
      return "info";
  }
}
function impactTone(i: IncidentImpact | null | undefined): Tone {
  return i === "OUTAGE" ? "danger" : i === "DEGRADED" ? "warning" : "muted";
}
function stageTone(s: IncidentStatusStage | null | undefined): Tone {
  return s === "RESOLVED" ? "success" : s === "MONITORING" ? "info" : "warning";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
function fmtWindow(startsAt: string | null | undefined, endsAt: string | null | undefined): string {
  const start = startsAt ? fmtDate(startsAt) : "now";
  const end = endsAt ? fmtDate(endsAt) : "indefinite";
  return `${start} → ${end}`;
}
/** ISO → the value a <input type="datetime-local"> expects (local wall time). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** datetime-local value → ISO string, or null when blank. */
function fromLocalInput(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const INPUT = "refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60";
const SELECT = "refx-input mt-1 w-full rounded-md px-2 py-1.5 text-sm outline-none";

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`h-5 w-9 shrink-0 rounded-full border transition ${
        checked ? "border-primary/60 bg-primary/80" : "border-white/10 bg-white/[0.06]"
      }`}
    >
      <span
        className={`block h-4 w-4 rounded-full bg-white transition ${checked ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span>
        <span className="text-sm text-foreground">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="mt-0.5">
        <Switch checked={checked} onChange={onChange} />
      </span>
    </label>
  );
}

function Modal({ onClose, wide, children }: { onClose: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`refx-panel refx-beam max-h-[85vh] w-full overflow-y-auto p-6 ${wide ? "max-w-lg" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onCancel}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-destructive">{title}</h2>
        <p className="mt-2 text-sm text-foreground/85">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button onClick={onConfirm} className="btn-danger rounded-md px-3 py-1.5 text-sm font-medium text-white">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── root ───────────────────────────────────────────────────────────────

export default function AdminContent() {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  // content.manage implies content.read via hasPermission; the global-alerts
  // list is the only read-gated fetch, so anyone reaching this screen can see
  // it. The homepage + incidents lists (and every mutation) require manage.
  const canManage = hasPermission(perms, "content.manage");

  const [tab, setTab] = useState<Tab>("alerts");
  const [error, setError] = useState<string | null>(null);

  const tabs: { key: Tab; label: string }[] = [
    { key: "alerts", label: "Internal alerts" },
    ...(canManage
      ? ([
          { key: "homepage", label: "Homepage banners" },
          { key: "incidents", label: "Status incidents" },
        ] as { key: Tab; label: string }[])
      : []),
  ];

  return (
    <div className="p-6">
      <div className="mb-4 inline-flex rounded-md border border-white/10 p-0.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setError(null);
            }}
            className={`rounded px-3 py-1 text-sm ${
              tab === t.key ? "bg-primary/20 text-foreground" : "text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      {tab === "alerts" && <GlobalAlertsPanel canManage={canManage} onError={setError} />}
      {tab === "homepage" && canManage && <HomepageAlertsPanel onError={setError} />}
      {tab === "incidents" && canManage && <IncidentsPanel onError={setError} />}
    </div>
  );
}

// ── 1) Global / internal alerts ────────────────────────────────────────

function GlobalAlertsPanel({ canManage, onError }: { canManage: boolean; onError: (m: string | null) => void }) {
  const [rows, setRows] = useState<GlobalAlert[] | null>(null);
  const [dialog, setDialog] = useState<{ editing: GlobalAlert | null } | null>(null);
  const [del, setDel] = useState<GlobalAlert | null>(null);

  async function load() {
    try {
      setRows(await ipc.admin.alertsList());
      onError(null);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleActive(a: GlobalAlert) {
    try {
      await ipc.admin.alertUpdate(a.id, { isActive: !(a.isActive ?? false) });
      await load();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">In-app alerts shown to signed-in customers.</p>
        {canManage && (
          <button onClick={() => setDialog({ editing: null })} className="btn-primary rounded-md px-3 py-1.5 text-sm">
            New alert
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts.</p>
        ) : (
          rows.map((a) => (
            <div key={a.id} className="refx-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={severityTone(a.severity)}>{a.severity ?? "INFO"}</Badge>
                    {!a.isActive && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">inactive</span>
                    )}
                  </div>
                  <div className="mt-1.5 font-medium text-foreground">{a.title || "(untitled)"}</div>
                  {a.body && <div className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</div>}
                  <div className="mt-2 text-xs text-muted-foreground">{fmtWindow(a.startsAt, a.endsAt)}</div>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch checked={!!a.isActive} onChange={() => void toggleActive(a)} />
                    <button onClick={() => setDialog({ editing: a })} className="btn-ghost rounded px-2 py-1 text-xs">
                      Edit
                    </button>
                    <button onClick={() => setDel(a)} className="btn-ghost rounded px-2 py-1 text-xs text-destructive">
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {dialog && (
        <AlertDialog
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            await load();
          }}
          onError={onError}
        />
      )}
      {del && (
        <ConfirmDialog
          title="Delete alert"
          body={`"${del.title || "(untitled)"}" will stop showing immediately.`}
          confirmLabel="Delete alert"
          onCancel={() => setDel(null)}
          onConfirm={async () => {
            const a = del;
            setDel(null);
            try {
              await ipc.admin.alertDelete(a.id);
              await load();
            } catch (e) {
              onError(errorMessage(e));
            }
          }}
        />
      )}
    </div>
  );
}

function AlertDialog({
  editing,
  onClose,
  onDone,
  onError,
}: {
  editing: GlobalAlert | null;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [severity, setSeverity] = useState<AlertSeverity>(editing?.severity ?? "INFO");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInput(editing?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(editing?.endsAt));
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const valid = title.trim().length > 0 && body.trim().length > 0;

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      const payload = {
        severity,
        title: title.trim(),
        body: body.trim(),
        isActive,
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
      };
      if (editing) await ipc.admin.alertUpdate(editing.id, payload);
      else await ipc.admin.alertCreate(payload);
      onDone();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-semibold tracking-tight">{editing ? "Edit alert" : "New alert"}</h2>
      <div className="mt-4 grid gap-3">
        <label className="text-sm">
          <span className="text-muted-foreground">Severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)} className={SELECT}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Body</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${INPUT} min-h-[72px]`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Starts (blank = now)</span>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={INPUT} />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Ends (blank = indefinite)</span>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={INPUT} />
          </label>
        </div>
        <SwitchRow label="Active" checked={isActive} onChange={setIsActive} />
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
          {busy ? "Saving…" : editing ? "Save alert" : "Create alert"}
        </button>
      </div>
    </Modal>
  );
}

// ── 2) Homepage banners ────────────────────────────────────────────────

function HomepageAlertsPanel({ onError }: { onError: (m: string | null) => void }) {
  const [rows, setRows] = useState<HomepageAlert[] | null>(null);
  const [dialog, setDialog] = useState<{ editing: HomepageAlert | null } | null>(null);
  const [del, setDel] = useState<HomepageAlert | null>(null);

  async function load() {
    try {
      setRows(await ipc.admin.homepageAlertsList());
      onError(null);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleActive(a: HomepageAlert) {
    try {
      await ipc.admin.homepageAlertUpdate(a.id, { isActive: !(a.isActive ?? false) });
      await load();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Public banners on the marketing homepage. Higher priority shows first.</p>
        <button onClick={() => setDialog({ editing: null })} className="btn-primary rounded-md px-3 py-1.5 text-sm">
          New banner
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No banners.</p>
        ) : (
          rows.map((a) => (
            <div key={a.id} className="refx-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={homepageTone(a.type)}>{a.type ?? "INFO"}</Badge>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">priority {a.priority ?? 0}</span>
                    {a.dismissible && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">dismissible</span>
                    )}
                    {!a.isActive && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">inactive</span>
                    )}
                  </div>
                  <div className="mt-1.5 font-medium text-foreground">{a.title || "(untitled)"}</div>
                  {a.body && <div className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</div>}
                  {a.ctaLabel && a.ctaUrl && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      CTA: <span className="text-foreground/90">{a.ctaLabel}</span> → <span className="font-mono">{a.ctaUrl}</span>
                    </div>
                  )}
                  <div className="mt-2 text-xs text-muted-foreground">{fmtWindow(a.startsAt, a.endsAt)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch checked={!!a.isActive} onChange={() => void toggleActive(a)} />
                  <button onClick={() => setDialog({ editing: a })} className="btn-ghost rounded px-2 py-1 text-xs">
                    Edit
                  </button>
                  <button onClick={() => setDel(a)} className="btn-ghost rounded px-2 py-1 text-xs text-destructive">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {dialog && (
        <HomepageDialog
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            await load();
          }}
          onError={onError}
        />
      )}
      {del && (
        <ConfirmDialog
          title="Delete banner"
          body={`"${del.title || "(untitled)"}" will be removed from the homepage immediately.`}
          confirmLabel="Delete banner"
          onCancel={() => setDel(null)}
          onConfirm={async () => {
            const a = del;
            setDel(null);
            try {
              await ipc.admin.homepageAlertDelete(a.id);
              await load();
            } catch (e) {
              onError(errorMessage(e));
            }
          }}
        />
      )}
    </div>
  );
}

function HomepageDialog({
  editing,
  onClose,
  onDone,
  onError,
}: {
  editing: HomepageAlert | null;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [type, setType] = useState<HomepageAlertType>(editing?.type ?? "INFO");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [priority, setPriority] = useState(String(editing?.priority ?? 0));
  const [ctaLabel, setCtaLabel] = useState(editing?.ctaLabel ?? "");
  const [ctaUrl, setCtaUrl] = useState(editing?.ctaUrl ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInput(editing?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(editing?.endsAt));
  const [dismissible, setDismissible] = useState(editing?.dismissible ?? true);
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const valid = title.trim().length > 0 && body.trim().length > 0;

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      const prioNum = Number(priority);
      const payload = {
        type,
        title: title.trim(),
        body: body.trim(),
        isActive,
        dismissible,
        priority: Number.isFinite(prioNum) ? prioNum : 0,
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
        ctaLabel: ctaLabel.trim() || null,
        ctaUrl: ctaUrl.trim() || null,
      };
      if (editing) await ipc.admin.homepageAlertUpdate(editing.id, payload);
      else await ipc.admin.homepageAlertCreate(payload);
      onDone();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <h2 className="text-lg font-semibold tracking-tight">{editing ? "Edit banner" : "New banner"}</h2>
      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as HomepageAlertType)} className={SELECT}>
              {HOMEPAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Priority</span>
            <input
              value={priority}
              onChange={(e) => setPriority(e.target.value.replace(/[^0-9-]/g, ""))}
              inputMode="numeric"
              className={INPUT}
            />
          </label>
        </div>
        <label className="text-sm">
          <span className="text-muted-foreground">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Body</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${INPUT} min-h-[72px]`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-muted-foreground">CTA label (optional)</span>
            <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} className={INPUT} />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">CTA URL (optional)</span>
            <input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://…" className={INPUT} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Starts (blank = now)</span>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={INPUT} />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Ends (blank = indefinite)</span>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={INPUT} />
          </label>
        </div>
        <div className="grid gap-3 rounded-md border border-white/[0.06] p-3">
          <SwitchRow label="Dismissible" hint="Visitors can close the banner." checked={dismissible} onChange={setDismissible} />
          <SwitchRow label="Active" checked={isActive} onChange={setIsActive} />
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
          {busy ? "Saving…" : editing ? "Save banner" : "Create banner"}
        </button>
      </div>
    </Modal>
  );
}

// ── 3) Status incidents ────────────────────────────────────────────────

function IncidentsPanel({ onError }: { onError: (m: string | null) => void }) {
  const [rows, setRows] = useState<StatusIncident[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState<StatusIncident | null>(null);
  const [del, setDel] = useState<StatusIncident | null>(null);

  async function load() {
    try {
      setRows(await ipc.admin.incidentsList());
      onError(null);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resolve(inc: StatusIncident) {
    try {
      await ipc.admin.incidentUpdate(inc.id, { status: "RESOLVED" });
      await load();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Incidents shown on the public status page.</p>
        <button onClick={() => setCreating(true)} className="btn-primary rounded-md px-3 py-1.5 text-sm">
          New incident
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No incidents.</p>
        ) : (
          rows.map((inc) => {
            const timeline = [...(inc.updates ?? [])].sort((a, b) =>
              (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
            );
            return (
              <div key={inc.id} className="refx-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={impactTone(inc.impact)}>{inc.impact ?? "—"}</Badge>
                      <Badge tone={stageTone(inc.status)}>{inc.status ?? "—"}</Badge>
                    </div>
                    <div className="mt-1.5 font-medium text-foreground">{inc.title || "(untitled)"}</div>
                    {inc.components.length > 0 && (
                      <div className="mt-0.5 text-xs text-muted-foreground">Affected: {inc.components.join(", ")}</div>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">
                      started {fmtDate(inc.startedAt)}
                      {inc.resolvedAt ? ` · resolved ${fmtDate(inc.resolvedAt)}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => setUpdating(inc)} className="btn-ghost rounded px-2 py-1 text-xs">
                      Update
                    </button>
                    {!inc.resolvedAt && (
                      <button onClick={() => void resolve(inc)} className="btn-ghost rounded px-2 py-1 text-xs">
                        Resolve
                      </button>
                    )}
                    <button onClick={() => setDel(inc)} className="btn-ghost rounded px-2 py-1 text-xs text-destructive">
                      Delete
                    </button>
                  </div>
                </div>

                {timeline.length > 0 && (
                  <ol className="mt-3 flex flex-col gap-2 border-t border-white/[0.06] pt-3">
                    {timeline.map((u, i) => (
                      <li key={u.id ?? i} className="text-sm">
                        <div className="flex items-center gap-2">
                          <Badge tone={stageTone(u.status)}>{u.status ?? "—"}</Badge>
                          <span className="text-xs text-muted-foreground">{fmtDate(u.createdAt)}</span>
                        </div>
                        {u.body && <div className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{u.body}</div>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })
        )}
      </div>

      {creating && (
        <IncidentCreateDialog
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false);
            await load();
          }}
          onError={onError}
        />
      )}
      {updating && (
        <IncidentUpdateDialog
          incident={updating}
          onClose={() => setUpdating(null)}
          onDone={async () => {
            setUpdating(null);
            // incidentAddUpdate returns the bare incident row without its
            // refreshed updates[], so refetch rather than trust the response.
            await load();
          }}
          onError={onError}
        />
      )}
      {del && (
        <ConfirmDialog
          title="Delete incident"
          body={`"${del.title || "(untitled)"}" and its full update timeline will be removed from the status page.`}
          confirmLabel="Delete incident"
          onCancel={() => setDel(null)}
          onConfirm={async () => {
            const inc = del;
            setDel(null);
            try {
              await ipc.admin.incidentDelete(inc.id);
              await load();
            } catch (e) {
              onError(errorMessage(e));
            }
          }}
        />
      )}
    </div>
  );
}

function IncidentCreateDialog({
  onClose,
  onDone,
  onError,
}: {
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState<IncidentImpact>("DEGRADED");
  const [status, setStatus] = useState<IncidentStatusStage>("INVESTIGATING");
  const [components, setComponents] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);

  const valid = title.trim().length > 0 && body.trim().length > 0 && components.length > 0;

  function toggleComponent(c: string) {
    setComponents((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function create() {
    if (!valid) return;
    setBusy(true);
    try {
      await ipc.admin.incidentCreate({
        title: title.trim(),
        impact,
        components,
        body: body.trim(),
        status,
        notify,
      });
      onDone();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <h2 className="text-lg font-semibold tracking-tight">New incident</h2>
      <div className="mt-4 grid gap-3">
        <label className="text-sm">
          <span className="text-muted-foreground">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Impact</span>
            <select value={impact} onChange={(e) => setImpact(e.target.value as IncidentImpact)} className={SELECT}>
              {IMPACTS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Initial status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as IncidentStatusStage)} className={SELECT}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Affected components</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {COMPONENTS.map((c) => {
              const on = components.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleComponent(c)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    on ? "border-primary/60 bg-primary/20 text-foreground" : "border-white/10 text-muted-foreground"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        <label className="text-sm">
          <span className="text-muted-foreground">First update</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${INPUT} min-h-[72px]`} />
        </label>
        <div className="rounded-md border border-white/[0.06] p-3">
          <SwitchRow
            label="Notify all customers"
            hint="Fans out in-app + push + email. Use only for major incidents."
            checked={notify}
            onChange={setNotify}
          />
        </div>
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
          {busy ? "Creating…" : "Create incident"}
        </button>
      </div>
    </Modal>
  );
}

function IncidentUpdateDialog({
  incident,
  onClose,
  onDone,
  onError,
}: {
  incident: StatusIncident;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [status, setStatus] = useState<IncidentStatusStage>(incident.status ?? "INVESTIGATING");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = body.trim().length > 0;

  async function post() {
    if (!valid) return;
    setBusy(true);
    try {
      await ipc.admin.incidentAddUpdate(incident.id, { status, body: body.trim() });
      onDone();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-semibold tracking-tight">Post update</h2>
      <p className="mt-1 truncate text-sm text-muted-foreground">{incident.title || "(untitled)"}</p>
      <div className="mt-4 grid gap-3">
        <label className="text-sm">
          <span className="text-muted-foreground">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as IncidentStatusStage)} className={SELECT}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Update</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${INPUT} min-h-[72px]`} />
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
          Cancel
        </button>
        <button
          onClick={() => void post()}
          disabled={!valid || busy}
          className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? "Posting…" : "Post update"}
        </button>
      </div>
    </Modal>
  );
}
