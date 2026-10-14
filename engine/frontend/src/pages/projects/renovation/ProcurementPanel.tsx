/* Procurement details (owner, 14 Oct 2026): a PO date and a delivery date per
   product category, and per sub-category under it. A sub-category follows its
   category unless set to its own dates or to no dates; following ones change with
   the category. The server computes the effective dates (GET/PUT
   /api/renovation/:id/procurement) and answers every save with the whole list.
   Later these dates will raise purchase orders automatically; nothing does yet. */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, PackageCheck } from "lucide-react";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { simpleApi, type ProcGroup, type ProcMode, type ProcSub } from "./simpleApi";
import { errorText } from "./renovationModel";
import { smallInput } from "./renovationUi";

const MODE_LABEL: Record<ProcMode, string> = { follow: "Follow category", own: "Own dates", none: "No dates" };

export function ProcurementPanel({ projectId, canWrite, onError }: { projectId: number; canWrite: boolean; onError: (t: string) => void }) {
  const q = useQuery(["renovation", "procurement", projectId], () => simpleApi.procurement(projectId), [projectId]);
  const [groups, setGroups] = useState<ProcGroup[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setGroups(q.data.groups); }, [q.data]);

  async function save(fn: () => Promise<{ groups: ProcGroup[] }>) {
    setBusy(true);
    try { setGroups((await fn()).groups); } catch (e) { onError(errorText(e)); setGroups((g) => (g ? [...g] : g)); } finally { setBusy(false); }
  }
  const toggle = (code: string) => setOpen((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><PackageCheck size={14} />Procurement details</h3>
      <p className="mt-0.5 text-[11px] text-ink-secondary">PO and delivery date per category. Sub-categories follow their category unless given their own dates.</p>
      {q.error && !groups && <p role="alert" className="mt-2 text-xs text-err">Procurement dates could not be loaded: {q.error}</p>}
      {!groups && !q.error && <p className="mt-2 text-xs text-ink-secondary">Loading...</p>}
      {groups && (
        <>
        <div aria-hidden className="mt-2 hidden grid-cols-[minmax(0,1fr)_8rem_8.5rem_8.5rem] gap-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary sm:grid">
          <span className="col-span-2">Category</span><span>PO date</span><span>Delivery date</span>
        </div>
        <ul className="mt-1 divide-y divide-border rounded-md border border-border">
          {groups.map((g) => {
            const isOpen = open.has(g.code);
            const own = g.subs.filter((s) => s.mode !== "follow").length;
            return (
              <li key={g.code} className="px-2 py-1.5">
                <div className="grid grid-cols-2 items-center gap-1 sm:grid-cols-[minmax(0,1fr)_8rem_8.5rem_8.5rem]">
                  <button type="button" onClick={() => toggle(g.code)} aria-expanded={isOpen} disabled={g.subs.length === 0}
                    className="col-span-2 flex min-w-0 items-center gap-1 text-left">
                    {g.subs.length > 0 ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="w-[13px]" />}
                    <span className="truncate text-xs font-semibold text-ink">{g.label}</span>
                    {g.subs.length > 0 && <span className="shrink-0 text-[10px] text-ink-secondary">{g.subs.length} sub{own ? ` · ${own} own` : ""}</span>}
                  </button>
                  <DateBox label={`${g.label} PO date`} caption="PO" value={g.poDate} disabled={!canWrite || busy}
                    onChange={(v) => save(() => simpleApi.setCategoryDates(projectId, g.code, { poDate: v, deliveryDate: g.deliveryDate }))} />
                  <DateBox label={`${g.label} delivery date`} caption="Delivery" value={g.deliveryDate} min={g.poDate} disabled={!canWrite || busy}
                    onChange={(v) => save(() => simpleApi.setCategoryDates(projectId, g.code, { poDate: g.poDate, deliveryDate: v }))} />
                </div>
                {isOpen && (
                  <ul className="mt-1 space-y-1 border-t border-dashed border-border pt-1">
                    {g.subs.map((s) => <SubRow key={s.code} g={g} s={s} canWrite={canWrite} busy={busy}
                      onSave={(b) => save(() => simpleApi.setSubDates(projectId, g.code, s.code, b))} />)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        </>
      )}
    </section>
  );
}

function SubRow({ g, s, canWrite, busy, onSave }: { g: ProcGroup; s: ProcSub; canWrite: boolean; busy: boolean; onSave: (b: { mode: ProcMode; poDate?: string | null; deliveryDate?: string | null }) => void }) {
  const own = s.mode === "own";
  return (
    <li className="grid grid-cols-2 items-center gap-1 sm:grid-cols-[minmax(0,1fr)_8rem_8.5rem_8.5rem]">
      <span className="truncate pl-4 text-[11px] text-ink" title={s.label}>{s.label}</span>
      <select aria-label={`${s.label} dates`} className={smallInput} value={s.mode} disabled={!canWrite || busy}
        onChange={(e) => {
          const mode = e.target.value as ProcMode;
          onSave(mode === "own" ? { mode, poDate: s.effective.poDate ?? g.poDate, deliveryDate: s.effective.deliveryDate ?? g.deliveryDate } : { mode });
        }}>
        {(Object.keys(MODE_LABEL) as ProcMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
      </select>
      <DateBox label={`${s.label} PO date`} caption="PO" value={s.effective.poDate} muted={!own} disabled={!canWrite || busy || !own}
        onChange={(v) => onSave({ mode: "own", poDate: v, deliveryDate: s.stored.deliveryDate })} />
      <DateBox label={`${s.label} delivery date`} caption="Delivery" value={s.effective.deliveryDate} min={s.effective.poDate} muted={!own} disabled={!canWrite || busy || !own}
        onChange={(v) => onSave({ mode: "own", poDate: s.stored.poDate, deliveryDate: v })} />
    </li>
  );
}

function DateBox({ label, caption, value, min, disabled, muted, onChange }: {
  label: string; caption: string; value: string | null; min?: string | null; disabled?: boolean; muted?: boolean; onChange: (v: string | null) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] text-ink-secondary sm:hidden">{caption}</span>
      <input type="date" aria-label={label} title={label} value={value ?? ""} min={min ?? undefined} disabled={disabled}
        className={cn(smallInput, muted && "text-ink-secondary")}
        onChange={(e) => { if ((e.target.value || null) !== value) onChange(e.target.value || null); }} />
    </label>
  );
}
