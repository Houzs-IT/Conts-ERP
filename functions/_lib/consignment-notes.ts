/** Consignment Notes (sell-side), ported from 2990's SCM concept. Money integer sen. */
import { intOrNull } from './scm-util';

export const CN_STATUSES = ['OPEN', 'PARTIALLY_SETTLED', 'CLOSED', 'CANCELLED'] as const;
export const isCnStatus = (v: unknown): v is typeof CN_STATUSES[number] => typeof v === 'string' && (CN_STATUSES as readonly string[]).includes(v);

export interface CnHeaderRow {
  id: string; cn_number: string; consignee_name: string; consignee_phone: string | null; cn_date: string; status: string;
  notes: string | null; total_sen: number; created_at: string; updated_at: string;
}
export interface CnLineRow { id: string; line_no: number; item_code: string; description: string; uom: string; qty_consigned: number; qty_sold: number; qty_returned: number; unit_price_sen: number; line_total_sen: number }

export function toCnHeaderPayload(r: CnHeaderRow) {
  return { id: r.id, cnNumber: r.cn_number, consigneeName: r.consignee_name, consigneePhone: r.consignee_phone ?? '', cnDate: r.cn_date, status: r.status, notes: r.notes ?? '', totalSen: r.total_sen };
}
export function toCnLinePayload(r: CnLineRow) {
  return { id: r.id, lineNo: r.line_no, itemCode: r.item_code, description: r.description, uom: r.uom, qtyConsigned: r.qty_consigned, qtySold: r.qty_sold, qtyReturned: r.qty_returned, unitPriceSen: r.unit_price_sen, lineTotalSen: r.line_total_sen };
}

export interface CnNormLine { itemCode: string; description: string; uom: string; qtyConsigned: number; unitPriceSen: number; lineTotalSen: number }
export function normalizeCnLines(raw: unknown): CnNormLine[] {
  if (!Array.isArray(raw)) return [];
  const out: CnNormLine[] = [];
  for (const l of raw as Record<string, unknown>[]) {
    const itemCode = String(l.itemCode ?? '').trim();
    const description = String(l.description ?? '').trim();
    if (!itemCode || !description) continue;
    const qtyConsigned = Math.max(0, intOrNull(l.qtyConsigned) ?? 0);
    const unitPriceSen = Math.max(0, intOrNull(l.unitPriceSen) ?? 0);
    if (qtyConsigned <= 0) continue;
    out.push({ itemCode, description, uom: String(l.uom ?? 'UNIT').trim() || 'UNIT', qtyConsigned, unitPriceSen, lineTotalSen: qtyConsigned * unitPriceSen });
  }
  return out;
}
