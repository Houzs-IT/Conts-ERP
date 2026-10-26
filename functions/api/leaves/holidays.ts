import { mayWork } from '../../_lib/access';
import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { hasLeaves, NOT_MIGRATED, readHolidays, HOLIDAYS_KEY } from '../../_lib/leave';
import { holidayList } from '../../_lib/leaveRules';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)

/** PUT /api/leaves/holidays [{ date, name }] — the whole public holiday list (HR > Workers > Leave). Leave balances take
 *  these days off each request; payroll (phase 4) pays them at the holiday rate. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include the holiday list.', 403);
  if (!(await hasLeaves(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const parsed = holidayList.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('VALIDATION', parsed.error.issues[0]?.message ?? 'Check the list.', 422);
  const before = await readHolidays(env);
  await run(env, `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, HOLIDAYS_KEY, JSON.stringify(parsed.data), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'hr.holidays', entityTable: 'settings', entityId: HOLIDAYS_KEY, before, after: parsed.data });
  return json({ data: parsed.data });
};
