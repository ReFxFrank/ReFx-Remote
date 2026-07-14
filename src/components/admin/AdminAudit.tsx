import { useEffect, useRef, useState } from "react";
import { ipc, errorMessage, type AuditLog, type PageMeta } from "../../lib/ipc";

export default function AdminAudit() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | undefined>();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const searchTimer = useRef<number | null>(null);

  async function load(p = page, act = action) {
    try {
      const res = await ipc.admin.auditLogs({ page: p, pageSize: 50, action: act.trim() || undefined });
      setLogs(res.entries);
      setMeta(res.meta);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    void load(1, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onFilter(v: string) {
    setAction(v);
    setPage(1);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => void load(1, v), 350);
  }

  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4">
        <input
          value={action}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="Filter by action (e.g. admin.user.update)…"
          className="refx-input w-80 rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
        />
        <span className="text-sm text-muted-foreground">{meta ? `${meta.total} entries` : ""}</span>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      <div className="refx-card mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Actor</th>
              <th className="px-4 py-2.5 font-medium">Action</th>
              <th className="px-4 py-2.5 font-medium">Target</th>
              <th className="px-4 py-2.5 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No audit entries.
                </td>
              </tr>
            ) : (
              logs.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setDetail(l)}
                  className="cursor-pointer border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03]"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtTime(l.createdAt)}</td>
                  <td className="px-4 py-3 text-foreground">{l.actor?.email ?? l.actorId ?? "system"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground/90">{l.action ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {l.targetType ? `${l.targetType}${l.targetId ? ` · ${l.targetId.slice(0, 8)}` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{l.ip ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => {
              const p = page - 1;
              setPage(p);
              void load(p, action);
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
              void load(p, action);
            }}
            className="btn-ghost rounded px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div className="refx-panel refx-beam w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-mono text-sm text-foreground">{detail.action ?? "audit entry"}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {fmtTime(detail.createdAt)} · {detail.actor?.email ?? detail.actorId ?? "system"} · {detail.ip ?? "—"}
            </p>
            <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-white/[0.06] bg-[rgba(7,13,24,0.7)] p-3 text-xs text-foreground/90">
              {JSON.stringify(detail.metadata ?? {}, null, 2)}
            </pre>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setDetail(null)} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
