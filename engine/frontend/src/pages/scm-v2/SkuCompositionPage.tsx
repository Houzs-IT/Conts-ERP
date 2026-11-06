/* Production > SKU Composition (owner, 5 Nov 2026): what one unit of a SKU uses. A project's line reads this times its
   qty until someone changes that line's own list, so setting it here saves picking the materials on every project.
   The same page as the system's other lists: cards, status pills, one table, and a drawer for the record. */

import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable } from "../../components/DataTable";
import type { Column } from "../../components/dataTableTypes";
import { FilterPills } from "../../components/FilterPills";
import { PageHeader } from "../../components/Layout";
import { ResizableDetailDrawer } from "../../components/ResizableDetailDrawer";
import { StatCard } from "../../components/StatCard";
import { SearchableSelect } from "../../vendor/scm/components/SearchableSelect";
import { useConfirm } from "../../vendor/scm/components/ConfirmDialog";
import { useNotify } from "../../vendor/scm/components/NotifyDialog";
import { useToast } from "../../hooks/useToast";
import {
  useAddComposition, useCompositionSkus, useDeleteComposition, useRawSkus, useSkuCompositions, useUpdateComposition, type CompositionRow,
} from "../../vendor/scm/lib/production-order-queries";
import { RawMaterialAddPanel, type RawPick } from "./RawMaterialAddPanel";

const LABEL = "font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted";
const INPUT = "h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px]";
type Sku = { code: string; name: string | null };
type ListRow = { code: string; name: string | null; uom: string | null; materials: CompositionRow[] };
const skuLabel = (s: Sku) => (s.name ? `${s.code} · ${s.name}` : s.code);
const skuOption = (s: Sku) => ({ value: s.code, label: skuLabel(s) });
const plural = (n: number) => `${n} raw material${n === 1 ? "" : "s"}`;

const COLUMNS: Column<ListRow>[] = [
  { key: "code", label: "SKU", alwaysVisible: true, getValue: (r) => r.code, disableFilter: true,
    render: (r) => <span className="font-mono text-[12.5px] font-semibold text-primary">{r.code}</span> },
  { key: "name", label: "Name", getValue: (r) => r.name ?? "", disableFilter: true, render: (r) => r.name || "—" },
  { key: "uom", label: "Unit", getValue: (r) => r.uom ?? "", render: (r) => r.uom || "—" },
  { key: "count", label: "Raw materials", align: "right", getValue: (r) => r.materials.length, disableFilter: true,
    render: (r) => (r.materials.length ? <span className="tabular-nums">{r.materials.length}</span> : <span className="text-ink-muted">None</span>) },
  { key: "uses", label: "Uses", getValue: (r) => r.materials.map((m) => m.material_name || m.material_code).join(", "), disableFilter: true,
    render: (r) => <span className="text-ink-secondary">{r.materials.map((m) => m.material_name || m.material_code).join(", ") || "—"}</span> },
];

