import { useEffect, useState } from "react";
import { ipc, errorMessage, type AppSettings } from "../lib/ipc";
import { useAuth } from "../store/auth";

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span>
        <span className="text-sm text-foreground">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition ${
          checked ? "border-primary/60 bg-primary/80" : "border-white/10 bg-white/[0.06]"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white transition ${checked ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
    </label>
  );
}

export default function Settings({ onClose }: { onClose: () => void }) {
  const { profile, logout } = useAuth();
  const [s, setS] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ipc.settingsGet().then(setS).catch((e) => setError(errorMessage(e)));
  }, []);

  function update(patch: Partial<AppSettings>) {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    ipc.settingsSet(next).catch((e) => setError(errorMessage(e)));
  }

  async function copyDiagnostics() {
    try {
      const log = await ipc.copyDiagnostics();
      await navigator.clipboard.writeText(log);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="refx-panel refx-beam w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">{profile?.email}</p>

        {error && (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            {error}
          </p>
        )}

        {s && (
          <>
            <div className="refx-eyebrow mt-5">Notifications</div>
            <Toggle
              label="Server crashed"
              hint="Alert when a server stops unexpectedly."
              checked={s.notifyCrashed}
              onChange={(v) => update({ notifyCrashed: v })}
            />
            <Toggle
              label="Back online"
              hint="Alert when a crashed server recovers."
              checked={s.notifyBackOnline}
              onChange={(v) => update({ notifyBackOnline: v })}
            />

            <div className="refx-eyebrow mt-5">Window</div>
            <Toggle
              label="Keep running in the tray on close"
              hint="Closing the window keeps monitoring your servers."
              checked={s.closeToTray}
              onChange={(v) => update({ closeToTray: v })}
            />
            <Toggle
              label="Start with Windows"
              hint="Launch ReFx Desktop when you sign in."
              checked={s.startWithWindows}
              onChange={(v) => update({ startWithWindows: v })}
            />
          </>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-white/[0.06] pt-4">
          <button onClick={() => void copyDiagnostics()} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
            {copied ? "Copied to clipboard" : "Copy diagnostics"}
          </button>
          <button
            onClick={() => {
              onClose();
              void logout();
            }}
            className="btn-danger rounded-md px-3 py-1.5 text-sm"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
