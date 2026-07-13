import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type AppInfo = { name: string; version: string };

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    invoke<AppInfo>("app_info")
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-2 bg-zinc-950 text-zinc-100">
      <h1 className="text-2xl font-semibold tracking-tight">
        {info?.name ?? "ReFx Desktop"}
      </h1>
      <p className="text-sm text-zinc-400">
        {info ? `v${info.version} — Phase 0 scaffold` : "connecting to core…"}
      </p>
    </main>
  );
}
