/** Delivery Orders, ported from 2990's SCM. Delivers a sales order. Money integer sen. */
import { type Env, all, one, run, nowIso } from './db';

export const DO_STATUSES = ['LOADED', 'DISPATCHED', 'IN_TRANSIT', 'SIGNED', 'DELIVERED', 'INVOICED', 'CANCELLED'] as const;
export type DoStatus = typeof DO_STATUSES[number];
export const isDoStatus = (v: unknown): v is DoStatus => typeof v === 'string' && (DO_STATUSES as readonly string[]).includes(v);
export const DO_FLOW: DoStatus[] = ['LOADED', 'DISPATCHED', 'IN_TRANSIT', 'SIGNED', 'DELIVERED'];
export function nextDoStatus(cur: string): DoStatus | null {
  const i = DO_FLOW.indexOf(cur as DoStatus);
  return i >= 0 && i < DO_FLOW.length - 1 ? DO_FLOW[i + 1] : null;
}

export interface DoHeaderRow {
  id: string; do_number: string; sales_order_id: string | null; customer_name: string; do_date: string;
  expected_delivery_at: string | null; status: string; driver_name: string | null; vehicle: string | null;
  address1: string | null; city: string | null; state: string | null; postcode: string | null; phone: string | null;
  notes: string | null; warehouse_id: string | null; created_at: string; updated_at: string;
  so_doc_no?: string | null; warehouse_name?: string | null;
}
export interface DoLineRow { id: string; sales_order_line_id: string | null; line_no: number; item_code: string; description: string; uom: string; qty: number; unit_price_sen: number; line_total_sen: number }

export function toDoHeaderPayload(r: DoHeaderRow) {
  return {
    id: r.id, doNumber: r.do_number, salesOrderId: r.sales_order_id ?? '', soDocNo: r.so_doc_no ?? '', customerName: r.customer_name,
    doDate: r.do_date, expectedDeliveryAt: r.expected_delivery_at ?? '', status: r.status, driverName: r.driver_name ?? '', vehicle: r.vehicle ?? '',
    address1: r.address1 ?? '', city: r.city ?? '', state: r.state ?? '', postcode: r.postcode ?? '', phone: r.phone ?? '', notes: r.notes ?? '',
    warehouseId: r.warehouse_id ?? '', warehouseName: r.warehouse_name ?? '',
  };
}
export function toDoLinePayload(r: DoLineRow) {
  return { id: r.id, salesOrderLineId: r.sales_order_line_id ?? '', lineNo: r.line_no, itemCode: r.item_code, description: r.description, uom: r.uom, qty: r.qty, unitPriceSen: r.unit_price_sen, lineTotalSen: r.line_total_sen };
}

export async function nextDoNumber(env: Env): Promise<string> {
  const year = nowIso().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(do_number) AS mx FROM delivery_orders WHERE do_number LIKE ?', `DO-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `DO-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

/** When every line of a sales order is fully delivered, advance it to DELIVERED. */
export async function maybeMarkSoDelivered(env: Env, soId: string): Promise<void> {
  const so = await one<{ status: string }>(env, 'SELECT status FROM sales_orders WHERE id = ?', soId);
  if (!so || ['DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED'].includes(so.status)) return;
  const lines = await all<{ qty: number; delivered_qty: number }>(env, 'SELECT qty, delivered_qty FROM sales_order_lines WHERE sales_order_id = ?', soId);
  if (lines.length > 0 && lines.every(l => l.delivered_qty >= l.qty)) {
    await run(env, 'UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ?', 'DELIVERED', nowIso(), soId);
  }
}
