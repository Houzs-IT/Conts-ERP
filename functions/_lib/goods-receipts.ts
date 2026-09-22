/** Goods Received Notes (GRN), ported from 2990's SCM. Receives against a PO. */
import { type Env, all, one, run, nowIso } from './db';

export const GRN_STATUSES = ['POSTED', 'CLOSED', 'CANCELLED'] as const;
export type GrnStatus = typeof GRN_STATUSES[number];

export interface GrnHeaderRow {
  id: string; grn_number: string; purchase_order_id: string; supplier_id: string; received_at: string;
  delivery_note_ref: string | null; status: string; notes: string | null; currency: string;
  subtotal_sen: number; tax_sen: number; total_sen: number; posted_at: string | null;
  created_at: string; updated_at: string; po_number?: string | null; supplier_code?: string | null; supplier_name?: string | null;
}
export interface GrnLineRow {
  id: string; purchase_order_line_id: string | null; line_no: number; item_code: string; description: string; uom: string;
  qty_received: number; qty_accepted: number; qty_rejected: number; rejection_reason: string | null;
  unit_price_sen: number; line_total_sen: number; invoiced_qty: number; notes: string | null;
}

export function toGrnHeaderPayload(r: GrnHeaderRow) {
  return {
    id: r.id, grnNumber: r.grn_number, purchaseOrderId: r.purchase_order_id, supplierId: r.supplier_id,
    receivedAt: r.received_at, deliveryNoteRef: r.delivery_note_ref ?? '', status: r.status, notes: r.notes ?? '',
    currency: r.currency, subtotalSen: r.subtotal_sen, taxSen: r.tax_sen, totalSen: r.total_sen,
    poNumber: r.po_number ?? '', supplierCode: r.supplier_code ?? '', supplierName: r.supplier_name ?? '',
  };
}

export function toGrnLinePayload(r: GrnLineRow) {
  return {
    id: r.id, purchaseOrderLineId: r.purchase_order_line_id ?? '', lineNo: r.line_no, itemCode: r.item_code, description: r.description, uom: r.uom,
    qtyReceived: r.qty_received, qtyAccepted: r.qty_accepted, qtyRejected: r.qty_rejected, rejectionReason: r.rejection_reason ?? '',
    unitPriceSen: r.unit_price_sen, lineTotalSen: r.line_total_sen, invoicedQty: r.invoiced_qty, notes: r.notes ?? '',
  };
}

/** Next GRN number: GRN-<year>-<seq4>. */
export async function nextGrnNumber(env: Env): Promise<string> {
  const year = nowIso().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(grn_number) AS mx FROM goods_receipts WHERE grn_number LIKE ?', `GRN-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `GRN-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

/** Recompute a PO's status from its lines' received_qty vs ordered qty. Never touches a
 *  cancelled PO. Sets received_at when fully received. */
export async function recomputePoStatus(env: Env, poId: string): Promise<void> {
  const cur = await one<{ status: string }>(env, 'SELECT status FROM purchase_orders WHERE id = ?', poId);
  if (!cur || cur.status === 'CANCELLED') return;
  const lines = await all<{ qty: number; received_qty: number }>(env, 'SELECT qty, received_qty FROM purchase_order_lines WHERE purchase_order_id = ?', poId);
  const received = lines.reduce((s, l) => s + Math.min(l.received_qty, l.qty), 0);
  const allDone = lines.length > 0 && lines.every(l => l.received_qty >= l.qty);
  const status = received <= 0 ? 'SUBMITTED' : allDone ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  const now = nowIso();
  await run(env, 'UPDATE purchase_orders SET status = ?, received_at = ?, updated_at = ? WHERE id = ?',
    status, status === 'RECEIVED' ? now : null, now, poId);
}
