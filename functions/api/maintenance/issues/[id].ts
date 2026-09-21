import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';

/** PATCH /api/maintenance/issues/:id { assigneeId | state:'reopened' }
 *  assigneeId is the technician or vendor NAME: outside vendors are not user accounts. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot change maintenance jobs.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const cur = await one<any>(env, 'SELECT id, state, vendor_name, unit_id, blocks_unit FROM maintenance_issues WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  const now = nowIso();

  if (typeof b?.assigneeId === 'string' && b.assigneeId.trim()) {
    const name = b.assigneeId.trim().slice(0, 80);
    await run(env, `UPDATE maintenance_issues SET vendor_name = ?, state = CASE WHEN state = 'open' THEN 'assigned' ELSE state END, updated_at = ? WHERE id = ?`, name, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.assign', entityTable: 'maintenance_issues', entityId: id, before: { vendor: cur.vendor_name }, after: { vendor: name } });
    return json({ ok: true });
  }

  if (b?.state === 'reopened') {
    if (cur.state !== 'resolved') return fail('CONFLICT', 'Only a finished job can be reopened.', 409);
    await run(env, `UPDATE maintenance_issues SET state = 'reopened', final_amount = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?`, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.reopen', entityTable: 'maintenance_issues', entityId: id, before: { state: cur.state }, after: { state: 'reopened' } });
    return json({ ok: true });
  }

  return fail('VALIDATION', 'Nothing to change.', 422);
};
