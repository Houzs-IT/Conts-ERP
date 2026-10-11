import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { releaseRepairBlocks } from '../../../../_lib/repairBlocks';
import { postJobExpense } from '../../../../_lib/maintenanceCost';

/** POST /api/maintenance/issues/:id/cancel { reason } — calls a job off: it is closed with no cost, the maintenance
 *  expense it posted to the unit is taken back, a unit it blocked goes back on sale. Refused when that expense sits in
 *  a month whose owner statement is final. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Only operations managers, finance and management can cancel a job.', 403);
  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
  if (!reason) return fail('VALIDATION', 'Say why the job is cancelled.', 422, { reason: 'Say why.' });
  const cur = await one<any>(env, 'SELECT id, state, unit_id, title, blocks_unit, charge_to, final_amount, cancelled_at FROM maintenance_issues WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (cur.cancelled_at) return json({ ok: true });

  const posted = await postJobExpense(env, cur, 0, cur.charge_to, { id: session.userId, label: session.fullName });
  if (posted === 'locked') return fail('PERIOD_LOCKED', "The cost is on an owner statement that is already final, so it cannot be taken back.", 409);
  const now = nowIso();
  await run(env, `UPDATE maintenance_issues SET state = 'resolved', cancelled_at = ?, final_amount = 0, resolved_at = COALESCE(resolved_at, ?), blocks_unit = 0, updated_at = ? WHERE id = ?`, now, now, now, id);
  if (cur.blocks_unit) {
    const other = await one(env, `SELECT 1 AS x FROM maintenance_issues WHERE unit_id = ? AND id != ? AND blocks_unit = 1 AND state != 'resolved'`, cur.unit_id, id);
    if (!other) await run(env, `UPDATE units SET readiness = 'ready', updated_at = ? WHERE id = ? AND readiness IN ('maintenance','blocked')`, now, cur.unit_id);
  }
  await releaseRepairBlocks(env, [id], { id: session.userId, label: session.fullName });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.cancel', entityTable: 'maintenance_issues', entityId: id, before: { state: cur.state, finalAmount: cur.final_amount }, after: { state: 'cancelled', reason } });
  return json({ ok: true });
};
