/* Pure rules for Site & photos, the Defects pipeline and Site progress (BRIEF-beta-oct24 sections 5, 6 and 8).
   No React, no calls; today is passed in as a Malaysian YYYY-MM-DD so the rules can be tested on fixed dates. */

import type { TaskViewV2 } from "../projects/renovation/simpleApi";
import type { BetaPayments } from "./renovationBetaApi";
import { ord } from "./renovationBetaBoard";
import { defectColumn, defectDaysLate, type DefectColumn, type SiteStep } from "./renovationBetaModel";
import type { DefectTicket, SiteDelivery, SitePhoto } from "./renovationBetaSiteApi";

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/* ---------- Site & photos ---------- */

/** The area chips for the deliveries: only rooms a delivered or received line (or one of its photos) is in, in the
    sales order's room order, then any other. A room nothing was delivered to has no chip (owner, 24 Oct 2026). */
export function areaChips(soAreas: readonly string[], deliveries: readonly SiteDelivery[]): string[] {
  const named: string[] = [];
  for (const d of deliveries) {
    for (const a of [...d.areas, ...d.photos.map((p) => p.area)]) {
      if (a && !named.some((x) => same(x, a))) named.push(a);
    }
  }
  const ordered = soAreas.filter((a) => named.some((x) => same(x, a)));
  return [...ordered.filter((a, i) => ordered.findIndex((x) => same(x, a)) === i), ...named.filter((a) => !soAreas.some((x) => same(x, a)))];
}

/** The deliveries that carry something for this area, each with the photos that belong to it: photos tagged with the
    area, and photos of the whole delivery (no room tag). "" = every delivery with every photo. */
export function filterDeliveries(deliveries: readonly SiteDelivery[], area: string): SiteDelivery[] {
  if (!area) return [...deliveries];
  const out: SiteDelivery[] = [];
  for (const d of deliveries) {
    const carries = d.areas.some((a) => same(a, area));
    const tagged = d.photos.filter((p) => p.area != null && same(p.area, area));
    if (!carries && tagged.length === 0) continue;
    out.push({ ...d, photos: d.photos.filter((p) => (p.area == null ? carries : same(p.area, area))) });
  }
  return out;
}

/** How many photos each purchase order has on its goods receipts, for the Site progress rows. */
export function photosByPo(deliveries: readonly SiteDelivery[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of deliveries) {
    if (d.type !== "goods_received") continue;
    for (const po of d.poIds) out.set(po, (out.get(po) ?? 0) + d.photos.filter((p) => p.image).length);
  }
  return out;
}

export const DELIVERY_LABEL: Readonly<Record<SiteDelivery["type"], string>> = { delivery_order: "Delivery order", goods_received: "Goods receipt" };

export const PHOTO_SOURCE: Readonly<Record<SitePhoto["source"], string>> = { pod: "POD", site: "Site", upload: "File" };

/* ---------- Defects pipeline ---------- */

/** To fix: late first, then the earliest fix-by date, no date last. Check: oldest fix first. Done: newest close first. */
export function ticketColumns(tickets: readonly DefectTicket[], today: string): Record<DefectColumn, DefectTicket[]> {
  const out: Record<DefectColumn, DefectTicket[]> = { to_fix: [], check: [], done: [] };
  for (const t of tickets) out[defectColumn(t)].push(t);
  out.to_fix.sort((a, b) => defectDaysLate(b, today) - defectDaysLate(a, today) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id - b.id);
  out.check.sort((a, b) => (a.fixedAt ?? "").localeCompare(b.fixedAt ?? "") || a.id - b.id);
  out.done.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || b.id - a.id);
  return out;
}

export interface DueLine { text: string; late: boolean }

/** The fix-by line on a card: late in red, else the date; null when there is nothing to say. */
export function dueLine(t: Pick<DefectTicket, "dueDate" | "fixedAt" | "closedAt">, today: string, fmt: (iso: string) => string): DueLine | null {
  if (!t.dueDate) return null;
  const late = defectDaysLate(t, today);
  if (late > 0) return { text: `Overdue ${late} day${late === 1 ? "" : "s"} · was due ${fmt(t.dueDate)}`, late: true };
  if (defectColumn(t) === "to_fix") return { text: t.dueDate === today ? "Fix by today" : `Fix by ${fmt(t.dueDate)}`, late: false };
  return null;
}

export function overdueCount(tickets: readonly DefectTicket[], today: string): number {
  return tickets.filter((t) => defectDaysLate(t, today) > 0).length;
}

/* ---------- Site progress ---------- */

export interface SiteStepPlus extends SiteStep {
  /** Photos on the goods receipts of the step's purchase order. */
  photos: number;
  /** "Waits for 2nd payment" when the step needs a payment not received yet. */
  waitsFor: string | null;
}

/** The payment a step at this stage waits for: the first unpaid instalment tied to that stage. */
function unpaidFor(stage: string, payments: BetaPayments): string | null {
  if (payments.state !== "ok") return null;
  const i = [...payments.instalments].sort((a, b) => a.seq - b.seq).find((x) => x.stageCode === stage && x.status !== "paid");
  return i ? `Waits for ${ord(i.seq)} payment` : null;
}

/** Adds the photo count and the payment a step is waiting for to each Site progress row. */
export function siteStepsPlus(
  steps: readonly SiteStep[], tasks: readonly TaskViewV2[], payments: BetaPayments, photos: ReadonlyMap<string, number>,
): SiteStepPlus[] {
  const byId = new Map<string, TaskViewV2>(tasks.map((t) => [`task-${t.id}`, t]));
  return steps.map((s) => {
    if (s.id === "handover") return { ...s, photos: 0, waitsFor: unpaidFor("handover", payments) };
    const t = byId.get(s.id);
    if (!t) return { ...s, photos: 0, waitsFor: null };
    return {
      ...s,
      photos: t.purchase_order_id ? photos.get(t.purchase_order_id) ?? 0 : 0,
      waitsFor: s.state === "done" ? null : unpaidFor(t.stage_key, payments),
    };
  });
}
