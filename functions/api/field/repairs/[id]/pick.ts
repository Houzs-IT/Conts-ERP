import { type Env, one, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { hasAssigneeUser, hasTechnicianList, UNASSIGNED_SQL, hasJobType, fieldVisibleSql } from '../../../../_lib/maintenance';
import { repairNotice } from '../../../../_lib/notices';

/** POST /api/field/repairs/:id/pick — a technician takes an open job nobody has. Only a job with no technician or
 *  contractor named can be taken; the office can still give it to someone else afterwards (PATCH assigneeName). Two
 *  technicians tapping at once: the first wins, the second is told it is gone. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'technician') return fail('FORBIDDEN', 'Only technicians pick up maintenance jobs. The office assigns them.', 403);

  const id = String(params.id);
  const cur = await one<{ state: string; vendor_name: string | null }>(env, 'SELECT state, vendor_name FROM maintenance_issues WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);

  const [byId, listed] = await Promise.all([hasAssigneeUser(env), hasTechnicianList(env)]);
  const now = nowIso();
  const taken = await one<{ id: string }>(env, `
    UPDATE maintenance_issues m SET vendor_name = ?, assignee_kind = 'in_house', state = 'assigned', updated_at = ?${byId ? ', assignee_user_id = ?' : ''}${listed ? ', technician_id = (SELECT t.id FROM technicians t WHERE t.user_id = ?)' : ''}
    WHERE m.id = ? AND ${UNASSIGNED_SQL} AND ${fieldVisibleSql(await hasJobType(env))} AND m.state IN ('open','reopened')${byId ? ' AND m.assignee_user_id IS NULL' : ''}
    RETURNING m.id`, session.fullName, now, ...(byId ? [session.userId] : []), ...(listed ? [session.userId] : []), id);
  if (!taken) {
    return fail('CONFLICT', cur.vendor_name?.trim() ? `${cur.vendor_name.trim()} already has this job.` : 'This job cannot be picked up now. Refresh the list.', 409);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.assign', entityTable: 'maintenance_issues', entityId: id,
    before: { assignee: null, state: cur.state }, after: { assignee: session.fullName, assigneeKind: 'in_house', state: 'assigned', via: 'picked_up' }, source: 'field_app' });
  await repairNotice(env, id, 'picked', session.userId);
  return json({ ok: true, state: 'assigned' });
};
