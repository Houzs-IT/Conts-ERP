/** Sales Returns, ported from 2990's SCM. Sell-side twin of Purchase Returns: a customer
 *  returns goods delivered on a DO. Money integer sen. */
import { type Env, one, nowIso, mytToday } from './db';

export const SRET_STATUSES = ['POSTED', 'COMPLETED', 'CANCELLED'] as const;
export const isSretStatus = (v: unknown): v is typeof SRET_STATUSES[number] => typeof v === 'string' && (SRET_STATUSES as readonly string[]).includes(v);

export interface SretHeaderRow {
  id: string; return_number: string; sales_order_id: string | null; delivery_order_id: string | null; customer_name: string;
  return_date: string; reason: string | null; status: string; credit_note_ref: string | null; refund_sen: number;
  notes: string | null; created_at: string; updated_at: string;
  so_doc_no?: string | null; do_number?: string | null;
}
export interface SretLineRow { id: string; delivery_order_line_id: string | null; line_no: number; item_code: string; description: string; uom: string; qty_returned: number; unit_price_sen: number; line_total_sen: number; reason: string | null }

export function toSretHeaderPayload(r: SretHeaderRow) {
  return {
    id: r.id, returnNumber: r.return_number, salesOrderId: r.sales_order_id ?? '', deliveryOrderId: r.delivery_order_id ?? '', customerName: r.customer_name,
    returnDate: r.return_date, reason: r.reason ?? '', status: r.status, creditNoteRef: r.credit_note_ref ?? '', refundSen: r.refund_sen,
    notes: r.notes ?? '', soDocNo: r.so_doc_no ?? '', doNumber: r.do_number ?? '',
  };
}
export function toSretLinePayload(r: SretLineRow) {
  return { id: r.id, deliveryOrderLineId: r.delivery_order_line_id ?? '', lineNo: r.line_no, itemCode: r.item_code, description: r.description, uom: r.uom, qtyReturned: r.qty_returned, unitPriceSen: r.unit_price_sen, lineTotalSen: r.line_total_sen, reason: r.reason ?? '' };
}

export async function nextSalesReturnNumber(env: Env): Promise<string> {
  const year = mytToday().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(return_number) AS mx FROM sales_returns WHERE return_number LIKE ?', `SRET-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `SRET-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}
