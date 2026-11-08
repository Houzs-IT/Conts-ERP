import { mayRun } from '../../_lib/access';
import { type Env, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { hasPayroll, NOT_MIGRATED, isPeriod, throughDay, generateDrafts } from '../../_lib/payroll';

const MANAGE = ['management']; // everyone else needs Full on HR (functions/_lib/access.ts)

/** POST /api/payroll/generate { period } — make or refresh the month's draft slips. Approved and paid ones stay as they
 *  are. Can run while the month is open; the figures then cover the days so far. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, MANAGE)) return fail('FORBIDDEN', 'Running payroll needs Full access to HR.', 403);
  if (!(await hasPayroll(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const b = await request.json<Record<string, unknown>>().catch(() => null);
  const period = b?.period;
  if (!isPeriod(period)) return fail('VALIDATION', 'Pick a month.', 422, { period: 'Pick a month.' });
  if (!throughDay(period)) return fail('VALIDATION', 'That month has not started yet.', 422, { period: 'Not started yet.' });

  let done: { written: number; kept: number };
  try {
    done = await generateDrafts(env, period, session.userId);
  } catch (e) {
    // All-or-nothing: nothing was saved, so the screen can say so and the run can simply be tried again.
    return fail('NOT_SAVED', e instanceof Error ? e.message : 'Payroll was not saved. Try again.', 409);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'payroll.generate', entityTable: 'payslips', entityId: period, after: done });
  return json(done);
};
