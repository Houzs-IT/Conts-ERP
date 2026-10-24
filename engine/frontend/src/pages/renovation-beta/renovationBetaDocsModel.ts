/* Pure rules for the DO and GR tabs (owner, 24 Oct 2026): what one delivery order or goods receipt carries, read
   against the PO tab's own lines (renovationBetaLines.ts), so its PO number, "Client PO" and delivery date are the
   same values the PO tab shows; which DOs carried the lines of a GR; and the delivered lines grouped by category or by
   area with the documents that delivered them. No React, no calls. */

import { lineDates, livePo, NO_AREA, type ManagedLine } from "./renovationBetaLines";
import type { DeliveryLine, SiteDelivery, SitePhoto } from "./renovationBetaSiteApi";

export type DocView = "doc" | "category" | "area";

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface DocRef { id: string; no: string }

export interface DocSummary {
  /** The PO numbers of its lines as the PO tab shows them, in line order. */
  pos: string[];
  /** One of its lines is bought by the client (the PO tab's "Client PO"). */
  clientPo: boolean;
  /** Its lines' delivery dates (the PO line's once a PO holds the line, else the line's plan), earliest first. */
  deliverOn: string[];
  /** For a goods receipt: the delivery orders that carried the same sales order lines, newest first. */
  dos: DocRef[];
}

const linesOf = (d: SiteDelivery): DeliveryLine[] => d.lines ?? [];

/** The PO number the PO tab shows for this line; on a goods receipt the PO of the very PO line it received. */
function poOf(l: ManagedLine, poLineId: string | null): string | null {
  const hit = poLineId ? l.pos.find((p) => p.poLineId === poLineId) : undefined;
  return (hit ?? livePo(l))?.poNumber ?? null;
}

export function docSummary(d: SiteDelivery, lines: readonly ManagedLine[], all: readonly SiteDelivery[]): DocSummary {
  const byId = new Map(lines.map((l) => [l.id, l] as const));
  const pos: string[] = [];
  const dates = new Set<string>();
  let clientPo = false;
  for (const x of linesOf(d)) {
    const l = x.soItemId ? byId.get(x.soItemId) : undefined;
    if (!l) continue;
    const po = poOf(l, x.poLineId);
    if (po && !pos.includes(po)) pos.push(po);
    if (!po && l.goesTo === "client") clientPo = true;
    const on = lineDates(l).deliverOn;
    if (on) dates.add(on);
  }
  if (pos.length === 0 && d.poNumber) pos.push(d.poNumber);
  const mine = new Set(linesOf(d).map((x) => x.soItemId).filter((x): x is string => !!x));
  const dos = d.type === "goods_received"
    ? all.filter((o) => o.type === "delivery_order" && linesOf(o).some((x) => x.soItemId != null && mine.has(x.soItemId))).map((o) => ({ id: o.id, no: o.no }))
    : [];
  return { pos, clientPo, deliverOn: [...dates].sort(), dos };
}

/** "24 Oct", "24 Oct, 2 Nov", "24 Oct to 9 Nov" (three or more). */
export function datesText(days: readonly string[], fmt: (iso: string) => string): string | null {
  if (days.length === 0) return null;
  if (days.length <= 2) return days.map(fmt).join(", ");
  return `${fmt(days[0])} to ${fmt(days[days.length - 1])}`;
}

export interface DeliveredLine {
  key: string;
  line: ManagedLine;
  /** Each document that carried it and how many. */
  docs: Array<{ d: SiteDelivery; qty: number }>;
  qty: number;
  poNumber: string | null;
  clientPo: boolean;
  deliverOn: string | null;
  /** The photos of those documents (in the area view only the ones of this area or of the whole document). */
  photos: SitePhoto[];
  /** The delivery orders (of `all`) that carried this line: on the GR tab, where the received line went. */
  dos: DocRef[];
}

export interface DeliveredGroup { key: string; label: string; lines: DeliveredLine[] }

/** The lines the documents carried, one row per sales order line, grouped by its category (the PO tab's order) or by
    its area (the sales order's order, "No area" last). Documents are newest first, so each line's documents are too. */
export function deliveredGroups(
  deliveries: readonly SiteDelivery[], lines: readonly ManagedLine[], view: "category" | "area", all: readonly SiteDelivery[] = deliveries,
): DeliveredGroup[] {
  const order = new Map(lines.map((l, i) => [l.id, i] as const));
  const byId = new Map(lines.map((l) => [l.id, l] as const));
  const rows = new Map<string, DeliveredLine>();
  for (const d of deliveries) {
    for (const x of linesOf(d)) {
      const l = x.soItemId ? byId.get(x.soItemId) : undefined;
      if (!l) continue;
      let r = rows.get(l.id);
      if (!r) {
        const po = poOf(l, x.poLineId);
        r = { key: l.id, line: l, docs: [], qty: 0, poNumber: po, clientPo: !po && l.goesTo === "client", deliverOn: lineDates(l).deliverOn, photos: [],
          dos: all.filter((o) => o.type === "delivery_order" && linesOf(o).some((y) => y.soItemId === l.id)).map((o) => ({ id: o.id, no: o.no })) };
        rows.set(l.id, r);
      }
      const had = r.docs.find((y) => y.d.id === d.id);
      if (had) had.qty += x.qty; else r.docs.push({ d, qty: x.qty });
      r.qty += x.qty;
    }
  }
  const groups = new Map<string, { label: string; sort: number; lines: DeliveredLine[] }>();
  for (const r of rows.values()) {
    const area = r.line.area?.trim() || NO_AREA;
    const label = view === "category" ? r.line.categoryLabel : area;
    const sort = view === "category" ? r.line.categorySort : area === NO_AREA ? Number.MAX_SAFE_INTEGER : order.get(r.line.id) ?? 0;
    const g = groups.get(label) ?? { label, sort, lines: [] };
    g.sort = Math.min(g.sort, sort);
    r.photos = r.docs.flatMap((y) => y.d.photos.filter((p) => view !== "area" || p.area == null || same(p.area, area)));
    g.lines.push(r);
    groups.set(label, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map((g) => ({
      key: `${view}:${g.label}`,
      label: g.label,
      lines: g.lines.sort((a, b) => (view === "category" ? a.line.subSort - b.line.subSort : 0) || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)),
    }));
}
