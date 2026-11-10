/* Worker actual hours on a production order (TODO item 16), shared by the desktop page and the phone screen.
   Each worker presses Start time when they begin and Stop time when they leave; a supervisor adds or corrects an entry
   by hand. Actual hours are set against the Production time budget; the plan dates are not touched. */

import { useEffect, useMemo, useState } from "react";
import { fmtDate } from "@2990s/shared";
import { Button } from "../../components/Button";
import { ModalOverlay } from "../../components/scm-v2/DocumentRelationshipMapModal";
import { cn } from "../../lib/utils";
import { useNotify } from "../../vendor/scm/components/NotifyDialog";
import { useConfirm } from "../../vendor/scm/components/ConfirmDialog";
import { todayMyt } from "../../vendor/scm/lib/dates";
import {
  hoursOf, useProductionHours, useProductionHoursAction,
  type HoursAction, type ProductionHours, type ProductionTimeEntry, type ProductionWorker,
} from "../../vendor/scm/lib/production-order-queries";
import { mytDate, mytTime } from "./renovationProductionDays";

const FIELD = "mt-1 block h-10 w-full rounded-md border border-border bg-surface px-2.5 text-[14px] text-ink";
const message = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

/** A Malaysia date and HH:MM as an instant. */
export const isoFromMyt = (date: string, time: string): string => new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+08:00`).toISOString();
/** An instant as the Malaysia HH:MM a time box holds. */
export const timeBoxOf = (iso: string): string => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(11, 16);
export const fmtHours = (minutes: number): string => `${hoursOf(minutes)} h`;

/** The line under the totals: how far from the budget, in words. */
export function budgetWords(h: Pick<ProductionHours, "budgetHours" | "summary">): { text: string; over: boolean } {
  const v = h.summary.varianceMinutes;
  if (h.budgetHours == null || v == null) return { text: "No production time set", over: false };
  if (v > 0) return { text: `${fmtHours(v)} over budget`, over: true };
  if (v === 0) return { text: "Exactly on budget", over: false };
  return { text: `${fmtHours(-v)} left`, over: false };
}

/** The people who can be put on the clock: you first, then the order's workers, each once. */
export function clockPeople(h: Pick<ProductionHours, "me" | "summary" | "entries">, workers: readonly ProductionWorker[], myName: string): Array<{ key: string; name: string; you: boolean }> {
  const out = new Map<string, { key: string; name: string; you: boolean }>();
  out.set(h.me, { key: h.me, name: myName, you: true });
  for (const w of workers) if (!out.has(w.person_key)) out.set(w.person_key, { key: w.person_key, name: w.name, you: false });
  for (const p of h.summary.people) if (!out.has(p.personKey)) out.set(p.personKey, { key: p.personKey, name: p.name, you: false });
  return [...out.values()];
}

export function ProductionHoursPanel({ orderId, workers, canAct, phone, myName = "You" }: {
  orderId: string; workers: readonly ProductionWorker[]; canAct: boolean; phone?: boolean; myName?: string;
}) {
  const q = useProductionHours(orderId);
  const act = useProductionHoursAction(orderId);
  const notify = useNotify();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ProductionTimeEntry | "new" | null>(null);
  const h = q.data;
  const people = useMemo(() => (h ? clockPeople(h, workers, myName) : []), [h, workers, myName]);
  const run = (a: HoursAction, title: string) => act.mutate(a, { onError: (e) => notify({ title, body: message(e), tone: "error" }) });

  if (q.isLoading) return <p className="p-3 text-[13px] text-ink-muted">Loading hours…</p>;
  if (q.isError || !h) return <p className="p-3 text-[13px] text-err">The hours could not be loaded.</p>;
  const words = budgetWords(h);
  const running = new Map(h.entries.filter((e) => !e.stopped_at).map((e) => [e.person_key, e]));
  const mayTime = canAct && h.canTime;
  const mayEnter = canAct && h.canEnter;

  return (
    <div>
      <div className={cn("grid grid-cols-3 gap-2.5 border-b border-border-subtle text-[13px]", phone ? "p-3" : "px-3.5 py-3")}>
        <div>
          <div className="text-ink-secondary">Budget</div>
          <div className={cn("mt-0.5 text-[18px] font-bold", h.budgetHours == null && "text-ink-muted")}>{h.budgetHours == null ? "Not set" : `${h.budgetHours} h`}</div>
        </div>
        <div>
          <div className="text-ink-secondary">Actual</div>
          <div className={cn("mt-0.5 text-[18px] font-bold", words.over && "text-err")}>{fmtHours(h.summary.actualMinutes)}</div>
        </div>
        <div>
          <div className="text-ink-secondary">{words.over ? "Over" : "Remaining"}</div>
          <div className={cn("mt-0.5 text-[13px] font-semibold", words.over ? "text-err" : "text-ink-secondary")}>{words.text}</div>
        </div>
      </div>

      {people.map((p) => {
        const live = running.get(p.key);
        const total = h.summary.people.find((x) => x.personKey === p.key)?.minutes ?? 0;
        return (
          <div key={p.key} className={cn("flex items-center justify-between gap-2.5 border-b border-border-subtle text-[13px]", phone ? "px-3 py-2" : "px-3.5 py-2")}>
            <div className="min-w-0">
              <b className="font-semibold">{p.you ? "You" : p.name}</b>
              <div className="text-[12px] text-ink-muted">
                {live ? <span className="font-semibold text-synced">On the clock since {mytTime(live.started_at)}</span> : "Not on the clock"}
                {total > 0 ? ` · ${fmtHours(total)} on this order` : ""}
              </div>
            </div>
            {mayTime && (live
              ? <Button variant="secondary" disabled={act.isPending} onClick={() => run({ kind: "stop", personKey: p.key }, "Not stopped")}>Stop time</Button>
              : <Button disabled={act.isPending} onClick={() => run({ kind: "start", personKey: p.key }, "Not started")}>Start time</Button>)}
          </div>
        );
      })}

      <div className={cn("flex items-center justify-between gap-2.5", phone ? "px-3 py-2" : "px-3.5 py-2")}>
        <span className="text-[12px] font-semibold uppercase tracking-brand text-ink-muted">Time entries · {h.entries.length}</span>
        {mayEnter && <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setEditing("new")}>Add time</button>}
      </div>
      {h.entries.length === 0 ? (
        <p className={cn("text-[13px] text-ink-muted", phone ? "px-3 pb-3" : "px-3.5 pb-3")}>No time recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="px-3.5 py-1.5 font-semibold">Date</th>
                <th className="px-3.5 py-1.5 font-semibold">Worker</th>
                <th className="px-3.5 py-1.5 font-semibold">Start</th>
                <th className="px-3.5 py-1.5 font-semibold">Stop</th>
                <th className="px-3.5 py-1.5 text-right font-semibold">Hours</th>
                {!phone && <th className="px-3.5 py-1.5 font-semibold">Notes</th>}
                {mayEnter && <th className="px-3.5 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {[...h.entries].reverse().map((e) => (
                <tr key={e.id} className="border-t border-border-subtle">
                  <td className="whitespace-nowrap px-3.5 py-1.5">{fmtDate(mytDate(e.started_at))}</td>
                  <td className="px-3.5 py-1.5">{e.name}</td>
                  <td className="px-3.5 py-1.5">{mytTime(e.started_at)}</td>
                  <td className="px-3.5 py-1.5">{e.stopped_at ? mytTime(e.stopped_at) : <span className="font-semibold text-synced">Running</span>}</td>
                  <td className="px-3.5 py-1.5 text-right tabular-nums">{hoursOf(e.minutes)}</td>
                  {!phone && <td className="px-3.5 py-1.5 text-ink-secondary">{[e.how === "MANUAL" ? "Typed" : null, e.notes].filter(Boolean).join(" · ")}</td>}
                  {mayEnter && (
                    <td className="whitespace-nowrap px-3.5 py-1.5 text-right">
                      <button type="button" className="mr-2 font-semibold text-primary hover:underline" onClick={() => setEditing(e)}>Edit</button>
                      <button type="button" className="font-semibold text-err hover:underline" onClick={async () => {
                        if (await confirm({ title: "Remove this time entry?", body: `${e.name}, ${hoursOf(e.minutes)} h on ${fmtDate(mytDate(e.started_at))}. It comes off the order's actual hours; History keeps a note.`, confirmLabel: "Remove", danger: true })) {
                          run({ kind: "delete", entryId: e.id }, "Not removed");
                        }
                      }}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== null && <EntryDialog open entry={editing === "new" ? null : editing} people={people} onClose={() => setEditing(null)}
        onSave={(a) => act.mutate(a, { onSuccess: () => setEditing(null), onError: (e) => notify({ title: "Not saved", body: message(e), tone: "error" }) })} saving={act.isPending} />}
    </div>
  );
}

