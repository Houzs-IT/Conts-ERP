import { mayWork } from '../../_lib/access';
import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { hasLeaves, NOT_MIGRATED, readHolidays, HOLIDAYS_KEY } from '../../_lib/leave';
import { holidayList } from '../../_lib/leaveRules';
import { holidaysReady, listHolidays } from '../../_lib/holidays';
import { requeueForHolidays } from '../../_lib/holidayQueue';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)

/** PUT /api/leaves/holidays [{ date, name }] — HR's older way to save the whole staff holiday list at once. The screens
 *  now edit the shared list one entry at a time (/api/holidays); this stays for anything still sending the old shape.
 *  Since migration 0202 it sets the all-state entries of the shared list to exactly these (state holidays are left
 *  alone), each a staff day off; before 0202 it writes HR's own list in settings, as it always did. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include the holiday list.', 403);
  if (!(await hasLeaves(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const parsed = holidayList.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message ?? 'Check the list.', 422);
  const before = await readHolidays(env);
  if (await holidaysReady(env)) {
    const was = (await listHolidays(env)).filter(h => h.state === null);
    const wanted = new Map(parsed.data.map(h => [h.date, h.name]));
    const now = nowIso();
    await run(env, `DELETE FROM public_holidays WHERE state IS NULL AND holiday_date NOT IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify([...wanted.keys()]));
    await run(env, `INSERT INTO public_holidays (id, holiday_date, name, state, staff_day_off, created_at, updated_at)
      SELECT x.id, x.date, x.name, NULL, true, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, date text, name text)
      ON CONFLICT (holiday_date, (COALESCE(state, ''))) DO UPDATE SET name = excluded.name, staff_day_off = true, updated_at = excluded.updated_at`,
      now, now, JSON.stringify(parsed.data.map(h => ({ id: crypto.randomUUID(), date: h.date, name: h.name }))));
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'hr.holidays', entityTable: 'public_holidays', entityId: 'all-states', before, after: parsed.data });
    const changed = [...was.filter(h => !wanted.has(h.date)).map(h => h.date), ...parsed.data.filter(h => !was.some(w => w.date === h.date)).map(h => h.date)];
    if (changed.length) await requeueForHolidays(env, changed.map(date => ({ date, state: null })), 'hr.holidays');
    return json({ data: parsed.data });
  }
  await run(env, `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, HOLIDAYS_KEY, JSON.stringify(parsed.data), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'hr.holidays', entityTable: 'settings', entityId: HOLIDAYS_KEY, before, after: parsed.data });
  return json({ data: parsed.data });
};
