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

export type Startup = { startupCommand?: string | null; dockerImage?: string | null };
export type VarRules = { options?: string[] | null; regex?: string | null; required?: boolean | null };
export type Variable = {
  envName: string;
  displayName?: string | null;
  description?: string | null;
  type?: string | null;
  rules?: VarRules | null;
  userEditable: boolean;
  userViewable: boolean;
  value: string;
  isSet?: boolean | null;
};
export type ScheduleTask = {
  id?: string | null;
  action?: string | null;
  payload?: string | null;
  timeOffsetMs?: number | null;
  sortOrder?: number | null;
};
export type Schedule = {
  id: string;
  name?: string | null;
  cron?: string | null;
  isActive: boolean;
  onlyWhenOnline: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  tasks: ScheduleTask[];
};
export type Database = {
  id: string;
  engine?: string | null;
  name?: string | null;
  username?: string | null;
  host?: string | null;
  port?: number | null;
  remoteAccess?: boolean | null;
  createdAt?: string | null;
};

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

export type AppSettings = {
  notifyCrashed: boolean;
  notifyBackOnline: boolean;
  closeToTray: boolean;
  startWithWindows: boolean;
};
export type OpenServerEvent = { id: string; console: boolean };

// ── Admin / staff ──────────────────────────────────────────────────────
export type AdminRole = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  permissions: string[];
  /** How many accounts hold this role. */
  _count?: { users: number } | null;
};
export type RolePermissionCatalog = { wildcard?: string | null; permissions: string[] };
export type AdminUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  globalRole?: string | null;
  state?: string | null;
  roleId?: string | null;
  createdAt?: string | null;
  emailVerifiedAt?: string | null;
};
export type AdminUserList = { users: AdminUser[]; meta?: PageMeta };
export type AdminUserDetail = AdminUser & {
  emailVerifiedAt?: string | null;
  totpEnabledAt?: string | null;
  creditBalanceMinor?: number | null;
  phone?: string | null;
  country?: string | null;
  ownedServers: { id: string; shortId?: string | null; name?: string | null; state?: string | null; node?: unknown }[];
  subscriptions: {
    id: string;
    state?: string | null;
    interval?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean | null;
    gateway?: string | null;
    product?: unknown;
  }[];
  invoices: {
    id: string;
    number?: string | null;
    state?: string | null;
    currency?: string | null;
    totalMinor?: number | null;
    amountPaidMinor?: number | null;
    createdAt?: string | null;
    paidAt?: string | null;
  }[];
  paymentMethods: {
    id: string;
    gateway?: string | null;
    brand?: string | null;
    last4?: string | null;
    isDefault?: boolean | null;
  }[];
};
export type OneTimeSecret = { id?: string | null; email?: string | null; password: string };
export type CreditTx = {
  id: string;
  amountMinor?: number | null;
  reason?: string | null;
  note?: string | null;
  createdAt?: string | null;
};
export type CreditLedger = { balanceMinor: number; transactions: CreditTx[] };
export type AdminCustomer = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  state?: string | null;
  globalRole?: string | null;
  createdAt?: string | null;
  activeServices?: number | null;
  servers?: number | null;
  lifetimeSpendMinor?: number | null;
};
export type AdminCustomerList = { customers: AdminCustomer[]; meta?: PageMeta };
export type AdminServer = {
  id: string;
  name: string;
  state: ServerState;
  cpuCores?: number | null;
  memoryMb?: number | null;
  diskMb?: number | null;
  swapMb?: number | null;
  nodeId?: string | null;
  template?: { id?: string; name?: string; slug?: string } | null;
  node?: { id?: string; name?: string; fqdn?: string } | null;
  owner?: { id: string; email?: string | null; firstName?: string | null; lastName?: string | null } | null;
  primaryAllocation?: { ip?: string; port?: number; alias?: string } | null;
  suspendedAt?: string | null;
};
export type AdminServerList = { servers: AdminServer[]; meta?: PageMeta };
export type ServerTransfer = {
  id: string;
  serverId?: string | null;
  fromNodeId?: string | null;
  toNodeId?: string | null;
  state?: string | null;
  error?: string | null;
  createdAt?: string | null;
};
export type VoiceStatus = {
  enabled: boolean;
  port?: number | null;
  ip?: string | null;
  alreadyEnabled?: boolean | null;
  disabled?: boolean | null;
};
export type AuditLog = {
  id: string;
  actorId?: string | null;
  actor?: { email?: string | null } | null;
  action?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  metadata?: unknown;
  createdAt?: string | null;
};
export type AuditLogList = { entries: AuditLog[]; meta?: PageMeta };
export type AdminMetrics = {
  totals?: {
    users: number;
    servers: number;
    nodesOnline: number;
    openTickets: number;
    activeSubscriptions: number;
    mrrMinor: number;
    mrrCurrency?: string | null;
    revenueMinor: number;
  } | null;
  serversByState: Record<string, number>;
  nodes: { id: string; name?: string | null; cpuPct?: number | null; memPct?: number | null; diskPct?: number | null }[];
};

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
  startupGet: (serverId: string) => invoke<Startup>("startup_get", { serverId }),
  variablesList: (serverId: string) => invoke<Variable[]>("variables_list", { serverId }),
  variableSet: (serverId: string, envName: string, value: string) =>
    invoke<void>("variable_set", { serverId, envName, value }),
  schedulesList: (serverId: string) => invoke<Schedule[]>("schedules_list", { serverId }),
  scheduleSetActive: (serverId: string, scheduleId: string, active: boolean) =>
    invoke<void>("schedule_set_active", { serverId, scheduleId, active }),
  scheduleRun: (serverId: string, scheduleId: string) =>
    invoke<void>("schedule_run", { serverId, scheduleId }),
  databasesList: (serverId: string) => invoke<Database[]>("databases_list", { serverId }),
  settingsGet: () => invoke<AppSettings>("settings_get"),
  settingsSet: (next: AppSettings) => invoke<void>("settings_set", { next }),
  copyDiagnostics: () => invoke<string>("copy_diagnostics"),
  deeplinkReady: (ready: boolean) =>
    invoke<OpenServerEvent[]>("deeplink_ready", { ready }),

  // Staff/admin surface. Authorized server-side; the UI also gates on
  // profile.permissions (src/lib/perms.ts).
  admin: {
    rolesList: () => invoke<AdminRole[]>("admin_roles_list"),
    rolePermissions: () => invoke<RolePermissionCatalog>("admin_role_permissions"),
    roleCreate: (key: string, name: string, description: string | null, permissions: string[]) =>
      invoke<AdminRole>("admin_role_create", { key, name, description, permissions }),
    roleUpdate: (
      id: string,
      patch: { name?: string; description?: string | null; permissions?: string[] },
    ) => invoke<AdminRole>("admin_role_update", { id, ...patch }),
    roleDelete: (id: string) => invoke<void>("admin_role_delete", { id }),
    usersList: (opts?: {
      page?: number;
      pageSize?: number;
      q?: string;
      role?: string;
      accountState?: string;
    }) => invoke<AdminUserList>("admin_users_list", { ...opts }),
    userSetRole: (userId: string, role: string | null, roleId: string | null) =>
      invoke<AdminUser>("admin_user_set_role", { userId, role, roleId }),
    userGet: (id: string) => invoke<AdminUserDetail>("admin_user_get", { id }),
    userCreate: (input: {
      email: string;
      password?: string;
      firstName?: string;
      lastName?: string;
      role?: string;
      emailVerified?: boolean;
    }) => invoke<OneTimeSecret>("admin_user_create", { ...input }),
    userSetState: (id: string, accountState: "ACTIVE" | "SUSPENDED" | "BANNED") =>
      invoke<AdminUser>("admin_user_set_state", { id, accountState }),
    userVerifyEmail: (id: string) => invoke<AdminUser>("admin_user_verify_email", { id }),
    userDelete: (id: string) => invoke<void>("admin_user_delete", { id }),
    userPurge: (id: string) => invoke<void>("admin_user_purge", { id }),
    userSendPasswordReset: (id: string) =>
      invoke<unknown>("admin_user_send_password_reset", { id }),
    userSetPassword: (id: string, password?: string) =>
      invoke<OneTimeSecret>("admin_user_set_password", { id, password }),
    userCreditGet: (id: string) => invoke<CreditLedger>("admin_user_credit_get", { id }),
    /** amountMinor is signed (negative = deduct); confirmAmount is the major-unit
     *  string the user typed and must match, enforced Rust-side. */
    userCreditAdjust: (
      id: string,
      amountMinor: number,
      confirmAmount: string,
      reason?: string,
      note?: string,
    ) => invoke<{ balanceMinor: number }>("admin_user_credit_adjust", { id, amountMinor, confirmAmount, reason, note }),
    customersList: (opts?: { page?: number; pageSize?: number; q?: string }) =>
      invoke<AdminCustomerList>("admin_customers_list", { ...opts }),

    serversList: (opts?: { page?: number; pageSize?: number; q?: string }) =>
      invoke<AdminServerList>("admin_servers_list", { ...opts }),
    serverDelete: (id: string) => invoke<void>("admin_server_delete", { id }),
    serverResize: (
      id: string,
      patch: { cpuCores?: number; memoryMb?: number; swapMb?: number; diskMb?: number },
    ) => invoke<AdminServer>("admin_server_resize", { id, ...patch }),
    serverTransfer: (id: string, toNodeId: string) =>
      invoke<ServerTransfer>("admin_server_transfer", { id, toNodeId }),
    serverTransfers: (id: string) => invoke<ServerTransfer[]>("admin_server_transfers", { id }),
    serverVoiceGet: (id: string) => invoke<VoiceStatus>("admin_server_voice_get", { id }),
    serverVoiceEnable: (id: string) => invoke<VoiceStatus>("admin_server_voice_enable", { id }),
    serverVoiceDisable: (id: string) => invoke<VoiceStatus>("admin_server_voice_disable", { id }),
    serverSuspend: (id: string, reason?: string) =>
      invoke<unknown>("admin_server_suspend", { id, reason }),
    serverUnsuspend: (id: string) => invoke<unknown>("admin_server_unsuspend", { id }),
    serverReinstall: (id: string) => invoke<unknown>("admin_server_reinstall", { id }),
    serverVanityStrip: (id: string, refundCredit: boolean, confirm: boolean) =>
      invoke<unknown>("admin_server_vanity_strip", { id, refundCredit, confirm }),

    auditLogs: (opts?: {
      page?: number;
      pageSize?: number;
      actorId?: string;
      targetType?: string;
      targetId?: string;
      action?: string;
      from?: string;
      to?: string;
    }) => invoke<AuditLogList>("admin_audit_logs", { ...opts }),
    metrics: () => invoke<AdminMetrics>("admin_metrics"),
  },
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
