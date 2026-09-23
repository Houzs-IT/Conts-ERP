/** Payment Vouchers (AP), ported from 2990's SCM. Pays purchase invoices. */
import { type Env, one, nowIso } from './db';

export const PV_METHODS = ['TRANSFER', 'CASH', 'CHEQUE', 'CARD', 'OTHER'] as const;

export interface PvHeaderRow {
  id: string; voucher_number: string; supplier_id: string; payment_date: string; method: string; reference: string | null;
  amount_sen: number; notes: string | null; status: string; created_at: string; updated_at: string;
  supplier_code?: string | null; supplier_name?: string | null;
}
export interface PvAllocRow { id: string; purchase_invoice_id: string; amount_sen: number; invoice_number?: string | null; invoice_total_sen?: number | null }

export function toPvHeaderPayload(r: PvHeaderRow) {
  return {
    id: r.id, voucherNumber: r.voucher_number, supplierId: r.supplier_id, paymentDate: r.payment_date, method: r.method,
    reference: r.reference ?? '', amountSen: r.amount_sen, notes: r.notes ?? '', status: r.status,
    supplierCode: r.supplier_code ?? '', supplierName: r.supplier_name ?? '',
  };
}
export function toPvAllocPayload(r: PvAllocRow) {
  return { id: r.id, purchaseInvoiceId: r.purchase_invoice_id, amountSen: r.amount_sen, invoiceNumber: r.invoice_number ?? '', invoiceTotalSen: r.invoice_total_sen ?? 0 };
}

export async function nextVoucherNumber(env: Env): Promise<string> {
  const year = nowIso().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(voucher_number) AS mx FROM payment_vouchers WHERE voucher_number LIKE ?', `PV-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `PV-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}
