import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { CHARGE_TO } from '../../../../_lib/maintenance';
import { isPeriodLocked } from '../../../../_lib/expenses';

/** POST /api/maintenance/issues/:id/complete { finalAmount, chargeTo? } — closes the job, puts a blocked unit back on sale and
 *  raises the expense on the unit with the payer chosen (owner through the statement, the company, the guest's deposit,
 *  a warranty). A month whose owner statement is final takes no new expense: the job is refused, not half-closed. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Only operations managers, finance and management can close a job.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const amount = b?.finalAmount;
  if (!Number.isInteger(amount) || amount < 0) return fail('VALIDATION', 'Enter the final amount.', 422, { finalAmount: 'Enter the final amount.' });

  if (b?.chargeTo !== undefined && !CHARGE_TO.includes(b.chargeTo)) return fail('VALIDATION', 'Pick who pays.', 422, { chargeTo: 'Pick who pays.' });

  const cur = await one<any>(env, 'SELECT id, state, unit_id, title, blocks_unit, charge_to, owner_approval_required, owner_approved_at FROM maintenance_issues WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (cur.state === 'resolved') return json({ ok: true });
  const chargeTo: string = b?.chargeTo ?? cur.charge_to;
  if (cur.owner_approval_required && !cur.owner_approved_at && chargeTo === 'owner') return fail('APPROVAL_PENDING', 'The owner has not approved this quote yet.', 409);

  const now = nowIso();
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  if (amount > 0 && await isPeriodLocked(env, cur.unit_id, day)) return fail('PERIOD_LOCKED', "This month's owner statement is already final, so the cost cannot be added to it.", 409);
  await run(env, `UPDATE maintenance_issues SET state = 'resolved', final_amount = ?, charge_to = ?, resolved_at = ?, blocks_unit = 0, updated_at = ? WHERE id = ?`, amount, chargeTo, now, now, id);
  if (cur.blocks_unit) {
    const other = await one(env, `SELECT 1 AS x FROM maintenance_issues WHERE unit_id = ? AND id != ? AND blocks_unit = 1 AND state != 'resolved'`, cur.unit_id, id);
    if (!other) await run(env, `UPDATE units SET readiness = 'ready', updated_at = ? WHERE id = ? AND readiness IN ('maintenance','blocked')`, now, cur.unit_id);
  }
  if (amount > 0) {
    await run(env, `
      INSERT INTO expenses (id, unit_id, maintenance_id, category, description, amount, currency, incurred_on, charge_to, created_by, created_at)
      VALUES (?, ?, ?, 'maintenance', ?, ?, 'MYR', ?, ?, ?, ?)`,
      crypto.randomUUID(), cur.unit_id, id, cur.title, amount, day, chargeTo, session.userId, now);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.complete', entityTable: 'maintenance_issues', entityId: id, before: { state: cur.state }, after: { state: 'resolved', finalAmount: amount, chargeTo } });
  return json({ ok: true, chargeTo, expensed: amount > 0 });
};
