import { create } from "zustand";
import {
  errorMessage,
  ipc,
  isIpcError,
  type LiveStats,
  type PowerSignal,
  type ServerDetail,
  type ServerState,
  type ServerSummary,
} from "../lib/ipc";
import { useAuth } from "./auth";

// Polling cadences (ms). One list call per cycle keeps us far inside the
// panel's 120 req/min budget; only the selected server polls live stats.
const LIST_FOCUSED = 10_000;
const LIST_BLURRED = 30_000;
const STATS_INTERVAL = 5_000;
/// After a power action, how long we wait for the panel to confirm before
/// admitting it hasn't.
const RECONCILE_TIMEOUT = 30_000;
/// A power action can't be considered settled-by-state until at least this
/// long has passed — otherwise a restart of a RUNNING server would clear
/// instantly (it's already RUNNING) before it ever cycles.
const MIN_SETTLE = 6_000;
/// Debounce for server-side search refresh.
const SEARCH_DEBOUNCE = 400;

// Expected terminal state per signal, for reconciling optimistic actions
// even when start-state == end-state (e.g. restart of a running server).
const EXPECTED_STATE: Record<PowerSignal, ServerState[]> = {
  start: ["RUNNING"],
  restart: ["RUNNING"],
  stop: ["OFFLINE"],
  kill: ["OFFLINE", "CRASHED"],
};

export type Pending = { signal: PowerSignal; since: number; stateAtSend: string };
export type NetRates = { rxPerSec: number; txPerSec: number };

type ConnState = "ok" | "offline" | "error";
type Sample = { rx: number; tx: number; at: number };

type ServersStore = {
  servers: ServerSummary[];
  total: number;
  loaded: boolean;
  conn: ConnState;
  connDetail: string | null;
  search: string;
  selectedId: string | null;
  selectedDetail: ServerDetail | null;
  selectedStats: LiveStats | null;
  netRates: NetRates | null;
  statsError: string | null;
  pending: Record<string, Pending>;
  actionError: string | null;

  refresh: () => Promise<void>;
  setSearch: (q: string) => void;
  select: (id: string | null) => Promise<void>;
  pollStats: () => Promise<void>;
  power: (id: string, signal: PowerSignal) => Promise<void>;
  patchState: (id: string, state: ServerState) => void;
  clearActionError: () => void;
  startPolling: () => () => void;
};

// Module-scoped, non-reactive scratch state (never triggers renders).
let listInFlight = false;
let statsInFlight = false;
let prevSample: Sample | null = null;
let searchTimer: number | null = null;

/// Route a dead session back to sign-in; returns true if handled (caller
/// should stop). Any other error is left for the caller to surface.
function handleAuthDeath(e: unknown): boolean {
  const code = isIpcError(e) ? e.code : "OTHER";
  if (code === "SESSION_EXPIRED" || code === "NOT_SIGNED_IN") {
    useAuth.getState().sessionExpired();
    return true;
  }
  return false;
}

