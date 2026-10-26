import { type Env, all } from './db';
import { hasColumn } from './auth';

/** The unit Type list (Studio, 1 bedroom, ...), kept by staff on the Units screen (staff sheet UNIT, 26 Oct 2026;
 *  migration 0147). Before 0147 it is the fixed list below, the one units.layout_type was checked against. The cleaning
 *  price grid has a row per active type (servicePrices.layoutGrid). */
export interface LayoutTypeRow { key: string; label: string; sortOrder: number; isActive: boolean }

export const BUILT_IN_LAYOUTS: readonly LayoutTypeRow[] = [
  ['studio', 'Studio'], ['1_bedroom', '1 bedroom'], ['2_bedroom', '2 bedroom'], ['3_bedroom', '3 bedroom'], ['4_plus_bedroom', '4+ bedroom'],
  ['duplex', 'Duplex'], ['dual_key', 'Dual key'], ['penthouse', 'Penthouse'], ['other', 'Other'],
].map(([key, label], n) => ({ key, label, sortOrder: key === 'other' ? 1000 : (n + 1) * 10, isActive: true }));

export const layoutTypesReady = (env: Env): Promise<boolean> => hasColumn(env, 'unit_layout_types', 'key').catch(() => false);

/** Every type, hidden ones too (a unit may still have one), in the order staff set. */
export async function layoutTypes(env: Env): Promise<LayoutTypeRow[]> {
  if (!(await layoutTypesReady(env))) return [...BUILT_IN_LAYOUTS];
  const rows = await all<{ key: string; label: string; sort_order: number; is_active: boolean }>(env,
    'SELECT key, label, sort_order, is_active FROM unit_layout_types ORDER BY sort_order, label');
  return rows.map(r => ({ key: r.key, label: r.label, sortOrder: Number(r.sort_order), isActive: r.is_active === true }));
}

/** A key for a new type from its label: "Loft 2 storey" -> "loft_2_storey". Empty when the label has no letter or digit. */
export const layoutKeyOf = (label: string): string => label.trim().toLowerCase().replace(/\+/g, '_plus').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
