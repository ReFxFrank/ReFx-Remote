import { useState } from "react";

type Props = {
  title: string;
  body: React.ReactNode;
  /** The exact word the user must type to enable the action. */
  confirmWord: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A destructive-action gate: the user must type an exact string (usually the
 * server name) before the confirm button enables — clicking OK isn't enough. */
export default function TypedConfirm({
  title,
  body,
  confirmWord,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className={`text-lg font-semibold ${danger ? "text-red-300" : "text-zinc-100"}`}>
          {title}
        </h2>
        <div className="mt-2 text-sm text-zinc-300">{body}</div>
        <p className="mt-3 text-sm text-zinc-400">
          Type <span className="font-mono text-zinc-200">{confirmWord}</span> to confirm.
        </p>
        <input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-400"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:text-white">
            Cancel
          </button>
          <button
            disabled={typed !== confirmWord}
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 ${
              danger ? "bg-red-600 hover:bg-red-500" : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
