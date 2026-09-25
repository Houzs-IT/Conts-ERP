/** Stock Transfers + Stock Takes, ported from 2990's SCM. Post to the stock_movements ledger. */
import { type Env, one, run, nowIso } from './db';
import { genId } from './scm-util';

export type MovementType = 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'RETURN' | 'STOCK_TAKE';

/** Post one row to the stock_movements ledger. qtyDelta is signed (+ in, - out). Shared by
 *  manual adjustments, transfers, takes, and GRN/DO auto-wiring. */
export async function postStockMovement(env: Env, m: {
  itemCode: string; warehouseId: string; qtyDelta: number; movementType: MovementType;
  refType: string; refId: string; note?: string | null; movedAt: string; createdBy?: string | null;
}): Promise<void> {
  await run(env, `INSERT INTO stock_movements (id, item_code, warehouse_id, qty_delta, movement_type, ref_type, ref_id, note, moved_at, created_by, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    genId('mv'), m.itemCode, m.warehouseId, m.qtyDelta, m.movementType, m.refType, m.refId, m.note ?? null, m.movedAt, m.createdBy ?? null, nowIso());
}

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
  return Number(r?.h ?? 0);
}

export interface StockShortage { itemCode: string; needed: number; available: number; short: number }

/** Items these outgoing quantities would take below zero at one warehouse. The ledger itself
 *  allows negative stock (as in Houzs); each caller decides whether a shortage refuses outright
 *  or only asks. Repeated item codes are summed first, so two lines of the same item are judged
 *  together. Run it before writing anything, so a refusal leaves nothing changed. */
export async function stockShortages(env: Env, warehouseId: string, outgoing: { itemCode: string; qty: number }[]): Promise<StockShortage[]> {
  const byItem = new Map<string, number>();
  for (const o of outgoing) if (o.qty > 0) byItem.set(o.itemCode, (byItem.get(o.itemCode) ?? 0) + o.qty);
  const out: StockShortage[] = [];
  for (const [itemCode, needed] of byItem) {
    const available = await onHandOf(env, itemCode, warehouseId);
    if (needed > available) out.push({ itemCode, needed, available, short: needed - Math.max(0, available) });
  }
  return out;
}

/** "SF-3S at Main Warehouse: need 5, available 1 (short 4)" per item — Houzs's wording. */
export async function shortageText(env: Env, warehouseId: string, s: StockShortage[]): Promise<string> {
  const wh = await one<{ name: string }>(env, 'SELECT name FROM warehouses WHERE id = ?', warehouseId);
  const at = wh?.name ?? 'this warehouse';
  return s.map(x => `${x.itemCode} at ${at}: need ${x.needed}, available ${x.available} (short ${x.short})`).join('; ');
}
