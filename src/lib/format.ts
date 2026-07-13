import type { ServerState } from "./ipc";

export function stateLabel(s: ServerState): string {
  switch (s) {
    case "SWITCHING_GAME":
      return "Switching game";
    case "PENDING_PAYMENT":
      return "Pending payment";
    default:
      return s.charAt(0) + s.slice(1).toLowerCase();
  }
}

// Tailwind dot color per state. Running=green, transitional=amber, dead=zinc,
// crashed/suspended=red.
export function stateDot(s: ServerState): string {
  switch (s) {
    case "RUNNING":
      return "bg-emerald-500";
    case "STARTING":
    case "STOPPING":
    case "INSTALLING":
    case "REINSTALLING":
    case "SWITCHING_GAME":
    case "TRANSFERRING":
      return "bg-amber-400";
    case "CRASHED":
    case "SUSPENDED":
    case "PENDING_PAYMENT":
      return "bg-red-500";
    default:
      return "bg-zinc-500";
  }
}

export function fromMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function pct(used: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

export function uptime(ms: number | null): string | null {
  if (ms == null || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function bytesRate(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB/s`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB/s`;
  return `${Math.round(b)} B/s`;
}
