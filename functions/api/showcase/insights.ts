import { type Env, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { showcaseUnits, insights, fiveStarReviews } from '../../_lib/showcase';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/showcase/insights?from=YYYY-MM-DD&to=YYYY-MM-DD&unitId= — the Reviews, Occupancy and Lead Time pages
 *  of the Owner Showcase for the portfolio or one property, over [from, to]. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const q = new URL(request.url).searchParams;
  const from = q.get('from') ?? '', to = q.get('to') ?? '', unitId = q.get('unitId') || null;
  if (!DATE.test(from) || !DATE.test(to) || from > to) return fail('VALIDATION', 'Pick a start date on or before the end date.', 422);
  if (Date.parse(to) - Date.parse(from) > 400 * 864e5) return fail('VALIDATION', 'Pick a range of at most 13 months.', 422);

  const units = await showcaseUnits(env);
  if (unitId && !units.some(u => u.id === unitId)) return fail('NOT_FOUND', 'That unit is not listed.', 404);
  const one = unitId ? units.filter(u => u.id === unitId) : null;
  const [ins, reviews] = await Promise.all([insights(env, units, from, to, unitId), one ? fiveStarReviews(env, one, 6) : Promise.resolve(null)]);
  return json({ ...ins, recentReviews: reviews });
};
