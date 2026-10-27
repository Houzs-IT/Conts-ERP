import { type Env, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { employeeForUser } from '../../../../_lib/hr';
import { hasLeaves, NOT_MIGRATED, leaveById } from '../../../../_lib/leave';

/** POST /api/field/leave/:id/cancel — take back one of your own requests the office has not decided yet. An approved
 *  one is the office's to change. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await hasLeaves(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const me = await employeeForUser(env, session.userId);
  const leave = await leaveById(env, String(params.id));
  if (!me?.id || !leave || leave.employee_id !== me.id) return fail('NOT_FOUND', 'That request is not yours or no longer exists.', 404);
  if (leave.status !== 'pending') return fail('CONFLICT', `That request is already ${leave.status}. Ask the office to change it.`, 409);

  await run(env, `UPDATE leaves SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'`, nowIso(), leave.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'leave.cancel', entityTable: 'leaves', entityId: leave.id, source: 'field_app', before: { status: 'pending' }, after: { status: 'cancelled' } });
  return json({ ok: true });
};
