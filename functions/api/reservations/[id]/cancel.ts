import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';

/** POST /api/reservations/:id/cancel { reason } — releases the dates. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot cancel reservations.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => ({}));
  const cur = await one<any>(env, 'SELECT id, state FROM reservations WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That reservation does not exist.', 404);
  if (cur.state === 'cancelled') return json({ id, state: 'cancelled' });
  if (cur.state === 'checked_out') return fail('CONFLICT', 'A finished stay cannot be cancelled.', 409);

  await run(env, `UPDATE reservations SET state = 'cancelled', notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`, b.reason ?? null, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.cancel', entityTable: 'reservations', entityId: id, before: { state: cur.state }, after: { state: 'cancelled', reason: b.reason ?? null } });
  return json({ id, state: 'cancelled' });
};
