import { useEffect, useState } from "react";
import {
  ipc,
  errorMessage,
  type EmailConfig,
  type SteamConfig,
  type VanityConfig,
  type ReferralConfig,
  type SteamVerifyResult,
  type AdminNode,
} from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";
import { money } from "../../lib/format";

// Platform settings — one screen, four cards (Email, Steam, Vanity, Referrals),
// the whole thing gated on settings.manage (server-authoritative; the UI gate
// just avoids dead-ending a role that can't reach it). Secret fields are
// write-only: reads return masked config, and a blank field means "keep".

export default function AdminSettings() {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  const canManage = hasPermission(perms, "settings.manage");

  if (!canManage) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          You don't have permission to manage platform settings.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <EmailCard />
      <SteamCard />
      <VanityCard />
      <ReferralsCard />
    </div>
  );
}

// ── Email (SMTP) ───────────────────────────────────────────────────────

function EmailCard() {
  const [cfg, setCfg] = useState<EmailConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [from, setFrom] = useState("");
  const [secure, setSecure] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, flashSaved] = useFlash();

  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  async function load() {
    try {
      const c = await ipc.admin.settingsEmailGet();
      setCfg(c);
      setHost(c.host ?? "");
      setPort(c.port != null ? String(c.port) : "587");
      setUser(c.user ?? "");
      setFrom(c.from ?? "");
      setSecure(c.secure);
      setTheme(c.theme ?? "dark");
      setPassword("");
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const portNum = port.trim() ? Number(port) : undefined;
      await ipc.admin.settingsEmailUpdate({
        host: host.trim() || undefined,
        port: portNum != null && Number.isFinite(portNum) ? portNum : undefined,
        user: user.trim() || undefined,
        from: from.trim() || undefined,
        secure,
        theme,
        // Write-only: only send a password when the operator typed one.
        password: password ? password : undefined,
      });
      await load();
      flashSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) return;
    setTesting(true);
    setTestMsg(null);
    setError(null);
    try {
      const r = await ipc.admin.settingsEmailTest(testTo.trim());
      setTestMsg(
        r.delivered
          ? "Test email delivered."
          : "SMTP not configured — the email was logged, not delivered.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card
      title="Email · SMTP"
      desc="Transactional email delivery for receipts, alerts and account mail."
      badge={<Badge active={!!cfg?.configured} on="Configured" off="Not configured" />}
    >
      {error && <ErrorBanner msg={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Host" value={host} onChange={setHost} placeholder="smtp.example.com" />
        <Field label="Port" value={port} onChange={(v) => setPort(v.replace(/[^0-9]/g, ""))} inputMode="numeric" />
        <Field label="Username" value={user} onChange={setUser} />
        <Field label="From address" value={from} onChange={setFrom} placeholder="no-reply@example.com" />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          placeholder={cfg?.passwordSet ? "•••• set — leave blank to keep" : "SMTP password"}
        />
        <label className="block text-sm">
          <span className="text-muted-foreground">Email theme</span>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as "dark" | "light")}
            className="refx-input mt-1 w-full rounded-md px-2 py-1.5 text-sm outline-none"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
      </div>

      <div className="mt-2">
        <Toggle label="Use TLS (secure connection)" checked={secure} onChange={setSecure} />
      </div>

      <SaveRow saving={saving} saved={saved} onSave={() => void save()} />

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <div className="refx-eyebrow mb-2">Send a test email</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">Recipient</span>
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
              className="refx-input mt-1 w-64 rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
          <button
            onClick={() => void sendTest()}
            disabled={!testTo.trim() || testing}
            className="btn-ghost rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {testing ? "Sending…" : "Send test"}
          </button>
          {testMsg && <span className="text-sm text-muted-foreground">{testMsg}</span>}
        </div>
      </div>
    </Card>
  );
}

// ── Steam ──────────────────────────────────────────────────────────────

function SteamCard() {
  const [cfg, setCfg] = useState<SteamConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [password, setPassword] = useState("");
  const [guardCode, setGuardCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, flashSaved] = useFlash();

  const [nodes, setNodes] = useState<AdminNode[] | null>(null);
  const [nodeId, setNodeId] = useState("");
  const [verifyGuard, setVerifyGuard] = useState("");
  const [verifying, setVerifying] = useState<"send" | "verify" | null>(null);
  const [result, setResult] = useState<SteamVerifyResult | null>(null);

  async function load() {
    try {
      const c = await ipc.admin.settingsSteamGet();
      setCfg(c);
      setUsername(c.username ?? "");
      setApiKey("");
      setPassword("");
      setGuardCode("");
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
    ipc.admin
      .nodesList({ pageSize: 100 })
      .then((res) => {
        setNodes(res.nodes);
        if (res.nodes.length > 0) setNodeId((prev) => prev || res.nodes[0].id);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await ipc.admin.settingsSteamUpdate({
        username: username.trim() || undefined,
        // Write-only secrets: send only what was typed.
        apiKey: apiKey ? apiKey : undefined,
        password: password ? password : undefined,
        guardCode: guardCode ? guardCode : undefined,
      });
      await load();
      flashSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function verify(kind: "send" | "verify") {
    if (!nodeId) return;
    setVerifying(kind);
    setResult(null);
    setError(null);
    try {
      // "send" makes Steam email a fresh Guard code (no code passed);
      // "verify" submits the typed code and caches the session on the node.
      const r = await ipc.admin.settingsSteamVerify(
        nodeId,
        kind === "verify" ? verifyGuard.trim() || undefined : undefined,
      );
      setResult(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setVerifying(null);
    }
  }

  return (
    <Card
      title="Steam"
      desc="Credentials steamcmd uses to install and update Steam-based game servers."
      badge={
        <>
          <Badge active={!!cfg?.loginConfigured} on="Login ready" off="No login" />
          <Badge active={!!cfg?.apiKeySet} on="API key set" off="No API key" />
          {cfg?.guardCodePending && (
            <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[11px] text-warning">Guard code staged</span>
          )}
        </>
      }
    >
      {error && <ErrorBanner msg={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Username" value={username} onChange={setUsername} />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          placeholder={cfg?.passwordSet ? "(set — leave blank to keep)" : "Steam password"}
        />
        <Field
          label="Web API key"
          value={apiKey}
          onChange={setApiKey}
          type="password"
          placeholder={cfg?.apiKeySet ? "(set — leave blank to keep)" : "Steam Web API key"}
        />
        <Field
          label="Guard code (stage for next install)"
          value={guardCode}
          onChange={setGuardCode}
          placeholder="optional one-time code"
        />
      </div>

      <SaveRow saving={saving} saved={saved} onSave={() => void save()} />

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <div className="refx-eyebrow mb-2">Verify &amp; cache on a node</div>
        <p className="mb-3 text-xs text-muted-foreground">
          Log in on a node to validate the credentials and cache the Steam session. Send a fresh
          email code first, then enter it and verify.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">Node</span>
            <select
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
              className="refx-input mt-1 w-56 rounded-md px-2 py-1.5 text-sm outline-none"
            >
              {nodes === null ? (
                <option value="">Loading…</option>
              ) : nodes.length === 0 ? (
                <option value="">No nodes</option>
              ) : (
                nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name ?? n.fqdn ?? n.id}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Guard code</span>
            <input
              value={verifyGuard}
              onChange={(e) => setVerifyGuard(e.target.value)}
              placeholder="emailed code"
              className="refx-input mt-1 w-40 rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
          <button
            onClick={() => void verify("send")}
            disabled={!nodeId || verifying !== null}
            className="btn-ghost rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {verifying === "send" ? "Sending…" : "Send fresh email code"}
          </button>
          <button
            onClick={() => void verify("verify")}
            disabled={!nodeId || verifying !== null}
            className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {verifying === "verify" ? "Verifying…" : "Verify & cache"}
          </button>
        </div>

        {result && (
          <div className="mt-3">
            <div className={`mb-1.5 text-sm ${result.ok ? "text-success" : "text-destructive-foreground"}`}>
              {result.ok ? "Success" : "Failed"}
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[rgba(7,13,24,0.7)] px-3 py-2 font-mono text-xs text-foreground/90">
              {result.output}
            </pre>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Vanity ─────────────────────────────────────────────────────────────

function VanityCard() {
  const [cfg, setCfg] = useState<VanityConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [fee, setFee] = useState("0");
  const [words, setWords] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, flashSaved] = useFlash();

  function apply(c: VanityConfig) {
    setCfg(c);
    setEnabled(c.enabled);
    setFee((c.feeMinor / 100).toString());
    setWords(c.reservedWords.join("\n"));
  }

  useEffect(() => {
    ipc.admin
      .settingsVanityGet()
      .then(apply)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const feeMinor = Math.round(Number(fee || "0") * 100);
  const feeValid = Number.isFinite(feeMinor) && feeMinor >= 0 && feeMinor <= 100000;

  async function save() {
    if (!feeValid) return;
    setSaving(true);
    setError(null);
    try {
      const reservedWords = words
        .split(/\r?\n/)
        .map((w) => w.trim())
        .filter(Boolean);
      const fresh = await ipc.admin.settingsVanityUpdate({ enabled, feeMinor, reservedWords });
      apply(fresh);
      flashSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Vanity URLs"
      desc="Let customers claim a custom subdomain for their servers."
      badge={<Badge active={!!cfg?.enabled} on="Enabled" off="Disabled" />}
    >
      {error && <ErrorBanner msg={error} />}
      <Toggle label="Allow vanity URL claims" checked={enabled} onChange={setEnabled} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="One-time fee (e.g. 2.00)"
          value={fee}
          onChange={(v) => setFee(v.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          hint={feeValid ? `${feeMinor === 0 ? "Free" : money(feeMinor)} one-time` : "Fee must be between $0 and $1000."}
        />
      </div>
      <label className="mt-3 block text-sm">
        <span className="text-muted-foreground">Reserved words (one per line)</span>
        <textarea
          value={words}
          onChange={(e) => setWords(e.target.value)}
          rows={4}
          placeholder="admin&#10;support&#10;refx"
          className="refx-input mt-1 w-full rounded-md px-3 py-2 font-mono text-sm outline-none focus:border-primary/60"
        />
      </label>
      <SaveRow saving={saving} saved={saved} onSave={() => void save()} disabled={!feeValid} />
    </Card>
  );
}

// ── Referrals ──────────────────────────────────────────────────────────

function ReferralsCard() {
  const [cfg, setCfg] = useState<ReferralConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [reward, setReward] = useState("0");
  const [saving, setSaving] = useState(false);
  const [saved, flashSaved] = useFlash();

  function apply(c: ReferralConfig) {
    setCfg(c);
    setEnabled(c.enabled);
    setReward((c.rewardMinor / 100).toString());
  }

  useEffect(() => {
    ipc.admin
      .settingsReferralsGet()
      .then(apply)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const rewardMinor = Math.round(Number(reward || "0") * 100);
  const rewardValid = Number.isFinite(rewardMinor) && rewardMinor >= 0 && rewardMinor <= 100000;

  async function save() {
    if (!rewardValid) return;
    setSaving(true);
    setError(null);
    try {
      const fresh = await ipc.admin.settingsReferralsUpdate({ enabled, rewardMinor });
      apply(fresh);
      flashSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Referrals"
      desc="Reward both sides when a referred customer signs up and pays."
      badge={<Badge active={!!cfg?.enabled} on="Enabled" off="Disabled" />}
    >
      {error && <ErrorBanner msg={error} />}
      <Toggle label="Enable the referral program" checked={enabled} onChange={setEnabled} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="Two-sided reward (e.g. 5.00)"
          value={reward}
          onChange={(v) => setReward(v.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          hint={rewardValid ? `${money(rewardMinor)} to each side` : "Reward must be between $0 and $1000."}
        />
      </div>
      <SaveRow saving={saving} saved={saved} onSave={() => void save()} disabled={!rewardValid} />
    </Card>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────

function useFlash(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const flash = () => {
    setOn(true);
    window.setTimeout(() => setOn(false), 1600);
  };
  return [on, flash];
}

function Card({
  title,
  desc,
  badge,
  children,
}: {
  title: string;
  desc?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="refx-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="refx-eyebrow">{title}</div>
          {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
        </div>
        {badge && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{badge}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Badge({ active, on, off }: { active: boolean; on: string; off: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] ${
        active ? "bg-success/15 text-success" : "bg-white/[0.06] text-muted-foreground"
      }`}
    >
      {active ? on : off}
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "text";
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={type === "password" ? "new-password" : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
      />
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span>
        <span className="text-sm text-foreground">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition ${
          checked ? "border-primary/60 bg-primary/80" : "border-white/10 bg-white/[0.06]"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white transition ${checked ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
    </label>
  );
}

function SaveRow({
  saving,
  saved,
  onSave,
  disabled,
}: {
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-3">
      {saved && <span className="text-sm text-success">Saved.</span>}
      <button
        onClick={onSave}
        disabled={saving || disabled}
        className="btn-primary rounded-md px-4 py-1.5 text-sm disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
      {msg}
    </p>
  );
}
