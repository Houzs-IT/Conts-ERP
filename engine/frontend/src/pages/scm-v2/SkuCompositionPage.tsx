/* Production > SKU Composition (owner, 5 Nov 2026): pick a SKU and bind the raw materials one unit of it uses. */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { fmtQty } from "@2990s/shared";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/Layout";
import { SearchableSelect } from "../../vendor/scm/components/SearchableSelect";
import { useConfirm } from "../../vendor/scm/components/ConfirmDialog";
import { useNotify } from "../../vendor/scm/components/NotifyDialog";
import { useToast } from "../../hooks/useToast";
import {
  useAddComposition, useCompositionSkus, useDeleteComposition, useRawSkus, useSkuCompositions, useUpdateComposition, type CompositionRow,
} from "../../vendor/scm/lib/production-order-queries";

const FIELD_LABEL = "mb-1 block font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted";
const skuOption = (s: { code: string; name: string | null }) => ({ value: s.code, label: s.name ? `${s.code} · ${s.name}` : s.code });

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
  const [sku, setSku] = useState("");
  const [material, setMaterial] = useState("");
  const [qty, setQty] = useState("1");
  const [pickerKey, setPickerKey] = useState(0);

  const all = useMemo(() => rows.data ?? [], [rows.data]);
  const mine = all.filter((r) => r.sku_code === sku);
  const bound = useMemo(() => {
    const m = new Map<string, { code: string; name: string | null; n: number }>();
    for (const r of all) m.set(r.sku_code, { code: r.sku_code, name: r.sku_name, n: (m.get(r.sku_code)?.n ?? 0) + 1 });
    return [...m.values()];
  }, [all]);
  const taken = new Set(mine.map((r) => r.material_code));
  const refused = (title: string) => (e: unknown) => notify({ title, body: e instanceof Error ? e.message : "Something went wrong.", tone: "error" });

  const addOne = () => {
    if (!sku || !material || !(Number(qty) > 0) || add.isPending) return;
    add.mutate({ skuCode: sku, materialCode: material, qty: Number(qty) }, {
      onSuccess: () => { toast.success(`${material} added to ${sku}`); setMaterial(""); setQty("1"); setPickerKey((k) => k + 1); },
      onError: refused("Material not added"),
    });
  };
  const drop = async (r: CompositionRow) => {
    if (!(await confirm({ title: `Remove ${r.material_code}?`, body: `It leaves the composition of ${r.sku_code}.`, confirmLabel: "Remove" }))) return;
    remove.mutate(r.id, { onSuccess: () => toast.success(`${r.material_code} removed`), onError: refused("Material not removed") });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Production" title="SKU Composition" description="Choose a SKU, then bind the raw materials one unit of it uses." />

      <div className="max-w-[640px]">
        <span className={FIELD_LABEL}>SKU</span>
        <SearchableSelect className="h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px]" value={sku} onChange={setSku} options={(skus.data ?? []).map(skuOption)} placeholder="Search SKUs" ariaLabel="SKU" />
      </div>

      {sku ? (
        <div className="rounded-md border border-border-subtle bg-surface p-3">
          {mine.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No raw material on {sku} yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-[13px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-brand text-ink-muted">
                    <th className="px-1 py-1 font-semibold">Raw material</th>
                    <th className="px-1 py-1 text-right font-semibold">Qty per 1 unit</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {mine.map((r) => (
                    <tr key={r.id} className="border-t border-border-subtle">
                      <td className="px-1 py-2">
                        <div className="font-mono text-[12px] font-semibold">{r.material_code}</div>
                        <div className="text-[12px] text-ink-secondary">{r.material_name}</div>
                      </td>
                      <td className="whitespace-nowrap px-1 py-2 text-right">
                        <input
                          key={r.qty} type="number" min="0" step="any" defaultValue={Number(r.qty)} aria-label={`Quantity of ${r.material_code}`}
                          className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-right text-[13px]"
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (n > 0 && n !== Number(r.qty)) update.mutate({ id: r.id, qty: n }, { onSuccess: () => toast.success(`${r.material_code}: ${fmtQty(n)}`), onError: refused("Quantity not saved") });
                          }}
                        />
                        <span className="ml-1 text-[11px] text-ink-muted">{r.uom ?? ""}</span>
                      </td>
                      <td className="px-1 py-2 text-right">
                        <button type="button" aria-label={`Remove ${r.material_code}`} onClick={() => void drop(r)} className="text-ink-muted hover:text-err"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_100px_auto]">
            <div className="min-w-0">
              <span className={FIELD_LABEL}>Add a raw material</span>
              <SearchableSelect
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px]" key={pickerKey} value={material} onChange={setMaterial} placeholder="Search raw materials" ariaLabel="Raw material"
                options={(materials.data ?? []).filter((m) => !taken.has(m.code)).map(skuOption)}
              />
            </div>
            <label className="block">
              <span className={FIELD_LABEL}>Qty per 1 unit</span>
              <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" className="h-9 w-full rounded-md border border-border bg-surface px-2 text-right text-[13px]" />
            </label>
            <Button variant="primary" icon={<Plus size={14} />} onClick={addOne} disabled={!material || !(Number(qty) > 0) || add.isPending}>{add.isPending ? "Adding…" : "Add"}</Button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-border-subtle bg-surface p-3">
          <p className={FIELD_LABEL}>SKUs with a composition ({bound.length})</p>
          {rows.isLoading ? <p className="text-[13px] text-ink-muted">Loading…</p> : rows.error ? (
            <p role="alert" className="text-[13px] text-err">The compositions could not be loaded.</p>
          ) : bound.length === 0 ? (
            <p className="text-[13px] text-ink-muted">None yet. Choose a SKU above to start.</p>
          ) : (
            <ul className="flex flex-col">
              {bound.map((b) => (
                <li key={b.code} className="border-t border-border-subtle first:border-t-0">
                  <button type="button" onClick={() => setSku(b.code)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:text-primary">
                    <span className="min-w-0"><span className="font-mono text-[12px] font-semibold">{b.code}</span> <span className="text-[12.5px] text-ink-secondary">{b.name}</span></span>
                    <span className="shrink-0 text-[12px] text-ink-muted">{b.n} material{b.n === 1 ? "" : "s"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
