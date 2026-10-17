import { type Env, all, one } from './db';
import { hasColumn } from './auth';

/** Cleaning prices (owner, 17 Oct 2026): clean type x unit layout, each with the internal cost (what the cleaner is paid)
 *  and the external charge (what is charged for the clean: the cleaning fee on the unit's costs). A unit may override
 *  its own. Nothing set means "price not set": a finished clean is then charged the way it was before (cleanPrice). */
export const PRICE_KINDS = ['turnover', 'deep_clean', 'light_clean'] as const;
export const LAYOUTS = ['studio', '1_bedroom', '2_bedroom', '3_bedroom', '4_plus_bedroom', 'duplex', 'dual_key', 'penthouse', 'other'] as const;

/** Migration 0126. Without it there are no price tables and no external jobs. */
export const hasCleanPrices = (env: Env) => hasColumn(env, 'tasks', 'amount').catch(() => false);

/** The price-table row a unit falls in: its layout type, else its bedrooms (0 studio, 4 or more 4+), else Other. */
export function layoutKey(layoutType: unknown, bedrooms: unknown): string {
  if (typeof layoutType === 'string' && (LAYOUTS as readonly string[]).includes(layoutType)) return layoutType;
  const n = bedrooms == null || bedrooms === '' ? NaN : Number(bedrooms);
  if (!Number.isFinite(n)) return 'other';
  return n <= 0 ? 'studio' : n >= 4 ? '4_plus_bedroom' : `${n}_bedroom`;
}

export interface CleanAmounts { internal: number | null; external: number | null; source: 'unit' | 'table' | null }
const priceKind = (kind: string) => ((PRICE_KINDS as readonly string[]).includes(kind) ? kind : 'turnover');

/** The amounts for cleans on these units, keyed `${unitId}:${kind}`. A unit's own figure wins, field by field. */
export async function priceBook(env: Env, unitIds: string[]): Promise<(unitId: string, kind: string, layout: string) => CleanAmounts> {
  if (!(await hasCleanPrices(env))) return () => ({ internal: null, external: null, source: null });
  const table = await all<{ kind: string; layout: string; internal_cost: number | null; external_charge: number | null }>(env,
    'SELECT kind, layout, internal_cost, external_charge FROM cleaning_prices');
  const ids = [...new Set(unitIds.filter(Boolean))];
  const own = ids.length ? await all<{ unit_id: string; kind: string; internal_cost: number | null; external_charge: number | null }>(env,
    'SELECT unit_id, kind, internal_cost, external_charge FROM unit_cleaning_prices WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', JSON.stringify(ids)) : [];
  const t = new Map(table.map(r => [`${r.kind}:${r.layout}`, r]));
  const u = new Map(own.map(r => [`${r.unit_id}:${r.kind}`, r]));
  return (unitId, kind, layout) => {
    const k = priceKind(kind);
    const o = u.get(`${unitId}:${k}`), d = t.get(`${k}:${layout}`);
    const internal = o?.internal_cost ?? d?.internal_cost ?? null, external = o?.external_charge ?? d?.external_charge ?? null;
    const source = (o && (o.internal_cost != null || o.external_charge != null)) ? 'unit' : (internal != null || external != null) ? 'table' : null;
    return { internal: internal == null ? null : Number(internal), external: external == null ? null : Number(external), source };
  };
}

/** The amounts for one clean on one unit. */
export async function cleanAmounts(env: Env, unitId: string, kind: string): Promise<CleanAmounts> {
  const u = await one<{ layout: string | null; bedrooms: number | null }>(env,
    `SELECT ${(await hasColumn(env, 'units', 'layout_type').catch(() => false)) ? 'layout_type' : 'NULL::text'} AS layout, bedrooms FROM units WHERE id = ?`, unitId);
  if (!u) return { internal: null, external: null, source: null };
  return (await priceBook(env, [unitId]))(unitId, kind, layoutKey(u.layout, u.bedrooms));
}
