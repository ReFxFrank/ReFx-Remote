import { useCallback, useEffect, useState } from "react";
import { ipc, errorMessage, type Database } from "../lib/ipc";

export default function Databases({ serverId }: { serverId: string }) {
  const [dbs, setDbs] = useState<Database[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDbs(await ipc.databasesList(serverId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(label);
        window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
      },
      () => setCopied(null),
    );
  }

  return (
    <div className="refx-panel min-h-0 flex-1 overflow-y-auto p-4">
      {error && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {loading ? (
        <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
      ) : dbs.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted-foreground">
          No databases. Create them on refx.gg; connection details will appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dbs.map((d) => {
            const host = d.host ?? "";
            const addr = host && d.port ? `${host}:${d.port}` : host;
            return (
              <li key={d.id} className="refx-card p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{d.name || "(database)"}</span>
                  {d.engine && (
                    <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {d.engine}
                    </span>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                  <Field id={d.id} label="Host" value={addr} onCopy={copy} copied={copied} />
                  <Field id={d.id} label="Database" value={d.name ?? ""} onCopy={copy} copied={copied} />
                  <Field id={d.id} label="Username" value={d.username ?? ""} onCopy={copy} copied={copied} />
                </dl>
                <p className="mt-2 text-[11px] text-muted-foreground/70">
                  The password is shown once on refx.gg when the database is created or rotated.
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onCopy,
  copied,
}: {
  id: string;
  label: string;
  value: string;
  onCopy: (token: string, text: string) => void;
  copied: string | null;
}) {
  if (!value) return null;
  // Token is scoped per database so two rows' identical field labels don't
  // both flip to "Copied!".
  const token = `${id}:${label}`;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className="truncate font-mono text-foreground/85">{value}</span>
        <button
          onClick={() => onCopy(token, value)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {copied === token ? "Copied!" : "Copy"}
        </button>
      </dd>
    </>
  );
}
