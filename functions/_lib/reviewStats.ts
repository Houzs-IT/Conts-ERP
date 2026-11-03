import { type Env, all } from './db';
import { categoryKeySql, tagInfo } from '../../src/lib/reviewRules';
import { cleanJobsSql } from './reviews';

/** Review figures by category, tag and cleaner (owner, 3 Nov 2026). Every category average is out of 5 over Airbnb
 *  and Booking.com together (a Booking.com 9/10 counts as 4.5), and says how many reviews it is over. Real reviews
 *  only: Demo mode's sample reviews never reach these figures. */

export type Group = 'unit' | 'building' | 'all';
export interface Scope { unitId?: string | null; propertyId?: string | null; from?: string | null }

/** The group key of review `v` (reservation `r`, unit `u`). */
const groupSql = (by: Group) => (by === 'building' ? `COALESCE(u.property_id, 'none')` : by === 'unit' ? `u.id` : `'all'`);
const BASE = `FROM reviews v LEFT JOIN reservations r ON r.id = v.reservation_id LEFT JOIN units u ON u.id = COALESCE(v.unit_id, r.unit_id)`;

function scopeSql(s: Scope): { cond: string; args: unknown[] } {
  const where: string[] = [], args: unknown[] = [];
  if (s.unitId) { where.push('u.id = ?'); args.push(s.unitId); }
  if (s.propertyId) { where.push('u.property_id = ?'); args.push(s.propertyId); }
  if (s.from) { where.push('substr(v.reviewed_at, 1, 10) >= ?'); args.push(s.from); }
  return { cond: where.length ? ` AND ${where.join(' AND ')}` : '', args };
}

export type CategoryAverages = Record<string, { average: number; reviews: number }>;

/** Average of each category per unit, building or overall. */
export async function categoryAverages(env: Env, by: Group, scope: Scope = {}): Promise<Map<string, CategoryAverages>> {
  const { cond, args } = scopeSql(scope);
  const rows = await all<{ g: string | null; cat: string; s5: number; n: number }>(env, `
    SELECT ${groupSql(by)} AS g, ${categoryKeySql("s->>'category'")} AS cat, sum((s->>'score')::float / 2) AS s5, count(*)::int AS n
    ${BASE} CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.scores, '[]'::jsonb)) s
    WHERE jsonb_typeof(s->'score') = 'number' ${by === 'unit' ? 'AND u.id IS NOT NULL' : ''}${cond}
    GROUP BY 1, 2`, ...args);
  const out = new Map<string, CategoryAverages>();
  for (const r of rows) {
    const k = String(r.g ?? 'none');
    const m = out.get(k) ?? {};
    m[r.cat] = { average: Math.round((Number(r.s5) / Number(r.n)) * 100) / 100, reviews: Number(r.n) };
    out.set(k, m);
  }
  return out;
}

