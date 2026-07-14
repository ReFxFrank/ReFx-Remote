import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useServers } from "../store/servers";
import { useAuth } from "../store/auth";
import { ipc, type OpenServerEvent, type ServerSummary } from "../lib/ipc";
import { fromMb, stateDot, stateLabel } from "../lib/format";
import ServerDetailPanel from "../components/ServerDetailPanel";
import { LogoWordmark } from "../components/Logo";
import Settings from "../components/Settings";
import CommandPalette from "../components/CommandPalette";

export default function Servers() {
  const {
    servers,
    total,
    loaded,
    conn,
    connDetail,
    search,
    setSearch,
    selectedId,
    select,
    pending,
    startPolling,
  } = useServers();
  const { profile } = useAuth();
  const focusServer = useServers((s) => s.focusServer);
  const patchState = useServers((s) => s.patchState);
  const [sortKey, setSortKey] = useState<"name" | "state">("name");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => startPolling(), [startPolling]);

  // Tray clicks and refx:// deep links resolve to a server the backend has
  // already shown the window for; jump straight to it (and its console).
  // Register the listener FIRST, then tell the backend we're ready and drain
  // any link that arrived before mount (cold-start / signed-out). On unmount we
  // clear the ready flag so later links buffer until we mount again.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const un = await listen<OpenServerEvent>("app:open-server", (e) =>
        void focusServer(e.payload.id, !!e.payload.console),
      );
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      // Drain every link buffered before we mounted (oldest first). Only the
      // last one wins the selection, but processing all keeps semantics honest.
      const pending = await ipc.deeplinkReady(true);
      for (const link of pending) {
        if (cancelled) break;
        await focusServer(link.id, !!link.console);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      void ipc.deeplinkReady(false);
    };
  }, [focusServer]);

  // The background monitor fires `status:crash` the instant it detects a crash;
  // reflect it on the list badge immediately rather than waiting for the poll.
  useEffect(() => {
    const un = listen<string>("status:crash", (e) => patchState(e.payload, "CRASHED"));
    return () => {
      void un.then((f) => f());
    };
  }, [patchState]);

  // Global shortcuts: Ctrl+K quick-switch, Ctrl+R restart selected (confirmed),
  // Ctrl+` focus the console command line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "r") {
        // Restart the selected server — but never hijack a keystroke typed into
        // an input (search/console/etc.), and only when something is selected.
        // ServerDetailPanel applies the permission/state/busy gate and shows a
        // confirmation before anything actually restarts.
        if (isEditableTarget(e.target) || !useServers.getState().selectedId) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("refx:request-restart"));
      } else if (e.key === "`") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("refx:focus-console"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? servers.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.template?.name?.toLowerCase().includes(q) ||
            s.primaryAllocation?.ip?.includes(q),
        )
      : servers;
    return [...rows].sort((a, b) =>
      sortKey === "name"
        ? a.name.localeCompare(b.name)
        : a.state.localeCompare(b.state) || a.name.localeCompare(b.name),
    );
  }, [servers, search, sortKey]);

  const selected = servers.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="relative flex h-screen flex-col">
      <header className="refx-beam sticky top-0 z-40 flex items-center justify-between border-b border-white/[0.06] bg-[rgba(7,11,18,0.72)] px-6 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <LogoWordmark height={18} />
          <span className="text-sm font-medium text-muted-foreground">Desktop</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {conn !== "ok" && (
            <span className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive-foreground">
              {conn === "offline" ? "Offline — reconnecting…" : "Panel unreachable"}
            </span>
          )}
          <button
            onClick={() => setPaletteOpen(true)}
            className="btn-ghost hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground sm:flex"
            title="Quick switch (Ctrl+K)"
          >
            <span>Jump to…</span>
            <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
          </button>
          <span className="text-muted-foreground">{profile?.email}</span>
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn-ghost rounded-md p-1.5"
            title="Settings"
            aria-label="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      <div className="flex min-h-0 flex-1">
        <section className="flex w-1/2 min-w-[420px] flex-col border-r border-white/[0.06]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search servers…"
              className="refx-input flex-1 rounded-md px-3 py-1.5 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/40"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as "name" | "state")}
              className="refx-input rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
            >
              <option value="name">Name</option>
              <option value="state">Status</option>
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!loaded ? (
              <Center>Loading your servers…</Center>
            ) : conn === "offline" && servers.length === 0 ? (
              <Center>You're offline. This list will refresh when you reconnect.</Center>
            ) : conn === "error" && servers.length === 0 ? (
              <Center>Can't reach the panel right now.{connDetail ? ` ${connDetail}` : ""}</Center>
            ) : filtered.length === 0 ? (
              <Center>
                {search
                  ? "No servers match your search."
                  : "You don't have any servers yet. Order one on refx.gg."}
              </Center>
            ) : (
              <>
                <ul className="flex flex-col gap-1.5">
                  {filtered.map((s) => (
                    <Row
                      key={s.id}
                      server={s}
                      active={s.id === selectedId}
                      pendingLabel={pending[s.id]?.signal}
                      onClick={() => void select(s.id === selectedId ? null : s.id)}
                    />
                  ))}
                </ul>
                {total > servers.length && !search && (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    Showing {servers.length} of {total}. Use search to find the rest.
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        <section className="min-h-0 flex-1 overflow-hidden">
          {selected ? (
            <ServerDetailPanel server={selected} />
          ) : (
            <Center>Select a server to manage it.</Center>
          )}
        </section>
      </div>
    </div>
  );
}

/** True when a keystroke landed in a text field we shouldn't hijack. */
function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Row({
  server,
  active,
  pendingLabel,
  onClick,
}: {
  server: ServerSummary;
  active: boolean;
  pendingLabel?: string;
  onClick: () => void;
}) {
  const alloc = server.primaryAllocation;
  return (
    <li>
      <button
        onClick={onClick}
        className={`refx-card refx-hover-card flex w-full items-center gap-3 px-3.5 py-3 text-left ${
          active ? "!border-primary/50 refx-glow" : ""
        }`}
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stateDot(server.state)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">{server.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{server.template?.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{pendingLabel ? `${pendingLabel}…` : stateLabel(server.state)}</span>
            {alloc?.ip && (
              <span className="font-mono text-[11px]">
                {alloc.ip}:{alloc.port}
              </span>
            )}
            {server.node?.name && <span>· {server.node.name}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          {server.memoryMb != null && <div>{fromMb(server.memoryMb)}</div>}
        </div>
      </button>
    </li>
  );
}
