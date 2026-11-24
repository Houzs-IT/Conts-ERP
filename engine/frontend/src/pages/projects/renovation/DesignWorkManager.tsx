/* Project Maintenance > Design work (owner, 19 Nov 2026; backend services/renovation/workTypes.ts, migration 0342).
   The works of a project in order: the calendar's Add work types, and, for the works in Design, the rows of Design
   progress and the steps of the Design stage. A bookable work picks a date and time and is done once its day has
   passed. The built-in works keep their own rule and cannot be removed. Variants is not a work: the system checks it
   after the list. */

import { useState, type DragEvent } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { simpleApi, type WorkTypeRow } from "./simpleApi";
import { errorText } from "./renovationModel";
import { inputClass } from "./renovationUi";

const RULE_TEXT: Record<WorkTypeRow["rule"], string> = {
  booking: "Done once its booked day has passed",
  measure: "Done once the booked measure day has passed, or a measure is recorded",
  approve_3d: "Done when Record approval is pressed",
  approve_2d: "Done when Record approval is pressed",
  payment_2: "Done when the second payment is received (no longer a work)",
};

export function DesignWorkManager() {
  const q = useQuery(["renovation", "work-types"], () => simpleApi.workTypes(), []);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [bookable, setBookable] = useState(true);
  const [inDesign, setInDesign] = useState(true);
  const [busy, setBusy] = useState(false);
  const rows = [...(q.data?.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try { await fn(); q.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  /* Drag a row to its place (owner, 19 Nov 2026); the list is renumbered 10, 20, 30 ... and only rows whose number
     changed are saved. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const move = (from: string, to: string) => run(async () => {
    const list = rows.map((w) => w.code);
    const at = list.indexOf(from), dest = list.indexOf(to);
    if (at < 0 || dest < 0 || at === dest) return;
    list.splice(dest, 0, ...list.splice(at, 1));
    for (const [i, code] of list.entries()) {
      const w = rows.find((x) => x.code === code)!;
      if (w.sortOrder !== (i + 1) * 10) await simpleApi.patchWorkType(code, { sortOrder: (i + 1) * 10 });
    }
  });

  return (
    <section className="rounded-md border border-border bg-surface p-4 sm:p-6 min-w-0">
      <h2 className="text-[10px] font-semibold uppercase tracking-brand text-accent">Design work</h2>
      <p className="mt-1 mb-4 text-[12px] text-ink-secondary">
        The works of a project, in order: drag a row to move it. Every work is a type in Add work on the calendar. Ticked under Show in Design progress, it is also a row of Design progress
        on the project page and a step of the Design stage. A bookable work is booked from Design progress or the calendar (date, time, who), shows on the calendar, and is done once its day has passed.
        Built-in works keep their own rule and cannot be removed. Variants is checked by the system after this list: done when every sales order line has its variants picked.
      </p>
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      {q.error && <p role="alert" className="mb-2 text-sm text-err">{q.error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-secondary">
              <th className="py-2 pr-2 font-semibold"><span className="sr-only">Drag to move</span></th>
              <th className="py-2 pr-2 font-semibold">Work</th>
              <th className="py-2 pr-2 font-semibold">Show in Design progress</th>
              <th className="py-2 pr-2 font-semibold">Bookable</th>
              <th className="py-2 pr-2 font-semibold">Complete when</th>
              <th className="py-2 pr-2 font-semibold">On</th>
              <th className="py-2 font-semibold"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <WorkRow key={w.code} w={w} busy={busy} dragging={dragging === w.code} over={over === w.code && dragging !== w.code}
                drag={{
                  onDragStart: () => setDragging(w.code),
                  onDragEnd: () => { setDragging(null); setOver(null); },
                  onDragOver: (e) => { e.preventDefault(); if (over !== w.code) setOver(w.code); },
                  onDrop: (e) => { e.preventDefault(); const from = dragging; setDragging(null); setOver(null); if (from) void move(from, w.code); },
                }}
                onSave={(patch) => void run(() => simpleApi.patchWorkType(w.code, patch))}
                onRemove={() => void run(async () => {
                  const r = await simpleApi.deleteWorkType(w.code);
                  if (r.archived) setError(`${w.label} is on ${r.entries} calendar entr${r.entries === 1 ? "y" : "ies"}, so it was switched off instead; those entries keep it.`);
                })} />
            ))}
          </tbody>
        </table>
      </div>
      <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4" onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void run(async () => { await simpleApi.createWorkType({ label: name.trim(), bookable, inDesign }); setName(""); });
      }}>
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-ink-secondary">New work
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lighting site check" maxLength={60} />
        </label>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={bookable} onChange={(e) => setBookable(e.target.checked)} /> Bookable (date and time)</label>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={inDesign} onChange={(e) => setInDesign(e.target.checked)} /> Show in Design progress</label>
        <Button type="submit" disabled={busy || !name.trim()} icon={<Plus size={15} />}>Add work</Button>
      </form>
    </section>
  );
}

interface DragHandlers {
  onDragStart: () => void; onDragEnd: () => void; onDragOver: (e: DragEvent<HTMLTableRowElement>) => void; onDrop: (e: DragEvent<HTMLTableRowElement>) => void;
}

function WorkRow({ w, busy, dragging, over, drag, onSave, onRemove }: {
  w: WorkTypeRow; busy: boolean; dragging: boolean; over: boolean; drag: DragHandlers;
  onSave: (patch: Partial<Pick<WorkTypeRow, "label" | "bookable" | "inDesign" | "active">>) => void; onRemove: () => void;
}) {
  const [label, setLabel] = useState(w.label);
  const fixedBooking = w.system && w.rule === "booking";
  const fixedOther = w.system && w.rule !== "booking" && w.rule !== "measure";
  return (
    <tr draggable={!busy} {...drag}
      className={cn("border-t border-border align-middle", !w.active && "opacity-60", dragging && "opacity-40", over && "[box-shadow:inset_0_2px_0_var(--color-primary)]")}>
      <td className="py-2 pr-2">
        <span className="inline-flex cursor-grab items-center text-ink-secondary active:cursor-grabbing" title="Drag to move" aria-label={`Drag ${w.label} to move it`}><GripVertical size={16} /></span>
      </td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-2">
          <input className={inputClass + " min-w-[10rem]"} value={label} onChange={(e) => setLabel(e.target.value)} aria-label={`Name of ${w.label}`} maxLength={60} />
          {label.trim() && label !== w.label && <Button variant="secondary" disabled={busy} onClick={() => onSave({ label: label.trim() })}>Save</Button>}
        </div>
        {w.system && <span className="text-[11px] text-ink-secondary">Built in</span>}
      </td>
      <td className="py-2 pr-2"><input type="checkbox" aria-label={`${w.label} in Design`} checked={w.inDesign} disabled={busy} onChange={(e) => onSave({ inDesign: e.target.checked })} /></td>
      <td className="py-2 pr-2"><input type="checkbox" aria-label={`${w.label} bookable`} checked={w.bookable} disabled={busy || fixedBooking || fixedOther} onChange={(e) => onSave({ bookable: e.target.checked })} /></td>
      <td className="py-2 pr-2 text-[12.5px] text-ink-secondary">{w.system ? RULE_TEXT[w.rule] : w.bookable ? RULE_TEXT.booking : "Marked done by hand"}</td>
      <td className="py-2 pr-2"><input type="checkbox" aria-label={`${w.label} on`} checked={w.active} disabled={busy || w.system} onChange={(e) => onSave({ active: e.target.checked })} /></td>
      <td className="py-2">
        <button type="button" className="rounded border border-border p-1.5 text-err disabled:text-ink-secondary disabled:opacity-40" aria-label={`Remove ${w.label}`} title={w.system ? "Built in: cannot be removed" : "Remove"} disabled={busy || w.system} onClick={onRemove}><Trash2 size={14} /></button>
      </td>
    </tr>
  );
}
