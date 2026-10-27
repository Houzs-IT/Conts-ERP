import { type Env, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { todayMyt } from '../../_lib/ops';
import { showcaseUnits, todayBlock, fiveStarReviews, insights, liveFigures, readOverrides, showcaseReady, addDays } from '../../_lib/showcase';

/** GET /api/showcase — everything the Owner Showcase opens with: today's arrivals, departures and stays on the books,
 *  the listings, the newest five-star reviews, the portfolio's live figures over the last 30 days and the overrides
 *  set in Showcase control. Area Performance (functions/_lib/access.ts). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const units = await showcaseUnits(env);
  const today = todayMyt();
  const [day, reviews, ins, overrides, ready] = await Promise.all([
    todayBlock(env, units), fiveStarReviews(env, units, 14), insights(env, units, addDays(today, -30), addDays(today, -1)), readOverrides(env), showcaseReady(env),
  ]);
  return json({
    generatedAt: new Date().toISOString(), today: day, listings: units, reviews,
    live: liveFigures(day, units, ins), overrides, overridesReady: ready,
  });
};
