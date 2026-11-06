/* The one way to add raw materials (owner, 5 Nov 2026), on SKU Composition and on a production order: search, tick as
   many as needed, set each quantity, add them together. A material missing from the list can be created here. */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { useNotify } from "../../vendor/scm/components/NotifyDialog";
import { useToast } from "../../hooks/useToast";
import { useCreateMfgProduct, type NewMfgProductInput } from "../../vendor/scm/lib/mfg-products-queries";

export interface RawSku { code: string; name: string | null; uom?: string | null }
export interface RawPick { code: string; qty: number }

const LABEL = "font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted";
const INPUT = "h-8 w-full rounded-md border border-border bg-surface px-2 text-[13px]";
const ROW = "grid grid-cols-[24px_minmax(0,1fr)_44px_84px] items-center gap-2 px-2";

export function RawMaterialAddPanel({ skus, taken, qtyLabel = "Qty", seed, extra, footnote, onAdd, onCancel }: {
  skus: readonly RawSku[];
  /** Already on this document: not offered again. */
  taken?: ReadonlySet<string>;
  qtyLabel?: string;
  /** Ticks these with these quantities (copy from another SKU); a new object applies again. */
  seed?: Record<string, string>;
  /** Fields that apply to everything ticked (dates, a remark). */
  extra?: ReactNode;
  footnote?: ReactNode;
  onAdd: (picks: RawPick[]) => Promise<void>;
  onCancel?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ code: string; name: string; uom: string } | null>(null);
  const createSku = useCreateMfgProduct();
  const qc = useQueryClient();
  const notify = useNotify();
  const toast = useToast();

  useEffect(() => { if (seed) setPicked((p) => ({ ...p, ...seed })); }, [seed]);

  const offered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return skus
      .filter((s) => !taken?.has(s.code))
      .filter((s) => !term || `${s.code} ${s.name ?? ""}`.toLowerCase().includes(term));
  }, [skus, taken, search]);
  const codes = Object.keys(picked);
  const valid = codes.length > 0 && codes.every((c) => Number(picked[c]) > 0);

  const toggle = (code: string) => setPicked((p) => {
    if (code in p) { const { [code]: _gone, ...rest } = p; return rest; }
    return { ...p, [code]: "1" };
  });
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onAdd(codes.map((code) => ({ code, qty: Number(picked[code]) })));
      setPicked({});
      setSearch("");
    } catch (e) {
      notify({ title: "Raw material not added", body: e instanceof Error ? e.message : "Something went wrong.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const create = () => {
    if (!draft) return;
    const body = { code: draft.code.trim().toUpperCase(), name: draft.name.trim(), category: "RAW", subCategory: "OTHER_RAW", uom: draft.uom.trim() || "PCS" } as NewMfgProductInput;
    createSku.mutate(body, {
      onSuccess: (r) => {
        void qc.invalidateQueries({ queryKey: ["production-raw-skus"] });
        setPicked((p) => ({ ...p, [r.code]: "1" }));
        setDraft(null);
        toast.success(`${r.code} created`);
      },
      onError: (e) => { notify({ title: "Raw material not created", body: e instanceof Error ? e.message : "Something went wrong.", tone: "error" }); },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <input aria-label="Search raw materials" className={INPUT} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search raw materials by code or name" />
      <div className="overflow-hidden rounded-md border border-border">
        <div className={`${ROW} border-b border-border bg-surface-2 py-1.5`}>
          <span /><span className={LABEL}>Raw material</span><span className={LABEL}>Unit</span><span className={`${LABEL} text-right`}>{qtyLabel}</span>
        </div>
        <div role="group" aria-label="Raw materials" className="max-h-[260px] overflow-y-auto">
          {offered.map((s) => {
            const on = s.code in picked;
            return (
              <label key={s.code} className={`${ROW} cursor-pointer border-b border-border-subtle py-1 last:border-b-0 ${on ? "bg-accent/10" : "hover:bg-surface-2"}`}>
                <input type="checkbox" aria-label={s.name ? `${s.code} · ${s.name}` : s.code} checked={on} onChange={() => toggle(s.code)} />
                <span className="min-w-0">
                  <span className="block break-words text-[12.5px] font-semibold text-ink">{s.name || s.code}</span>
                  <span className="block font-mono text-[11px] text-ink-muted">{s.code}</span>
                </span>
                <span className="text-[12px] text-ink-muted">{s.uom ?? ""}</span>
                {on ? (
                  <input
                    type="number" min="0" step="any" aria-label={`New quantity of ${s.code}`} value={picked[s.code]}
                    onFocus={(e) => e.currentTarget.select()} onChange={(e) => setPicked((p) => ({ ...p, [s.code]: e.target.value }))}
                    className="h-7 w-full rounded-md border border-border bg-surface px-2 text-right text-[13px]"
                  />
                ) : <span />}
              </label>
            );
          })}
          {offered.length === 0 && <p className="px-3 py-3 text-[12.5px] text-ink-muted">No raw material matches.</p>}
        </div>
      </div>

      {draft ? (
        <div className="grid grid-cols-1 items-end gap-2 rounded-md border border-border-subtle bg-surface-2 p-2 sm:grid-cols-[130px_minmax(0,1fr)_72px_auto_auto]">
          <label className="block"><span className={LABEL}>New code</span><input aria-label="New raw material code" className={INPUT} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></label>
          <label className="block"><span className={LABEL}>Name</span><input aria-label="New raw material name" className={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="block"><span className={LABEL}>Unit</span><input aria-label="New raw material unit" className={INPUT} value={draft.uom} onChange={(e) => setDraft({ ...draft, uom: e.target.value })} /></label>
          <Button onClick={create} disabled={!draft.code.trim() || !draft.name.trim() || createSku.isPending}>{createSku.isPending ? "Creating…" : "Create"}</Button>
          <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
        </div>
      ) : (
        <p className="text-[11.5px] text-ink-muted">
          Not on the list?{" "}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setDraft({ code: "", name: "", uom: "PCS" })}>Create a new raw material</button>
        </p>
      )}

      {extra}
      {footnote && <p className="text-[11.5px] text-ink-muted">{footnote}</p>}

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[12px] text-ink-secondary">{codes.length} ticked</span>
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={busy}>Close</Button>}
        <Button icon={<Plus size={14} />} onClick={() => void submit()} disabled={!valid || busy}>
          {busy ? "Adding…" : codes.length > 1 ? `Add ${codes.length} raw materials` : "Add raw material"}
        </Button>
      </div>
    </div>
  );
}
