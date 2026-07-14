import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

type DialogProps = {
  title: ReactNode;
  danger?: boolean;
  onClose: () => void;
  /** Whether Esc / backdrop click dismiss the dialog. Default true. */
  dismissible?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * Accessible modal shell: role="dialog" + aria-modal, a focus trap, focus
 * restoration on close, and Esc / backdrop-click dismiss. The one place these
 * behaviours live so every dialog gets them for free.
 */
export function Dialog({ title, danger, onClose, dismissible = true, children, className = "" }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Hold the latest onClose/dismissible without re-running the focus effect:
  // callers pass fresh inline closures, and a parent re-render (e.g. the 5s
  // stats poll behind an open dialog) must NOT re-steal focus or re-fire
  // focus-restore.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const initial = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (initial && initial.length ? initial[0] : panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (dismissibleRef.current) {
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
    // Runs once: focus setup + trap + restore. onClose/dismissible are read
    // live from refs above so a re-render never re-triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`refx-panel refx-beam w-full max-w-md p-6 outline-none ${className}`}
      >
        <h2
          id={titleId}
          className={`text-lg font-semibold ${danger ? "text-destructive" : "text-foreground"}`}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

type ConfirmProps = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Yes/no confirmation — the styled replacement for window.confirm. */
export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Dialog title={title} danger={danger} onClose={onCancel}>
      <div className="mt-2 text-sm text-muted-foreground">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:text-white"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${danger ? "btn-danger" : "btn-primary"}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

type PromptProps = {
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

/** Single-line text prompt — the styled replacement for window.prompt. */
export function PromptDialog({
  title,
  label,
  initialValue = "",
  placeholder,
  confirmLabel,
  onSubmit,
  onCancel,
}: PromptProps) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <Dialog title={title} onClose={onCancel}>
      <form onSubmit={submit}>
        {label && <label className="refx-eyebrow mt-4 block">{label}</label>}
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="refx-input mt-2 w-full rounded-md px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!trimmed}
            className="btn-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
