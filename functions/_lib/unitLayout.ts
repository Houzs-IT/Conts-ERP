import type { Env } from './db';
import { hasColumn } from './auth';

/** A unit's size for the cleaning screens (owner requests K3 and K5, 11 Oct 2026): "2 bed · 1 bath", and its layout
 *  type when the unit has one. units.layout_type comes with the units work (migration 0123) and may not be on the
 *  database yet, so it is read only when the column exists. */
export async function unitLayoutSql(env: Env, alias = 'u'): Promise<string> {
  const has = await hasColumn(env, 'units', 'layout_type').catch(() => false);
  return has ? `${alias}.layout_type::text` : 'NULL::text';
}

/** How many beds and mattresses the unit sleeps on, from units.beds (migration 0125), for the cleaning screens:
 *  the cleaner brings that many sets of linen (staff sheet CLEANING, 23 Oct 2026). NULL before 0125. */
export async function unitMattressesSql(env: Env, alias = 'u'): Promise<string> {
  const has = await hasColumn(env, 'units', 'beds').catch(() => false);
  return has ? `(SELECT SUM((b->>'quantity')::int) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${alias}.beds) = 'array' THEN ${alias}.beds ELSE '[]'::jsonb END) b)` : 'NULL::int';
}

export interface UnitLayout { bedrooms: number | null; bathrooms: number | null; size: string | null; layout: string | null }

const tidy = (v: string) => (/[A-Z]/.test(v) ? v : v.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()));

/** From a row with bedrooms, bathrooms and layout_type, and mattresses when the query selected it
 *  (unitMattressesSql): "2 bed · 3 mattresses · 1 bath". A unit with no bedrooms is a studio. */
export function unitLayout(r: { bedrooms?: unknown; bathrooms?: unknown; layout_type?: unknown; mattresses?: unknown }): UnitLayout {
  const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const bed = num(r.bedrooms), bath = num(r.bathrooms), mat = num(r.mattresses);
  const parts = [bed == null ? null : bed === 0 ? 'Studio' : `${bed} bed`, mat ? `${mat} ${mat === 1 ? 'mattress' : 'mattresses'}` : null,
    bath == null ? null : `${bath} bath`].filter(Boolean);
  const layout = typeof r.layout_type === 'string' && r.layout_type.trim() ? tidy(r.layout_type.trim()) : null;
  return { bedrooms: bed, bathrooms: bath, size: parts.length ? parts.join(' · ') : null, layout };
}
