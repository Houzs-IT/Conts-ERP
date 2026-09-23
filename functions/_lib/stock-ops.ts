/** Stock Transfers + Stock Takes, ported from 2990's SCM. Post to the stock_movements ledger. */
import { type Env, one, nowIso } from './db';

export interface TransferHeaderRow {
  id: string; transfer_number: string; from_warehouse_id: string; to_warehouse_id: string; transfer_date: string;
  status: string; notes: string | null; created_at: string; updated_at: string; from_name?: string | null; to_name?: string | null;
}
export interface TransferLineRow { id: string; line_no: number; item_code: string; description: string | null; qty: number }
export interface TakeHeaderRow {
  id: string; take_number: string; warehouse_id: string; take_date: string; status: string; notes: string | null;
  created_at: string; updated_at: string; warehouse_name?: string | null;
}
export interface TakeLineRow { id: string; line_no: number; item_code: string; description: string | null; system_qty: number; counted_qty: number | null; variance: number | null }

export function toTransferPayload(r: TransferHeaderRow) {
  return { id: r.id, transferNumber: r.transfer_number, fromWarehouseId: r.from_warehouse_id, toWarehouseId: r.to_warehouse_id, fromName: r.from_name ?? '', toName: r.to_name ?? '', transferDate: r.transfer_date, status: r.status, notes: r.notes ?? '' };
}
export function toTransferLinePayload(r: TransferLineRow) { return { id: r.id, lineNo: r.line_no, itemCode: r.item_code, description: r.description ?? '', qty: r.qty }; }
export function toTakePayload(r: TakeHeaderRow) {
  return { id: r.id, takeNumber: r.take_number, warehouseId: r.warehouse_id, warehouseName: r.warehouse_name ?? '', takeDate: r.take_date, status: r.status, notes: r.notes ?? '' };
}
export function toTakeLinePayload(r: TakeLineRow) { return { id: r.id, lineNo: r.line_no, itemCode: r.item_code, description: r.description ?? '', systemQty: r.system_qty, countedQty: r.counted_qty, variance: r.variance }; }

export async function nextNumber(env: Env, table: string, col: string, prefix: string): Promise<string> {
  const year = nowIso().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, `SELECT MAX(${col}) AS mx FROM ${table} WHERE ${col} LIKE ?`, `${prefix}-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `${prefix}-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

/** On-hand for one item in one warehouse (running sum of the ledger). */
export async function onHandOf(env: Env, itemCode: string, warehouseId: string): Promise<number> {
  const r = await one<{ h: number }>(env, 'SELECT COALESCE(SUM(qty_delta), 0) AS h FROM stock_movements WHERE item_code = ? AND warehouse_id = ?', itemCode, warehouseId);
  return r?.h ?? 0;
}
