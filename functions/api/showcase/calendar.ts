import { type Env, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { showcaseUnits, calendar } from '../../_lib/showcase';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/showcase/calendar?from=YYYY-MM-DD&days=21&unitId= — the Owner Showcase calendar: stays and nightly
 *  Airbnb prices of every listed unit (timeline) or one (month view). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const q = new URL(request.url).searchParams;
  const from = q.get('from') ?? '', days = Math.floor(Number(q.get('days') ?? 21)), unitId = q.get('unitId') || null;
  if (!DATE.test(from)) return fail('VALIDATION', 'Pick the first day to show.', 422);
  if (!(days >= 1 && days <= 42)) return fail('VALIDATION', 'Show between 1 and 42 days.', 422);

  const units = await showcaseUnits(env, unitId);
  if (unitId && !units.length) return fail('NOT_FOUND', 'That unit is not listed.', 404);
  return json(await calendar(env, units, from, days));
};
