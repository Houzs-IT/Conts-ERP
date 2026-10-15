/* Procurement details counts (owner, 15 Oct 2026): per category and sub-category, how many of the project's item lines
   are Ordered -> Received -> Delivered, the goods receipts and delivery orders that did it, Ready and LATE. The lines
   come from GET /api/renovation/:id/procurement-status (engine/backend/src/services/renovation/procurementStatus.ts);
   they are counted here and never listed. Pure. */

export interface GrRef { id: string; no: string; date: string | null; atSite: boolean; photos: number }
export interface DoRef { id: string; no: string; date: string | null; status: string; delivered: boolean; signed: boolean; hasPod: boolean }
export interface StatusLine {
  categoryGroup: string | null;
  subCategory: string | null;
  qty: number;
  orderedQty: number;
  receivedQty: number;
  deliveredQty: number;
  grs: GrRef[];
  dos: DoRef[];
}

export interface Stage {
  /** Item lines in the row. */
  items: number;
  /** Lines fully on purchase orders. */
  ordered: number;
  /** Ordered lines fully received (goods receipt or site receipt). */
  received: number;
  /** Ordered lines fully delivered (delivery order or site receipt). */
  delivered: number;
  /** Everything ordered here has been received and delivered (and something was ordered). */
  ready: boolean;
  grs: GrRef[];
  dos: DoRef[];
}

const isOrdered = (l: StatusLine) => l.qty > 0 && l.orderedQty >= l.qty;
const isReceived = (l: StatusLine) => l.receivedQty >= l.qty;
const isDelivered = (l: StatusLine) => l.deliveredQty >= l.qty;

function addOnce<T extends { id: string }>(list: T[], items: readonly T[]) {
  for (const x of items) if (!list.some((y) => y.id === x.id)) list.push(x);
}

export function stageOf(lines: readonly StatusLine[]): Stage {
  const ordered = lines.filter(isOrdered);
  const s: Stage = {
    items: lines.length,
    ordered: ordered.length,
    received: ordered.filter(isReceived).length,
    delivered: ordered.filter(isDelivered).length,
    ready: ordered.length > 0 && ordered.every((l) => isReceived(l) && isDelivered(l)),
    grs: [],
    dos: [],
  };
  for (const l of lines) { addOnce(s.grs, l.grs); addOnce(s.dos, l.dos); }
  s.grs.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.no.localeCompare(b.no));
  s.dos.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.no.localeCompare(b.no));
  return s;
}

/** A category's stage from its rows that have items: Ready only when every one of them is Ready. */
export function categoryStage(rows: readonly Stage[]): Stage {
  const withItems = rows.filter((r) => r.items > 0);
  const out: Stage = { items: 0, ordered: 0, received: 0, delivered: 0, ready: withItems.length > 0 && withItems.every((r) => r.ready), grs: [], dos: [] };
  for (const r of withItems) {
    out.items += r.items; out.ordered += r.ordered; out.received += r.received; out.delivered += r.delivered;
    addOnce(out.grs, r.grs); addOnce(out.dos, r.dos);
  }
  return out;
}

/** The lines of one row: a sub-category's own, or (sub null) the category's lines with no sub-category row. */
export function linesOf(lines: readonly StatusLine[], group: string, sub: string | null, subCodes: readonly string[]): StatusLine[] {
  return lines.filter((l) => l.categoryGroup === group
    && (sub === null ? !l.subCategory || !subCodes.includes(l.subCategory) : l.subCategory === sub));
}

/** LATE: the planned delivery date has passed and the row has items that are not all in (Ready). */
export function isLate(s: Stage, plannedDelivery: string | null, today: string): boolean {
  return !!plannedDelivery && plannedDelivery < today && s.items > 0 && !s.ready;
}

/** "12 items · 8 ordered · 5 received · 3 delivered", '' with no items. */
export function stageText(s: Stage): string {
  if (s.items === 0) return '';
  return `${s.items} item${s.items === 1 ? '' : 's'} · ${s.ordered} ordered · ${s.received} received · ${s.delivered} delivered`;
}
