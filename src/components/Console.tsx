import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { ipc, type ConnEvent, type ConsoleLine, type StatusEvent } from "../lib/ipc";
import { errorMessage } from "../lib/ipc";
import { useServers } from "../store/servers";

type Props = { serverId: string; canCommand: boolean };

const CONN_LABEL: Record<string, string> = {
  connecting: "Connecting…",
  live: "Live",
  retrying: "Reconnecting…",
  failed: "Disconnected",
  closed: "Closed",
};

export default function Console({ serverId, canCommand }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const stickRef = useRef(true); // autoscroll unless the user scrolled up

  const [conn, setConn] = useState<ConnEvent>({ state: "connecting" });
  const [atBottom, setAtBottom] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [command, setCommand] = useState("");
  const [cmdError, setCmdError] = useState<string | null>(null);
  const historyRef = useRef<string[]>([]);
  const histIdx = useRef<number>(-1);

  // Terminal + event wiring. Re-runs when the selected server changes.
  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: '"Cascadia Code", "Consolas", ui-monospace, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: "#070b12",
        foreground: "#eef6ff",
        cursor: "#7db7ff",
        selectionBackground: "rgba(0,114,255,0.35)",
        black: "#0a111d",
        blue: "#3aa0ff",
        brightBlue: "#7db7ff",
        cyan: "#22d3ee",
      },
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    if (hostRef.current) term.open(hostRef.current);
    try {
      const webgl = new WebglAddon();
      // On GPU context loss (driver reset, sleep/wake) WebGL does NOT
      // auto-recover — dispose so xterm falls back to the DOM renderer
      // instead of freezing the terminal blank.
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL unavailable (rare in WebView2) — canvas renderer still works.
    }
    fit.fit();
    termRef.current = term;
    searchRef.current = search;
    fitRef.current = fit;

    // Track whether the viewport is pinned to the bottom.
    const onScroll = () => {
      const buf = term.buffer.active;
      const bottom = buf.viewportY >= buf.baseY;
      stickRef.current = bottom;
      setAtBottom(bottom);
    };
    term.onScroll(onScroll);

    const onResize = () => {
      try {
        fit.fit();
      } catch {
        /* element not yet laid out */
      }
    };
    window.addEventListener("resize", onResize);

    const write = (l: ConsoleLine) => {
      term.write(l.line.replace(/\r?\n$/, "") + "\r\n");
      if (stickRef.current) term.scrollToBottom();
    };

    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    // Register a listener but honour a cleanup that ran before it resolved —
    // otherwise (StrictMode double-mount / fast server-switch) the listener
    // leaks and its `write` fires on a disposed terminal.
    const track = (un: UnlistenFn) => {
      if (disposed) un();
      else unlisteners.push(un);
    };
    const patchState = useServers.getState().patchState;

    (async () => {
      // Attach listeners BEFORE opening so no line is missed in the gap.
      track(await listen<ConsoleLine>(`console:${serverId}`, (e) => write(e.payload)));
      track(await listen<ConnEvent>(`conn:${serverId}`, (e) => setConn(e.payload)));
      // Sub-second power/state signal → update the badge ahead of the poll.
      track(
        await listen<StatusEvent>(`status:${serverId}`, (e) =>
          patchState(serverId, e.payload.state),
        ),
      );
      if (disposed) return;
      // Open the session; render buffered scrollback, then stream continues.
      try {
        const history = await ipc.consoleOpen(serverId);
        for (const l of history) write(l);
      } catch {
        /* signed out / closed — conn events will reflect it */
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      unlisteners.forEach((u) => u());
      void ipc.consoleClose(serverId);
      term.dispose();
      termRef.current = null;
    };
  }, [serverId]);

  // Ctrl+F toggles the search box.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSearch((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function jumpToBottom() {
    stickRef.current = true;
    termRef.current?.scrollToBottom();
    setAtBottom(true);
  }

  function runSearch(dir: "next" | "prev") {
    if (!query) return;
    if (dir === "next") searchRef.current?.findNext(query);
    else searchRef.current?.findPrevious(query);
  }

  async function submitCommand() {
    const cmd = command.trim();
    if (!cmd) return;
    setCommand("");
    setCmdError(null);
    historyRef.current = [cmd, ...historyRef.current.filter((c) => c !== cmd)].slice(0, 100);
    histIdx.current = -1;
    // Echo locally so the user sees what they sent (server may not echo).
    termRef.current?.write(`\x1b[38;5;244m> ${cmd}\x1b[0m\r\n`);
    try {
      await ipc.consoleCommand(serverId, cmd);
    } catch (e) {
      setCmdError(errorMessage(e));
    }
  }

  function onCommandKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      void submitCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const hist = historyRef.current;
      if (histIdx.current < hist.length - 1) {
        histIdx.current += 1;
        setCommand(hist[histIdx.current]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx.current > 0) {
        histIdx.current -= 1;
        setCommand(historyRef.current[histIdx.current]);
      } else {
        histIdx.current = -1;
        setCommand("");
      }
    }
  }

  const live = conn.state === "live";
  const connColor =
    conn.state === "live"
      ? "text-success"
      : conn.state === "failed"
        ? "text-destructive"
        : "text-warning";

  return (
    <div className="refx-beam flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/[0.06] bg-[#070b12]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5 text-xs">
        <span className={`flex items-center gap-1.5 ${connColor}`}>
          <span className={`h-1.5 w-1.5 rounded-full bg-current ${live ? "shadow-[0_0_8px_currentColor]" : ""}`} />
          {CONN_LABEL[conn.state] ?? conn.state}
          {conn.attempt ? ` (attempt ${conn.attempt})` : ""}
          {conn.detail ? ` — ${conn.detail}` : ""}
        </span>
        <button
          onClick={() => setShowSearch((s) => !s)}
          className="text-muted-foreground hover:text-foreground/85"
          title="Search (Ctrl+F)"
        >
          Search
        </button>
      </div>

      {showSearch && (
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(e.shiftKey ? "prev" : "next");
              if (e.key === "Escape") setShowSearch(false);
            }}
            placeholder="Find in console…"
            className="flex-1 rounded border border-white/10 bg-[rgba(7,13,24,0.7)] px-2 py-1 text-xs outline-none focus:border-primary/60"
          />
          <button onClick={() => runSearch("prev")} className="text-xs text-muted-foreground hover:text-foreground">
            ↑
          </button>
          <button onClick={() => runSearch("next")} className="text-xs text-muted-foreground hover:text-foreground">
            ↓
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0 p-2" />
        {!atBottom && (
          <button
            onClick={jumpToBottom}
            className="absolute bottom-3 right-4 rounded-full btn-ghost px-3 py-1 text-xs shadow"
          >
            Jump to bottom ↓
          </button>
        )}
      </div>

      <div className="border-t border-white/[0.06] p-2">
        {cmdError && <p className="mb-1 px-1 text-xs text-destructive">{cmdError}</p>}
        <div className="flex items-center gap-2">
          <span className="pl-1 text-muted-foreground">›</span>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onCommandKey}
            disabled={!canCommand}
            placeholder={
              canCommand
                ? live
                  ? "Type a command and press Enter"
                  : "Console offline — commands may not run"
                : "You don't have permission to run commands"
            }
            className="flex-1 rounded border border-white/[0.06] bg-[rgba(7,11,18,0.55)] px-2 py-1.5 font-mono text-sm outline-none focus:border-primary/60 disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
