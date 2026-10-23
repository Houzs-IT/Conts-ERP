import { type Env, one, json, fail, audit } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { chargeClean } from '../../_lib/cleaning';
import { unitCosts } from '../../_lib/unitCosts';

/** POST /api/expenses/clean-charges { unitId, month: YYYY-MM }
 *  Charges every finished clean of the unit in that month that has no cost yet (the same charge a finished clean makes,
 *  functions/_lib/cleaning.ts chargeClean), each dated the day the clean was finished. Cleans imported as done without
 *  a price never went through Finish, so they never charged the unit. A clean on a day the unit already carries a
 *  cleaning cost, or in a month whose owner statement is final, is skipped and reported. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || !session.manage) {
    return fail('FORBIDDEN', 'Only finance and management can charge cleaning jobs to a unit.', 403);
  }
  const b = await request.json<any>().catch(() => null);
  const unitId = String(b?.unitId ?? ''), month = String(b?.month ?? '');
  const fields: Record<string, string> = {};
  if (!unitId) fields.unitId = 'A unit is required.';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fields.month = 'Month must look like 2026-10.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Say which unit and month.', 422, fields);
  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', unitId))) return fail('NOT_FOUND', 'That unit no longer exists.', 404);

  const { unchargedCleans } = await unitCosts(env, month, { unitId });
  const charged: { taskId: string; amount: number; day: string }[] = [], skipped: { taskId: string; reason: string }[] = [];
  for (const c of unchargedCleans) {
    const r = await chargeClean(env, session, { id: c.taskId, unit_id: c.unitId, kind: c.kind, title: c.title }, c.doneOn);
    if (r.created) charged.push({ taskId: c.taskId, amount: r.amount, day: c.doneOn });
    else skipped.push({ taskId: c.taskId, reason: r.reason ?? 'not charged' });
  }
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'expense.clean_catch_up', entityTable: 'units', entityId: unitId,
    before: { month, unchargedCleans: unchargedCleans.length },
    after: { month, charged: charged.length, amount: charged.reduce((n, c) => n + c.amount, 0), skipped: skipped.length },
  });
  return json({ charged, skipped }, charged.length ? 201 : 200);
};
