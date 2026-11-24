import { type Env, all, one } from './db';
import { hasColumn } from './auth';
import type { Bed } from './unitPurpose';

/** The bed size list (King, Queen, ...) a unit's Beds and mattresses pick from, kept by staff on Units > Unit settings
 *  (owner, 4 Nov 2026; migration 0210). Before 0210 it is the fixed list below. units.beds holds the key. */
export interface BedSizeRow { key: string; label: string; sortOrder: number; isActive: boolean }

export const BUILT_IN_BED_SIZES: readonly BedSizeRow[] = [
  ['king', 'King'], ['queen', 'Queen'], ['super_single', 'Super single'], ['single', 'Single'], ['sofa_bed', 'Sofa bed'],
  ['single_floor_mattress', 'Single floor mattress'], ['double_decker', 'Double decker'],
].map(([key, label], n) => ({ key, label, sortOrder: (n + 1) * 10, isActive: true }));

export const bedSizesReady = (env: Env): Promise<boolean> => hasColumn(env, 'unit_bed_sizes', 'key');

/** Every size, hidden ones too (a unit may still have one), in the order staff set. */
export async function bedSizes(env: Env): Promise<BedSizeRow[]> {
  if (!(await bedSizesReady(env))) return [...BUILT_IN_BED_SIZES];
  const rows = await all<{ key: string; label: string; sort_order: number; is_active: boolean }>(env,
    'SELECT key, label, sort_order, is_active FROM unit_bed_sizes ORDER BY sort_order, label');
  return rows.map(r => ({ key: r.key, label: r.label, sortOrder: Number(r.sort_order), isActive: r.is_active === true }));
}

/** A bed size that is not on the list, or hidden and not already on this unit, or null. */
export async function invalidBedSizes(env: Env, beds: Bed[] | undefined, unitId?: string): Promise<{ field: string; message: string } | null> {
  if (!beds?.length) return null;
  const sizes = await bedSizes(env);
  const cur = unitId ? await one<{ beds: unknown }>(env, 'SELECT beds FROM units WHERE id = ?', unitId) : null;
  const stored: unknown = typeof cur?.beds === 'string' ? JSON.parse(cur.beds) : cur?.beds;
  const had = new Set((Array.isArray(stored) ? stored as Bed[] : []).map(b => b.size));
  const bad = beds.find(b => !sizes.some(s => s.key === b.size && (s.isActive || had.has(b.size))));
  return bad ? { field: 'beds', message: 'Pick a bed size from the list.' } : null;
}
