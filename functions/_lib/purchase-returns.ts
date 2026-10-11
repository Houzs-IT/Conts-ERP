/** Purchase Returns, ported from 2990's SCM. Returns GRN-received goods to the supplier. */
import { type Env, one, mytToday } from './db';

export const PRET_STATUSES = ['POSTED', 'COMPLETED', 'CANCELLED'] as const;

export interface PretHeaderRow {
  id: string; return_number: string; purchase_order_id: string | null; grn_id: string | null; supplier_id: string;
  return_date: string; reason: string | null; status: string; credit_note_ref: string | null; refund_sen: number;
  notes: string | null; created_at: string; updated_at: string;
  supplier_code?: string | null; supplier_name?: string | null; grn_number?: string | null;
}
export interface PretLineRow { id: string; grn_line_id: string | null; line_no: number; item_code: string; description: string; uom: string; qty_returned: number; unit_price_sen: number; line_total_sen: number; reason: string | null }

export function toPretHeaderPayload(r: PretHeaderRow) {
  return {
    id: r.id, returnNumber: r.return_number, purchaseOrderId: r.purchase_order_id ?? '', grnId: r.grn_id ?? '', supplierId: r.supplier_id,
    returnDate: r.return_date, reason: r.reason ?? '', status: r.status, creditNoteRef: r.credit_note_ref ?? '', refundSen: r.refund_sen,
    notes: r.notes ?? '', supplierCode: r.supplier_code ?? '', supplierName: r.supplier_name ?? '', grnNumber: r.grn_number ?? '',
  };
}
export function toPretLinePayload(r: PretLineRow) {
  return { id: r.id, grnLineId: r.grn_line_id ?? '', lineNo: r.line_no, itemCode: r.item_code, description: r.description, uom: r.uom, qtyReturned: r.qty_returned, unitPriceSen: r.unit_price_sen, lineTotalSen: r.line_total_sen, reason: r.reason ?? '' };
}

export async function nextReturnNumber(env: Env): Promise<string> {
  const year = mytToday().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(return_number) AS mx FROM purchase_returns WHERE return_number LIKE ?', `PRET-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `PRET-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}
