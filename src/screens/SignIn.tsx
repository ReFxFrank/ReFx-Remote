import { useState, type FormEvent } from "react";
import { useAuth } from "../store/auth";

export default function SignIn() {
  const { status, login, verifyMfa, backToSignIn, busy, error, mfaMethods } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const mfa = status === "mfa";
  const hasTotp = mfaMethods.includes("totp");
  const hasRecovery = mfaMethods.includes("recovery");
  // Passkey-only accounts can't complete MFA here (no WebAuthn in v1) —
  // say so honestly instead of presenting a code box that can never work.
  const passkeyOnly = mfa && !hasTotp && !hasRecovery;
  // Recovery-only accounts go straight to recovery mode.
  const recoveryMode = useRecovery || (hasRecovery && !hasTotp);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || passkeyOnly) return;
    if (mfa) {
      if (code.trim()) void verifyMfa(code, recoveryMode ? "recovery" : undefined);
    } else if (email.trim() && password) {
      void login(email, password, remember);
    }
  }

  return (
    <main className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl"
      >
        <h1 className="text-xl font-semibold tracking-tight">ReFx Desktop</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {mfa
            ? passkeyOnly
              ? "This account uses a passkey for two-factor sign-in."
              : "Enter your two-factor code to finish signing in."
            : "Sign in with your refx.gg account."}
        </p>

        {mfa ? (
          passkeyOnly ? (
            <p className="mt-6 rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
              ReFx Desktop can't use passkeys yet. Sign in on refx.gg and add an
              authenticator app (or keep recovery codes handy), then try again.
            </p>
          ) : (
            <>
              <label className="mt-6 block text-sm text-zinc-300" htmlFor="code">
                {recoveryMode ? "Recovery code" : "Authenticator code"}
              </label>
              <input
                id="code"
                autoFocus
                inputMode={recoveryMode ? "text" : "numeric"}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono outline-none focus:border-zinc-400 ${
                  recoveryMode ? "" : "text-center tracking-[0.3em]"
                }`}
                placeholder={recoveryMode ? "recovery code" : "123456"}
              />
              {hasRecovery && hasTotp && (
                <button
                  type="button"
                  onClick={() => {
                    setUseRecovery(!useRecovery);
                    setCode("");
                  }}
                  className="mt-2 text-xs text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                >
                  {useRecovery ? "Use your authenticator code" : "Use a recovery code instead"}
                </button>
              )}
            </>
          )
        ) : (
          <>
            <label className="mt-6 block text-sm text-zinc-300" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-zinc-400"
              placeholder="you@example.com"
            />
            <label className="mt-4 block text-sm text-zinc-300" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-zinc-400"
            />
            <label className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              Keep me signed in
            </label>
          </>
        )}

        {error && (
          <p className="mt-4 rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {!passkeyOnly && (
          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full rounded-md bg-zinc-100 px-3 py-2 font-medium text-zinc-950 transition hover:bg-white disabled:opacity-50"
          >
            {busy ? "Working…" : mfa ? "Verify" : "Sign in"}
          </button>
        )}

        {mfa && (
          <button
            type="button"
            onClick={() => {
              setUseRecovery(false);
              setCode("");
              backToSignIn();
            }}
            className="mt-3 w-full text-sm text-zinc-400 hover:text-zinc-200"
          >
            ← Back to sign-in
          </button>
        )}
      </form>
    </main>
  );
}
