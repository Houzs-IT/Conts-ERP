/* Supplier bills booked more than once, grouped for Finance to review (the
   rows that predate the refusal in duplicate-supplier-bill.ts). Ported from
   Houzs. The grouping key is the refusal's own: company, supplier, the table
   the bill lives in, quotation or formal invoice (Conts; Houzs used the AP doc
   kind), and billRefKey of the supplier's bill number. A cancelled copy is not
   live and never forms or joins a group. */

import { billRefKey } from './duplicate-supplier-bill';

export type BillTable = 'purchase_invoices' | 'ap_invoices';

export type BillRow = {
  table: BillTable;
  id: string;
  companyId: number;
  supplierId: string | null;
  supplierInvoiceRef: string | null;
  /** An AP invoice booked on the supplier's quotation (ap_invoices.provisional); always false on a purchase invoice. */
  quotation: boolean;
  status: string;
};

export type BillGroup<R extends BillRow> = {
  table: BillTable;
  supplierId: string;
  quotation: boolean;
  billKey: string;
  rows: R[];
};

export function groupDuplicateBills<R extends BillRow>(rows: readonly R[]): BillGroup<R>[] {
  const byKey = new Map<string, BillGroup<R>>();
  for (const r of rows) {
    if (String(r.status).toUpperCase() === 'CANCELLED') continue;
    const billKey = billRefKey(r.supplierInvoiceRef);
    if (!billKey || !r.supplierId) continue;
    const k = JSON.stringify([r.companyId, r.table, r.supplierId, r.quotation, billKey]);
    let g = byKey.get(k);
    if (!g) { g = { table: r.table, supplierId: r.supplierId, quotation: r.quotation, billKey, rows: [] }; byKey.set(k, g); }
    g.rows.push(r);
  }
  return [...byKey.values()].filter((g) => g.rows.length > 1);
}
