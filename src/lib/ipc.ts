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

export type AuthStatus = { signedIn: boolean; offline?: boolean; profile?: Profile };

export type LoginResult = { status: "ok" } | { status: "mfa"; methods: string[] };
export type TotpEnrollment = { otpauthUrl?: string | null; secret?: string | null };
export type RecoveryCodes = { recoveryCodes: string[] };

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
export type CreatedDatabase = Database & { password?: string | null };
export type DatabasePassword = { password?: string | null };

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
  notifyOnline: boolean;
  notifyOffline: boolean;
  notifySupport: boolean;
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
export type SupportPerson = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  globalRole?: string | null;
  avatarUrl?: string | null;
};
export type Ticket = {
  id: string;
  number?: number | null;
  subject?: string | null;
  state?: string | null;
  priority?: string | null;
  requesterId?: string | null;
  assigneeId?: string | null;
  requester?: SupportPerson | null;
  assignee?: SupportPerson | null;
  slaBreached?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  _count?: { messages: number } | null;
};
export type TicketMessage = {
  id: string;
  authorId?: string | null;
  body?: string | null;
  isInternal: boolean;
  createdAt?: string | null;
  author?: SupportPerson | null;
};
export type TicketDetail = {
  id: string;
  number?: number | null;
  subject?: string | null;
  state?: string | null;
  priority?: string | null;
  requester?: SupportPerson | null;
  assignee?: SupportPerson | null;
  assigneeId?: string | null;
  slaBreached?: boolean | null;
  createdAt?: string | null;
  messages: TicketMessage[];
};
export type TicketList = { tickets: Ticket[]; meta?: PageMeta };
export type CannedResponse = { id: string; title?: string | null; body?: string | null; tags: string[] };
export type NodeRegion = { id: string; code?: string | null; name?: string | null; country?: string | null };
export type NodeHeartbeat = {
  recordedAt?: string | null;
  cpuPct?: number | null;
  memUsedMb?: number | null;
  diskUsedMb?: number | null;
};
export type AdminNode = {
  id: string;
  name?: string | null;
  fqdn?: string | null;
  region?: NodeRegion | null;
  latestHeartbeat?: NodeHeartbeat | null;
  servers?: number | null;
  maintenance?: boolean | null;
  cpuCores?: number | null;
  memoryMb?: number | null;
  diskMb?: number | null;
  provider?: string | null;
};
export type NodeList = { nodes: AdminNode[]; meta?: PageMeta };
export type NodePing = { ms?: number | null; reachable: boolean; heartbeatAgeMs?: number | null };
export type NodeBootstrapToken = { bootstrapToken: string; expiresAt?: string | null };
export type BillingSummary = {
  currency?: string | null;
  revenueMinor: number;
  outstandingMinor: number;
  activeSubscriptions: number;
  openInvoices: number;
  paidInvoices: number;
};
export type Invoice = {
  id: string;
  number?: string | null;
  state?: string | null;
  currency?: string | null;
  totalMinor?: number | null;
  amountPaidMinor?: number | null;
  createdAt?: string | null;
  user?: { id?: string | null; email?: string | null } | null;
};
export type InvoiceList = { invoices: Invoice[]; meta?: PageMeta };
export type Order = {
  id: string;
  state?: string | null;
  interval?: string | null;
  gateway?: string | null;
  currentPeriodEnd?: string | null;
  user?: { id?: string | null; email?: string | null } | null;
  product?: unknown;
};
export type OrderList = { orders: Order[]; meta?: PageMeta };
export type Payment = {
  id: string;
  gateway?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  state?: string | null;
  failureReason?: string | null;
  createdAt?: string | null;
  invoice?: unknown;
};
export type PaymentList = { payments: Payment[]; meta?: PageMeta };
export type RefundResult = { refunded: boolean; amountMinor?: number | null; full?: boolean | null };
export type Coupon = {
  id: string;
  code?: string | null;
  description?: string | null;
  kind?: string | null;
  value?: number | null;
  currency?: string | null;
  maxRedemptions?: number | null;
  maxPerUser?: number | null;
  timesRedeemed?: number | null;
  expiresAt?: string | null;
};
export type GiftCard = {
  id: string;
  code?: string | null;
  balanceMinor?: number | null;
  initialBalanceMinor?: number | null;
  currency?: string | null;
  note?: string | null;
  expiresAt?: string | null;
  isActive?: boolean | null;
};
export type GrowthReport = {
  days: number;
  totals?: { signups: number; payers: number; revenueMinor: number };
  channels?: { channel: string; signups: number; payers: number; revenueMinor: number }[];
  landings?: { landing: string; signups: number }[];
  referral?: { signups: number; converted: number; creditIssuedMinor: number };
};

