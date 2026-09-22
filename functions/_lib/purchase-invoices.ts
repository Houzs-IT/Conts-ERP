/** Purchase Invoices, ported from 2990's SCM. Bills a GRN; paid via Payment Vouchers. */
import { type Env, one, run, nowIso } from './db';

export const PI_STATUSES = ['POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
export type PiStatus = typeof PI_STATUSES[number];

export interface PiHeaderRow {
  id: string; invoice_number: string; supplier_invoice_ref: string | null; supplier_id: string;
  purchase_order_id: string | null; grn_id: string | null; invoice_date: string; due_date: string | null;
  currency: string; subtotal_sen: number; tax_sen: number; total_sen: number; paid_sen: number; status: string;
  notes: string | null; created_at: string; updated_at: string;
  supplier_code?: string | null; supplier_name?: string | null; grn_number?: string | null; po_number?: string | null;
}
export interface PiLineRow { id: string; grn_line_id: string | null; line_no: number; item_code: string; description: string; uom: string; qty: number; unit_price_sen: number; line_total_sen: number }

export function toPiHeaderPayload(r: PiHeaderRow) {
  return {
    id: r.id, invoiceNumber: r.invoice_number, supplierInvoiceRef: r.supplier_invoice_ref ?? '', supplierId: r.supplier_id,
    purchaseOrderId: r.purchase_order_id ?? '', grnId: r.grn_id ?? '', invoiceDate: r.invoice_date, dueDate: r.due_date ?? '',
    currency: r.currency, subtotalSen: r.subtotal_sen, taxSen: r.tax_sen, totalSen: r.total_sen, paidSen: r.paid_sen,
    outstandingSen: Math.max(0, r.total_sen - r.paid_sen), status: r.status, notes: r.notes ?? '',
    supplierCode: r.supplier_code ?? '', supplierName: r.supplier_name ?? '', grnNumber: r.grn_number ?? '', poNumber: r.po_number ?? '',
  };
}
export function toPiLinePayload(r: PiLineRow) {
  return { id: r.id, grnLineId: r.grn_line_id ?? '', lineNo: r.line_no, itemCode: r.item_code, description: r.description, uom: r.uom, qty: r.qty, unitPriceSen: r.unit_price_sen, lineTotalSen: r.line_total_sen };
}

export async function nextInvoiceNumber(env: Env): Promise<string> {
  const year = nowIso().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(invoice_number) AS mx FROM purchase_invoices WHERE invoice_number LIKE ?', `PINV-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `PINV-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

/** Recompute an invoice's paid status from paid vs total. Never touches a cancelled one. */
export async function recomputePiStatus(env: Env, id: string): Promise<void> {
  const cur = await one<{ total_sen: number; paid_sen: number; status: string }>(env, 'SELECT total_sen, paid_sen, status FROM purchase_invoices WHERE id = ?', id);
  if (!cur || cur.status === 'CANCELLED') return;
  const status = cur.paid_sen <= 0 ? 'POSTED' : cur.paid_sen >= cur.total_sen ? 'PAID' : 'PARTIALLY_PAID';
  await run(env, 'UPDATE purchase_invoices SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
}
