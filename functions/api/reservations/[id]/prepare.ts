import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';

/** POST /api/reservations/:id/prepare — makes sure a clean is queued for the unit before the arrival. It sends
 *  nothing to the guest; the answer says whether a clean was queued now or one was already open. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot prepare arrivals.', 403);

  const id = String(params.id);
  const r = await one<any>(env, 'SELECT id, unit_id, check_in, check_in_time FROM reservations WHERE id = ?', id);
  if (!r) return fail('NOT_FOUND', 'That reservation does not exist.', 404);

  const open = await one(env, `SELECT 1 AS x FROM tasks WHERE reservation_id = ? AND state != 'resolved'`, id);
  const taskCreated = !open;
  if (!open) {
    const now = nowIso();
    const at = `${r.check_in}T${r.check_in_time}:00+08:00`;
    await run(env, `
      INSERT INTO tasks (id, unit_id, reservation_id, kind, state, title, next_guest_at, due_at, requires_photo, created_at, updated_at)
      VALUES (?, ?, ?, 'turnover', 'open', 'Prepare for arrival', ?, ?, 1, ?, ?)`,
      crypto.randomUUID(), r.unit_id, id, at, at, now, now);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.prepare', entityTable: 'reservations', entityId: id });
  return json({ id, preparedAt: nowIso(), taskCreated });
};
