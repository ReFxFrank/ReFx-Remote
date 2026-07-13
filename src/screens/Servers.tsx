import { useEffect, useMemo, useState } from "react";
import { useServers } from "../store/servers";
import { useAuth } from "../store/auth";
import type { ServerSummary } from "../lib/ipc";
import { fromMb, stateDot, stateLabel } from "../lib/format";
import ServerDetailPanel from "../components/ServerDetailPanel";

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
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <span className="font-semibold tracking-tight">ReFx Desktop</span>
        <div className="flex items-center gap-4 text-sm">
          {conn !== "ok" && (
            <span className="rounded-md bg-red-950/60 px-2 py-1 text-xs text-red-300">
              {conn === "offline" ? "Offline — reconnecting…" : "Panel unreachable"}
            </span>
          )}
          <span className="text-zinc-400">{profile?.email}</span>
          <button
            onClick={() => void logout()}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 transition hover:border-zinc-500 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex w-1/2 min-w-[420px] flex-col border-r border-zinc-800">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search servers…"
              className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as "name" | "state")}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm outline-none"
            >
              <option value="name">Name</option>
              <option value="state">Status</option>
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
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
                <ul>
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
                  <p className="px-4 py-3 text-center text-xs text-zinc-500">
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
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-zinc-500">
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
        className={`flex w-full items-center gap-3 border-b border-zinc-900 px-4 py-3 text-left transition hover:bg-zinc-900 ${
          active ? "bg-zinc-900" : ""
        }`}
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stateDot(server.state)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{server.name}</span>
            <span className="shrink-0 text-xs text-zinc-500">{server.template?.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
            <span>
              {pendingLabel ? `${pendingLabel}…` : stateLabel(server.state)}
            </span>
            {alloc?.ip && (
              <span className="font-mono">
                {alloc.ip}:{alloc.port}
              </span>
            )}
            {server.node?.name && <span>· {server.node.name}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-zinc-500">
          {server.memoryMb != null && <div>{fromMb(server.memoryMb)}</div>}
        </div>
      </button>
    </li>
  );
}
