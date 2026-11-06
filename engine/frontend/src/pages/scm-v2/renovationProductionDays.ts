/* The day strip on a production order (owner, 6 Nov 2026): Day 1 to Day N from the plan dates, one day's photos at a time.
   A late job carries on past the plan, and a photo on a day off (a Sunday, a holiday) still has a day to sit under. Shared
   by the desktop page and the phone screen, so they count alike. */

import type { MaterialRow, MaterialStatus } from "../../vendor/scm/lib/production-order-queries";
import { parseProvenanceNote, provenanceNoteRe } from "../../vendor/shared/transfer-vocabulary";

export interface StripPhoto { id: string; at: string; by: string | null }
export interface StripDay<P extends StripPhoto = StripPhoto> { date: string; label: string; photos: P[]; future: boolean }

/** The calendar day in Malaysia, whatever the browser's clock says. */
export const mytDate = (iso: string): string => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
export const mytTime = (iso: string): string => {
  const [h = "0", m = "00"] = new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(11, 16).split(":");
  return `${Number(h)}:${m}`;
};
const addDay = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const isWorkday = (date: string, holidays: ReadonlySet<string>): boolean => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0 && !holidays.has(date);

export function dayStrip<P extends StripPhoto>(planDays: readonly string[], photos: readonly P[], today: string, holidays: readonly string[], lastDay?: string | null): StripDay<P>[] {
  const off = new Set(holidays);
  const days = [...planDays];
  /* Past the plan the job keeps its numbering, up to today or the day it finished. */
  const through = lastDay ?? today;
  if (days.length > 0) {
    for (let d = addDay(days[days.length - 1]!); d <= through; d = addDay(d)) if (isWorkday(d, off)) days.push(d);
  }
  const byDate = new Map<string, P[]>();
  for (const p of photos) {
    const d = mytDate(p.at);
    byDate.set(d, [...(byDate.get(d) ?? []), p]);
  }
  const numbered = days.map((date, i): StripDay<P> => ({ date, label: `Day ${i + 1}`, photos: byDate.get(date) ?? [], future: date > today }));
  const known = new Set(days);
  const extras = [...byDate.keys()].filter((d) => !known.has(d)).map((date): StripDay<P> => ({ date, label: "Extra", photos: byDate.get(date) ?? [], future: false }));
  return [...numbered, ...extras].sort((a, b) => a.date.localeCompare(b.date));
}

/** Today when it is on the strip, else the latest day with photos, else the first. */
export function initialDay(days: readonly StripDay[], today: string): number {
  const on = days.findIndex((d) => d.date === today);
  if (on >= 0) return on;
  for (let i = days.length - 1; i >= 0; i -= 1) if (days[i]!.photos.length > 0) return i;
  return 0;
}

/** The first day shown on a page of the strip: the selected day stays in view and past days fill the rest. */
export const pageStart = (selected: number, count: number, size: number): number =>
  count <= size ? 0 : Math.min(Math.max(0, selected - (size - 4)), count - size);

export const photoWord = (n: number): string => `${n} photo${n === 1 ? "" : "s"}`;
export const shortDate = (date: string): string => date.slice(5).replace("-", "/");
export const peopleOn = (photos: readonly StripPhoto[]): string => [...new Set(photos.map((p) => p.by).filter(Boolean))].join(", ");

export type ReadyWord = { ready: boolean; tally: string; readyCount: number; total: number; arrivingOn: string | null };

/** An order's note as staff read it. MRP stores the PO's provenance note ("Transfer from Sales Order: X"), which every
    document-flow reader parses, so the stored words stay and only this reading says where the order really came from. */
export function productionNote(notes: string | null | undefined): string | null {
  const text = (notes ?? "").trim();
  if (!text) return null;
  const sos = parseProvenanceNote(text);
  return sos.length > 0 ? text.replace(provenanceNoteRe(), `Raised through MRP for ${sos.join(", ")}`) : text;
}

/** The line above an order and the Start reminder: "1 of 3 ready · 1 arriving 2026/11/10 · 1 no PO yet". */
export function materialTally(rows: readonly MaterialRow[], statuses: Record<string, MaterialStatus> | undefined, date: (d: string) => string): ReadyWord {
  const of = rows.map((m) => statuses?.[m.id]?.state);
  const readyCount = of.filter((s) => s === "received" || s === "stock").length;
  const onOrder = rows.filter((m) => statuses?.[m.id]?.state === "po");
  const noPo = of.filter((s) => s === "short").length;
  const arrivingOn = onOrder.map((m) => statuses?.[m.id]?.eta).filter((e): e is string => Boolean(e)).sort()[0] ?? null;
  const parts = [`${readyCount} of ${rows.length} ready`];
  if (onOrder.length > 0) parts.push(`${onOrder.length} arriving${arrivingOn ? ` ${date(arrivingOn)}` : ""}`);
  if (noPo > 0) parts.push(`${noPo} no PO yet`);
  return { ready: rows.length === 0 || readyCount === rows.length, tally: parts.join(" · "), readyCount, total: rows.length, arrivingOn };
}

/** "120 SQFT × 0.5": the work's quantity times what one unit uses. A hand-listed material has no calculation to show. */
export function materialCalculation(m: Pick<MaterialRow, "qty_needed" | "from_composition" | "added_how">, works: ReadonlyArray<{ qty: number; uom?: string | null }>): string {
  if (m.added_how === "REQUESTED") return "Requested";
  if (!m.from_composition || works.length !== 1) return "Listed";
  const work = works[0]!;
  if (!(Number(work.qty) > 0)) return "Listed";
  const per = Math.round((Number(m.qty_needed) / Number(work.qty)) * 1000) / 1000;
  return `${Number(work.qty)}${work.uom ? ` ${work.uom}` : ""} × ${per}`;
}