export function SkuCompositionPage() {
  const rows = useSkuCompositions();
  const skus = useCompositionSkus();
  const materials = useRawSkus(true);
  const add = useAddComposition();
  const update = useUpdateComposition();
  const remove = useDeleteComposition();
  const confirm = useConfirm();
  const notify = useNotify();
  const toast = useToast();
  /* null: drawer shut. "": a new composition, its SKU not chosen yet. */
  const [sku, setSku] = useState<string | null>(null);
  const [view, setView] = useState("with");
  const [q, setQ] = useState("");
  const [seed, setSeed] = useState<Record<string, string> | undefined>();

  const all = useMemo(() => rows.data ?? [], [rows.data]);
  const list = useMemo(() => {
    const m = new Map<string, ListRow>();
    for (const s of skus.data ?? []) m.set(s.code, { code: s.code, name: s.name, uom: s.uom ?? null, materials: [] });
    for (const r of all) {
      const row = m.get(r.sku_code) ?? { code: r.sku_code, name: r.sku_name, uom: null, materials: [] };
      row.materials.push(r);
      m.set(r.sku_code, row);
    }
    return [...m.values()];
  }, [all, skus.data]);
  const withC = list.filter((r) => r.materials.length > 0);
  const without = list.filter((r) => r.materials.length === 0);
  const term = q.trim().toLowerCase();
  const shown = (view === "with" ? withC : view === "without" ? without : list).filter((r) =>
    !term || `${r.code} ${r.name ?? ""} ${r.materials.map((m) => `${m.material_code} ${m.material_name ?? ""}`).join(" ")}`.toLowerCase().includes(term));
  const mine = all.filter((r) => r.sku_code === sku);
  const taken = useMemo(() => new Set(mine.map((r) => r.material_code)), [mine]);
  const current = list.find((r) => r.code === sku);
  const refused = (title: string) => (e: unknown) => notify({ title, body: e instanceof Error ? e.message : "Something went wrong.", tone: "error" });

  const open = (code: string | null) => { setSku(code); setSeed(undefined); };
  const addPicks = async (picks: RawPick[]) => {
    if (!sku) return;
    for (const p of picks) await add.mutateAsync({ skuCode: sku, materialCode: p.code, qty: p.qty });
    toast.success(`${plural(picks.length)} added to ${sku}`);
  };
  /* Starts from what another SKU uses: the quantities stay editable before anything is saved. */
  const copyFrom = (code: string) => {
    const from = all.filter((r) => r.sku_code === code && !taken.has(r.material_code));
    setSeed(Object.fromEntries(from.map((r) => [r.material_code, String(Number(r.qty))])));
  };
  const dropAll = async (code: string) => {
    const lines = all.filter((x) => x.sku_code === code);
    if (!(await confirm({ title: `Delete the composition of ${code}?`, body: `All ${plural(lines.length)} leave it. Lines already on a project keep what they have.`, confirmLabel: "Delete" }))) return;
    try {
      for (const r of lines) await remove.mutateAsync(r.id);
      toast.success(`Composition of ${code} deleted`);
      open(null);
    } catch (e) {
      refused("Composition not deleted")(e);
    }
  };
  const drop = async (r: CompositionRow) => {
    if (!(await confirm({ title: `Remove ${r.material_code}?`, body: `It leaves the composition of ${r.sku_code}.`, confirmLabel: "Remove" }))) return;
    remove.mutate(r.id, { onSuccess: () => toast.success(`${r.material_code} removed`), onError: refused("Material not removed") });
  };

  const pending = rows.isLoading;
  const failed = { failed: Boolean(rows.error), onRetry: () => void rows.refetch() };
  return (
    <div className={sku !== null ? "transition-[padding] duration-200 md:pr-[600px]" : "transition-[padding] duration-200"}>
      <PageHeader
        eyebrow="Production"
        title="SKU Composition"
        description="Set the raw materials one unit of a SKU uses. Projects with that SKU bring them in by themselves."
        primaryAction={<Button icon={<Plus size={14} />} onClick={() => open("")}>New Composition</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard pending={pending} {...failed} label="With a composition" value={withC.length.toLocaleString("en-MY")} subtitle="SKUs that bring their materials" rail="bg-primary" />
        <StatCard pending={pending} {...failed} label="No composition" value={without.length.toLocaleString("en-MY")} subtitle="SKUs still picked by hand" rail="bg-warning-text" />
        <StatCard pending={pending} {...failed} label="Raw materials in use" value={new Set(all.map((r) => r.material_code)).size.toLocaleString("en-MY")} subtitle={`Of ${(materials.data ?? []).length.toLocaleString("en-MY")} on the list`} rail="bg-accent" />
      </div>

      <div className="mb-4">
        <FilterPills
          options={[
            { value: "with", label: "With composition", count: pending ? undefined : withC.length },
            { value: "without", label: "No composition", count: pending ? undefined : without.length },
            { value: "", label: "All SKUs", count: pending ? undefined : list.length },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      <DataTable<ListRow>
        tableId="sku-composition"
        documentLabel="SKU compositions"
        exportName="sku-composition"
        rows={shown}
        loading={pending}
        error={rows.error ? "The compositions could not be loaded." : null}
        columns={COLUMNS}
        getRowKey={(r) => r.code}
        onRowClick={(r) => open(r.code)}
        mobileCard={{ primary: "code", cells: ["name", "count"] }}
        emptyLabel={q ? "Nothing matches." : view === "with" ? "None yet. Press New Composition to start." : "Every SKU has a composition."}
        search={{ value: q, onChange: setQ, placeholder: "Search SKU or raw material", scope: "server", totalRecords: shown.length, countPending: pending }}
      />

      <ResizableDetailDrawer open={sku !== null} onClose={() => open(null)} ariaLabel={sku ? `Composition of ${sku}` : "New composition"}>
        {sku !== null && (
          <>
            <div className="flex h-[60px] shrink-0 items-center gap-3 bg-sidebar px-5 text-sidebar-ink">
              <button type="button" onClick={() => open(null)} className="text-sidebar-ink-muted hover:text-sidebar-ink" aria-label="Close composition"><X size={18} /></button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[14px] font-bold tracking-wide">{sku || "New composition"}</div>
                <div className="mt-0.5 truncate text-[11px] text-sidebar-ink-muted">{current?.name || "SKU composition"}</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {!sku ? (
                <>
                  <span className={`${LABEL} mb-1 block`}>SKU</span>
                  <SearchableSelect className={INPUT} value="" onChange={(v) => open(v)} options={list.map(skuOption)} placeholder="Search SKU" ariaLabel="SKU" />
                  <p className="mt-2 text-[12.5px] text-ink-muted">Choose the SKU, then tick its raw materials.</p>
                </>
              ) : (
                <>
                  <div className={`${LABEL} mb-2`}>Per 1 {current?.uom || "unit"} of {sku}</div>
                  {mine.length === 0 ? (
                    <p className="mb-4 rounded-md border border-dashed border-border px-3 py-4 text-center text-[13px] text-ink-muted">No raw material on {sku} yet.</p>
                  ) : (
                    <div className="mb-5 overflow-hidden rounded-md border border-border">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b border-border bg-surface-2 text-left">
                            <th className={`${LABEL} px-3 py-1.5`}>Raw material</th>
                            <th className={`${LABEL} px-3 py-1.5 text-right`}>Qty per unit</th>
                            <th className="w-9" aria-label="Remove" />
                          </tr>
                        </thead>
                        <tbody>
                          {mine.map((r) => (
                            <tr key={r.id} className="border-b border-border-subtle last:border-b-0">
                              <td className="px-3 py-2">
                                <div className="font-semibold text-ink">{r.material_name || r.material_code}</div>
                                <div className="font-mono text-[11px] text-ink-muted">{r.material_code}</div>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right">
                                <input
                                  key={r.qty} type="number" min="0" step="any" defaultValue={Number(r.qty)} aria-label={`Quantity of ${r.material_code}`}
                                  onFocus={(e) => e.currentTarget.select()}
                                  className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-right text-[13px]"
                                  onBlur={(e) => {
                                    const n = Number(e.target.value);
                                    if (n > 0 && n !== Number(r.qty)) update.mutate({ id: r.id, qty: n }, { onSuccess: () => toast.success(`${r.material_code} updated`), onError: refused("Quantity not saved") });
                                  }}
                                />
                                <span className="ml-1 text-[11px] text-ink-muted">{r.uom ?? ""}</span>
                              </td>
                              <td className="px-2 text-right">
                                <button type="button" aria-label={`Remove ${r.material_code}`} onClick={() => void drop(r)} className="text-ink-muted hover:text-err"><Trash2 size={14} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className={`${LABEL} mb-2`}>Add raw materials</div>
                  {withC.some((b) => b.code !== sku) && (
                    <div className="mb-2">
                      <SearchableSelect className={INPUT} value="" onChange={copyFrom} placeholder="Or copy from another SKU" ariaLabel="Copy from another SKU"
                        options={withC.filter((b) => b.code !== sku).map(skuOption)} />
                    </div>
                  )}
                  <RawMaterialAddPanel skus={materials.data ?? []} taken={taken} qtyLabel="Qty per unit" seed={seed} onAdd={addPicks} />
                </>
              )}
            </div>

            {sku && mine.length > 0 && (
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
                <Button variant="secondary" icon={<Trash2 size={14} />} onClick={() => void dropAll(sku)}>Delete composition</Button>
              </div>
            )}
          </>
        )}
      </ResizableDetailDrawer>
    </div>
  );
}
