import { useEffect, useMemo, useRef, useState } from "react";
import { useServers } from "../store/servers";
import { stateDot, stateLabel } from "../lib/format";

/** Ctrl+K quick server switcher. */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const { servers, select } = useServers();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const rows = query
      ? servers.filter(
          (s) =>
            s.name.toLowerCase().includes(query) ||
            s.template?.name?.toLowerCase().includes(query),
        )
      : servers;
    return rows.slice(0, 50);
  }, [servers, q]);

  useEffect(() => setActive(0), [q]);

  function choose(id: string) {
    void select(id);
    onClose();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) choose(r.id);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24 backdrop-blur-sm" onClick={onClose}>
      <div
        className="refx-panel refx-beam w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Jump to a server…"
          className="w-full border-b border-white/[0.06] bg-transparent px-4 py-3 text-sm text-foreground outline-none"
        />
        <ul className="max-h-80 overflow-y-auto p-1">
          {results.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">No servers found.</li>
          ) : (
            results.map((s, i) => (
              <li key={s.id}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(s.id)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${
                    i === active ? "bg-primary/15" : ""
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${stateDot(s.state)}`} />
                  <span className="flex-1 truncate text-sm text-foreground">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{stateLabel(s.state)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
