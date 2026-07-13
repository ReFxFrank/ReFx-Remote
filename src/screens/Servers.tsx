import { useEffect, useMemo, useState } from "react";
import { useServers } from "../store/servers";
import { useAuth } from "../store/auth";
import type { ServerSummary } from "../lib/ipc";
import { fromMb, stateDot, stateLabel } from "../lib/format";
import ServerDetailPanel from "../components/ServerDetailPanel";
import { LogoWordmark } from "../components/Logo";

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
  const { profile, logout } = useAuth();
  const [sortKey, setSortKey] = useState<"name" | "state">("name");

  useEffect(() => startPolling(), [startPolling]);

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
          <span className="text-muted-foreground">{profile?.email}</span>
          <button
            onClick={() => void logout()}
            className="btn-ghost rounded-md px-3 py-1.5 text-sm"
          >
            Sign out
          </button>
        </div>
      </header>

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
