import { useEffect, useState } from "react";
import type { PowerSignal, ServerState } from "../lib/ipc";

type Props = {
  state: ServerState;
  serverName: string;
  busy: boolean;
  canPower?: boolean;
  onPower: (signal: PowerSignal) => void;
};

const RUNNING_ISH: ServerState[] = ["RUNNING", "STARTING", "STOPPING"];
const BUSY_STATES: ServerState[] = ["INSTALLING", "REINSTALLING", "SWITCHING_GAME", "TRANSFERRING"];

export default function PowerControls({ state, serverName, busy, canPower, onPower }: Props) {
  const [confirmKill, setConfirmKill] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!confirmKill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmKill(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmKill]);

  const isOff = state === "OFFLINE" || state === "CRASHED";
  const isUp = RUNNING_ISH.includes(state);
  const provisioning = BUSY_STATES.includes(state);
  const locked = state === "SUSPENDED" || state === "PENDING_PAYMENT";
  const noPerm = canPower === false;

  if (locked) {
    return (
      <p className="text-sm text-destructive-foreground/90">
        This server is suspended. Settle the past-due invoice on refx.gg to restore access.
      </p>
    );
  }

  const btn = "rounded-md px-3.5 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed";
  const block = busy || provisioning || noPerm;
  const permTitle = noPerm ? "You don't have permission to control this server." : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className={`${btn} btn-primary refx-sheen relative`}
        disabled={block || !isOff}
        title={permTitle}
        onClick={() => onPower("start")}
      >
        Start
      </button>
      <button
        className={`${btn} btn-ghost`}
        disabled={block || !isUp}
        title={permTitle}
        onClick={() => onPower("restart")}
      >
        Restart
      </button>
      <button
        className={`${btn} btn-ghost`}
        disabled={block || !isUp}
        title={permTitle}
        onClick={() => onPower("stop")}
      >
        Stop
      </button>
      <button
        className={`${btn} btn-danger`}
        disabled={block || isOff}
        title={permTitle}
        onClick={() => {
          setConfirmKill(true);
          setTyped("");
        }}
      >
        Kill
      </button>

      {noPerm && (
        <span className="w-full text-xs text-muted-foreground">You have view-only access to this server.</span>
      )}

      {confirmKill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setConfirmKill(false)}
        >
          <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-destructive-foreground">Force kill?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Killing is an unclean shutdown — the process is terminated immediately and unsaved
              world data can be corrupted. Prefer <b className="text-foreground">Stop</b> when you can.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Type the server name{" "}
              <span className="font-mono text-foreground">{serverName}</span> to confirm.
            </p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="refx-input mt-2 w-full rounded-md px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-destructive/60"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setConfirmKill(false)}
              >
                Cancel
              </button>
              <button
                className="btn-danger rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                disabled={typed !== serverName}
                onClick={() => {
                  setConfirmKill(false);
                  onPower("kill");
                }}
              >
                Force kill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
