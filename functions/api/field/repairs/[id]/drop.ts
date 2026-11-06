import { type Env, one, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { mineSql, hasAssigneeUser, hasTechnicianList } from '../../../../_lib/maintenance';
import { repairNotice } from '../../../../_lib/notices';

interface LastAssign { via: string | null; state_before: string | null; actor_id: string | null }

/** POST /api/field/repairs/:id/drop — a technician gives back a job they picked up themselves, before starting it. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'technician') return fail('FORBIDDEN', 'Only technicians drop maintenance jobs.', 403);

  const id = String(params.id);
  if (!(await one(env, 'SELECT 1 AS x FROM maintenance_issues WHERE id = ?', id))) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  const lastAssign = await one<LastAssign>(env, `
    SELECT after_state::jsonb ->> 'via' AS via, before_state::jsonb ->> 'state' AS state_before, actor_id FROM audit_log
    WHERE entity_table = 'maintenance_issues' AND entity_id = ? AND action = 'maintenance.assign'
    ORDER BY occurred_at DESC LIMIT 1`, id);
  if (lastAssign?.via !== 'picked_up' || lastAssign.actor_id !== session.userId) return fail('CONFLICT', 'The office gave you this job. Ask the office to take it back.', 409);

  const [byId, listed] = await Promise.all([hasAssigneeUser(env), hasTechnicianList(env)]);
  const stateAfter = lastAssign.state_before === 'reopened' ? 'reopened' : 'open';
  const now = nowIso();
  const dropped = await one<{ id: string }>(env, `
    UPDATE maintenance_issues m SET vendor_name = NULL, assignee_kind = NULL, state = ?, updated_at = ?${byId ? ', assignee_user_id = NULL' : ''}${listed ? ', technician_id = NULL' : ''}
    WHERE m.id = ? AND ${mineSql(byId)} AND m.started_at IS NULL AND m.state = 'assigned'
    RETURNING m.id`, stateAfter, now, id, ...(byId ? [session.userId, session.userId] : [session.userId]));
  if (!dropped) return fail('CONFLICT', 'This job is already started or no longer yours. Refresh the list.', 409);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.assign', entityTable: 'maintenance_issues', entityId: id,
    before: { assignee: session.fullName, state: 'assigned' }, after: { assignee: null, state: stateAfter, via: 'dropped' }, source: 'field_app' });
  await repairNotice(env, id, 'dropped', session.userId, session.fullName);
  return json({ ok: true, state: stateAfter });
};
