import { useState, type FormEvent } from "react";
import { useAuth } from "../store/auth";
import { LogoWordmark } from "../components/Logo";

const input =
  "mt-1 w-full rounded-md refx-input px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/40";

/**
 * Shown when the signed-in account has `mustChangePassword` set — e.g. an admin
 * issued a temporary password. The backend 403s every route except the password
 * change until it's done, so this screen replaces the whole app until the user
 * sets a new password (or signs out).
 */
export default function ForcePasswordChange() {
  const { changePassword, logout, busy, error, profile } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const tooShort = next.length > 0 && next.length < 8;
  const sameAsCurrent = next.length > 0 && next === current;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    !busy && current.length > 0 && next.length >= 8 && next === confirm && next !== current;

  let hint: string | null = null;
  if (tooShort) hint = "New password must be at least 8 characters.";
  else if (sameAsCurrent) hint = "New password must be different from your current one.";
  else if (mismatch) hint = "New passwords don't match.";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    void changePassword(current, next);
  }

  return (
    <main className="flex h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="refx-panel refx-beam refx-enter w-full max-w-sm overflow-hidden p-8"
      >
        <div className="flex items-center gap-2.5">
          <LogoWordmark height={26} />
          <span className="text-lg font-semibold tracking-tight text-muted-foreground">Desktop</span>
        </div>
        <h1 className="mt-5 text-base font-semibold text-foreground">Set a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account requires a password change before you can continue
          {profile?.email ? (
            <>
              {" as "}
              <span className="text-foreground">{profile.email}</span>
            </>
          ) : null}
          .
        </p>

        <label className="refx-eyebrow mt-6 block" htmlFor="current">
          Current password
        </label>
        <input
          id="current"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={input}
        />

        <label className="refx-eyebrow mt-4 block" htmlFor="next">
          New password
        </label>
        <input
          id="next"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={input}
        />

        <label className="refx-eyebrow mt-4 block" htmlFor="confirm">
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={input}
        />

        {hint && <p className="mt-3 text-xs text-warning">{hint}</p>}
        {error && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary refx-sheen relative mt-6 w-full rounded-md px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Working…" : "Update password & continue"}
        </button>

        <button
          type="button"
          onClick={() => void logout()}
          className="mt-3 w-full text-sm text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
