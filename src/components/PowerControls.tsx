import { useState } from "react";
import type { PowerSignal, ServerState } from "../lib/ipc";

type Props = {
  state: ServerState;
  serverName: string;
  busy: boolean;
  /** From the server detail's viewerPermissions; undefined = not loaded yet
   * (assume allowed — owner is the common case; 403 is the backstop). */
  canPower?: boolean;
  onPower: (signal: PowerSignal) => void;
};

const RUNNING_ISH: ServerState[] = ["RUNNING", "STARTING", "STOPPING"];
// The panel rejects any power signal (409) while a server is provisioning.
const BUSY_STATES: ServerState[] = [
  "INSTALLING",
  "REINSTALLING",
  "SWITCHING_GAME",
  "TRANSFERRING",
];

export default function PowerControls({
  state,
  serverName,
  busy,
  canPower,
  onPower,
}: Props) {
  const [confirmKill, setConfirmKill] = useState(false);
  const [typed, setTyped] = useState("");

  const isOff = state === "OFFLINE" || state === "CRASHED";
  const isUp = RUNNING_ISH.includes(state);
  const provisioning = BUSY_STATES.includes(state);
  const locked = state === "SUSPENDED" || state === "PENDING_PAYMENT";
  const noPerm = canPower === false;

  if (locked) {
    return (
      <p className="text-sm text-red-300">
        This server is suspended. Settle the past-due invoice on refx.gg to restore
        access.
      </p>
    );
  }

  const btn =
    "rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";
  // Any power action is unavailable while provisioning or without permission.
  const block = busy || provisioning || noPerm;
  const permTitle = noPerm ? "You don't have permission to control this server." : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
        disabled={block || !isOff}
        title={permTitle}
        onClick={() => onPower("start")}
      >
        Start
      </button>
      <button
        className={`${btn} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}
        disabled={block || !isUp}
        title={permTitle}
        onClick={() => onPower("restart")}
      >
        Restart
      </button>
      <button
        className={`${btn} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}
        disabled={block || !isUp}
        title={permTitle}
        onClick={() => onPower("stop")}
      >
        Stop
      </button>
      <button
        className={`${btn} border border-red-800 text-red-300 hover:bg-red-950`}
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
        <span className="w-full text-xs text-zinc-500">
          You have view-only access to this server.
        </span>
      )}

      {confirmKill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-lg font-semibold text-red-300">Force kill?</h2>
            <p className="mt-2 text-sm text-zinc-300">
              Killing is an unclean shutdown — the process is terminated immediately
              and unsaved world data can be corrupted. Prefer <b>Stop</b> when you can.
            </p>
            <p className="mt-3 text-sm text-zinc-400">
              Type the server name <span className="font-mono text-zinc-200">{serverName}</span> to
              confirm.
            </p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-red-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:text-white"
                onClick={() => setConfirmKill(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
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
