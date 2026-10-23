import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { CHARGE_TO, DAY, hasBilling } from '../../../../_lib/maintenance';
import { isPeriodLocked } from '../../../../_lib/expenses';
import { releaseRepairBlocks } from '../../../../_lib/repairBlocks';
import { repairNotice } from '../../../../_lib/notices';

/** POST /api/maintenance/issues/:id/complete { finalAmount, chargeTo?, billingDate? } — closes the job, puts a blocked unit back
 *  on sale and raises the expense on the unit with the payer chosen (owner through the statement, the company, the guest's
 *  deposit, a warranty). The expense is dated the billing date (sent, or saved on the job), else today, so the cost lands
 *  in the month it is billed. A month whose owner statement is final takes no new expense: the job is refused, not
 *  half-closed. A job finished before and reopened keeps one expense: it is updated, not doubled. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only people with Full Operations access can close a job.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const amount = b?.finalAmount;
  if (!Number.isInteger(amount) || amount < 0) return fail('VALIDATION', 'Enter the final amount.', 422, { finalAmount: 'Enter the final amount.' });

  if (b?.chargeTo !== undefined && !CHARGE_TO.includes(b.chargeTo)) return fail('VALIDATION', 'Pick who pays.', 422, { chargeTo: 'Pick who pays.' });

  if (b?.billingDate != null && (typeof b.billingDate !== 'string' || !DAY.test(b.billingDate))) return fail('VALIDATION', 'Pick the billing date.', 422, { billingDate: 'Pick the billing date.' });
  const billing = await hasBilling(env);

  const cur = await one<any>(env, `SELECT id, state, unit_id, title, blocks_unit, charge_to, owner_approval_required, owner_approved_at${billing ? ', billing_date' : ''} FROM maintenance_issues WHERE id = ?`, id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (cur.state === 'resolved') return json({ ok: true });
  const chargeTo: string = b?.chargeTo ?? cur.charge_to;
  if (cur.owner_approval_required && !cur.owner_approved_at && chargeTo === 'owner') return fail('APPROVAL_PENDING', 'The owner has not approved this quote yet.', 409);

  const now = nowIso();
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const billingDate: string | null = billing ? (b?.billingDate ?? cur.billing_date ?? null) : null;
  const day = billingDate ?? today;
  const prior = await one<{ id: string; incurred_on: string; amount: number }>(env, 'SELECT id, incurred_on, amount FROM expenses WHERE maintenance_id = ? ORDER BY created_at LIMIT 1', id);
  const unchanged = !!prior && Number(prior.amount) === amount && prior.incurred_on === day;
  if (amount > 0 && !unchanged && await isPeriodLocked(env, cur.unit_id, day)) return fail('PERIOD_LOCKED', "That month's owner statement is already final, so the cost cannot be added to it. Pick a later billing date.", 409, { billingDate: 'That month is closed.' });
  if (prior && !unchanged && await isPeriodLocked(env, cur.unit_id, prior.incurred_on)) return fail('PERIOD_LOCKED', 'This job was finished before and its cost is on an owner statement that is already final. Ask finance to adjust it there.', 409);
  await run(env, `UPDATE maintenance_issues SET state = 'resolved', final_amount = ?, charge_to = ?, resolved_at = ?, blocks_unit = 0${billing ? ', billing_date = ?' : ''}, updated_at = ? WHERE id = ?`,
    amount, chargeTo, now, ...(billing ? [billingDate ?? (amount > 0 ? day : null)] : []), now, id);
  if (cur.blocks_unit) {
    const other = await one(env, `SELECT 1 AS x FROM maintenance_issues WHERE unit_id = ? AND id != ? AND blocks_unit = 1 AND state != 'resolved'`, cur.unit_id, id);
    if (!other) await run(env, `UPDATE units SET readiness = 'ready', updated_at = ? WHERE id = ? AND readiness IN ('maintenance','blocked')`, now, cur.unit_id);
  }
  if (unchanged) {
    // The cost already on the unit is the same: nothing to write.
  } else if (prior && amount > 0) {
    await run(env, 'UPDATE expenses SET amount = ?, incurred_on = ?, charge_to = ?, description = ? WHERE id = ?', amount, day, chargeTo, cur.title, prior.id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.update', entityTable: 'expenses', entityId: prior.id, before: { amount: prior.amount, incurredOn: prior.incurred_on }, after: { amount, incurredOn: day, chargeTo } });
  } else if (prior) {
    await run(env, 'DELETE FROM expenses WHERE id = ?', prior.id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.delete', entityTable: 'expenses', entityId: prior.id, before: { amount: prior.amount, incurredOn: prior.incurred_on }, after: { reason: 'Maintenance job closed again at RM 0' } });
  } else if (amount > 0) {
    await run(env, `
      INSERT INTO expenses (id, unit_id, maintenance_id, category, description, amount, currency, incurred_on, charge_to, created_by, created_at)
      VALUES (?, ?, ?, 'maintenance', ?, ?, 'MYR', ?, ?, ?, ?)`,
      crypto.randomUUID(), cur.unit_id, id, cur.title, amount, day, chargeTo, session.userId, now);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.complete', entityTable: 'maintenance_issues', entityId: id, before: { state: cur.state, billingDate: cur.billing_date ?? null }, after: { state: 'resolved', finalAmount: amount, chargeTo, billingDate: billing ? (billingDate ?? (amount > 0 ? day : null)) : undefined, expenseOn: amount > 0 ? day : null } });
  // The calendar block "Block unit until fixed" made is given back now, not left for someone to remove by hand.
  const released = await releaseRepairBlocks(env, [id], { id: session.userId, label: session.fullName });
  await repairNotice(env, id, 'done', session.userId);
  return json({ ok: true, chargeTo, expensed: amount > 0, expenseOn: amount > 0 ? day : null, blocksReleased: released.length });
};
