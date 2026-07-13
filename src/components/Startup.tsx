import { useCallback, useEffect, useState } from "react";
import { ipc, errorMessage, type Startup as StartupInfo, type Variable } from "../lib/ipc";

export default function Startup({ serverId, canEdit }: { serverId: string; canEdit: boolean }) {
  const [info, setInfo] = useState<StartupInfo | null>(null);
  const [vars, setVars] = useState<Variable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadVars = useCallback(async () => {
    const v = await ipc.variablesList(serverId);
    setVars(v.filter((x) => x.userViewable));
  }, [serverId]);

  const load = useCallback(async () => {
    setError(null);
    // Load the two endpoints independently — the startup command needs
    // startup.update while variables only need server.read, so a 403 on one
    // must not hide the other.
    const [s, v] = await Promise.allSettled([ipc.startupGet(serverId), loadVars()]);
    if (s.status === "fulfilled") setInfo(s.value);
    if (v.status === "rejected") setError(errorMessage(v.reason));
    setLoading(false);
  }, [serverId, loadVars]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function save(v: Variable, value: string) {
    if (value === v.value) return;
    setSavingKey(v.envName);
    setError(null);
    try {
      await ipc.variableSet(serverId, v.envName, value);
      // Refetch (don't optimistically write) — for write-only secrets the
      // server returns value:"" so the masked affordance is preserved.
      await loadVars();
      setNotice(`${v.displayName ?? v.envName} saved.`);
      window.setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="refx-panel min-h-0 flex-1 overflow-y-auto p-4">
      {error && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {notice && <p className="mb-3 text-xs text-success">{notice}</p>}

      {loading ? (
        <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="refx-eyebrow">Startup command</div>
          <pre className="refx-input mt-1.5 overflow-x-auto rounded-md px-3 py-2 font-mono text-xs text-foreground/85">
            {info?.startupCommand || "—"}
          </pre>
          {info?.dockerImage && (
            <p className="mt-2 text-xs text-muted-foreground">
              Docker image: <span className="font-mono text-foreground/85">{info.dockerImage}</span>
            </p>
          )}

          <div className="refx-eyebrow mt-6">Variables</div>
          {vars.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">This server has no configurable variables.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-4">
              {vars.map((v) => (
                <VariableRow
                  key={v.envName}
                  v={v}
                  canEdit={canEdit}
                  saving={savingKey === v.envName}
                  onSave={save}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VariableRow({
  v,
  canEdit,
  saving,
  onSave,
}: {
  v: Variable;
  canEdit: boolean;
  saving: boolean;
  onSave: (v: Variable, value: string) => void;
}) {
  const [draft, setDraft] = useState(v.value);
  useEffect(() => setDraft(v.value), [v.value]);

  const dirty = draft !== v.value;
  const isEnum = v.type === "ENUM" && !!v.rules?.options?.length;
  // Gate on BOTH the variable's own editability and the viewer's permission.
  const readOnly = !v.userEditable || !canEdit;
  const secret = v.isSet && v.value === "";
  // If the current value isn't among the enum options, include it so the
  // select shows the truth instead of silently snapping to the first option.
  const enumOptions =
    isEnum && !v.rules!.options!.includes(v.value)
      ? [v.value, ...v.rules!.options!]
      : v.rules?.options ?? [];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-foreground">{v.displayName ?? v.envName}</label>
        <span className="font-mono text-[11px] text-muted-foreground/70">{v.envName}</span>
      </div>
      {v.description && <p className="mt-0.5 text-xs text-muted-foreground">{v.description}</p>}

      <div className="mt-1.5 flex items-center gap-2">
        {isEnum ? (
          <select
            disabled={readOnly}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="refx-input flex-1 rounded-md px-3 py-1.5 text-sm text-foreground outline-none disabled:opacity-60"
          >
            {enumOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            disabled={readOnly}
            value={draft}
            placeholder={secret ? "•••••• (set — enter a new value to change)" : undefined}
            onChange={(e) => setDraft(e.target.value)}
            className="refx-input flex-1 rounded-md px-3 py-1.5 font-mono text-sm text-foreground outline-none focus:border-primary/60 disabled:opacity-60"
          />
        )}
        {!readOnly && (
          <button
            onClick={() => onSave(v, draft)}
            disabled={!dirty || saving}
            className="btn-primary rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            {saving ? "…" : "Save"}
          </button>
        )}
      </div>
      {readOnly && <p className="mt-1 text-[11px] text-muted-foreground/70">Read-only</p>}
    </div>
  );
}
