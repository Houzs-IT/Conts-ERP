/** Purchase Orders, ported from 2990's SCM. Core priced document: header + lines.
 *  Money is integer sen. Furniture specials / MRP-SO linkage deferred to later tiers. */
import { intOrNull } from './scm-util';
import { checkDate, checkInt, checkSen, type Fields } from './validate';

export const PO_STATUSES = ['SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
export type PoStatus = typeof PO_STATUSES[number];
export const isPoStatus = (v: unknown): v is PoStatus => typeof v === 'string' && (PO_STATUSES as readonly string[]).includes(v);

export interface PoHeaderRow {
  id: string; po_number: string; supplier_id: string; status: string; po_date: string; expected_at: string | null;
  warehouse_id: string | null; currency: string; subtotal_sen: number; tax_sen: number; total_sen: number;
  notes: string | null; submitted_at: string | null; received_at: string | null; cancelled_at: string | null;
  created_at: string; updated_at: string; supplier_code?: string | null; supplier_name?: string | null;
}
export interface PoLineRow {
  id: string; line_no: number; item_code: string; description: string; uom: string;
  qty: number; unit_price_sen: number; discount_sen: number; line_total_sen: number; received_qty: number; notes: string | null;
}

export function toPoHeaderPayload(r: PoHeaderRow) {
  return {
    id: r.id, poNumber: r.po_number, supplierId: r.supplier_id, status: r.status, poDate: r.po_date,
    expectedAt: r.expected_at ?? '', warehouseId: r.warehouse_id ?? '', currency: r.currency,
    subtotalSen: r.subtotal_sen, taxSen: r.tax_sen, totalSen: r.total_sen, notes: r.notes ?? '',
    submittedAt: r.submitted_at ?? '', receivedAt: r.received_at ?? '', cancelledAt: r.cancelled_at ?? '',
    supplierCode: r.supplier_code ?? '', supplierName: r.supplier_name ?? '',
  };
}

export function toPoLinePayload(r: PoLineRow) {
  return {
    id: r.id, lineNo: r.line_no, itemCode: r.item_code, description: r.description, uom: r.uom,
    qty: r.qty, unitPriceSen: r.unit_price_sen, discountSen: r.discount_sen, lineTotalSen: r.line_total_sen, receivedQty: r.received_qty, notes: r.notes ?? '',
  };
}

export interface NormLine { itemCode: string; description: string; uom: string; qty: number; unitPriceSen: number; discountSen: number; lineTotalSen: number; notes: string | null }

/** Keep only lines with an item code + description; compute each line total (>= 0). */
export function normalizeLines(raw: unknown): NormLine[] {
  if (!Array.isArray(raw)) return [];
  const out: NormLine[] = [];
  for (const l of raw as Record<string, unknown>[]) {
    const itemCode = String(l.itemCode ?? '').trim();
    const description = String(l.description ?? '').trim();
    if (!itemCode || !description) continue;
    const qty = Math.max(0, intOrNull(l.qty) ?? 0);
    const unitPriceSen = Math.max(0, intOrNull(l.unitPriceSen) ?? 0);
    const discountSen = Math.max(0, intOrNull(l.discountSen) ?? 0);
    const lineTotalSen = Math.max(0, qty * unitPriceSen - discountSen);
    const notes = String(l.notes ?? '').trim() || null;
    out.push({ itemCode, description, uom: String(l.uom ?? 'UNIT').trim() || 'UNIT', qty, unitPriceSen, discountSen, lineTotalSen, notes });
  }
  return out;
}

export function computeTotals(lines: NormLine[], taxSen = 0) {
  const subtotal = lines.reduce((s, l) => s + l.lineTotalSen, 0);
  const tax = Math.max(0, taxSen);
  return { subtotalSen: subtotal, taxSen: tax, totalSen: subtotal + tax };
}

/** Field checks for a PO or PC body (header dates, tax, line numbers). Absent values pass, so PATCH uses it too. */
export function checkPricedBody(fields: Fields, b: Record<string, unknown>, dateKey: 'poDate' | 'pcDate', dateLabel: string) {
  checkDate(fields, dateKey, b[dateKey], { label: dateLabel });
  checkDate(fields, 'expectedAt', b.expectedAt, { label: 'Expected date' });
  checkSen(fields, 'taxSen', b.taxSen, { label: 'Tax' });
  if (!Array.isArray(b.lines)) return;
  (b.lines as Record<string, unknown>[]).forEach((l, i) => {
    checkInt(fields, `lines.${i}.qty`, l?.qty, { label: 'Quantity', min: 0 });
    checkSen(fields, `lines.${i}.unitPriceSen`, l?.unitPriceSen, { label: 'Unit price' });
    checkSen(fields, `lines.${i}.discountSen`, l?.discountSen, { label: 'Discount' });
  });
}
