import { useEffect, useRef, useState, type FormEvent } from "react";
import { ipc, errorMessage } from "../lib/ipc";
import { Dialog } from "./Dialog";

/**
 * Guided TOTP two-factor enrollment: enroll → show the secret → verify a code →
 * reveal the one-time recovery codes. `onDone` fires after success so the caller
 * can refresh the profile (which now carries `totpEnabledAt`).
 */
export default function TwoFactorSetup({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    ipc.mfaTotpEnroll().then(
      (e) => {
        if (alive) {
          setSecret(e.secret ?? null);
          setBusy(false);
        }
      },
      (e) => {
        if (alive) {
          setError(errorMessage(e));
          setBusy(false);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (busy || code.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ipc.mfaTotpVerify(code.trim());
      if (mounted.current) setCodes(res.recoveryCodes ?? []);
    } catch (err) {
      if (mounted.current) setError(errorMessage(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function finish() {
    onDone();
    onClose();
  }

  // Step 3 — recovery codes.
  if (codes) {
    return (
      <Dialog title="Two-factor is on" dismissible={false} onClose={finish}>
        <p className="mt-2 text-sm text-muted-foreground">
          Save these recovery codes somewhere safe. Each works once to sign in if you lose your
          authenticator.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-[rgba(7,13,24,0.7)] p-3 font-mono text-sm text-foreground">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between">
          <button
            onClick={() => void navigator.clipboard.writeText(codes.join("\n"))}
            className="btn-ghost rounded-md px-3 py-1.5 text-sm"
          >
            Copy codes
          </button>
          <button
            onClick={finish}
            className="btn-primary rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            Done
          </button>
        </div>
      </Dialog>
    );
  }

  // Steps 1–2 — enroll + verify. Lock the dialog while a verify is in flight so
  // it can't be dismissed before the one-time recovery codes are shown.
  const verifying = busy && secret !== null;
  return (
    <Dialog title="Set up two-factor" dismissible={!verifying} onClose={onClose}>
      <p className="mt-2 text-sm text-muted-foreground">
        Add this secret to an authenticator app (Google Authenticator, Authy, 1Password…), then enter
        the 6-digit code it shows.
      </p>
      {error && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
          {error}
        </p>
      )}
      {busy && !secret ? (
        <p className="mt-4 text-sm text-muted-foreground">Preparing…</p>
      ) : (
        <>
          {secret && (
            <div className="mt-3">
              <div className="refx-eyebrow">Secret</div>
              <div className="mt-1 flex items-center gap-2 rounded-md border border-white/10 bg-[rgba(7,13,24,0.7)] px-3 py-2">
                <span className="flex-1 break-all font-mono text-sm text-foreground">{secret}</span>
                <button
                  onClick={() => void navigator.clipboard.writeText(secret)}
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
          <form onSubmit={verify}>
            <label className="refx-eyebrow mt-4 block">Authenticator code</label>
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="refx-input mt-2 w-full rounded-md px-3 py-2 text-center font-mono text-sm tracking-[0.3em] text-foreground outline-none focus:border-primary/60"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={verifying}
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:text-white disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || code.trim().length === 0}
                className="btn-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Turn on
              </button>
            </div>
          </form>
        </>
      )}
    </Dialog>
  );
}
