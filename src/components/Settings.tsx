import { useEffect, useState } from "react";
import { ipc, errorMessage, type AppSettings, type AppInfo } from "../lib/ipc";
import { useAuth } from "../store/auth";
import { ConfirmDialog } from "./Dialog";
import TwoFactorSetup from "./TwoFactorSetup";

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
  const { profile, logout, init } = useAuth();
  const [s, setS] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [setup2fa, setSetup2fa] = useState(false);
  const [disable2fa, setDisable2fa] = useState(false);

  async function disableTwoFactor() {
    setDisable2fa(false);
    setError(null);
    try {
      await ipc.mfaTotpDisable();
      await init();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    ipc.settingsGet().then(setS).catch((e) => setError(errorMessage(e)));
    ipc.appInfo().then(setInfo).catch(() => {});
  }, []);

  function update(patch: Partial<AppSettings>) {
    if (!s) return;
    const prev = s;
    const next = { ...s, ...patch };
    setS(next);
    setError(null);
    ipc.settingsSet(next).catch((e) => {
      // The backend rejected without persisting (e.g. a denied autostart write).
      // Revert the optimistic toggle so the UI matches the persisted state —
      // otherwise it stays visually applied and re-sends the stuck value on
      // every later edit, blocking all further changes.
      setS(prev);
      setError(errorMessage(e));
    });
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

        <div className="refx-eyebrow mt-5">Security</div>
        <div className="flex items-start justify-between gap-4 py-2">
          <span>
            <span className="text-sm text-foreground">Two-factor authentication</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {profile?.totpEnabledAt
                ? "On — asked for at every sign-in."
                : "Add a second step when you sign in."}
            </span>
          </span>
          {profile?.totpEnabledAt ? (
            <button
              onClick={() => setDisable2fa(true)}
              className="btn-ghost mt-0.5 shrink-0 rounded-md px-3 py-1 text-xs"
            >
              Turn off
            </button>
          ) : (
            <button
              onClick={() => setSetup2fa(true)}
              className="btn-ghost mt-0.5 shrink-0 rounded-md px-3 py-1 text-xs"
            >
              Set up
            </button>
          )}
        </div>

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

        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          {info ? `${info.name} v${info.version}` : " "}
        </p>

        {setup2fa && (
          <TwoFactorSetup onClose={() => setSetup2fa(false)} onDone={() => void init()} />
        )}
        {disable2fa && (
          <ConfirmDialog
            title="Turn off two-factor?"
            body="Your account will be protected by password only. You can turn it back on any time."
            confirmLabel="Turn off"
            danger
            onConfirm={() => void disableTwoFactor()}
            onCancel={() => setDisable2fa(false)}
          />
        )}
      </div>
    </div>
  );
}
