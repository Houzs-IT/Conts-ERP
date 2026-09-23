/** Sales Orders, ported from 2990's SCM. Core sell-side document. Money integer sen. */
export { normalizeLines, computeTotals } from './purchase-orders';

export const SO_STATUSES = ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED', 'ON_HOLD', 'CANCELLED'] as const;
export type SoStatus = typeof SO_STATUSES[number];
export const isSoStatus = (v: unknown): v is SoStatus => typeof v === 'string' && (SO_STATUSES as readonly string[]).includes(v);

/** The forward-only main flow; ON_HOLD / CANCELLED are side transitions. */
export const SO_FLOW: SoStatus[] = ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED'];
export function nextStatus(cur: string): SoStatus | null {
  const i = SO_FLOW.indexOf(cur as SoStatus);
  return i >= 0 && i < SO_FLOW.length - 1 ? SO_FLOW[i + 1] : null;
}

export interface SoHeaderRow {
  id: string; doc_no: string; customer_name: string; customer_phone: string | null; customer_po: string | null;
  so_date: string; target_date: string | null; status: string; currency: string;
  subtotal_sen: number; tax_sen: number; total_sen: number; deposit_sen: number; paid_sen: number;
  notes: string | null; created_at: string; updated_at: string;
}
export interface SoLineRow {
  id: string; line_no: number; item_code: string; description: string; uom: string;
  qty: number; unit_price_sen: number; discount_sen: number; line_total_sen: number; delivered_qty: number; notes: string | null;
}

export function toSoHeaderPayload(r: SoHeaderRow) {
  return {
    id: r.id, docNo: r.doc_no, customerName: r.customer_name, customerPhone: r.customer_phone ?? '', customerPo: r.customer_po ?? '',
    soDate: r.so_date, targetDate: r.target_date ?? '', status: r.status, currency: r.currency,
    subtotalSen: r.subtotal_sen, taxSen: r.tax_sen, totalSen: r.total_sen, depositSen: r.deposit_sen, paidSen: r.paid_sen,
    outstandingSen: Math.max(0, r.total_sen - r.paid_sen), notes: r.notes ?? '',
  };
}
export function toSoLinePayload(r: SoLineRow) {
  return {
    id: r.id, lineNo: r.line_no, itemCode: r.item_code, description: r.description, uom: r.uom,
    qty: r.qty, unitPriceSen: r.unit_price_sen, discountSen: r.discount_sen, lineTotalSen: r.line_total_sen, deliveredQty: r.delivered_qty, notes: r.notes ?? '',
  };
}
