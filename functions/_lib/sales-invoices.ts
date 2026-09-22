/** Sales Invoices (AR), ported from 2990's SCM. Bills a delivery order. Money integer sen. */
import { type Env, one, run, nowIso } from './db';

export const SI_STATUSES = ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'] as const;

export interface SiHeaderRow {
  id: string; invoice_number: string; delivery_order_id: string | null; sales_order_id: string | null; customer_name: string;
  invoice_date: string; due_date: string | null; currency: string; subtotal_sen: number; tax_sen: number; total_sen: number; paid_sen: number;
  status: string; notes: string | null; created_at: string; updated_at: string; do_number?: string | null; so_doc_no?: string | null;
}
export interface SiLineRow { id: string; line_no: number; item_code: string; description: string; uom: string; qty: number; unit_price_sen: number; line_total_sen: number }

export function toSiHeaderPayload(r: SiHeaderRow) {
  return {
    id: r.id, invoiceNumber: r.invoice_number, deliveryOrderId: r.delivery_order_id ?? '', salesOrderId: r.sales_order_id ?? '', customerName: r.customer_name,
    invoiceDate: r.invoice_date, dueDate: r.due_date ?? '', currency: r.currency, subtotalSen: r.subtotal_sen, taxSen: r.tax_sen, totalSen: r.total_sen, paidSen: r.paid_sen,
    outstandingSen: Math.max(0, r.total_sen - r.paid_sen), status: r.status, notes: r.notes ?? '', doNumber: r.do_number ?? '', soDocNo: r.so_doc_no ?? '',
  };
}
export function toSiLinePayload(r: SiLineRow) {
  return { id: r.id, lineNo: r.line_no, itemCode: r.item_code, description: r.description, uom: r.uom, qty: r.qty, unitPriceSen: r.unit_price_sen, lineTotalSen: r.line_total_sen };
}

export async function nextSiNumber(env: Env): Promise<string> {
  const year = nowIso().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(invoice_number) AS mx FROM sales_invoices WHERE invoice_number LIKE ?', `SINV-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `SINV-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

export async function recomputeSiStatus(env: Env, id: string): Promise<void> {
  const cur = await one<{ total_sen: number; paid_sen: number; status: string }>(env, 'SELECT total_sen, paid_sen, status FROM sales_invoices WHERE id = ?', id);
  if (!cur || cur.status === 'CANCELLED') return;
  const status = cur.paid_sen <= 0 ? 'SENT' : cur.paid_sen >= cur.total_sen ? 'PAID' : 'PARTIALLY_PAID';
  await run(env, 'UPDATE sales_invoices SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
}
