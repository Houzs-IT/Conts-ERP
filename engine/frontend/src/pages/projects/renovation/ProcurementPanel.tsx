/* Procurement details (owner, 14 Oct 2026): a PO date and a delivery date per
   product category, and per sub-category under it. A sub-category follows its
   category unless set to its own dates or to no dates; following ones change with
   the category. The server computes the effective dates (GET/PUT
   /api/renovation/:id/procurement) and answers every save with the whole list.
   Later these dates will raise purchase orders automatically; nothing does yet.
   Under each row (batch 4, mig 0116): the POs raised for that category / sub-category (one category per PO), their
   goods receipts, the actual dates and a late flag (GET /api/renovation/:id/documents). The planned dates stay the plan. */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, PackageCheck } from "lucide-react";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { simpleApi, type ProcGroup, type ProcMode, type ProcSub } from "./simpleApi";
import { errorText } from "./renovationModel";
import { smallInput } from "./renovationUi";
import { subDateEdit } from "./designModel";
import { posForRow, rowSummary, todayKl, type ProjectGr, type ProjectPo } from "./projectDocsModel";
import { ActualLine, PoList, RowBadges, SalesDocs } from "./ProcurementPos";
import { renovationApi, type PodPhoto } from "./renovationApi";


export function ProcurementPanel({ projectId, canWrite, onError, showMoney = true }: { projectId: number; canWrite: boolean; onError: (t: string) => void; showMoney?: boolean }) {
  const q = useQuery(["renovation", "procurement", projectId], () => simpleApi.procurement(projectId), [projectId]);
  const [groups, setGroups] = useState<ProcGroup[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  /* A category with POs or its own sub dates opens on those sub-categories only (owner: no long open lists). */
  const [allSubs, setAllSubs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  useEffect(() => { if (q.data) setGroups(q.data.groups); }, [q.data]);
  const docs = useQuery(["renovation", "documents", projectId], () => simpleApi.documents(projectId), [projectId]);
  const pos: ProjectPo[] = docs.data?.ready ? docs.data.purchaseOrders ?? [] : [];
  const grs: ProjectGr[] = docs.data?.ready ? docs.data.goodsReceipts ?? [] : [];
  const today = todayKl();
  /* Site receipt photos (proof of delivery) by goods receipt, shown under each PO's GR. */
  const pod = useQuery(["renovation", "pod", projectId], () => renovationApi.pod(projectId), [projectId]);
  const photosByGrn = new Map<string, PodPhoto[]>();
  for (const room of pod.data?.rooms ?? []) for (const ph of room.photos) if (ph.grn_id) photosByGrn.set(ph.grn_id, [...(photosByGrn.get(ph.grn_id) ?? []), ph]);

  async function save(fn: () => Promise<{ groups: ProcGroup[] }>) {
    setBusy(true);
    try { setGroups((await fn()).groups); } catch (e) { onError(errorText(e)); setGroups((g) => (g ? [...g] : g)); } finally { setBusy(false); }
  }
  const toggle = (code: string) => setOpen((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><PackageCheck size={14} />Procurement details</h3>
        <label className="flex items-center gap-1 text-[11px] text-ink-secondary">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />Show only changed
        </label>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-secondary">The project's documents, then the PO and delivery date per category with its POs and receipts. Type a sub-category date to give it its own; empty both for no dates.</p>
      {docs.data?.ready && <SalesDocs d={docs.data} showMoney={showMoney} />}
      {q.error && !groups && <p role="alert" className="mt-2 text-xs text-err">Procurement dates could not be loaded: {q.error}</p>}
      {!groups && !q.error && <p className="mt-2 text-xs text-ink-secondary">Loading...</p>}
      {groups && (
        <>
        <div aria-hidden className="mt-2 hidden grid-cols-[minmax(0,1fr)_8rem_8.5rem_8.5rem] gap-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary sm:grid">
          <span className="col-span-2">Category</span><span>PO date</span><span>Delivery date</span>
        </div>
        <ul className="mt-1 divide-y divide-border rounded-md border border-border">
          {onlyChanged && !groups.some((g) => g.poDate || g.deliveryDate || g.subs.some((s) => s.mode !== "follow")) && (
            <li className="px-2 py-2 text-xs text-ink-secondary">No dates set yet.</li>
          )}
          {groups.map((g) => {
            const subCodes = g.subs.map((s) => s.code);
            const groupPos = pos.filter((p) => p.categoryGroup === g.code);
            const ownPos = posForRow(pos, g.code, null, subCodes);
            const sum = rowSummary(groupPos, g.deliveryDate, today);
            const changed = g.subs.filter((s) => s.mode !== "follow" || posForRow(pos, g.code, s.code, subCodes).length > 0);
            if (onlyChanged && !g.poDate && !g.deliveryDate && changed.length === 0 && groupPos.length === 0) return null;
            const focused = !onlyChanged && changed.length > 0 && changed.length < g.subs.length && !allSubs.has(g.code);
            const subs = onlyChanged || focused ? changed : g.subs;
            const isOpen = onlyChanged ? changed.length > 0 || ownPos.length > 0 : open.has(g.code);
            const own = g.subs.filter((s) => s.mode !== "follow").length;
            return (
              <li key={g.code} className="px-2 py-1.5">
                <div className="grid grid-cols-2 items-center gap-1 sm:grid-cols-[minmax(0,1fr)_8rem_8.5rem_8.5rem]">
                  <button type="button" onClick={() => toggle(g.code)} aria-expanded={isOpen} disabled={(g.subs.length === 0 && groupPos.length === 0) || onlyChanged}
                    className="col-span-2 flex min-w-0 flex-wrap items-center gap-1 text-left">
                    {g.subs.length > 0 || groupPos.length > 0 ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="w-[13px]" />}
                    <span className="truncate text-xs font-semibold text-ink">{g.label}</span>
                    {g.subs.length > 0 && <span className="shrink-0 text-[10px] text-ink-secondary">{g.subs.length} sub{own ? ` · ${own} changed` : ""}</span>}
                    <RowBadges s={sum} />
                  </button>
                  <DateBox label={`${g.label} PO date`} caption="PO" value={g.poDate} disabled={!canWrite || busy}
                    onChange={(v) => save(() => simpleApi.setCategoryDates(projectId, g.code, { poDate: v, deliveryDate: g.deliveryDate }))} />
                  <DateBox label={`${g.label} delivery date`} caption="Delivery" value={g.deliveryDate} min={g.poDate} disabled={!canWrite || busy}
                    onChange={(v) => save(() => simpleApi.setCategoryDates(projectId, g.code, { poDate: g.poDate, deliveryDate: v }))} />
                </div>
                <ActualLine s={sum} />
                {isOpen && (
                  <ul className="mt-1 space-y-1 border-t border-dashed border-border pt-1">
                    {ownPos.length > 0 && <li><PoList projectId={projectId} pos={ownPos} grs={grs} photosByGrn={photosByGrn} /></li>}
                    {subs.map((s) => {
                      const subPos = posForRow(pos, g.code, s.code, subCodes);
                      return <SubRow key={s.code} projectId={projectId} photosByGrn={photosByGrn} s={s} canWrite={canWrite} busy={busy} pos={subPos} grs={grs} today={today}
                        onSave={(b) => save(() => simpleApi.setSubDates(projectId, g.code, s.code, b))} />;
                    })}
                    {focused && (
                      <li className="pl-4">
                        <button type="button" onClick={() => setAllSubs((x) => new Set(x).add(g.code))} className="text-[11px] font-semibold text-primary hover:underline">
                          Show all {g.subs.length} sub-categories
                        </button>
                      </li>
                    )}
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

/* Owner, 14 Oct 2026: no mode dropdown. Typing a date makes the sub-category its own; emptying both dates means no
   dates; "follow category" (shown only when it differs) resets it. Following rows show the category's dates muted. */
function SubRow({ projectId, photosByGrn, s, canWrite, busy, onSave, pos, grs, today }: {
  projectId: number; photosByGrn: ReadonlyMap<string, PodPhoto[]>;
  s: ProcSub; canWrite: boolean; busy: boolean; onSave: (b: { mode: ProcMode; poDate?: string | null; deliveryDate?: string | null }) => void;
  pos: ProjectPo[]; grs: ProjectGr[]; today: string;
}) {
  const follows = s.mode === "follow";
  /* A sub-category with no dates and no PO is not late: nothing was planned for it. */
  const sum = rowSummary(pos, s.effective.deliveryDate, today);
  return (
    <li>
    <div className="grid grid-cols-2 items-center gap-1 sm:grid-cols-[minmax(0,1fr)_8rem_8.5rem_8.5rem]">
      <span className="flex min-w-0 flex-wrap items-center gap-1 pl-4 text-[11px] text-ink" title={s.label}>
        <span className="truncate">{s.label}</span>
        {!follows && <span className="shrink-0 rounded bg-primary/10 px-1 text-[9px] font-semibold uppercase text-primary">{s.mode === "none" ? "no dates" : "own"}</span>}
        {(pos.length > 0 || !follows) && <RowBadges s={sum} />}
      </span>
      <span className="text-right sm:text-left">
        {!follows && canWrite && (
          <button type="button" disabled={busy} onClick={() => onSave({ mode: "follow" })} aria-label={`${s.label}: follow the category`}
            className="text-[11px] text-primary hover:underline disabled:opacity-50">&#8634; follow category</button>
        )}
      </span>
      <DateBox label={`${s.label} PO date`} caption="PO" value={s.effective.poDate} muted={follows} disabled={!canWrite || busy}
        onChange={(v) => onSave(subDateEdit(s, "po", v))} />
      <DateBox label={`${s.label} delivery date`} caption="Delivery" value={s.effective.deliveryDate} min={s.effective.poDate} muted={follows} disabled={!canWrite || busy}
        onChange={(v) => onSave(subDateEdit(s, "delivery", v))} />
    </div>
    <ActualLine s={sum} indent />
    <PoList projectId={projectId} pos={pos} grs={grs} photosByGrn={photosByGrn} indent />
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
