import { type Env, all, one, json, fail, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { categoryAverages, categoryTrend, tagCounts } from '../../_lib/reviewStats';
import { AIRBNB_CATEGORIES, CATEGORY_FLAG_BELOW, categoryFlagged } from '../../../src/lib/reviewRules';

/** GET /api/reviews/health?unitId=|propertyId=&months=12 — how guests rate one unit, one building, or everything:
 *  each category's average (out of 5, Airbnb and Booking.com together) with the categories under CATEGORY_FLAG_BELOW,
 *  the same by month for the trend, the tags guests picked most (top compliments and top complaints), and, for a
 *  building or everything, the most common complaint of each unit or building. Real reviews only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);
  const url = new URL(request.url);
  const unitId = url.searchParams.get('unitId') || null;
  const propertyId = unitId ? null : url.searchParams.get('propertyId') || null;
  const months = Math.min(36, Math.max(1, Math.floor(Number(url.searchParams.get('months')) || 12)));
  const today = mytToday();
  const start = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - (months - 1), 1));
  const from = start.toISOString().slice(0, 10);
  const scope = { unitId, propertyId };
  const by = unitId ? 'unit' : propertyId ? 'unit' : 'building';

  const [label, overall, trend, tags, perPlace, placeTags, places] = await Promise.all([
    unitId ? one<{ label: string }>(env, `SELECT trim(COALESCE(p.name, '') || ' ' || u.unit_number) AS label FROM units u LEFT JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, unitId)
      : propertyId ? one<{ label: string }>(env, 'SELECT name AS label FROM properties WHERE id = ?', propertyId) : Promise.resolve({ label: 'All units' }),
    categoryAverages(env, 'all', scope),
    categoryTrend(env, { ...scope, from }),
    tagCounts(env, 'all', scope, 12),
    unitId ? Promise.resolve(new Map()) : categoryAverages(env, by, scope),
    unitId ? Promise.resolve(new Map()) : tagCounts(env, by, scope, 3),
    unitId ? Promise.resolve([]) : all<{ id: string; label: string }>(env, by === 'building'
      ? `SELECT id, name AS label FROM properties`
      : `SELECT u.id, u.unit_number AS label FROM units u WHERE u.property_id = ?`, ...(by === 'building' ? [] : [propertyId])),
  ]);
  if ((unitId || propertyId) && !label) return fail('NOT_FOUND', 'That unit or building no longer exists.', 404);
  const cats = overall.get('all') ?? {};
  const names = new Map(places.map(p => [p.id, p.label]));
  const placeIds = new Set([...perPlace.keys(), ...placeTags.keys()]);

  return json({
    generatedAt: new Date().toISOString(),
    scope: { unitId, propertyId, label: label?.label ?? 'All units', months, from },
    categoryKeys: AIRBNB_CATEGORIES, flagBelow: CATEGORY_FLAG_BELOW,
    categories: cats,
    flagged: Object.entries(cats).filter(([k, v]) => categoryFlagged(k, v.average)).map(([k]) => k),
    trend,
    tags: tags.get('all') ?? { positive: [], negative: [] },
    // Per building (everything) or per unit (a building): its categories, flags and top complaints.
    places: [...placeIds].map(id => {
      const c = perPlace.get(id) ?? {};
      return {
        id, by, label: names.get(id) ?? (id === 'none' ? 'No building' : 'Unit'), categories: c,
        flagged: Object.entries(c as Record<string, { average: number }>).filter(([k, v]) => categoryFlagged(k, v.average)).map(([k]) => k),
        topComplaints: placeTags.get(id)?.negative ?? [],
      };
    }).sort((a, b) => (a.categories.cleanliness?.average ?? 9) - (b.categories.cleanliness?.average ?? 9) || a.label.localeCompare(b.label)),
  });
};
