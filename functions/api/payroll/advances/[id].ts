import { mayRun } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { hasPayroll, NOT_MIGRATED } from '../../../_lib/payroll';

const MANAGE = ['management']; // everyone else needs Full on HR (functions/_lib/access.ts)

/** DELETE /api/payroll/advances/:id — remove an advance entered by mistake. Only while its month's slip is open: a
 *  settled advance has been taken back on an approved slip. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, MANAGE)) return fail('FORBIDDEN', 'Advances need Full access to HR.', 403);
  if (!(await hasPayroll(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const a = await one<{ id: string; employee_id: string; advance_date: string; amount_sen: number; status: string }>(env,
    'SELECT id, employee_id, advance_date, amount_sen, status FROM employee_advances WHERE id = ?', String(params.id));
  if (!a) return fail('NOT_FOUND', 'That advance no longer exists.', 404);
  if (a.status !== 'unsettled') return fail('CONFLICT', 'That advance was taken back on an approved payslip. Reopen the payslip first.', 409);
  await run(env, `DELETE FROM employee_advances WHERE id = ? AND status = 'unsettled'`, a.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'payroll.advance_delete', entityTable: 'employee_advances', entityId: a.id, before: { date: a.advance_date, amountSen: a.amount_sen } });
  return json({ ok: true });
};
