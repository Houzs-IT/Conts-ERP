import { mayRun } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { notifyUsers } from '../../../_lib/notify';
import { hasPayroll, NOT_MIGRATED, periodEnded, toPayslip, type PayslipRow } from '../../../_lib/payroll';
import { hasPenalties, PENALTY_SUM_SQL, postPenalties, unpostPenalties } from '../../../_lib/penalties';

const MANAGE = ['management']; // everyone else needs Full on HR (functions/_lib/access.ts)
const MOVES: Record<string, { from: string; to: 'draft' | 'approved' | 'paid' }> = {
  approve: { from: 'draft', to: 'approved' },
  pay: { from: 'approved', to: 'paid' },
  reopen: { from: 'approved', to: 'draft' },
};
const DONE: Record<string, string> = { approve: 'approved', pay: 'marked paid', reopen: 'reopened' };

/**
 * POST /api/payroll/:id/status { action: approve | pay | reopen } — a slip's life after the run.
 *  approve  once the month has ended; settles the month's advances (they are now taken back) and tells the person.
 *  pay      the money has gone out.
 *  reopen   an approved slip back to draft to fix it; its advances are open again. A paid slip is final.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, MANAGE)) return fail('FORBIDDEN', 'Approving and paying payroll needs Full access to HR.', 403);
  if (!(await hasPayroll(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const b = await request.json<Record<string, unknown>>().catch(() => null);
  const action = typeof b?.action === 'string' ? b.action : '';
  const move = MOVES[action];
  if (!move) return fail('VALIDATION', 'Say approve, pay or reopen.', 422);
  const slip = await one<PayslipRow>(env, 'SELECT * FROM payslips WHERE id = ?', String(params.id));
  if (!slip) return fail('NOT_FOUND', 'That payslip no longer exists.', 404);
  if (slip.status !== move.from) return fail('CONFLICT', `That payslip is ${slip.status}; it cannot be ${DONE[action]} from there.`, 409);
  if (action === 'approve' && !periodEnded(slip.period)) return fail('CONFLICT', 'A month can be approved once it has ended. Until then the slip is an estimate.', 409);

  // Hookka: a penalty approved or revoked after the draft was made must be on the slip before it is approved.
  const penalties = await hasPenalties(env);
  if (action === 'approve' && penalties) {
    const current = await one<{ total: number }>(env, `${PENALTY_SUM_SQL} AND l.employee_id = ? GROUP BY l.employee_id`, slip.period, slip.employee_id);
    if (Number(current?.total ?? 0) !== Number(slip.penalty_sen ?? 0)) {
      return fail('CONFLICT', 'Penalties for this month changed after the draft was made. Refresh drafts, check the slip, then approve.', 409);
    }
  }

  const now = nowIso();
  const set = action === 'approve' ? 'approved_by = ?, approved_at = ?' : action === 'pay' ? 'paid_by = ?, paid_at = ?' : 'approved_by = NULL, approved_at = NULL, generated_by = ?, generated_at = ?';
  await run(env, `UPDATE payslips SET status = ?, ${set}, updated_at = ? WHERE id = ? AND status = ?`, move.to, session.userId, now, now, slip.id, move.from);
  if (action === 'approve') {
    await run(env, `UPDATE employee_advances SET status = 'settled', settled_period = ?, updated_at = ? WHERE employee_id = ? AND advance_date LIKE ? AND status = 'unsettled'`,
      slip.period, now, slip.employee_id, `${slip.period}-%`);
    if (penalties) await postPenalties(env, slip.id, slip.employee_id, slip.period);
  } else if (action === 'reopen') {
    if (penalties) await unpostPenalties(env, slip.id);
    await run(env, `UPDATE employee_advances SET status = 'unsettled', settled_period = NULL, updated_at = ? WHERE employee_id = ? AND settled_period = ?`,
      now, slip.employee_id, slip.period);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `payroll.${action}`, entityTable: 'payslips', entityId: slip.id, before: { status: slip.status }, after: { status: move.to } });

  if (action === 'approve') {
    const who = await one<{ user_id: string | null }>(env, `
      SELECT COALESCE(c.user_id, t.user_id) AS user_id FROM employees e
      LEFT JOIN cleaners c ON c.id = e.cleaner_id LEFT JOIN technicians t ON t.id = e.technician_id WHERE e.id = ?`, slip.employee_id);
    if (who?.user_id) {
      await notifyUsers(env, [who.user_id], {
        kind: 'payroll.approved', title: 'Your payslip is ready', body: `For ${slip.period}. Open Pay to see it.`,
        link: `/portal/pay?month=${slip.period}`, entityTable: 'payslips', entityId: slip.id, dedupeKey: `payslip-${slip.id}-approved`,
      });
    }
  }
  const after = await one<PayslipRow>(env, 'SELECT * FROM payslips WHERE id = ?', slip.id);
  if (!after) throw new Error('The payslip was not saved.');
  return json({ data: toPayslip(after) });
};
