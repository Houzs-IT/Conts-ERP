/** Racks & Bins, ported from 2990's SCM. Rack/bin location master inside a warehouse. */

export interface RackRow {
  id: string; warehouse_id: string; rack: string; position: string | null; status: string; reserved: number;
  notes: string | null; warehouse_code?: string | null; warehouse_name?: string | null;
}

export function toRackPayload(r: RackRow) {
  return {
    id: r.id, warehouseId: r.warehouse_id, rack: r.rack, position: r.position ?? '', status: r.status,
    reserved: r.reserved === 1, notes: r.notes ?? '', warehouseCode: r.warehouse_code ?? '', warehouseName: r.warehouse_name ?? '',
  };
}

export function invalidRack(b: { warehouseId?: unknown; rack?: unknown }): { field: string; message: string } | null {
  if (typeof b.warehouseId !== 'string' || !b.warehouseId.trim()) return { field: 'warehouseId', message: 'Pick a warehouse.' };
  if (typeof b.rack !== 'string' || !b.rack.trim()) return { field: 'rack', message: 'Enter a rack / bin code.' };
  return null;
}
