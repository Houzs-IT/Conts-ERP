import { type Env, json, fail, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { cleanlinessByCleaner } from '../../_lib/reviewStats';
import { LOW_CLEANLINESS_BELOW } from '../../../src/lib/reviewRules';

/** GET /api/reviews/cleaners?months=6&propertyId=&unitId= — Cleanliness by cleaner: the average cleanliness score
 *  (out of 5, Airbnb and Booking.com together) of the stays each cleaner readied, over how many reviews, and how many
 *  of those were under LOW_CLEANLINESS_BELOW. A stay is credited to every cleaner on the clean jobs between the
 *  previous checkout and its check-in. Lowest average first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);
  const url = new URL(request.url);
  const months = Math.min(36, Math.max(1, Math.floor(Number(url.searchParams.get('months')) || 6)));
  const today = mytToday();
  const from = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - (months - 1), 1)).toISOString().slice(0, 10);
  const rows = await cleanlinessByCleaner(env, { from, propertyId: url.searchParams.get('propertyId'), unitId: url.searchParams.get('unitId') }, LOW_CLEANLINESS_BELOW);
  return json({ generatedAt: new Date().toISOString(), months, from, lowBelow: LOW_CLEANLINESS_BELOW, data: rows });
};
