import { type Env, run, json, fail, audit, nowIso, one } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { holidaysReady, HOLIDAYS_NOT_MIGRATED, holidayById, readHolidayInput, mayEditHolidays } from '../../_lib/holidays';
import { requeueForHolidays } from '../../_lib/holidayQueue';

/** PUT /api/holidays/:id { date?, name?, state?, staffDayOff? } — changes one holiday. When its date or state moves,
 *  the old and the new night are both sent to Channex again, for the units of the old and of the new state. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditHolidays(session)) return fail('FORBIDDEN', 'Changing the public holiday list needs Full access to Pricing, or edit access to Employees.', 403);
  if (!(await holidaysReady(env))) return fail('NOT_MIGRATED', HOLIDAYS_NOT_MIGRATED, 503);
  const was = await holidayById(env, String(params.id));
  if (!was) return fail('NOT_FOUND', 'That holiday is not on the list.', 404);
  const r = readHolidayInput(await request.json().catch(() => null), was);
  if ('field' in r) return fail('VALIDATION', r.message, 422, { [r.field]: r.message });
  const h = r.value;
  if (await one(env, `SELECT 1 AS x FROM public_holidays WHERE holiday_date = ? AND COALESCE(state, '') = ? AND id <> ?`, h.date, h.state ?? '', was.id)) {
    return fail('DUPLICATE', `${h.date} is already on the list${h.state ? ` for ${h.state}` : ' for all states'}.`, 409, { date: 'Already on the list.' });
  }
  const now = nowIso();
  await run(env, 'UPDATE public_holidays SET holiday_date = ?, name = ?, state = ?, staff_day_off = ?, updated_at = ? WHERE id = ?', h.date, h.name, h.state, h.staffDayOff, now, was.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'holiday.edit', entityTable: 'public_holidays', entityId: was.id,
    before: { date: was.date, name: was.name, state: was.state, staffDayOff: was.staffDayOff }, after: h });
  // Only a new date or state changes what the channels are sent.
  const moved = was.date !== h.date || was.state !== h.state;
  const queued = moved ? await requeueForHolidays(env, [{ date: was.date, state: was.state }, { date: h.date, state: h.state }], was.id) : 0;
  return json({ data: { id: was.id, ...h, updatedAt: now }, queued });
};

/** DELETE /api/holidays/:id — takes a holiday off the list. Nothing else hangs off it: leave balances and payroll read
 *  the list as it is, and the night goes back to its weekend or nightly price on the channels. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditHolidays(session)) return fail('FORBIDDEN', 'Changing the public holiday list needs Full access to Pricing, or edit access to Employees.', 403);
  if (!(await holidaysReady(env))) return fail('NOT_MIGRATED', HOLIDAYS_NOT_MIGRATED, 503);
  const was = await holidayById(env, String(params.id));
  if (!was) return fail('NOT_FOUND', 'That holiday is not on the list.', 404);
  await run(env, 'DELETE FROM public_holidays WHERE id = ?', was.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'holiday.remove', entityTable: 'public_holidays', entityId: was.id,
    before: { date: was.date, name: was.name, state: was.state, staffDayOff: was.staffDayOff } });
  const queued = await requeueForHolidays(env, [{ date: was.date, state: was.state }], was.id);
  return json({ ok: true, queued });
};
