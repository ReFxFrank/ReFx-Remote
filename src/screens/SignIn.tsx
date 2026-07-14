import { useState, type FormEvent } from "react";
import { useAuth } from "../store/auth";
import { LogoWordmark } from "../components/Logo";

export default function SignIn() {
  const { status, login, verifyMfa, verifyPasskey, backToSignIn, busy, error, mfaMethods } =
    useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const mfa = status === "mfa";
  const hasTotp = mfaMethods.includes("totp");
  const hasRecovery = mfaMethods.includes("recovery");
  const hasPasskey = mfaMethods.includes("webauthn");
  // No code-based factor at all → the passkey button is the only way through.
  const passkeyOnly = mfa && hasPasskey && !hasTotp && !hasRecovery;
  const recoveryMode = useRecovery || (hasRecovery && !hasTotp);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || passkeyOnly) return;
    if (mfa) {
      const raw = code.trim();
      if (!raw) return;
      // Authenticator apps show the code grouped ("057 115"); strip everything
      // but digits so a spaced/pasted TOTP code still validates. Recovery codes
      // keep their shape (letters + dashes), just trimmed.
      const clean = recoveryMode ? raw : raw.replace(/\D/g, "");
      void verifyMfa(clean, recoveryMode ? "recovery" : undefined);
    } else if (email.trim() && password) {
      void login(email, password, remember);
    }
  }

  const input =
    "mt-1 w-full rounded-md refx-input px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/40";

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
        <p className="mt-2 text-sm text-muted-foreground">
          {mfa
            ? passkeyOnly
              ? "This account uses a passkey for two-factor sign-in."
              : "Enter your two-factor code to finish signing in."
            : "Sign in with your refx.gg account."}
        </p>

        {mfa ? (
          passkeyOnly ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void verifyPasskey()}
                className="btn-primary refx-sheen relative mt-6 w-full rounded-md px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {busy ? "Waiting for Windows Hello…" : "Use passkey (Windows Hello)"}
              </button>
              <p className="mt-3 text-xs text-muted-foreground">
                Works with Windows Hello, a security key, or your phone. A passkey saved in a
                browser extension (e.g. Dashlane, 1Password) can't be used by the desktop app.
              </p>
            </>
          ) : (
            <>
              <label className="refx-eyebrow mt-6 block" htmlFor="code">
                {recoveryMode ? "Recovery code" : "Authenticator code"}
              </label>
              <input
                id="code"
                autoFocus
                inputMode={recoveryMode ? "text" : "numeric"}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${input} font-mono ${recoveryMode ? "" : "text-center tracking-[0.3em]"}`}
                placeholder={recoveryMode ? "recovery code" : "123456"}
              />
              {hasRecovery && hasTotp && (
                <button
                  type="button"
                  onClick={() => {
                    setUseRecovery(!useRecovery);
                    setCode("");
                  }}
                  className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {useRecovery ? "Use your authenticator code" : "Use a recovery code instead"}
                </button>
              )}
              {hasPasskey && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void verifyPasskey()}
                  className="btn-ghost mt-4 w-full rounded-md px-3 py-2 text-sm disabled:opacity-50"
                >
                  {busy ? "Waiting for Windows Hello…" : "Use passkey (Windows Hello) instead"}
                </button>
              )}
            </>
          )
        ) : (
          <>
            <label className="refx-eyebrow mt-6 block" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
              placeholder="you@example.com"
            />
            <label className="refx-eyebrow mt-4 block" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
            <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-border bg-transparent accent-primary"
              />
              Keep me signed in
            </label>
          </>
        )}

        {error && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        )}

        {!passkeyOnly && (
          <button
            type="submit"
            disabled={busy}
            className="btn-primary refx-sheen relative mt-6 w-full rounded-md px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
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
            className="mt-3 w-full text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to sign-in
          </button>
        )}
      </form>
    </main>
  );
}
