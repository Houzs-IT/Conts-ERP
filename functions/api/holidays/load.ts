import { type Env, all, json, fail, audit, nowIso, run } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { holidaysReady, HOLIDAYS_NOT_MIGRATED, mayEditHolidays, MALAYSIA_HOLIDAYS } from '../../_lib/holidays';
import { requeueForHolidays } from '../../_lib/holidayQueue';

/** POST /api/holidays/load { year, dryRun? } — adds the built-in starting list of Malaysia's national holidays for a
 *  year (functions/_lib/holidays.ts MALAYSIA_HOLIDAYS) as all-state staff days off. A date already on the list for all
 *  states is left as it is. dryRun answers what would be added, for the screen to show before saving. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditHolidays(session)) return fail('FORBIDDEN', 'Changing the public holiday list needs Full access to Pricing, or edit access to Employees.', 403);
  if (!(await holidaysReady(env))) return fail('NOT_MIGRATED', HOLIDAYS_NOT_MIGRATED, 503);
  const b = await request.json<any>().catch(() => null);
  const year = Number(b?.year);
  const list = MALAYSIA_HOLIDAYS[year];
  if (!list) return fail('VALIDATION', `There is no built-in list for ${Number.isInteger(year) ? year : 'that year'}. Add the holidays one by one.`, 422, { year: 'No built-in list.' });
  const have = new Set((await all<{ holiday_date: string }>(env, `SELECT holiday_date FROM public_holidays WHERE state IS NULL AND holiday_date LIKE ?`, `${year}-%`)).map(r => r.holiday_date));
  const items = list.map(h => ({ date: h.date, name: h.name, check: !!h.check, status: have.has(h.date) ? 'on_list' as const : 'new' as const }));
  const fresh = items.filter(i => i.status === 'new');
  if (b?.dryRun === true || !fresh.length) return json({ year, dryRun: b?.dryRun === true, items, added: 0 });
  const now = nowIso();
  await run(env, `INSERT INTO public_holidays (id, holiday_date, name, state, staff_day_off, created_at, updated_at)
    SELECT x.id, x.date, x.name, NULL, true, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, date text, name text)
    ON CONFLICT DO NOTHING`, now, now, JSON.stringify(fresh.map(h => ({ id: crypto.randomUUID(), date: h.date, name: h.name }))));
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'holiday.load', entityTable: 'public_holidays', entityId: `malaysia:${year}`,
    after: { year, added: fresh.map(h => ({ date: h.date, name: h.name })) } });
  const queued = await requeueForHolidays(env, fresh.map(h => ({ date: h.date, state: null })), `malaysia:${year}`);
  return json({ year, dryRun: false, items, added: fresh.length, queued });
};
