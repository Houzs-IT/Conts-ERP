/** Sales Order Amendments, ported from 2990's SCM (core workflow). Money integer sen. */
import { type Env, all, one, run, nowIso } from './db';

export const AMEND_STATUSES = ['REQUESTED', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED'] as const;
export const isAmendStatus = (v: unknown): v is typeof AMEND_STATUSES[number] => typeof v === 'string' && (AMEND_STATUSES as readonly string[]).includes(v);
export const AMEND_ACTIONS = ['CHANGE', 'ADD', 'REMOVE'] as const;
export const isAmendAction = (v: unknown): v is typeof AMEND_ACTIONS[number] => typeof v === 'string' && (AMEND_ACTIONS as readonly string[]).includes(v);

export interface AmendHeaderRow {
  id: string; amendment_no: string; sales_order_id: string; so_doc_no: string; status: string;
  reason: string | null; requested_by: string | null; applied_at: string | null; created_at: string; updated_at: string;
  customer_name?: string | null; so_status?: string | null;
}
export interface AmendLineRow {
  id: string; sales_order_line_id: string | null; action: string; line_no: number; item_code: string; description: string;
  uom: string; old_qty: number | null; old_unit_price_sen: number | null; new_qty: number; new_unit_price_sen: number;
}

export function toAmendHeaderPayload(r: AmendHeaderRow) {
  return {
    id: r.id, amendmentNo: r.amendment_no, salesOrderId: r.sales_order_id, soDocNo: r.so_doc_no, status: r.status,
    reason: r.reason ?? '', requestedBy: r.requested_by ?? '', appliedAt: r.applied_at ?? '',
    customerName: r.customer_name ?? '', soStatus: r.so_status ?? '',
  };
}
export function toAmendLinePayload(r: AmendLineRow) {
  return {
    id: r.id, salesOrderLineId: r.sales_order_line_id ?? '', action: r.action, lineNo: r.line_no, itemCode: r.item_code,
    description: r.description, uom: r.uom, oldQty: r.old_qty, oldUnitPriceSen: r.old_unit_price_sen,
    newQty: r.new_qty, newUnitPriceSen: r.new_unit_price_sen,
  };
}

export async function nextAmendmentNumber(env: Env): Promise<string> {
  const year = nowIso().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(amendment_no) AS mx FROM so_amendments WHERE amendment_no LIKE ?', `AMD-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `AMD-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

/** Recompute a sales order's subtotal/total from its lines (tax kept as-is). Mirrors the
 *  SO create formula: line_total = qty*price - discount; total = subtotal + tax. */
export async function recomputeSoTotals(env: Env, soId: string): Promise<void> {
  const lines = await all<{ line_total_sen: number }>(env, 'SELECT line_total_sen FROM sales_order_lines WHERE sales_order_id = ?', soId);
  const subtotal = lines.reduce((s, l) => s + (l.line_total_sen ?? 0), 0);
  const so = await one<{ tax_sen: number }>(env, 'SELECT tax_sen FROM sales_orders WHERE id = ?', soId);
  const tax = so?.tax_sen ?? 0;
  await run(env, 'UPDATE sales_orders SET subtotal_sen = ?, total_sen = ?, updated_at = ? WHERE id = ?', subtotal, subtotal + tax, nowIso(), soId);
}