/** Each category's average by month (yyyy-mm), oldest first, for the trend. */
export async function categoryTrend(env: Env, scope: Scope): Promise<{ month: string; reviews: number; average: number | null; categories: Record<string, number> }[]> {
  const { cond, args } = scopeSql(scope);
  const [cats, overall] = await Promise.all([
    all<{ month: string; cat: string; s5: number; n: number }>(env, `
      SELECT substr(v.reviewed_at, 1, 7) AS month, ${categoryKeySql("s->>'category'")} AS cat, sum((s->>'score')::float / 2) AS s5, count(*)::int AS n
      ${BASE} CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.scores, '[]'::jsonb)) s
      WHERE jsonb_typeof(s->'score') = 'number'${cond}
      GROUP BY 1, 2`, ...args),
    all<{ month: string; n: number; a: number | null }>(env, `
      SELECT substr(v.reviewed_at, 1, 7) AS month, count(*)::int AS n, ROUND(AVG(v.rating)::numeric, 2) AS a
      ${BASE} WHERE TRUE${cond} GROUP BY 1`, ...args),
  ]);
  const months = new Map<string, { month: string; reviews: number; average: number | null; categories: Record<string, number> }>();
  for (const o of overall) months.set(o.month, { month: o.month, reviews: Number(o.n), average: o.a == null ? null : Number(o.a), categories: {} });
  for (const c of cats) {
    const m = months.get(c.month) ?? { month: c.month, reviews: 0, average: null, categories: {} };
    m.categories[c.cat] = Math.round((Number(c.s5) / Number(c.n)) * 100) / 100;
    months.set(c.month, m);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface TagCount { code: string; label: string; tone: 'positive' | 'negative' | 'other'; count: number }

/** The tags guests picked (Airbnb), most common first, per unit, building or overall. */
export async function tagCounts(env: Env, by: Group, scope: Scope = {}, limit = 10): Promise<Map<string, { positive: TagCount[]; negative: TagCount[] }>> {
  const { cond, args } = scopeSql(scope);
  const rows = await all<{ g: string | null; tag: string; n: number }>(env, `
    SELECT ${groupSql(by)} AS g, t.tag, count(*)::int AS n
    ${BASE} CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(v.tags) = 'array' THEN v.tags ELSE '[]'::jsonb END) AS t(tag)
    WHERE TRUE ${by === 'unit' ? 'AND u.id IS NOT NULL' : ''}${cond}
    GROUP BY 1, 2 ORDER BY 3 DESC, 2`, ...args);
  const out = new Map<string, { positive: TagCount[]; negative: TagCount[] }>();
  for (const r of rows) {
    const k = String(r.g ?? 'none');
    const m = out.get(k) ?? { positive: [], negative: [] };
    const info = tagInfo(r.tag);
    const list = info.tone === 'positive' ? m.positive : m.negative;
    if (list.length < limit) list.push({ ...info, count: Number(r.n) });
    out.set(k, m);
  }
  return out;
}

export interface CleanerRow { cleanerId: string; name: string; reviews: number; average: number; low: number; lastReviewAt: string }

/** Average cleanliness per cleaner: every review with a cleanliness score, credited to each cleaner on the clean jobs
 *  that readied the unit for that stay (reviews.ts cleanJobsSql). A review two cleaners shared counts for both. */
export async function cleanlinessByCleaner(env: Env, scope: Scope, lowBelow: number): Promise<CleanerRow[]> {
  const { cond, args } = scopeSql(scope);
  const rows = await all<{ id: string; name: string; n: number; s5: number; low: number; last_at: string }>(env, `
    WITH rc AS (
      SELECT v.id, v.reviewed_at, (s->>'score')::float / 2 AS c5, ${cleanJobsSql('r', 'reservations')} AS jobs
      ${BASE} CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.scores, '[]'::jsonb)) s
      WHERE r.id IS NOT NULL AND jsonb_typeof(s->'score') = 'number' AND ${categoryKeySql("s->>'category'")} = 'cleanliness'${cond}
    ), credited AS (
      SELECT DISTINCT rc.id, rc.reviewed_at, rc.c5, c->>'id' AS cleaner_id, c->>'name' AS name
      FROM rc CROSS JOIN LATERAL jsonb_array_elements(COALESCE(rc.jobs, '[]'::jsonb)) j CROSS JOIN LATERAL jsonb_array_elements(j->'cleaners') c
    )
    SELECT cleaner_id AS id, max(name) AS name, count(*)::int AS n, sum(c5) AS s5, count(*) FILTER (WHERE c5 < ?)::int AS low, max(reviewed_at) AS last_at
    FROM credited GROUP BY cleaner_id ORDER BY sum(c5) / count(*), count(*) DESC`, ...args, lowBelow);
  return rows.map(r => ({
    cleanerId: r.id, name: r.name, reviews: Number(r.n), average: Math.round((Number(r.s5) / Number(r.n)) * 100) / 100,
    low: Number(r.low), lastReviewAt: String(r.last_at).slice(0, 10),
  }));
}
