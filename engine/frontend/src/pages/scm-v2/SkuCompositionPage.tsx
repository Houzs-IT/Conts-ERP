/* Production > SKU Composition (owner, 5 Nov 2026): what one unit of a SKU uses. A project's line reads this times its
   qty until someone changes that line's own list, so setting it here saves picking the materials on every project. */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { fmtQty } from "@2990s/shared";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/Layout";
import { SearchableSelect } from "../../vendor/scm/components/SearchableSelect";
import { useConfirm } from "../../vendor/scm/components/ConfirmDialog";
import { useNotify } from "../../vendor/scm/components/NotifyDialog";
import { useToast } from "../../hooks/useToast";
import { useCreateMfgProduct, type NewMfgProductInput } from "../../vendor/scm/lib/mfg-products-queries";
import {
  useAddComposition, useCompositionSkus, useDeleteComposition, useRawSkus, useSkuCompositions, useUpdateComposition, type CompositionRow,
} from "../../vendor/scm/lib/production-order-queries";

const FIELD_LABEL = "mb-1 block font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted";
const INPUT = "h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px]";
type Sku = { code: string; name: string | null; uom?: string | null };
const skuLabel = (s: Sku) => (s.name ? `${s.code} · ${s.name}` : s.code);
const skuOption = (s: Sku) => ({ value: s.code, label: skuLabel(s) });

