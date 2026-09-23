/** Warehouse master, ported from 2990's SCM (`warehouses`). Exactly one default. */

export interface WarehouseRow {
  id: string; code: string; name: string; location: string | null; is_active: number; is_default: number;
}

export function toWarehousePayload(r: WarehouseRow) {
  return { id: r.id, code: r.code, name: r.name, location: r.location ?? '', isActive: r.is_active === 1, isDefault: r.is_default === 1 };
}

export function invalidWarehouse(b: { code?: unknown; name?: unknown }): { field: string; message: string } | null {
  if (typeof b.code !== 'string' || !b.code.trim()) return { field: 'code', message: 'Enter a warehouse code.' };
  if (typeof b.name !== 'string' || !b.name.trim()) return { field: 'name', message: 'Enter a name.' };
  return null;
}
