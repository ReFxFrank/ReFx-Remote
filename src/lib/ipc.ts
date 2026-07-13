// Typed wrappers over the Rust IPC surface. Keep in lock-step with
// docs/ipc-contract.md and src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";

export type AppInfo = { name: string; version: string };

export type Profile = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  globalRole?: string | null;
  mustChangePassword: boolean;
  totpEnabledAt?: string | null;
  permissions: string[];
};

export type AuthStatus = { signedIn: boolean; profile?: Profile };

export type LoginResult = { status: "ok" } | { status: "mfa"; methods: string[] };

export type IpcError = { code: string; message: string; mfaMethods?: string[] };

export type ServerState =
  | "INSTALLING"
  | "OFFLINE"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "CRASHED"
  | "SUSPENDED"
  | "REINSTALLING"
  | "SWITCHING_GAME"
  | "TRANSFERRING"
  | "PENDING_PAYMENT"
  | "UNKNOWN";

export type ServerSummary = {
  id: string;
  shortId: string | null;
  name: string;
  description: string | null;
  state: ServerState;
  serverType: string | null;
  cpuCores: number | null;
  memoryMb: number | null;
  diskMb: number | null;
  slots: number | null;
  suspendedAt: string | null;
  createdAt: string | null;
  template: { id: string | null; name: string | null; slug: string | null } | null;
  node: { name: string | null; fqdn: string | null } | null;
  primaryAllocation: { ip: string | null; port: number | null; alias: string | null } | null;
};

export type ServerDetail = ServerSummary & { viewerPermissions: string[] };

export type LiveStats = {
  state: ServerState;
  cpuPct: number;
  memUsedMb: number;
  memTotalMb: number;
  diskUsedMb: number;
  netRxBytes: number;
  netTxBytes: number;
  players: number | null;
  uptimeMs: number | null;
};

export type PageMeta = { page: number; pageSize: number; total: number; totalPages: number };

export type ServerListResult = { servers: ServerSummary[]; meta?: PageMeta };

export type PowerSignal = "start" | "stop" | "restart" | "kill";

export type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mode?: string | null;
  modified?: string | null;
};

export type BackupState = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "UNKNOWN";
export type Backup = {
  id: string;
  name?: string | null;
  state: BackupState;
  storage?: string | null;
  progressPct?: number | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  isLocked: boolean;
  error?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
};

export type ConsoleLine = { line: string; stream: string; at: number };
export type ConnState = "connecting" | "live" | "retrying" | "failed" | "closed";
export type ConnEvent = { state: ConnState; detail?: string; attempt?: number };
export type StatusEvent = { state: ServerState };

export const ipc = {
  appInfo: () => invoke<AppInfo>("app_info"),
  authStatus: () => invoke<AuthStatus>("auth_status"),
  authLogin: (email: string, password: string, remember: boolean, totp?: string) =>
    invoke<LoginResult>("auth_login", { email, password, remember, totp }),
  authMfaVerify: (code: string, method?: string) =>
    invoke<void>("auth_mfa_verify", { code, method }),
  authLogout: () => invoke<void>("auth_logout"),
  serversList: (q?: string) => invoke<ServerListResult>("servers_list", { q }),
  serverGet: (serverId: string) => invoke<ServerDetail>("server_get", { serverId }),
  serverStats: (serverId: string) => invoke<LiveStats>("server_stats", { serverId }),
  serverPower: (serverId: string, signal: PowerSignal) =>
    invoke<void>("server_power", { serverId, signal }),
  consoleOpen: (serverId: string) => invoke<ConsoleLine[]>("console_open", { serverId }),
  consoleClose: (serverId: string) => invoke<void>("console_close", { serverId }),
  consoleCommand: (serverId: string, command: string) =>
    invoke<void>("console_command", { serverId, command }),
  filesList: (serverId: string, path: string) =>
    invoke<FileEntry[]>("files_list", { serverId, path }),
  filesRead: (serverId: string, path: string) =>
    invoke<string>("files_read", { serverId, path }),
  filesWrite: (serverId: string, path: string, content: string) =>
    invoke<void>("files_write", { serverId, path, content }),
  filesDelete: (serverId: string, paths: string[]) =>
    invoke<void>("files_delete", { serverId, paths }),
  filesRename: (serverId: string, from: string, to: string) =>
    invoke<void>("files_rename", { serverId, from, to }),
  filesMkdir: (serverId: string, path: string) =>
    invoke<void>("files_mkdir", { serverId, path }),
  filesCompress: (serverId: string, paths: string[]) =>
    invoke<void>("files_compress", { serverId, paths }),
  filesDecompress: (serverId: string, path: string) =>
    invoke<void>("files_decompress", { serverId, path }),
  filesDownload: (serverId: string, path: string, suggestedName: string) =>
    invoke<string | null>("files_download", { serverId, path, suggestedName }),
  filesUpload: (serverId: string, destDir: string) =>
    invoke<number | null>("files_upload", { serverId, destDir }),
  backupsList: (serverId: string) => invoke<Backup[]>("backups_list", { serverId }),
  backupCreate: (serverId: string, name: string, mode?: string) =>
    invoke<Backup>("backup_create", { serverId, name, mode }),
  backupSetLocked: (serverId: string, backupId: string, locked: boolean) =>
    invoke<Backup>("backup_set_locked", { serverId, backupId, locked }),
  backupDelete: (serverId: string, backupId: string) =>
    invoke<void>("backup_delete", { serverId, backupId }),
  backupRestore: (serverId: string, backupId: string) =>
    invoke<void>("backup_restore", { serverId, backupId }),
  backupDownload: (serverId: string, backupId: string, suggestedName: string) =>
    invoke<string | null>("backup_download", { serverId, backupId, suggestedName }),
};

export function isIpcError(e: unknown): e is IpcError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "message" in e &&
    typeof (e as IpcError).message === "string"
  );
}

export function errorMessage(e: unknown): string {
  if (isIpcError(e)) return e.message;
  return "Something went wrong talking to the app core.";
}
