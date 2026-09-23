/** Purchase Consignment Orders, ported from 2990's SCM. Same shape as a purchase order,
 *  for consigned stock. Reuses the PO status set + line helpers. Money integer sen. */
export { PO_STATUSES as PC_STATUSES, isPoStatus as isPcStatus, normalizeLines, computeTotals } from './purchase-orders';

export interface PcHeaderRow {
  id: string; pc_number: string; supplier_id: string; status: string; pc_date: string; expected_at: string | null;
  warehouse_id: string | null; currency: string; subtotal_sen: number; tax_sen: number; total_sen: number;
  notes: string | null; submitted_at: string | null; cancelled_at: string | null;
  created_at: string; updated_at: string; supplier_code?: string | null; supplier_name?: string | null;
}
export interface PcLineRow {
  id: string; line_no: number; item_code: string; description: string; uom: string;
  qty: number; unit_price_sen: number; discount_sen: number; line_total_sen: number; received_qty: number; notes: string | null;
}

export function toPcHeaderPayload(r: PcHeaderRow) {
  return {
    id: r.id, pcNumber: r.pc_number, supplierId: r.supplier_id, status: r.status, pcDate: r.pc_date,
    expectedAt: r.expected_at ?? '', warehouseId: r.warehouse_id ?? '', currency: r.currency,
    subtotalSen: r.subtotal_sen, taxSen: r.tax_sen, totalSen: r.total_sen, notes: r.notes ?? '',
    supplierCode: r.supplier_code ?? '', supplierName: r.supplier_name ?? '',
  };
}
export function toPcLinePayload(r: PcLineRow) {
  return {
    id: r.id, lineNo: r.line_no, itemCode: r.item_code, description: r.description, uom: r.uom,
    qty: r.qty, unitPriceSen: r.unit_price_sen, discountSen: r.discount_sen, lineTotalSen: r.line_total_sen, receivedQty: r.received_qty, notes: r.notes ?? '',
  };
}
