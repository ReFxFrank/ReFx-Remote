import { useAuth } from "../store/auth";

export default function Home() {
  const { profile, logout, busy } = useAuth();

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <span className="font-semibold tracking-tight">ReFx Desktop</span>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-400">{profile?.email}</span>
          <button
            onClick={() => void logout()}
            disabled={busy}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-zinc-500">
          Signed in. Your servers arrive here in Phase 2.
        </p>
      </main>
    </div>
  );
}
