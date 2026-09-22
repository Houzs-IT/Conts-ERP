/** Stock movements ledger, ported from 2990's SCM inventory (quantity-only first cut). */
export const MOVEMENT_TYPES = ['RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'RETURN', 'STOCK_TAKE'] as const;

export interface OnHandRow { item_code: string; warehouse_id: string; warehouse_code: string; warehouse_name: string; on_hand: number; item_name: string | null }
export interface MovementRow {
  id: string; item_code: string; warehouse_id: string; warehouse_code?: string | null; warehouse_name?: string | null;
  qty_delta: number; movement_type: string; ref_type: string | null; ref_id: string | null; note: string | null; moved_at: string;
}

export function toOnHandPayload(r: OnHandRow) {
  return { itemCode: r.item_code, itemName: r.item_name ?? '', warehouseId: r.warehouse_id, warehouseCode: r.warehouse_code, warehouseName: r.warehouse_name, onHand: r.on_hand };
}
export function toMovementPayload(r: MovementRow) {
  return { id: r.id, itemCode: r.item_code, warehouseId: r.warehouse_id, warehouseCode: r.warehouse_code ?? '', warehouseName: r.warehouse_name ?? '', qtyDelta: r.qty_delta, movementType: r.movement_type, refType: r.ref_type ?? '', refId: r.ref_id ?? '', note: r.note ?? '', movedAt: r.moved_at };
}
