import type { Env } from './db';
import { hasColumn } from './auth';

/** A unit's size for the cleaning screens (owner requests K3 and K5, 11 Oct 2026): "2 bed · 1 bath", and its layout
 *  type when the unit has one. units.layout_type comes with the units work (migration 0123) and may not be on the
 *  database yet, so it is read only when the column exists. */
export async function unitLayoutSql(env: Env, alias = 'u'): Promise<string> {
  const has = await hasColumn(env, 'units', 'layout_type').catch(() => false);
  return has ? `${alias}.layout_type::text` : 'NULL::text';
}

export interface UnitLayout { bedrooms: number | null; bathrooms: number | null; size: string | null; layout: string | null }

const tidy = (v: string) => (/[A-Z]/.test(v) ? v : v.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()));

/** From a row with bedrooms, bathrooms and layout_type. A unit with no bedrooms is a studio. */
export function unitLayout(r: { bedrooms?: unknown; bathrooms?: unknown; layout_type?: unknown }): UnitLayout {
  const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const bed = num(r.bedrooms), bath = num(r.bathrooms);
  const parts = [bed == null ? null : bed === 0 ? 'Studio' : `${bed} bed`, bath == null ? null : `${bath} bath`].filter(Boolean);
  const layout = typeof r.layout_type === 'string' && r.layout_type.trim() ? tidy(r.layout_type.trim()) : null;
  return { bedrooms: bed, bathrooms: bath, size: parts.length ? parts.join(' · ') : null, layout };
}