export type GameTemplate = {
  id: string;
  name?: string | null;
  slug?: string | null;
  author?: string | null;
  description?: string | null;
  supportsLinux?: boolean | null;
  supportsWindows?: boolean | null;
};
// ── Admin Tier 3 types ──
// ── content ──
// Add to the "Admin / staff" section of src/lib/ipc.ts:

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";
export type GlobalAlert = {
  id: string;
  severity?: AlertSeverity | null;
  title?: string | null;
  body?: string | null;
  isActive?: boolean | null;
  startsAt?: string | null;
  endsAt?: string | null;
  createdAt?: string | null;
};

export type HomepageAlertType = "INFO" | "SUCCESS" | "WARNING" | "DANGER" | "PROMO";
export type HomepageAlert = {
  id: string;
  type?: HomepageAlertType | null;
  title?: string | null;
  body?: string | null;
  isActive?: boolean | null;
  startsAt?: string | null;
  endsAt?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  dismissible?: boolean | null;
  priority?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type IncidentImpact = "MAINTENANCE" | "DEGRADED" | "OUTAGE";
export type IncidentStatusStage = "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
export type IncidentUpdate = {
  id?: string | null;
  incidentId?: string | null;
  status?: IncidentStatusStage | null;
  body?: string | null;
  createdAt?: string | null;
};
export type StatusIncident = {
  id: string;
  title?: string | null;
  status?: IncidentStatusStage | null;
  impact?: IncidentImpact | null;
  components: string[];
  startedAt?: string | null;
  resolvedAt?: string | null;
  updates: IncidentUpdate[];
  createdAt?: string | null;
  updatedAt?: string | null;
};

// ── settings ──
// ── Platform settings (settings.manage) ────────────────────────────────
export type EmailConfig = {
  configured: boolean;
  host?: string | null;
  port?: number | null;
  user?: string | null;
  from?: string | null;
  secure: boolean;
  /** Transactional-email theme. */
  theme?: "dark" | "light" | null;
  /** Whether an SMTP password is stored (the password itself is never returned). */
  passwordSet: boolean;
};
export type TestEmailResult = { delivered: boolean };
export type SteamConfig = {
  username?: string | null;
  apiKeySet: boolean;
  passwordSet: boolean;
  /** username + password both set (steamcmd can log in). */
  loginConfigured: boolean;
  /** A one-time Steam Guard code is staged for the next install. */
  guardCodePending: boolean;
};
export type SteamVerifyResult = { ok: boolean; output: string };
export type VanityConfig = {
  enabled: boolean;
  /** One-time fee in minor units (200 = $2.00; 0 = free). */
  feeMinor: number;
  reservedWords: string[];
};
export type ReferralConfig = {
  enabled: boolean;
  /** Two-sided reward in minor units (500 = $5.00). */
  rewardMinor: number;
};

// ── dbhosts ──
export type DatabaseHost = {
  id: string;
  name?: string | null;
  engine?: string | null;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  publicHost?: string | null;
  maxDatabases?: number | null;
  isActive?: boolean | null;
  databaseCount?: number | null;
  createdAt?: string | null;
};
export type DatabaseHostTestResult = { ok: boolean };

// ── products ──
// Add near the other admin types in ipc.ts. If any of ProductType / BillingModel /
// BillingInterval / Price / Product / HardwareTier already exist, dedupe on merge.
export type ProductType =
  | "GAME_SERVER"
  | "VOICE_SERVER"
  | "WEB_HOSTING"
  | "VPS"
  | "DEDICATED"
  | "ADDON"
  | "BOT_HOSTING";
export type BillingModel = "HARDWARE_TIER" | "PER_SLOT";
export type BillingInterval =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMIANNUAL"
  | "ANNUAL";
export type Price = {
  id: string;
  productId?: string | null;
  hardwareTierId?: string | null;
  interval?: BillingInterval | string | null;
  currency?: string | null;
  amountMinor?: number | null;
  stripePriceId?: string | null;
  isActive?: boolean | null;
};
export type HardwareTier = {
  id: string;
  productId?: string | null;
  name?: string | null;
  description?: string | null;
  cpuCores?: number | null;
  memoryMb?: number | null;
  diskMb?: number | null;
  recommendedPlayers?: number | null;
  isRecommended?: boolean | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
  prices: Price[];
};
export type Product = {
  id: string;
  type?: ProductType | string | null;
  billingModel?: BillingModel | string | null;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  isActive?: boolean | null;
  cpuCores?: number | null;
  memoryMb?: number | null;
  diskMb?: number | null;
  slots?: number | null;
  allowedTemplateIds: string[];
  hardwareTiers: HardwareTier[];
  prices: Price[];
  perSlot?: boolean | null;
  gameTemplateId?: string | null;
  minSlots?: number | null;
  maxSlots?: number | null;
  slotStep?: number | null;
  cpuPerSlot?: number | null;
  memoryMbPerSlot?: number | null;
  diskMbPerSlot?: number | null;
  // Reserved; always [] against the current backend (see Rust module note).
  variables: unknown[];
};

// ── team ──
export type TeamMember = {
  id: string;
  name?: string | null;
  title?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  link?: string | null;
  isActive: boolean;
  sortOrder: number;
};

export const ipc = {
  appInfo: () => invoke<AppInfo>("app_info"),
  notificationTest: () => invoke<void>("notification_test"),
  authStatus: () => invoke<AuthStatus>("auth_status"),
  authLogin: (email: string, password: string, remember: boolean, totp?: string) =>
    invoke<LoginResult>("auth_login", { email, password, remember, totp }),
  accountPassword: (currentPassword: string, newPassword: string) =>
    invoke<void>("account_password", { currentPassword, newPassword }),
  mfaTotpEnroll: () => invoke<TotpEnrollment>("mfa_totp_enroll"),
  mfaTotpVerify: (code: string) => invoke<RecoveryCodes>("mfa_totp_verify", { code }),
  mfaTotpDisable: () => invoke<void>("mfa_totp_disable"),
  authMfaVerify: (code: string, method?: string) =>
    invoke<void>("auth_mfa_verify", { code, method }),
  authMfaWebauthn: () => invoke<void>("auth_mfa_webauthn"),
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
  scheduleCreate: (
    serverId: string,
    input: {
      name: string;
      cron: string;
      onlyWhenOnline: boolean;
      isActive: boolean;
      taskAction?: string;
      taskPayload?: string;
    },
  ) => invoke<Schedule>("schedule_create", { serverId, ...input }),
  scheduleUpdate: (
    serverId: string,
    scheduleId: string,
    input: { name: string; cron: string; onlyWhenOnline: boolean },
  ) => invoke<Schedule>("schedule_update", { serverId, scheduleId, ...input }),
  scheduleDelete: (serverId: string, scheduleId: string) =>
    invoke<void>("schedule_delete", { serverId, scheduleId }),
  databasesList: (serverId: string) => invoke<Database[]>("databases_list", { serverId }),
  databaseCreate: (serverId: string, engine: string, name: string, remoteAccess: boolean) =>
    invoke<CreatedDatabase>("database_create", { serverId, engine, name, remoteAccess }),
  databaseDelete: (serverId: string, databaseId: string) =>
    invoke<void>("database_delete", { serverId, databaseId }),
  databaseRotate: (serverId: string, databaseId: string) =>
    invoke<DatabasePassword>("database_rotate", { serverId, databaseId }),
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

    ticketsList: (opts?: {
      page?: number;
      pageSize?: number;
      q?: string;
      ticketState?: string;
      priority?: string;
      mine?: boolean;
    }) => invoke<TicketList>("admin_tickets_list", { ...opts }),
    ticketGet: (id: string) => invoke<TicketDetail>("admin_ticket_get", { id }),
    ticketReply: (id: string, body: string, isInternal: boolean) =>
      invoke<TicketMessage>("admin_ticket_reply", { id, body, isInternal }),
    ticketUpdate: (
      id: string,
      patch: { ticketState?: string; priority?: string; assigneeId?: string; categoryId?: string },
    ) => invoke<Ticket>("admin_ticket_update", { id, ...patch }),
    ticketAssign: (id: string, assigneeId: string) =>
      invoke<Ticket>("admin_ticket_assign", { id, assigneeId }),
    ticketClose: (id: string) => invoke<Ticket>("admin_ticket_close", { id }),
    ticketArchive: (id: string) => invoke<Ticket>("admin_ticket_archive", { id }),
    ticketDelete: (id: string) => invoke<void>("admin_ticket_delete", { id }),
    supportStaff: () => invoke<SupportPerson[]>("admin_support_staff"),
    cannedResponses: () => invoke<CannedResponse[]>("admin_canned_responses"),

    nodesList: (opts?: { page?: number; pageSize?: number }) =>
      invoke<NodeList>("admin_nodes_list", { ...opts }),
    nodeGet: (id: string) => invoke<AdminNode>("admin_node_get", { id }),
    nodeRegions: () => invoke<NodeRegion[]>("admin_node_regions"),
    nodeHeartbeats: (id: string) => invoke<NodeHeartbeat[]>("admin_node_heartbeats", { id }),
    nodePing: (id: string) => invoke<NodePing>("admin_node_ping", { id }),
    nodeSetMaintenance: (id: string, maintenance: boolean) =>
      invoke<AdminNode>("admin_node_set_maintenance", { id, maintenance }),
    nodeDelete: (id: string) => invoke<void>("admin_node_delete", { id }),
    nodeRestartAgent: (id: string) => invoke<unknown>("admin_node_restart_agent", { id }),
    nodeUpdateAgent: (id: string) => invoke<unknown>("admin_node_update_agent", { id }),
    nodeRotateBootstrap: (id: string) =>
      invoke<NodeBootstrapToken>("admin_node_rotate_bootstrap", { id }),
    locationsList: () => invoke<NodeRegion[]>("admin_locations_list"),
    locationCreate: (code: string, name: string, country?: string) =>
      invoke<NodeRegion>("admin_location_create", { code, name, country }),
    locationUpdate: (id: string, patch: { code?: string; name?: string; country?: string }) =>
      invoke<NodeRegion>("admin_location_update", { id, ...patch }),
    locationDelete: (id: string) => invoke<void>("admin_location_delete", { id }),

    billingSummary: () => invoke<BillingSummary>("admin_billing_summary"),
    invoicesList: (opts?: { page?: number; pageSize?: number; q?: string }) =>
      invoke<InvoiceList>("admin_invoices_list", { ...opts }),
    invoiceVoid: (id: string) => invoke<Invoice>("admin_invoice_void", { id }),
    invoiceMarkPaid: (id: string, confirm: boolean) =>
      invoke<Invoice>("admin_invoice_mark_paid", { id, confirm }),
    /** amountMinor is the exact amount to refund; confirmAmount is the major-unit
     *  string the user typed, re-verified Rust-side to match amountMinor. */
    invoiceRefund: (id: string, amountMinor: number, confirmAmount: string) =>
      invoke<RefundResult>("admin_invoice_refund", { id, amountMinor, confirmAmount }),
    invoiceDelete: (id: string) => invoke<void>("admin_invoice_delete", { id }),
    ordersList: (opts?: { page?: number; pageSize?: number }) =>
      invoke<OrderList>("admin_orders_list", { ...opts }),
    orderDelete: (id: string) => invoke<void>("admin_order_delete", { id }),
    paymentsList: (opts?: { page?: number; pageSize?: number }) =>
      invoke<PaymentList>("admin_payments_list", { ...opts }),
    paymentGateways: () => invoke<unknown>("admin_payment_gateways"),
    growth: (days?: number) => invoke<GrowthReport>("admin_growth", { days }),

    couponsList: () => invoke<Coupon[]>("admin_coupons_list"),
    couponCreate: (input: {
      code: string;
      kind: "PERCENT" | "FIXED";
      value: number;
      description?: string;
      maxRedemptions?: number;
      expiresAt?: string;
    }) => invoke<Coupon>("admin_coupon_create", { ...input }),
    couponDelete: (id: string) => invoke<void>("admin_coupon_delete", { id }),
    giftCardsList: () => invoke<GiftCard[]>("admin_gift_cards_list"),
    /** balanceMinor bound to the typed confirmAmount Rust-side (stored value). */
    giftCardCreate: (balanceMinor: number, confirmAmount: string, note?: string, expiresAt?: string) =>
      invoke<GiftCard>("admin_gift_card_create", { balanceMinor, confirmAmount, note, expiresAt }),
    giftCardSetActive: (id: string, isActive: boolean) =>
      invoke<GiftCard>("admin_gift_card_set_active", { id, isActive }),

    templates: () => invoke<GameTemplate[]>("admin_templates_list"),
    templateGet: (id: string) => invoke<GameTemplate>("admin_template_get", { id }),
    // ── Admin Tier 3 bindings ──
    // Content — global alerts (content.read to list; content.manage to write)
        alertsList: () => invoke<GlobalAlert[]>("admin_alerts_list"),
        alertCreate: (input: {
          title: string;
          body: string;
          severity?: AlertSeverity;
          isActive?: boolean;
          startsAt?: string | null;
          endsAt?: string | null;
        }) => invoke<GlobalAlert>("admin_alert_create", { ...input }),
        alertUpdate: (
          id: string,
          patch: {
            severity?: AlertSeverity;
            title?: string;
            body?: string;
            isActive?: boolean;
            startsAt?: string | null;
            endsAt?: string | null;
          },
        ) => invoke<GlobalAlert>("admin_alert_update", { id, ...patch }),
        alertDelete: (id: string) => invoke<void>("admin_alert_delete", { id }),

        // Content — homepage alerts (content.manage). `type` maps to `alertType`
        // at the IPC boundary (reserved word); the response still uses `type`.
        homepageAlertsList: () => invoke<HomepageAlert[]>("admin_homepage_alerts_list"),
        homepageAlertCreate: (input: {
          title: string;
          body: string;
          type?: HomepageAlertType;
          isActive?: boolean;
          startsAt?: string | null;
          endsAt?: string | null;
          ctaLabel?: string | null;
          ctaUrl?: string | null;
          dismissible?: boolean;
          priority?: number;
        }) =>
          invoke<HomepageAlert>("admin_homepage_alert_create", {
            alertType: input.type,
            title: input.title,
            body: input.body,
            isActive: input.isActive,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            ctaLabel: input.ctaLabel,
            ctaUrl: input.ctaUrl,
            dismissible: input.dismissible,
            priority: input.priority,
          }),
        homepageAlertUpdate: (
          id: string,
          patch: {
            type?: HomepageAlertType;
            title?: string;
            body?: string;
            isActive?: boolean;
            startsAt?: string | null;
            endsAt?: string | null;
            ctaLabel?: string | null;
            ctaUrl?: string | null;
            dismissible?: boolean;
            priority?: number;
          },
        ) =>
          invoke<HomepageAlert>("admin_homepage_alert_update", {
            id,
            alertType: patch.type,
            title: patch.title,
            body: patch.body,
            isActive: patch.isActive,
            startsAt: patch.startsAt,
            endsAt: patch.endsAt,
            ctaLabel: patch.ctaLabel,
            ctaUrl: patch.ctaUrl,
            dismissible: patch.dismissible,
            priority: patch.priority,
          }),
        homepageAlertDelete: (id: string) => invoke<void>("admin_homepage_alert_delete", { id }),

        // Content — status incidents (content.manage)
        incidentsList: () => invoke<StatusIncident[]>("admin_incidents_list"),
        incidentCreate: (input: {
          title: string;
          impact: IncidentImpact;
          components: string[];
          body: string;
          status?: IncidentStatusStage;
          notify?: boolean;
        }) => invoke<StatusIncident>("admin_incident_create", { ...input }),
        incidentAddUpdate: (id: string, update: { status: IncidentStatusStage; body: string }) =>
          invoke<StatusIncident>("admin_incident_add_update", { id, ...update }),
        incidentUpdate: (
          id: string,
          patch: { title?: string; impact?: IncidentImpact; status?: IncidentStatusStage; components?: string[] },
        ) => invoke<StatusIncident>("admin_incident_update", { id, ...patch }),
        incidentDelete: (id: string) => invoke<void>("admin_incident_delete", { id }),

    // Platform settings (settings.manage). Secrets are write-only: omit a
        // password/apiKey/guardCode field to keep the stored value. Email + Steam
        // updates return void — refetch the *Get after saving.
        settingsEmailGet: () => invoke<EmailConfig>("admin_settings_email_get"),
        settingsEmailUpdate: (input: {
          host?: string;
          port?: number;
          user?: string;
          password?: string;
          from?: string;
          secure?: boolean;
          theme?: "dark" | "light";
        }) => invoke<void>("admin_settings_email_update", { ...input }),
        settingsEmailTest: (to: string) =>
          invoke<TestEmailResult>("admin_settings_email_test", { to }),
        settingsSteamGet: () => invoke<SteamConfig>("admin_settings_steam_get"),
        settingsSteamUpdate: (input: {
          apiKey?: string;
          username?: string;
          password?: string;
          guardCode?: string;
        }) => invoke<void>("admin_settings_steam_update", { ...input }),
        settingsSteamVerify: (nodeId: string, guardCode?: string) =>
          invoke<SteamVerifyResult>("admin_settings_steam_verify", { nodeId, guardCode }),
        settingsVanityGet: () => invoke<VanityConfig>("admin_settings_vanity_get"),
        settingsVanityUpdate: (input: {
          enabled?: boolean;
          feeMinor?: number;
          reservedWords?: string[];
        }) => invoke<VanityConfig>("admin_settings_vanity_update", { ...input }),
        settingsReferralsGet: () => invoke<ReferralConfig>("admin_settings_referrals_get"),
        settingsReferralsUpdate: (input: {
          enabled?: boolean;
          rewardMinor?: number;
        }) => invoke<ReferralConfig>("admin_settings_referrals_update", { ...input }),

    databaseHostsList: () => invoke<DatabaseHost[]>("admin_database_hosts_list"),
        databaseHostCreate: (input: {
          name: string;
          engine?: string;
          host: string;
          port?: number;
          username: string;
          password: string;
          publicHost: string;
          maxDatabases?: number;
          isActive?: boolean;
        }) => invoke<DatabaseHost>("admin_database_host_create", { ...input }),
        databaseHostUpdate: (
          id: string,
          patch: {
            name?: string;
            host?: string;
            port?: number;
            username?: string;
            password?: string;
            publicHost?: string;
            maxDatabases?: number;
            isActive?: boolean;
          },
        ) => invoke<DatabaseHost>("admin_database_host_update", { id, ...patch }),
        databaseHostDelete: (id: string) => invoke<void>("admin_database_host_delete", { id }),
        databaseHostTest: (id: string) =>
          invoke<DatabaseHostTestResult>("admin_database_host_test", { id }),

    productsList: () => invoke<Product[]>("admin_products_list"),
        productGet: (id: string) => invoke<Product>("admin_product_get", { id }),
        productCreate: (input: {
          productType: ProductType;
          name: string;
          slug: string;
          billingModel?: BillingModel;
          description?: string;
          isActive?: boolean;
          gameTemplateId?: string;
          allowedTemplateIds?: string[];
          minSlots?: number;
          maxSlots?: number;
          slotStep?: number;
          cpuPerSlot?: number;
          memoryMbPerSlot?: number;
          diskMbPerSlot?: number;
        }) => invoke<Product>("admin_product_create", { ...input }),
        productUpdate: (
          id: string,
          input: {
            productType?: ProductType;
            name?: string;
            slug?: string;
            billingModel?: BillingModel;
            description?: string;
            isActive?: boolean;
            gameTemplateId?: string;
            allowedTemplateIds?: string[];
            minSlots?: number;
            maxSlots?: number;
            slotStep?: number;
            cpuPerSlot?: number;
            memoryMbPerSlot?: number;
            diskMbPerSlot?: number;
          },
        ) => invoke<Product>("admin_product_update", { id, ...input }),
        productDelete: (id: string) => invoke<void>("admin_product_delete", { id }),
        priceCreate: (
          productId: string,
          input: { amountMinor: number; interval?: BillingInterval; currency?: string; isActive?: boolean },
        ) => invoke<Price>("admin_price_create", { productId, ...input }),
        tierPriceCreate: (
          productId: string,
          tierId: string,
          input: { amountMinor: number; interval?: BillingInterval; currency?: string; isActive?: boolean },
        ) => invoke<Price>("admin_tier_price_create", { productId, tierId, ...input }),
        priceUpdate: (
          priceId: string,
          input: { amountMinor?: number; interval?: BillingInterval; currency?: string; isActive?: boolean },
        ) => invoke<Price>("admin_price_update", { priceId, ...input }),
        priceDelete: (priceId: string) => invoke<void>("admin_price_delete", { priceId }),
        tierCreate: (
          productId: string,
          input: {
            name: string;
            cpuCores: number;
            memoryMb: number;
            diskMb: number;
            description?: string;
            recommendedPlayers?: number;
            isRecommended?: boolean;
            isActive?: boolean;
            sortOrder?: number;
          },
        ) => invoke<HardwareTier>("admin_tier_create", { productId, ...input }),
        tierUpdate: (
          tierId: string,
          input: {
            name?: string;
            description?: string;
            cpuCores?: number;
            memoryMb?: number;
            diskMb?: number;
            recommendedPlayers?: number;
            isRecommended?: boolean;
            isActive?: boolean;
            sortOrder?: number;
          },
        ) => invoke<HardwareTier>("admin_tier_update", { tierId, ...input }),
        tierDelete: (tierId: string) => invoke<void>("admin_tier_delete", { tierId }),

    // auto-converted to the Rust snake_case params by Tauri, e.g. avatarUrl ->
    // avatar_url, isActive -> is_active, sortOrder -> sort_order).
    staffList: () => invoke<TeamMember[]>("admin_staff_list"),
    staffCreate: (input: {
      name: string;
      title: string;
      bio?: string;
      avatarUrl?: string;
      link?: string;
      isActive?: boolean;
      sortOrder?: number;
    }) => invoke<TeamMember>("admin_staff_create", { ...input }),
    staffUpdate: (
      id: string,
      patch: {
        name?: string;
        title?: string;
        bio?: string;
        avatarUrl?: string;
        link?: string;
        isActive?: boolean;
        sortOrder?: number;
      },
    ) => invoke<TeamMember>("admin_staff_update", { id, ...patch }),
    staffDelete: (id: string) => invoke<void>("admin_staff_delete", { id }),
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
