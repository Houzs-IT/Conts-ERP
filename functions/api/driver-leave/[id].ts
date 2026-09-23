import { type Env, one, run, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';

/** DELETE /api/driver-leave/:id — remove a leave period. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can remove driver leave.', 403);
  const id = String(params.id);
  const cur = await one<{ driver_id: string }>(env, 'SELECT driver_id FROM driver_leave WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That leave record does not exist.', 404);
  await run(env, 'DELETE FROM driver_leave WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'driver_leave.delete', entityTable: 'driver_leave', entityId: id, before: { driverId: cur.driver_id } });
  return new Response(null, { status: 204 });
};
