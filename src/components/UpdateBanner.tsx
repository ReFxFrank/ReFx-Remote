import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, installUpdate, UPDATE_POLL_MS } from "../lib/updater";
import { errorMessage } from "../lib/ipc";

type Phase =
  | { k: "idle" }
  | { k: "checking" }
  | { k: "available"; update: Update }
  | { k: "downloading"; pct: number | null }
  | { k: "uptodate" } // only shown after a manual check
  | { k: "error"; message: string };

/**
 * Auto-updater surface. Silently checks on launch and every 6h; only shows a
 * banner when an update is actually available. A manual check (tray → "Check
 * for updates", which emits `app:check-updates`) additionally confirms when
 * you're already current. Dev builds have no updater endpoint, so `check()`
 * fails quietly and we stay out of the way.
 */
export default function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  // Guard against overlapping checks (launch + interval + manual) and against
  // starting a second download.
  const busyRef = useRef(false);
  // A manual check that lands while a check is in flight isn't dropped: we flag
  // it and re-run once the current one finishes, so the user always gets a result.
  const pendingManualRef = useRef(false);

  const runCheck = useCallback(async (manual: boolean) => {
    if (busyRef.current) {
      if (manual) {
        pendingManualRef.current = true;
        setPhase({ k: "checking" }); // acknowledge the click immediately
      }
      return;
    }
    busyRef.current = true;
    if (manual) setPhase({ k: "checking" });
    try {
      const update = await checkForUpdate();
      // Surface a result if the caller asked, OR a manual check arrived while
      // this one was in flight (it can only interleave during the await above,
      // so pendingManualRef is settled by the time we read it here).
      const surface = manual || pendingManualRef.current;
      if (update) {
        setPhase({ k: "available", update });
      } else if (surface) {
        setPhase({ k: "uptodate" });
        window.setTimeout(
          () => setPhase((p) => (p.k === "uptodate" ? { k: "idle" } : p)),
          4000,
        );
      }
    } catch (e) {
      // Only nag the user if they explicitly asked (or a manual check overlapped);
      // auto-checks fail silently (offline, dev build with no endpoint, GitHub hiccup).
      if (manual || pendingManualRef.current) {
        setPhase({ k: "error", message: errorMessage(e) });
      }
    } finally {
      busyRef.current = false;
      pendingManualRef.current = false;
    }
  }, []);

  // Launch check + 6h interval.
  useEffect(() => {
    void runCheck(false);
    const t = window.setInterval(() => void runCheck(false), UPDATE_POLL_MS);
    return () => window.clearInterval(t);
  }, [runCheck]);

  // Tray "Check for updates".
  useEffect(() => {
    const un = listen("app:check-updates", () => void runCheck(true));
    return () => {
      void un.then((f) => f());
    };
  }, [runCheck]);

  async function doInstall(update: Update) {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase({ k: "downloading", pct: null });
    try {
      await installUpdate(update, ({ downloaded, total }) => {
        setPhase({
          k: "downloading",
          pct: total ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
        });
      });
      // relaunch() replaces the process; nothing runs after this on success.
    } catch (e) {
      busyRef.current = false;
      setPhase({ k: "error", message: errorMessage(e) });
    }
  }

  if (phase.k === "idle" || phase.k === "checking") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
      <div className="refx-panel refx-beam pointer-events-auto flex items-center gap-3 px-4 py-2.5 text-sm shadow-lg">
        {phase.k === "available" && (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary shadow-[0_0_8px_currentColor]" />
            <span className="text-foreground">
              Version <span className="font-semibold">{phase.update.version}</span> is available.
            </span>
            <button
              onClick={() => void doInstall(phase.update)}
              className="btn-primary rounded-md px-3 py-1 text-xs"
            >
              Install &amp; restart
            </button>
            <button
              onClick={() => setPhase({ k: "idle" })}
              className="btn-ghost rounded-md px-2 py-1 text-xs"
            >
              Later
            </button>
          </>
        )}

        {phase.k === "downloading" && (
          <>
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
            <span className="text-foreground">
              Downloading update{phase.pct != null ? ` — ${phase.pct}%` : "…"}
            </span>
            <span className="text-xs text-muted-foreground">The app will restart when it's done.</span>
          </>
        )}

        {phase.k === "uptodate" && (
          <span className="text-foreground">You're on the latest version.</span>
        )}

        {phase.k === "error" && (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
            <span className="text-foreground">Update check failed: {phase.message}</span>
            <button
              onClick={() => setPhase({ k: "idle" })}
              className="btn-ghost rounded-md px-2 py-1 text-xs"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
