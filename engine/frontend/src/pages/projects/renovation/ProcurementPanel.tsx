/* Procurement details (owner, 14-16 Oct 2026). Per product category, and per sub-category under it:
   - the planned PO date and delivery date (the plan; GET/PUT /api/renovation/:id/procurement). A sub-category
     follows its category unless it has its own dates or no dates; a following one shows the category's dates greyed.
   - where its goods stand: of the project's item lines, how many are Ordered -> Received -> Delivered, with the
     purchase orders, goods receipts and delivery orders behind them (GET /api/renovation/:id/procurement-status).
     A sub-category is Ready when everything ordered in it has been received and delivered; a category when every
     sub-category with items is. LATE when the planned delivery date has passed and it is not Ready.
   The categories and sub-categories come from the project's sales orders (owner, 16 Oct 2026: "nobody needs Plan
   another sub-category"): only those its SO lines (or its own POs) have are listed, plus any that already carry
   planned dates, so a date typed earlier is never hidden. With no sales order the card asks for one instead of
   listing empty rows. No item, PO or SO rows (owner, 15 Oct 2026).
   Later these dates will raise purchase orders automatically; nothing does yet. */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, PackageCheck } from "lucide-react";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { simpleApi, type ProcGroup, type ProcMode, type ProcSub } from "./simpleApi";
import { errorText } from "./renovationModel";
import { smallInput } from "./renovationUi";
import { subDateEdit } from "./designModel";
import { todayKl } from "./projectDocsModel";
import { categoryStage, isLate, linesOf, stageOf, type Stage, type StatusLine } from "./procurementStatusModel";
import { DocLinks, StagePills } from "./ProcurementStatus";

const ROW = "grid grid-cols-2 items-center gap-1 sm:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem]";

/** The categories the card lists: those with item lines on the project's sales orders or POs, plus those that already
    carry planned dates. */
export function shownGroups(groups: readonly ProcGroup[], lines: readonly StatusLine[]): ProcGroup[] {
  return groups.filter((g) => lines.some((l) => l.categoryGroup === g.code) || !!g.poDate || !!g.deliveryDate || g.subs.some((s) => s.mode !== "follow"));
}

