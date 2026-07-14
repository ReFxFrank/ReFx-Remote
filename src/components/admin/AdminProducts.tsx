import { useEffect, useState } from "react";
import {
  ipc,
  errorMessage,
  type Product,
  type HardwareTier,
  type Price,
  type ProductType,
  type BillingModel,
  type BillingInterval,
} from "../../lib/ipc";
import { useAuth } from "../../store/auth";
import { hasPermission } from "../../lib/perms";
import { money, fromMb } from "../../lib/format";

// ── constants & helpers ────────────────────────────────────────────────

const PRODUCT_TYPES: ProductType[] = [
  "GAME_SERVER",
  "VOICE_SERVER",
  "WEB_HOSTING",
  "VPS",
  "DEDICATED",
  "ADDON",
  "BOT_HOSTING",
];
const INTERVALS: BillingInterval[] = [
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
];
const INTERVAL_ABBR: Record<string, string> = {
  WEEKLY: "wk",
  BIWEEKLY: "2wk",
  MONTHLY: "mo",
  QUARTERLY: "qtr",
  SEMIANNUAL: "6mo",
  ANNUAL: "yr",
};

const inputCls =
  "refx-input mt-1 w-full rounded-md px-3 py-1.5 text-sm outline-none focus:border-primary/60 disabled:opacity-60";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function isPerSlot(p: Product): boolean {
  return p.billingModel === "PER_SLOT" || p.perSlot === true;
}
function intervalAbbr(iv: string | null | undefined): string {
  if (!iv) return "";
  return INTERVAL_ABBR[iv] ?? iv.toLowerCase();
}
function toNum(s: string): number | undefined {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) ? n : undefined;
}
function activePrices(p: Product): Price[] {
  const list = isPerSlot(p) ? p.prices : p.hardwareTiers.flatMap((t) => t.prices);
  return list.filter((pr) => pr.isActive !== false && pr.amountMinor != null);
}
function cheapest(p: Product): Price | null {
  const list = activePrices(p);
  if (list.length === 0) return null;
  return list.reduce((a, b) => ((a.amountMinor ?? Infinity) <= (b.amountMinor ?? Infinity) ? a : b));
}

// ── main screen ────────────────────────────────────────────────────────

