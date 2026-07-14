import { useAuth } from "../store/auth";
import { LogoWordmark } from "../components/Logo";

/**
 * Shown when a saved session exists but the server is unreachable (e.g. the app
 * launched while briefly offline). The store retries automatically; this screen
 * just keeps the user informed instead of bouncing them to a full re-login.
 */
export default function Reconnecting() {
  const { init, logout } = useAuth();
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <LogoWordmark height={28} />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
        Reconnecting to ReFx…
      </div>
      <p className="max-w-xs text-xs text-muted-foreground">
        You're still signed in — ReFx just can't be reached right now. This retries automatically.
      </p>
      <div className="flex items-center gap-3">
        <button onClick={() => void init()} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
          Try now
        </button>
        <button
          onClick={() => void logout()}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
