import { z } from 'zod';
import { mayRun } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { hasPayroll, NOT_MIGRATED } from '../../../_lib/payroll';

const MANAGE = ['management']; // everyone else needs Full on HR (functions/_lib/access.ts)
const edit = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
  amountSen: z.int().min(1, 'Enter an amount.').max(10_000_000),
  note: z.string().trim().max(200).transform(v => v || null).nullable().default(null),
});

interface AdvanceRow { id: string; employee_id: string; advance_date: string; amount_sen: number; note: string | null; status: string }
const readAdvance = (env: Env, id: string): Promise<AdvanceRow | null> =>
  one<AdvanceRow>(env, 'SELECT id, employee_id, advance_date, amount_sen, note, status FROM employee_advances WHERE id = ?', id);

/** PUT /api/payroll/advances/:id { date, amountSen, note? } — fix an advance (Hookka's inline edit). Only while it is not
 *  taken back, and only into a month whose payslip is still open. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, MANAGE)) return fail('FORBIDDEN', 'Advances need Full access to HR.', 403);
  if (!(await hasPayroll(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const parsed = edit.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  const { date, amountSen, note } = parsed.data;
  const a = await readAdvance(env, String(params.id));
  if (!a) return fail('NOT_FOUND', 'That advance no longer exists.', 404);
  if (a.status !== 'unsettled') return fail('CONFLICT', 'That advance was taken back on an approved payslip. Reopen the payslip first.', 409);
  const locked = await one<{ status: string }>(env, `SELECT status FROM payslips WHERE employee_id = ? AND period = ? AND status <> 'draft'`, a.employee_id, date.slice(0, 7));
  if (locked) return fail('CONFLICT', `The payslip for ${date.slice(0, 7)} is already ${locked.status}. Date the advance in an open month.`, 409, { date: 'That month is closed.' });

  await run(env, `UPDATE employee_advances SET advance_date = ?, amount_sen = ?, note = ?, updated_at = ? WHERE id = ? AND status = 'unsettled'`,
    date, amountSen, note, nowIso(), a.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'payroll.advance_edit', entityTable: 'employee_advances', entityId: a.id,
    before: { date: a.advance_date, amountSen: Number(a.amount_sen), note: a.note }, after: { date, amountSen, note } });
  return json({ ok: true });
};

/** DELETE /api/payroll/advances/:id — remove an advance entered by mistake. Only while its month's slip is open: a
 *  settled advance has been taken back on an approved slip. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, MANAGE)) return fail('FORBIDDEN', 'Advances need Full access to HR.', 403);
  if (!(await hasPayroll(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const a = await readAdvance(env, String(params.id));
  if (!a) return fail('NOT_FOUND', 'That advance no longer exists.', 404);
  if (a.status !== 'unsettled') return fail('CONFLICT', 'That advance was taken back on an approved payslip. Reopen the payslip first.', 409);
  await run(env, `DELETE FROM employee_advances WHERE id = ? AND status = 'unsettled'`, a.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'payroll.advance_delete', entityTable: 'employee_advances', entityId: a.id, before: { date: a.advance_date, amountSen: a.amount_sen } });
  return json({ ok: true });
};