export function SkuCompositionPage() {
  const rows = useSkuCompositions();
  const skus = useCompositionSkus();
  const materials = useRawSkus(true);
  const add = useAddComposition();
  const update = useUpdateComposition();
  const remove = useDeleteComposition();
  const createSku = useCreateMfgProduct();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const notify = useNotify();
  const toast = useToast();
  /* null: the list. "": a new composition, its SKU not chosen yet. */
  const [sku, setSku] = useState<string | null>(null);
  const [listSearch, setListSearch] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [newSku, setNewSku] = useState<{ code: string; name: string; uom: string } | null>(null);

  const all = useMemo(() => rows.data ?? [], [rows.data]);
  const mine = all.filter((r) => r.sku_code === sku);
  const bound = useMemo(() => {
    const m = new Map<string, { code: string; name: string | null; materials: string[] }>();
    for (const r of all) {
      const b = m.get(r.sku_code) ?? { code: r.sku_code, name: r.sku_name, materials: [] };
      b.materials.push(r.material_code);
      m.set(r.sku_code, b);
    }
    return [...m.values()];
  }, [all]);
  const term = listSearch.trim().toLowerCase();
  const shownBound = bound.filter((b) => !term || `${b.code} ${b.name ?? ""} ${b.materials.join(" ")}`.toLowerCase().includes(term));
  const taken = new Set(mine.map((r) => r.material_code));
  const rawTerm = search.trim().toLowerCase();
  const rawSkus = (materials.data ?? []).filter((m) => !taken.has(m.code));
  const shownRaw = rawSkus.filter((m) => !rawTerm || skuLabel(m).toLowerCase().includes(rawTerm));
  const pickedCodes = Object.keys(picked);
  const pickedValid = pickedCodes.length > 0 && pickedCodes.every((c) => Number(picked[c]) > 0);
  const nameOf = (code: string) => (materials.data ?? []).find((m) => m.code === code);
  const refused = (title: string) => (e: unknown) => notify({ title, body: e instanceof Error ? e.message : "Something went wrong.", tone: "error" });

  const open = (code: string | null) => { setSku(code); setPicked({}); setSearch(""); setNewSku(null); };
  const toggle = (code: string) => setPicked((p) => {
    if (code in p) { const { [code]: _gone, ...rest } = p; return rest; }
    return { ...p, [code]: "1" };
  });
  const saveAll = async () => {
    if (!sku || !pickedValid || saving) return;
    setSaving(true);
    const done: string[] = [];
    try {
      for (const code of pickedCodes) {
        await add.mutateAsync({ skuCode: sku, materialCode: code, qty: Number(picked[code]) });
        done.push(code);
      }
      toast.success(`${done.length} raw material${done.length === 1 ? "" : "s"} added to ${sku}`);
      setPicked({});
      setSearch("");
    } catch (e) {
      /* Those already saved leave the list, so pressing again adds only the rest. */
      setPicked((p) => Object.fromEntries(Object.entries(p).filter(([c]) => !done.includes(c))));
      refused("Raw material not added")(e);
    } finally {
      setSaving(false);
    }
  };
  const makeSku = () => {
    if (!newSku) return;
    const body = { code: newSku.code.trim().toUpperCase(), name: newSku.name.trim(), category: "RAW", subCategory: "OTHER_RAW", uom: newSku.uom.trim().toUpperCase() } as NewMfgProductInput;
    createSku.mutate(body, {
      onSuccess: (r) => {
        void qc.invalidateQueries({ queryKey: ["production-raw-skus"] });
        setPicked((p) => ({ ...p, [r.code]: "1" }));
        setNewSku(null);
        toast.success(`${r.code} created`);
      },
      onError: refused("Raw material not created"),
    });
  };
  /* Starts from what another SKU uses: the quantities stay editable before anything is saved. */
  const copyFrom = (code: string) => {
    const from = all.filter((r) => r.sku_code === code && !taken.has(r.material_code));
    setPicked((p) => ({ ...p, ...Object.fromEntries(from.map((r) => [r.material_code, String(Number(r.qty))])) }));
  };
  const dropAll = async (code: string, count: number) => {
    if (!(await confirm({ title: `Delete the composition of ${code}?`, body: `All ${count} raw material${count === 1 ? "" : "s"} leave it. Lines already saved on a project keep their own list.`, confirmLabel: "Delete" }))) return;
    try {
      for (const r of all.filter((x) => x.sku_code === code)) await remove.mutateAsync(r.id);
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Production"
        title="SKU Composition"
        description="Set the raw materials one unit of a SKU uses. Projects with that SKU bring them in by themselves."
        primaryAction={sku === null ? <Button icon={<Plus size={14} />} onClick={() => open("")}>New composition</Button> : undefined}
      />

      {sku === null ? (
        <div className="rounded-md border border-border-subtle bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className={`${FIELD_LABEL} mb-0`}>SKUs with a composition ({bound.length})</p>
            <input aria-label="Search compositions" value={listSearch} onChange={(e) => setListSearch(e.target.value)} placeholder="Search SKU or raw material" className={`${INPUT} sm:w-[280px]`} />
          </div>
          {rows.isLoading ? <p className="text-[13px] text-ink-muted">Loading…</p> : rows.error ? (
            <p role="alert" className="text-[13px] text-err">The compositions could not be loaded.</p>
          ) : bound.length === 0 ? (
            <p className="text-[13px] text-ink-muted">None yet. Press New composition to start.</p>
          ) : shownBound.length === 0 ? (
            <p className="text-[13px] text-ink-muted">Nothing matches.</p>
          ) : (
            <ul className="flex flex-col">
              {shownBound.map((b) => (
                <li key={b.code} className="flex items-center gap-2 border-t border-border-subtle py-1.5 first:border-t-0">
                  <button type="button" onClick={() => open(b.code)} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:text-primary">
                    <span className="min-w-0"><span className="font-mono text-[12px] font-semibold">{b.code}</span> <span className="text-[12.5px] text-ink-secondary">{b.name}</span></span>
                    <span className="shrink-0 text-[12px] text-ink-muted">{b.materials.length} material{b.materials.length === 1 ? "" : "s"}</span>
                  </button>
                  <Button variant="secondary" icon={<Pencil size={14} />} onClick={() => open(b.code)} aria-label={`Edit ${b.code}`}>Edit</Button>
                  <Button variant="secondary" icon={<Trash2 size={14} />} onClick={() => void dropAll(b.code, b.materials.length)} aria-label={`Delete ${b.code}`}>Delete</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <Button variant="secondary" icon={<ArrowLeft size={14} />} onClick={() => open(null)}>All compositions</Button>
          </div>

          <div className="max-w-[640px]">
            <span className={FIELD_LABEL}>SKU</span>
            <SearchableSelect className={INPUT} value={sku} onChange={(v) => open(v)} options={(skus.data ?? []).map(skuOption)} placeholder="Search SKUs" ariaLabel="SKU" />
          </div>

          {!sku ? (
            <p className="text-[13px] text-ink-muted">Choose the SKU, then tick its raw materials.</p>
          ) : (
            <>
              <div className="rounded-md border border-border-subtle bg-surface p-3">
                {mine.length > 0 && (
                  <div className="mb-2 flex justify-end">
                    <Button variant="secondary" icon={<Trash2 size={14} />} onClick={() => void dropAll(sku, mine.length)}>Delete composition</Button>
                  </div>
                )}
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
                                onFocus={(e) => e.currentTarget.select()}
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
              </div>

              <div className="rounded-md border border-border-subtle bg-surface p-3">
                <p className={FIELD_LABEL}>Add raw materials: tick one or as many as you need</p>
                <input aria-label="Search raw materials" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search raw materials" className={INPUT} />
                {bound.some((b) => b.code !== sku) && (
                  <div className="mt-2 max-w-[420px]">
                    <span className={FIELD_LABEL}>Or copy from another SKU</span>
                    <SearchableSelect
                      className={INPUT} value="" onChange={copyFrom} placeholder="Choose a SKU to copy" ariaLabel="Copy from another SKU"
                      options={bound.filter((b) => b.code !== sku).map(skuOption)}
                    />
                  </div>
                )}
                <div role="group" aria-label="Raw materials" className="mt-2 max-h-[240px] overflow-y-auto rounded-md border border-border-subtle">
                  {shownRaw.map((m) => (
                    <label key={m.code} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[13px] hover:bg-accent/10">
                      <input type="checkbox" checked={m.code in picked} onChange={() => toggle(m.code)} />
                      <span className="min-w-0">{skuLabel(m)}</span>
                    </label>
                  ))}
                  {shownRaw.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-ink-muted">No raw material matches.</p>}
                </div>

                {newSku ? (
                  <div className="mt-2 grid grid-cols-1 items-end gap-2 sm:grid-cols-[140px_minmax(0,1fr)_80px_auto_auto]">
                    <label className="block"><span className={FIELD_LABEL}>Code</span>
                      <input value={newSku.code} onChange={(e) => setNewSku({ ...newSku, code: e.target.value })} className={INPUT} /></label>
                    <label className="block"><span className={FIELD_LABEL}>Name</span>
                      <input value={newSku.name} onChange={(e) => setNewSku({ ...newSku, name: e.target.value })} className={INPUT} /></label>
                    <label className="block"><span className={FIELD_LABEL}>Unit</span>
                      <input value={newSku.uom} onChange={(e) => setNewSku({ ...newSku, uom: e.target.value })} className={INPUT} /></label>
                    <Button onClick={makeSku} disabled={!newSku.code.trim() || !newSku.name.trim() || createSku.isPending}>{createSku.isPending ? "Creating…" : "Create"}</Button>
                    <Button variant="secondary" onClick={() => setNewSku(null)}>Cancel</Button>
                  </div>
                ) : (
                  <p className="mt-2 text-[11.5px] text-ink-muted">
                    Not on the list?{" "}
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setNewSku({ code: "", name: "", uom: "PCS" })}>Create a new raw material</button>
                  </p>
                )}

                {pickedCodes.length > 0 && (
                  <div className="mt-3 border-t border-border-subtle pt-2">
                    <p className={FIELD_LABEL}>Qty per 1 unit</p>
                    {pickedCodes.map((code) => (
                      <div key={code} className="flex items-center gap-2 py-1">
                        <span className="min-w-0 flex-1 text-[13px]">{nameOf(code) ? skuLabel(nameOf(code)!) : code}</span>
                        <input
                          type="number" min="0" step="any" value={picked[code]} aria-label={`New quantity of ${code}`}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => setPicked((p) => ({ ...p, [code]: e.target.value }))}
                          className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-right text-[13px]"
                        />
                        <button type="button" aria-label={`Untick ${code}`} onClick={() => toggle(code)} className="text-ink-muted hover:text-err"><Trash2 size={14} /></button>
                      </div>
                    ))}
                    <div className="mt-2 flex items-center gap-2">
                      <Button variant="secondary" onClick={() => setPicked({})} disabled={saving}>Cancel</Button>
                      <Button icon={<Plus size={14} />} onClick={() => void saveAll()} disabled={!pickedValid || saving}>
                        {saving ? "Adding…" : `Add ${pickedCodes.length} raw material${pickedCodes.length === 1 ? "" : "s"}`}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
