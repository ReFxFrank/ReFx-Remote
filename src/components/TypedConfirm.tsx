import { useState } from "react";
import { Dialog } from "./Dialog";

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
 * server name) before the confirm button enables — clicking OK isn't enough.
 * Wraps the shared Dialog, so it gets focus-trap, focus-restore, and Esc /
 * backdrop dismiss for free. */
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
    <Dialog title={title} danger={danger} onClose={onCancel}>
      <div className="mt-2 text-sm text-foreground/85">{body}</div>
      <p className="mt-3 text-sm text-muted-foreground">
        Type <span className="font-mono text-foreground">{confirmWord}</span> to confirm.
      </p>
      <input
        autoFocus
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="mt-2 w-full rounded-md border border-white/10 bg-[rgba(7,13,24,0.7)] px-3 py-2 font-mono text-sm outline-none focus:border-primary/60"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:text-white"
        >
          Cancel
        </button>
        <button
          disabled={typed !== confirmWord}
          onClick={onConfirm}
          className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 ${
            danger ? "btn-danger" : "btn-primary"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