export const useServers = create<ServersStore>((set, get) => ({
  servers: [],
  total: 0,
  loaded: false,
  conn: "ok",
  connDetail: null,
  search: "",
  selectedId: null,
  selectedDetail: null,
  selectedStats: null,
  netRates: null,
  statsError: null,
  pending: {},
  actionError: null,

  refresh: async () => {
    if (listInFlight) return; // no pile-up if a call outlives its interval
    listInFlight = true;
    try {
      // Server-side search so accounts with >100 servers are searchable
      // beyond the first page.
      const q = get().search.trim() || undefined;
      const result = await ipc.serversList(q);
      const now = Date.now();
      const pending = { ...get().pending };
      for (const [id, p] of Object.entries(pending)) {
        const row = result.servers.find((s) => s.id === id);
        const elapsed = now - p.since;
        const changed = row && row.state !== p.stateAtSend;
        const settled =
          row && EXPECTED_STATE[p.signal].includes(row.state) && elapsed >= MIN_SETTLE;
        if (!row || changed || settled || elapsed > RECONCILE_TIMEOUT) {
          delete pending[id];
        }
      }
      set({
        servers: result.servers,
        total: result.meta?.total ?? result.servers.length,
        loaded: true,
        conn: "ok",
        connDetail: null,
        pending,
      });
    } catch (e) {
      if (handleAuthDeath(e)) return;
      const code = isIpcError(e) ? e.code : "OTHER";
      set({
        conn: code === "NETWORK" ? "offline" : "error",
        connDetail: errorMessage(e),
      });
    } finally {
      listInFlight = false;
    }
  },

  setSearch: (q) => {
    set({ search: q });
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void get().refresh(), SEARCH_DEBOUNCE);
  },

  select: async (id) => {
    prevSample = null;
    set({
      selectedId: id,
      selectedDetail: null,
      selectedStats: null,
      netRates: null,
      statsError: null,
      actionError: null, // don't carry one server's error onto another
    });
    if (!id) return;
    try {
      const detail = await ipc.serverGet(id);
      if (get().selectedId === id) set({ selectedDetail: detail });
    } catch (e) {
      if (handleAuthDeath(e)) return;
      // Permission gating falls back to "assume allowed"; 403 is the backstop.
    }
    void get().pollStats();
  },

  pollStats: async () => {
    const id = get().selectedId;
    if (!id || statsInFlight) return;
    statsInFlight = true;
    try {
      const stats = await ipc.serverStats(id);
      if (get().selectedId !== id) return; // selection changed mid-flight
      // netRx/TxBytes are cumulative lifetime counters, not rates — derive
      // a per-second rate from consecutive samples (clamp counter resets).
      const now = Date.now();
      let netRates: NetRates | null = null;
      if (prevSample) {
        const dt = (now - prevSample.at) / 1000;
        if (dt > 0) {
          netRates = {
            rxPerSec: Math.max(0, (stats.netRxBytes - prevSample.rx) / dt),
            txPerSec: Math.max(0, (stats.netTxBytes - prevSample.tx) / dt),
          };
        }
      }
      prevSample = { rx: stats.netRxBytes, tx: stats.netTxBytes, at: now };
      set({ selectedStats: stats, netRates, statsError: null });
    } catch (e) {
      if (handleAuthDeath(e)) return;
      if (get().selectedId === id) {
        const code = isIpcError(e) ? e.code : "OTHER";
        set({
          statsError:
            code === "SERVER_ERROR"
              ? "Live stats unavailable (node not reporting)."
              : errorMessage(e),
        });
      }
    } finally {
      statsInFlight = false;
    }
  },

  power: async (id, signal) => {
    const row = get().servers.find((s) => s.id === id);
    set({
      actionError: null,
      pending: {
        ...get().pending,
        [id]: { signal, since: Date.now(), stateAtSend: row?.state ?? "UNKNOWN" },
      },
    });
    try {
      await ipc.serverPower(id, signal);
    } catch (e) {
      const pending = { ...get().pending };
      delete pending[id];
      set({ pending });
      if (handleAuthDeath(e)) return;
      set({ actionError: errorMessage(e) });
    }
  },

  // Apply a realtime power/state change from the console WS `status` event so
  // the badge and power gating update sub-second, ahead of the next list poll.
  // Also clears any optimistic pending for this server once its state moves.
  patchState: (id, state) => {
    const servers = get().servers.map((s) => (s.id === id ? { ...s, state } : s));
    const pending = { ...get().pending };
    if (pending[id] && pending[id].stateAtSend !== state) delete pending[id];
    set({ servers, pending });
  },

  clearActionError: () => set({ actionError: null }),

  /** Kick off the polling loops; returns a cleanup function. */
  startPolling: () => {
    let lastList = 0;
    let disposed = false;

    const tick = async () => {
      if (disposed || document.hidden) return;
      const cadence = document.hasFocus() ? LIST_FOCUSED : LIST_BLURRED;
      if (Date.now() - lastList >= cadence) {
        lastList = Date.now();
        await get().refresh();
      }
    };
    const statsTick = () => {
      if (disposed || document.hidden) return;
      void get().pollStats();
    };

    void get().refresh();
    lastList = Date.now();
    const listTimer = window.setInterval(() => void tick(), 1_000);
    const statsTimer = window.setInterval(statsTick, STATS_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) {
        lastList = 0; // catch up immediately on return
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      window.clearInterval(listTimer);
      window.clearInterval(statsTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  },
}));