export default function AdminProducts() {
  const perms = useAuth((s) => s.profile?.permissions) ?? [];
  const canRead = hasPermission(perms, "catalog.read");
  const canManage = hasPermission(perms, "catalog.manage");

  const [rows, setRows] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<Product | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  async function load() {
    try {
      setRows(await ipc.admin.productsList());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    if (canRead) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  async function toggleActive(p: Product) {
    try {
      await ipc.admin.productUpdate(p.id, { isActive: !(p.isActive ?? true) });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function confirmDelete() {
    if (!del) return;
    setDelBusy(true);
    try {
      await ipc.admin.productDelete(del.id);
      setDel(null);
      setError(null);
      await load();
    } catch (e) {
      // 400 when the product still has active subscriptions — surface it and
      // steer staff to deactivate instead of deleting (keeps billing history).
      setError(errorMessage(e));
      setDel(null);
    } finally {
      setDelBusy(false);
    }
  }

  if (!canRead) {
    return (
      <div className="p-6">
        <p className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-muted-foreground">
          You don't have permission to view the catalog.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Products, hardware tiers, and the pricing shown at checkout.</p>
        {canManage && (
          <button onClick={() => setCreating(true)} className="btn-primary rounded-md px-3 py-1.5 text-sm">
            New product
          </button>
        )}
      </div>

      {error && <ErrorBox msg={error} />}

      <div className="refx-card mt-4 overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 font-medium">Product</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Configuration</th>
              <th className="px-4 py-2.5 font-medium">Pricing</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <RowN>Loading products…</RowN>
            ) : rows.length === 0 ? (
              <RowN>No products.</RowN>
            ) : (
              rows.map((p) => {
                const per = isPerSlot(p);
                const cp = cheapest(p);
                return (
                  <tr key={p.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{p.name ?? "—"}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{p.slug ?? ""}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {p.type ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {per ? (
                        <>
                          <div className="text-foreground/90">Per slot</div>
                          <div className="text-xs">
                            {p.minSlots ?? "?"}–{p.maxSlots ?? "?"} (step {p.slotStep ?? 1})
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-foreground/90">Hardware tiers</div>
                          <div className="text-xs">
                            {p.hardwareTiers.length} tier{p.hardwareTiers.length === 1 ? "" : "s"}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {cp
                        ? `from ${money(cp.amountMinor, cp.currency)}/${intervalAbbr(cp.interval)}${per ? "/slot" : ""}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {canManage ? (
                        <button
                          onClick={() => void toggleActive(p)}
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            p.isActive === false ? "bg-white/[0.06] text-muted-foreground" : "bg-success/20 text-success"
                          }`}
                        >
                          {p.isActive === false ? "Inactive" : "Active"}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{p.isActive === false ? "Inactive" : "Active"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setEditing(p)} className="btn-ghost rounded px-2 py-1 text-xs">
                        {canManage ? "Edit" : "View"}
                      </button>
                      {canManage && (
                        <button onClick={() => setDel(p)} className="btn-ghost rounded px-2 py-1 text-xs text-destructive">
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <ProductDialog
          product={editing}
          canManage={canManage}
          onClose={() => {
            setCreating(false);
            setEditing(null);
            void load();
          }}
          onChanged={() => void load()}
          onError={setError}
        />
      )}

      {del && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
          onClick={() => !delBusy && setDel(null)}
        >
          <div className="refx-panel refx-beam w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold tracking-tight text-destructive">Delete {del.name ?? "product"}</h2>
            <p className="mt-2 text-sm text-foreground/85">
              This removes the product from the catalog. If it still has active subscriptions the server will refuse —
              deactivate it instead (toggle to Inactive) to keep billing history intact.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDel(null)}
                disabled={delBusy}
                className="btn-ghost rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmDelete()}
                disabled={delBusy}
                className="btn-danger rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {delBusy ? "Deleting…" : "Delete product"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── create / edit dialog ───────────────────────────────────────────────

function ProductDialog({
  product,
  canManage,
  onClose,
  onChanged,
  onError,
}: {
  product: Product | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [current, setCurrent] = useState<Product | null>(product);
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!product?.slug);
  const [type, setType] = useState<ProductType>((product?.type ?? "GAME_SERVER") as ProductType);
  const [billingModel, setBillingModel] = useState<BillingModel>(
    (product?.billingModel ?? "HARDWARE_TIER") as BillingModel,
  );
  const [gameTemplateId, setGameTemplateId] = useState(product?.gameTemplateId ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length > 0 && slug.trim().length > 0;

  function onNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  async function reload() {
    if (!current?.id) return;
    try {
      setCurrent(await ipc.admin.productGet(current.id));
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  async function save() {
    if (!valid || !canManage) return;
    setBusy(true);
    try {
      const common = {
        name: name.trim(),
        slug: slug.trim(),
        billingModel,
        gameTemplateId: gameTemplateId.trim() || undefined,
        description: description.trim() || undefined,
        isActive,
      };
      if (current?.id) {
        setCurrent(await ipc.admin.productUpdate(current.id, { productType: type, ...common }));
      } else {
        // Keep the dialog open after create so pricing/tiers can be added now.
        setCurrent(await ipc.admin.productCreate({ productType: type, ...common }));
      }
      onError("");
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Price mutation handlers (product-level, for PER_SLOT products).
  const addProductPrice = async (amountMinor: number, interval: BillingInterval, currency: string) => {
    if (!current?.id) return;
    try {
      await ipc.admin.priceCreate(current.id, { amountMinor, interval, currency });
      await reload();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    }
  };
  const addTierPrice = (tierId: string) => async (amountMinor: number, interval: BillingInterval, currency: string) => {
    if (!current?.id) return;
    try {
      await ipc.admin.tierPriceCreate(current.id, tierId, { amountMinor, interval, currency });
      await reload();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    }
  };
  const deletePrice = async (priceId: string) => {
    try {
      await ipc.admin.priceDelete(priceId);
      await reload();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  const per = billingModel === "PER_SLOT";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="refx-panel refx-beam max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">
            {current?.id ? `Edit ${current.name ?? "product"}` : "New product"}
          </h2>
          <button onClick={onClose} className="btn-ghost rounded-md px-2.5 py-1 text-sm">
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Name</span>
            <input value={name} onChange={(e) => onNameChange(e.target.value)} disabled={!canManage} className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-muted-foreground">Slug</span>
              <input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                disabled={!canManage}
                className={`${inputCls} font-mono`}
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Type</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ProductType)}
                disabled={!canManage}
                className={inputCls}
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-muted-foreground">Billing model</span>
              <select
                value={billingModel}
                onChange={(e) => setBillingModel(e.target.value as BillingModel)}
                disabled={!canManage}
                className={inputCls}
              >
                <option value="HARDWARE_TIER">Hardware tiers</option>
                <option value="PER_SLOT">Per slot</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Game / voice template ID (optional)</span>
              <input
                value={gameTemplateId}
                onChange={(e) => setGameTemplateId(e.target.value)}
                disabled={!canManage}
                className={`${inputCls} font-mono`}
              />
            </label>
          </div>
          <label className="text-sm">
            <span className="text-muted-foreground">Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canManage}
              rows={2}
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={!canManage}
              className="h-4 w-4"
            />
            <span className="text-muted-foreground">Active (visible at checkout)</span>
          </label>
        </div>

        {canManage && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => void save()}
              disabled={!valid || busy}
              className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "Saving…" : current?.id ? "Save changes" : "Create product"}
            </button>
          </div>
        )}

        {!current?.id ? (
          <p className="mt-5 border-t border-white/[0.06] pt-4 text-xs text-muted-foreground">
            Save the product first to add {per ? "slot pricing" : "hardware tiers and pricing"}.
          </p>
        ) : per ? (
          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <SlotConfig
              product={current}
              canManage={canManage}
              reload={reload}
              onChanged={onChanged}
              onError={onError}
            />
            <div className="mt-5">
              <div className="refx-eyebrow mb-2">Per-slot pricing</div>
              <PriceEditor prices={current.prices} canManage={canManage} perSlot onAdd={addProductPrice} onDelete={deletePrice} />
            </div>
          </div>
        ) : (
          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <div className="refx-eyebrow mb-2">Hardware tiers</div>
            <TierEditor
              product={current}
              canManage={canManage}
              reload={reload}
              onChanged={onChanged}
              onError={onError}
              onAddTierPrice={addTierPrice}
              onDeletePrice={deletePrice}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── slot config (PER_SLOT products) ────────────────────────────────────

function SlotConfig({
  product,
  canManage,
  reload,
  onChanged,
  onError,
}: {
  product: Product;
  canManage: boolean;
  reload: () => Promise<void>;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [minSlots, setMinSlots] = useState(product.minSlots != null ? String(product.minSlots) : "");
  const [maxSlots, setMaxSlots] = useState(product.maxSlots != null ? String(product.maxSlots) : "");
  const [slotStep, setSlotStep] = useState(product.slotStep != null ? String(product.slotStep) : "");
  const [cpuPerSlot, setCpuPerSlot] = useState(product.cpuPerSlot != null ? String(product.cpuPerSlot) : "");
  const [memPerSlot, setMemPerSlot] = useState(product.memoryMbPerSlot != null ? String(product.memoryMbPerSlot) : "");
  const [diskPerSlot, setDiskPerSlot] = useState(product.diskMbPerSlot != null ? String(product.diskMbPerSlot) : "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await ipc.admin.productUpdate(product.id, {
        minSlots: toNum(minSlots),
        maxSlots: toNum(maxSlots),
        slotStep: toNum(slotStep),
        cpuPerSlot: toNum(cpuPerSlot),
        memoryMbPerSlot: toNum(memPerSlot),
        diskMbPerSlot: toNum(diskPerSlot),
      });
      await reload();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="refx-eyebrow mb-2">Slot configuration</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <NumField label="Min slots" value={minSlots} set={setMinSlots} disabled={!canManage} />
        <NumField label="Max slots" value={maxSlots} set={setMaxSlots} disabled={!canManage} />
        <NumField label="Slot step" value={slotStep} set={setSlotStep} disabled={!canManage} />
        <NumField label="vCPU / slot" value={cpuPerSlot} set={setCpuPerSlot} disabled={!canManage} />
        <NumField label="RAM MB / slot" value={memPerSlot} set={setMemPerSlot} disabled={!canManage} />
        <NumField label="Disk MB / slot" value={diskPerSlot} set={setDiskPerSlot} disabled={!canManage} />
      </div>
      {canManage && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="btn-ghost rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save slot config"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── tier editor (HARDWARE_TIER products) ───────────────────────────────

function TierEditor({
  product,
  canManage,
  reload,
  onChanged,
  onError,
  onAddTierPrice,
  onDeletePrice,
}: {
  product: Product;
  canManage: boolean;
  reload: () => Promise<void>;
  onChanged: () => void;
  onError: (m: string) => void;
  onAddTierPrice: (tierId: string) => (amountMinor: number, interval: BillingInterval, currency: string) => Promise<void>;
  onDeletePrice: (priceId: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [cpu, setCpu] = useState("");
  const [mem, setMem] = useState("");
  const [disk, setDisk] = useState("");
  const [players, setPlayers] = useState("");
  const [busy, setBusy] = useState(false);

  async function addTier() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await ipc.admin.tierCreate(product.id, {
        name: name.trim(),
        cpuCores: toNum(cpu) ?? 0,
        memoryMb: toNum(mem) ?? 0,
        diskMb: toNum(disk) ?? 0,
        recommendedPlayers: toNum(players),
        sortOrder: product.hardwareTiers.length,
      });
      setName("");
      setCpu("");
      setMem("");
      setDisk("");
      setPlayers("");
      await reload();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleTier(t: HardwareTier) {
    try {
      await ipc.admin.tierUpdate(t.id, { isActive: !(t.isActive ?? true) });
      await reload();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  async function deleteTier(t: HardwareTier) {
    try {
      await ipc.admin.tierDelete(t.id);
      await reload();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {product.hardwareTiers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tiers yet.</p>
      ) : (
        product.hardwareTiers.map((t) => (
          <div key={t.id} className="rounded-md border border-white/[0.06] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{t.name ?? "—"}</span>
                  {t.isRecommended && (
                    <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">recommended</span>
                  )}
                  {t.isActive === false && (
                    <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">inactive</span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {t.cpuCores ?? "?"} vCPU · {t.memoryMb != null ? fromMb(t.memoryMb) : "?"} RAM ·{" "}
                  {t.diskMb != null ? fromMb(t.diskMb) : "?"} disk
                  {t.recommendedPlayers != null ? ` · ~${t.recommendedPlayers} players` : ""}
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => void toggleTier(t)} className="btn-ghost rounded px-2 py-1 text-xs">
                    {t.isActive === false ? "Enable" : "Disable"}
                  </button>
                  <button
                    onClick={() => void deleteTier(t)}
                    className="btn-ghost rounded px-2 py-1 text-xs text-destructive"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
            <div className="mt-3 border-t border-white/[0.04] pt-3">
              <PriceEditor
                prices={t.prices}
                canManage={canManage}
                onAdd={onAddTierPrice(t.id)}
                onDelete={onDeletePrice}
              />
            </div>
          </div>
        ))
      )}

      {canManage && (
        <div className="rounded-md border border-dashed border-white/[0.1] p-3">
          <div className="refx-eyebrow mb-2">Add tier</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <NumField label="Name" value={name} set={setName} text />
            <NumField label="vCPU" value={cpu} set={setCpu} />
            <NumField label="RAM (MB)" value={mem} set={setMem} />
            <NumField label="Disk (MB)" value={disk} set={setDisk} />
            <NumField label="Players (opt)" value={players} set={setPlayers} />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => void addTier()}
              disabled={!name.trim() || busy}
              className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add tier"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── price rows (shared: product-level & per-tier) ──────────────────────

function PriceEditor({
  prices,
  canManage,
  perSlot,
  onAdd,
  onDelete,
}: {
  prices: Price[];
  canManage: boolean;
  perSlot?: boolean;
  onAdd: (amountMinor: number, interval: BillingInterval, currency: string) => Promise<void>;
  onDelete: (priceId: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [interval, setIntervalV] = useState<BillingInterval>("MONTHLY");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);

  const num = Number(amount);
  const valid = Number.isFinite(num) && num > 0;

  async function add() {
    if (!valid) return;
    setBusy(true);
    try {
      await onAdd(Math.round(num * 100), interval, currency.trim().toUpperCase() || "USD");
      setAmount("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ul className="flex flex-col gap-1 text-sm">
        {prices.length === 0 ? (
          <li className="text-xs text-muted-foreground">No prices.</li>
        ) : (
          prices.map((pr) => (
            <li
              key={pr.id}
              className="flex items-center justify-between rounded-md border border-white/[0.04] px-2.5 py-1.5"
            >
              <span className="text-foreground/90">
                {money(pr.amountMinor, pr.currency)}/{intervalAbbr(pr.interval)}
                {perSlot ? "/slot" : ""}
                {pr.isActive === false && <span className="ml-2 text-xs text-muted-foreground">inactive</span>}
              </span>
              {canManage && (
                <button onClick={() => void onDelete(pr.id)} className="text-xs text-destructive hover:underline">
                  Remove
                </button>
              )}
            </li>
          ))
        )}
      </ul>

      {canManage && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            <span>Amount</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="9.99"
              className="refx-input mt-0.5 block w-24 rounded-md px-2 py-1 text-sm outline-none focus:border-primary/60"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            <span>Interval</span>
            <select
              value={interval}
              onChange={(e) => setIntervalV(e.target.value as BillingInterval)}
              className="refx-input mt-0.5 block w-32 rounded-md px-2 py-1 text-sm outline-none"
            >
              {INTERVALS.map((iv) => (
                <option key={iv} value={iv}>
                  {iv}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            <span>Currency</span>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              className="refx-input mt-0.5 block w-20 rounded-md px-2 py-1 font-mono text-sm outline-none focus:border-primary/60"
            />
          </label>
          <button
            onClick={() => void add()}
            disabled={!valid || busy}
            className="btn-ghost rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add price"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── shared bits ────────────────────────────────────────────────────────

function NumField({
  label,
  value,
  set,
  disabled,
  text,
}: {
  label: string;
  value: string;
  set: (s: string) => void;
  disabled?: boolean;
  text?: boolean;
}) {
  return (
    <label className="text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => set(text ? e.target.value : e.target.value.replace(/[^0-9.]/g, ""))}
        inputMode={text ? undefined : "decimal"}
        disabled={disabled}
        className="refx-input mt-0.5 block w-full rounded-md px-2 py-1 text-sm text-foreground outline-none focus:border-primary/60 disabled:opacity-60"
      />
    </label>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="my-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
      {msg}
    </p>
  );
}

function RowN({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