function EntryDialog({ open, entry, people, onClose, onSave, saving }: {
  open: boolean; entry: ProductionTimeEntry | null; people: Array<{ key: string; name: string; you: boolean }>;
  onClose: () => void; onSave: (a: HoursAction) => void; saving: boolean;
}) {
  const [who, setWho] = useState("");
  const [date, setDate] = useState(todayMyt());
  const [start, setStart] = useState("08:00");
  const [stop, setStop] = useState("17:00");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!open) return;
    setWho(entry?.person_key ?? people[0]?.key ?? "");
    setDate(entry ? mytDate(entry.started_at) : todayMyt());
    setStart(entry ? timeBoxOf(entry.started_at) : "08:00");
    setStop(entry?.stopped_at ? timeBoxOf(entry.stopped_at) : entry ? "" : "17:00");
    setNotes(entry?.notes ?? "");
  }, [open, entry, people]);
  const runningEdit = entry != null && !entry.stopped_at;
  /* A stop earlier than the start is the next morning (a night shift). */
  const stopDate = stop && stop <= start ? new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : date;
  const save = () => {
    const startedAt = isoFromMyt(date, start);
    if (entry) onSave({ kind: "edit", entryId: entry.id, startedAt, stoppedAt: runningEdit ? undefined : isoFromMyt(stopDate, stop), notes });
    else onSave({ kind: "add", personKey: who, startedAt, stoppedAt: isoFromMyt(stopDate, stop), notes });
  };
  return (
    <ModalOverlay open={open} onClose={onClose} title={entry ? "Correct time" : "Add time"}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving || !start || (!runningEdit && !stop) || (!entry && !who)}>Save</Button></div>}>
      <label className="block text-[13px] font-semibold">Worker
        {entry ? <div className="mt-1 text-[14px] font-normal">{entry.name}</div> : (
          <select aria-label="Worker" className={FIELD} value={who} onChange={(e) => setWho(e.target.value)}>
            {people.map((p) => <option key={p.key} value={p.key}>{p.you ? "You" : p.name}</option>)}
          </select>
        )}
      </label>
      <label className="mt-3 block text-[13px] font-semibold">Date
        <input aria-label="Date" type="date" className={FIELD} value={date} max={todayMyt()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <label className="block text-[13px] font-semibold">Start
          <input aria-label="Start" type="time" className={FIELD} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block text-[13px] font-semibold">Stop
          {runningEdit ? <div className="mt-1 text-[13px] font-normal text-ink-muted">Still running: press Stop time</div>
            : <input aria-label="Stop" type="time" className={FIELD} value={stop} onChange={(e) => setStop(e.target.value)} />}
        </label>
      </div>
      {!runningEdit && stop && stop <= start && <p className="mt-1 text-[12px] text-ink-muted">Stops the next day.</p>}
      <label className="mt-3 block text-[13px] font-semibold">Notes
        <input aria-label="Notes" className={FIELD} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </label>
    </ModalOverlay>
  );
}
