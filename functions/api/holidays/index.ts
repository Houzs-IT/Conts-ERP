import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import {
  holidaysReady, HOLIDAYS_NOT_MIGRATED, listHolidays, readHolidayInput, normalizeState, mayEditHolidays, maySeeHolidays,
  MY_STATES, MALAYSIA_HOLIDAYS,
} from '../../_lib/holidays';
import { requeueForHolidays } from '../../_lib/holidayQueue';

/** GET /api/holidays[?year=YYYY] — the company's public holiday list (Pricing > Public holidays, HR > Workers > Leave),
 *  with the states a holiday can belong to, how many units each state has, and whether the caller may change it. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!maySeeHolidays(session)) return fail('FORBIDDEN', 'Your access does not include the public holiday list.', 403);
  if (!(await holidaysReady(env))) return fail('NOT_MIGRATED', HOLIDAYS_NOT_MIGRATED, 503);
  const year = new URL(request.url).searchParams.get('year');
  if (year !== null && !/^\d{4}$/.test(year)) return fail('VALIDATION', 'Pick a year.', 422);
  const [data, buildings, years] = await Promise.all([
    year ? listHolidays(env, `${year}-01-01`, `${year}-12-31`) : listHolidays(env),
    all<{ state: string | null; units: number }>(env, `SELECT p.state, count(u.id)::int AS units FROM properties p JOIN units u ON u.property_id = p.id GROUP BY p.state`),
    all<{ y: string }>(env, `SELECT DISTINCT substr(holiday_date, 1, 4) AS y FROM public_holidays ORDER BY 1`),
  ]);
  // Units per state as the list matches them; a building whose state is not recognised follows only all-state holidays.
  const unitsByState: Record<string, number> = {};
  let unmatched = 0;
  for (const b of buildings) { const st = normalizeState(b.state); if (st) unitsByState[st] = (unitsByState[st] ?? 0) + b.units; else unmatched += b.units; }
  return json({
    data, states: MY_STATES, unitsByState, unmatchedUnits: unmatched, totalUnits: buildings.reduce((n, b) => n + b.units, 0),
    years: years.map(r => Number(r.y)), builtinYears: Object.keys(MALAYSIA_HOLIDAYS).map(Number),
    canEdit: mayEditHolidays(session),
  });
};

/** POST /api/holidays { date, name, state (null: all states), staffDayOff? } — adds one holiday. The prices of that
 *  night go to Channex again for every unit it applies to. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditHolidays(session)) return fail('FORBIDDEN', 'Changing the public holiday list needs Full access to Pricing, or edit access to Employees.', 403);
  if (!(await holidaysReady(env))) return fail('NOT_MIGRATED', HOLIDAYS_NOT_MIGRATED, 503);
  const r = readHolidayInput(await request.json().catch(() => null));
  if ('field' in r) return fail('VALIDATION', r.message, 422, { [r.field]: r.message });
  const h = r.value;
  if (await one(env, `SELECT 1 AS x FROM public_holidays WHERE holiday_date = ? AND COALESCE(state, '') = ?`, h.date, h.state ?? '')) {
    return fail('DUPLICATE', `${h.date} is already on the list${h.state ? ` for ${h.state}` : ' for all states'}.`, 409, { date: 'Already on the list.' });
  }
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `INSERT INTO public_holidays (id, holiday_date, name, state, staff_day_off, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, h.date, h.name, h.state, h.staffDayOff, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'holiday.add', entityTable: 'public_holidays', entityId: id, after: h });
  const queued = await requeueForHolidays(env, [{ date: h.date, state: h.state }], id);
  return json({ data: { id, ...h, updatedAt: now }, queued }, 201);
};