export function ProcurementPanel({ projectId, canWrite, onError }: { projectId: number; canWrite: boolean; onError: (t: string) => void; showMoney?: boolean }) {
  const q = useQuery(["renovation", "procurement", projectId], () => simpleApi.procurement(projectId), [projectId]);
  const st = useQuery(["renovation", "procurement-status", projectId], () => simpleApi.procurementStatus(projectId), [projectId]);
  const [groups, setGroups] = useState<ProcGroup[] | null>(null);
  /* Categories the user opened or closed against their default (open when it has items or sub-categories). */
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setGroups(q.data.groups); }, [q.data]);
  const lines: StatusLine[] = st.data?.ready ? st.data.lines : [];
  const today = todayKl();
  /* No sales order: nothing to plan from. An engine older than 16 Oct 2026 sends no count; then the rows show. */
  const noSo = st.data?.soCount === 0;
  const loading = (!groups && !q.error) || (st.loading && !st.data && !st.error);
  const list = groups && !noSo ? shownGroups(groups, lines) : [];

  async function save(fn: () => Promise<{ groups: ProcGroup[] }>) {
    setBusy(true);
    try { setGroups((await fn()).groups); } catch (e) { onError(errorText(e)); setGroups((g) => (g ? [...g] : g)); } finally { setBusy(false); }
  }
  const flip = (code: string) => setFlipped((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  return (
    <section id="reno-procurement" className="rounded-lg border border-border bg-surface p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><PackageCheck size={14} />Procurement details</h3>
      {!noSo && list.length > 0 && (
        <p className="mt-0.5 text-[11px] text-ink-secondary">The categories on this project's sales order, with planned PO and delivery dates and where the goods stand: ordered, received, delivered. Type a sub-category date to give it its own.</p>
      )}
      {q.error && !groups && <p role="alert" className="mt-2 text-xs text-err">Procurement dates could not be loaded: {q.error}</p>}
      {st.error && <p role="alert" className="mt-2 text-xs text-err">Where the goods stand could not be loaded: {st.error}</p>}
      {loading && <p className="mt-2 text-xs text-ink-secondary">Loading...</p>}
      {!loading && noSo && (
        <div className="mt-2 rounded-md border border-dashed border-border bg-surface-dim px-3 py-4 text-center" data-testid="proc-no-so">
          <p className="text-sm font-medium text-ink">Link a sales order to plan procurement</p>
          <p className="mt-0.5 text-[11px] text-ink-secondary">The categories to order come from the sales order's lines. Create a quotation or link an existing sales order in the Contract card.</p>
          <a href="#reno-contract" className="mt-1.5 inline-block text-[12px] font-semibold text-primary hover:underline">Go to Contract</a>
        </div>
      )}
      {!loading && groups && !noSo && list.length === 0 && (
        <p className="mt-2 text-xs text-ink-secondary" data-testid="proc-no-items">The sales order has no item lines with a product category yet.</p>
      )}
      {!loading && list.length > 0 && (
        <>
        <div aria-hidden className={cn(ROW, "mt-2 hidden px-2 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary sm:grid")}>
          <span>Category</span><span>PO date</span><span>Delivery date</span>
        </div>
        <ul className="mt-1 divide-y divide-border rounded-md border border-border">
          {list.map((g) => {
            const subCodes = g.subs.map((s) => s.code);
            const ownStage = stageOf(linesOf(lines, g.code, null, subCodes));
            const subRows = g.subs.map((s) => ({ s, stage: stageOf(linesOf(lines, g.code, s.code, subCodes)) }));
            const shown = subRows.filter((r) => r.stage.items > 0 || r.s.mode !== "follow");
            const cat = categoryStage([ownStage, ...subRows.map((r) => r.stage)]);
            const late = isLate(ownStage, g.deliveryDate, today) || subRows.some((r) => isLate(r.stage, r.s.effective.deliveryDate, today));
            const isOpen = (cat.items > 0 || shown.length > 0) !== flipped.has(g.code);
            return (
              <li key={g.code} className="px-2 py-1.5">
                <div className={ROW}>
                  <button type="button" onClick={() => flip(g.code)} aria-expanded={isOpen}
                    className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 text-left sm:col-span-1">
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className="truncate text-xs font-semibold text-ink">{g.label}</span>
                    <StagePills s={cat} late={late} />
                  </button>
                  <DateBox label={`${g.label} PO date`} caption="PO" value={g.poDate} disabled={!canWrite || busy}
                    onChange={(v) => save(() => simpleApi.setCategoryDates(projectId, g.code, { poDate: v, deliveryDate: g.deliveryDate }))} />
                  <DateBox label={`${g.label} delivery date`} caption="Delivery" value={g.deliveryDate} min={g.poDate} disabled={!canWrite || busy}
                    onChange={(v) => save(() => simpleApi.setCategoryDates(projectId, g.code, { poDate: g.poDate, deliveryDate: v }))} />
                </div>
                {isOpen && (
                  <ul className="mt-1 space-y-1.5 border-t border-dashed border-border pt-1.5">
                    {ownStage.items > 0 && (
                      <li>
                        <div className="flex flex-wrap items-center gap-1.5 pl-4 text-[11px] text-ink">
                          <span>{shown.length > 0 ? "No sub-category" : `All ${g.label.toLowerCase()} lines`}</span>
                          <StagePills s={ownStage} late={isLate(ownStage, g.deliveryDate, today)} />
                        </div>
                        <DocLinks s={ownStage} indent />
                      </li>
                    )}
                    {shown.map(({ s, stage }) => (
                      <SubRow key={s.code} s={s} stage={stage} today={today} canWrite={canWrite} busy={busy}
                        onSave={(b) => save(() => simpleApi.setSubDates(projectId, g.code, s.code, b))} />
                    ))}
                    {shown.length === 0 && ownStage.items === 0 && (
                      <li className="pl-4 text-[11px] text-ink-secondary">No {g.label.toLowerCase()} lines on the sales order; only the planned dates are kept.</li>
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

/* Owner, 15 Oct 2026: a sub-category that follows its category shows the category's dates greyed and says nothing
   else; typing a date gives it its own ("own dates"); "use the category's" puts it back. */
function SubRow({ s, stage, today, canWrite, busy, onSave }: {
  s: ProcSub; stage: Stage; today: string; canWrite: boolean; busy: boolean;
  onSave: (b: { mode: ProcMode; poDate?: string | null; deliveryDate?: string | null }) => void;
}) {
  const follows = s.mode === "follow";
  return (
    <li>
      <div className={ROW}>
        <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 pl-4 text-[11px] text-ink sm:col-span-1" title={s.label}>
          <span className="truncate">{s.label}</span>
          <StagePills s={stage} late={isLate(stage, s.effective.deliveryDate, today)} />
          {!follows && (
            <span className="text-[10px] text-ink-secondary">
              {s.mode === "none" ? "no dates" : "own dates"}
              {canWrite && <> · <button type="button" disabled={busy} onClick={() => onSave({ mode: "follow" })} className="text-primary hover:underline disabled:opacity-50">use the category's</button></>}
            </span>
          )}
        </span>
        <DateBox label={`${s.label} PO date`} caption="PO" value={s.effective.poDate} muted={follows} disabled={!canWrite || busy}
          onChange={(v) => onSave(subDateEdit(s, "po", v))} />
        <DateBox label={`${s.label} delivery date`} caption="Delivery" value={s.effective.deliveryDate} min={s.effective.poDate} muted={follows} disabled={!canWrite || busy}
          onChange={(v) => onSave(subDateEdit(s, "delivery", v))} />
      </div>
      <DocLinks s={stage} indent />
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
        className={cn(smallInput, muted && "border-dashed bg-surface-dim text-ink-secondary")}
        onChange={(e) => { if ((e.target.value || null) !== value) onChange(e.target.value || null); }} />
    </label>
  );
}
