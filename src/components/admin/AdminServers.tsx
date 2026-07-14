import { useEffect, useMemo, useRef, useState } from "react";
import { ipc, errorMessage, type AdminServer, type PageMeta } from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";
import { fromMb, stateDot, stateLabel } from "../../lib/format";
import TypedConfirm from "../TypedConfirm";
import AdminServerDrawer from "./AdminServerDrawer";

type Dialog =
  | { kind: "resize"; server: AdminServer }
  | { kind: "transfer"; server: AdminServer }
  | { kind: "delete"; server: AdminServer }
  | { kind: "vanity"; server: AdminServer }
  | { kind: "confirm"; server: AdminServer; action: "reinstall" | "suspend" | "unsuspend" }
  | null;

export default function AdminServers() {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  const canManage = hasPermission(perms, "servers.manage");

  const [servers, setServers] = useState<AdminServer[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | undefined>();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [manage, setManage] = useState<AdminServer | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);

  async function load(p = page, query = q) {
    try {
      const res = await ipc.admin.serversList({ page: p, pageSize: 50, q: query.trim() || undefined });
      setServers(res.servers);
      setMeta(res.meta);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    void load(1, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSearch(v: string) {
    setQ(v);
    setPage(1);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => void load(1, v), 350);
  }

  async function runConfirm(server: AdminServer, action: "reinstall" | "suspend" | "unsuspend") {
    setDialog(null);
    try {
      if (action === "reinstall") await ipc.admin.serverReinstall(server.id);
      else if (action === "suspend") await ipc.admin.serverSuspend(server.id);
      else await ipc.admin.serverUnsuspend(server.id);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="p-6" onClick={() => setMenuFor(null)}>
      <div className="flex items-center justify-between gap-4">
        <input
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search servers by name…"
          className="refx-input w-72 rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
        />
        <div className="text-sm text-muted-foreground">
          {meta ? `${meta.total} server${meta.total === 1 ? "" : "s"}` : ""}
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      <div className="refx-card mt-4 overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">Server</th>
              <th className="px-4 py-2.5 font-medium">Owner</th>
              <th className="px-4 py-2.5 font-medium">Node</th>
              <th className="px-4 py-2.5 font-medium">Resources</th>
              <th className="px-4 py-2.5 font-medium">State</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {servers === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Loading servers…
                </td>
              </tr>
            ) : servers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No servers match.
                </td>
              </tr>
            ) : (
              servers.map((s) => (
                <tr key={s.id} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.template?.name ?? "—"}
                      {s.primaryAllocation?.ip
                        ? ` · ${s.primaryAllocation.ip}:${s.primaryAllocation.port}`
                        : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.owner?.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.node?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.cpuCores != null ? `${s.cpuCores} vCPU` : "—"}
                    {s.memoryMb != null ? ` · ${fromMb(s.memoryMb)}` : ""}
                    {s.diskMb != null ? ` · ${fromMb(s.diskMb)}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className={`h-2 w-2 rounded-full ${stateDot(s.state)}`} />
                      {stateLabel(s.state)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setManage(s)} className="btn-ghost rounded px-2 py-1 text-xs">
                        Manage
                      </button>
                      {canManage && (
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                            className="btn-ghost rounded px-2 py-1 text-xs"
                          >
                            Actions ▾
                          </button>
                          {menuFor === s.id && (
                            <RowMenu
                              server={s}
                              onPick={(d) => {
                                setMenuFor(null);
                                setDialog(d);
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => {
              const p = page - 1;
              setPage(p);
              void load(p, q);
            }}
            className="btn-ghost rounded px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => {
              const p = page + 1;
              setPage(p);
              void load(p, q);
            }}
            className="btn-ghost rounded px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {manage && <AdminServerDrawer server={manage} onClose={() => { setManage(null); void load(); }} />}

      {dialog?.kind === "resize" && (
        <ResizeDialog
          server={dialog.server}
          onClose={() => setDialog(null)}
          onDone={async () => { setDialog(null); await load(); }}
          onError={setError}
        />
      )}
      {dialog?.kind === "transfer" && (
        <TransferDialog
          server={dialog.server}
          onClose={() => setDialog(null)}
          onDone={async () => { setDialog(null); await load(); }}
          onError={setError}
        />
      )}
      {dialog?.kind === "confirm" && (
        <SimpleConfirm
          action={dialog.action}
          server={dialog.server}
          onCancel={() => setDialog(null)}
          onConfirm={() => void runConfirm(dialog.server, dialog.action)}
        />
      )}
      {dialog?.kind === "delete" && (
        <TypedConfirm
          title={`Delete ${dialog.server.name}`}
          danger
          confirmWord={dialog.server.name}
          confirmLabel="Delete server"
          body={
            <>
              This tears the server down and frees its allocations. It does{" "}
              <strong>not</strong> cancel the customer's subscription — billing keeps renewing until
              you cancel it separately.
            </>
          }
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const srv = dialog.server;
            setDialog(null);
            try {
              await ipc.admin.serverDelete(srv.id);
              await load();
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
      )}
      {dialog?.kind === "vanity" && (
        <VanityDialog
          server={dialog.server}
          onClose={() => setDialog(null)}
          onDone={async () => { setDialog(null); await load(); }}
          onError={setError}
        />
      )}
    </div>
  );
}

function RowMenu({ server, onPick }: { server: AdminServer; onPick: (d: Dialog) => void }) {
  const suspended = !!server.suspendedAt;
  const item = "block w-full px-3 py-1.5 text-left text-sm text-foreground/90 hover:bg-white/[0.06]";
  return (
    <div className="refx-panel absolute right-0 z-20 mt-1 w-44 overflow-hidden py-1 text-sm shadow-lg">
      <button className={item} onClick={() => onPick({ kind: "resize", server })}>
        Resize…
      </button>
      <button className={item} onClick={() => onPick({ kind: "transfer", server })}>
        Transfer…
      </button>
      <button className={item} onClick={() => onPick({ kind: "confirm", server, action: "reinstall" })}>
        Reinstall…
      </button>
      <button
        className={item}
        onClick={() =>
          onPick({ kind: "confirm", server, action: suspended ? "unsuspend" : "suspend" })
        }
      >
        {suspended ? "Unsuspend" : "Suspend"}
      </button>
      <button className={item} onClick={() => onPick({ kind: "vanity", server })}>
        Strip vanity address…
      </button>
      <div className="my-1 border-t border-white/[0.06]" />
      <button className={`${item} text-destructive`} onClick={() => onPick({ kind: "delete", server })}>
        Delete…
      </button>
    </div>
  );
}

function ResizeDialog({
  server,
  onClose,
  onDone,
  onError,
}: {
  server: AdminServer;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [cpu, setCpu] = useState(String(server.cpuCores ?? ""));
  const [mem, setMem] = useState(String(server.memoryMb ?? ""));
  const [disk, setDisk] = useState(String(server.diskMb ?? ""));
  const [swap, setSwap] = useState(String(server.swapMb ?? ""));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await ipc.admin.serverResize(server.id, {
        cpuCores: cpu === "" ? undefined : Number(cpu),
        memoryMb: mem === "" ? undefined : Number(mem),
        diskMb: disk === "" ? undefined : Number(disk),
        swapMb: swap === "" ? undefined : Number(swap),
      });
      onDone();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  const field = (label: string, unit: string, v: string, set: (s: string) => void) => (
    <label className="text-sm">
      <span className="text-muted-foreground">
        {label} <span className="text-xs">({unit})</span>
      </span>
      <input
        value={v}
        onChange={(e) => set(e.target.value.replace(/[^0-9.]/g, ""))}
        inputMode="decimal"
        className="refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60"
      />
    </label>
  );

  return (
    <Modal title={`Resize ${server.name}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        Staff comp resize — applied live, no invoice. Leave a field blank to keep it unchanged.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {field("CPU", "vCPU", cpu, setCpu)}
        {field("Memory", "MB", mem, setMem)}
        {field("Disk", "MB", disk, setDisk)}
        {field("Swap", "MB", swap, setSwap)}
      </div>
      <ModalActions
        busy={busy}
        confirmLabel="Apply resize"
        onCancel={onClose}
        onConfirm={() => void save()}
      />
    </Modal>
  );
}

function TransferDialog({
  server,
  onClose,
  onDone,
  onError,
}: {
  server: AdminServer;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [toNode, setToNode] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!toNode.trim()) return;
    setBusy(true);
    try {
      await ipc.admin.serverTransfer(server.id, toNode.trim());
      onDone();
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Transfer ${server.name}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        Moves the server to another node (snapshot → provision → restore, queued). The source is
        removed only after the destination is verified. Current node: {server.node?.name ?? "—"}.
      </p>
      <label className="mt-4 block text-sm">
        <span className="text-muted-foreground">Destination node ID</span>
        <input
          value={toNode}
          onChange={(e) => setToNode(e.target.value)}
          placeholder="node UUID (from the Nodes screen)"
          className="refx-input mt-1 w-full rounded-md px-3 py-1.5 font-mono text-sm outline-none focus:border-primary/60"
        />
      </label>
      <ModalActions
        busy={busy}
        disabled={!toNode.trim()}
        confirmLabel="Start transfer"
        onCancel={onClose}
        onConfirm={() => void go()}
      />
    </Modal>
  );
}

function VanityDialog({
  server,
  onClose,
  onDone,
  onError,
}: {
  server: AdminServer;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [refund, setRefund] = useState(false);
  // With a refund the confirm word is stricter (money-moving); without, a plain confirm.
  const word = refund ? "REFUND" : server.name;
  return (
    <TypedConfirm
      title={`Strip vanity address — ${server.name}`}
      danger
      confirmWord={word}
      confirmLabel={refund ? "Strip & refund credit" : "Strip address"}
      body={
        <>
          <p>
            Removes the server's purchased custom address (ToS / impersonation enforcement).
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
            <span>
              Refund its price as <strong>store credit</strong> to the owner (money-moving).
            </span>
          </label>
        </>
      }
      onCancel={onClose}
      onConfirm={async () => {
        try {
          await ipc.admin.serverVanityStrip(server.id, refund, true);
          onDone();
        } catch (e) {
          onError(errorMessage(e));
        }
      }}
    />
  );
}

function SimpleConfirm({
  action,
  server,
  onCancel,
  onConfirm,
}: {
  action: "reinstall" | "suspend" | "unsuspend";
  server: AdminServer;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = useMemo(() => {
    switch (action) {
      case "reinstall":
        return {
          title: `Reinstall ${server.name}?`,
          body: "Reinstalls the server from its template. This may overwrite existing files.",
          label: "Reinstall",
          danger: true,
        };
      case "suspend":
        return {
          title: `Suspend ${server.name}?`,
          body: "Stops the server and blocks the owner from starting it until unsuspended.",
          label: "Suspend",
          danger: true,
        };
      case "unsuspend":
        return {
          title: `Unsuspend ${server.name}?`,
          body: "Lifts the suspension; the owner can start the server again.",
          label: "Unsuspend",
          danger: false,
        };
    }
  }, [action, server.name]);

  return (
    <Modal title={copy.title} onClose={onCancel}>
      <p className="text-sm text-muted-foreground">{copy.body}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`${copy.danger ? "btn-danger" : "btn-primary"} rounded-md px-3 py-1.5 text-sm`}
        >
          {copy.label}
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  busy,
  disabled,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  busy?: boolean;
  disabled?: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button onClick={onCancel} className="btn-ghost rounded-md px-3 py-1.5 text-sm">
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={busy || disabled}
        className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {busy ? "Working…" : confirmLabel}
      </button>
    </div>
  );
}
