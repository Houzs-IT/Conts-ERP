import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** PUT /api/reservations/:id/arrival { time: "HH:MM" | null } — the time the arriving guest said they will come.
 *  Separate from the agreed check-in time: Cleaning works out "clean by" and time left from it when set. Staff record
 *  it from the Cleaning board or the reservation; null clears it. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Your role cannot change reservations.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const raw = b?.time;
  const time = raw === null || raw === '' ? null : typeof raw === 'string' ? raw.trim() : undefined;
  if (time === undefined || (time !== null && !TIME.test(time))) return fail('VALIDATION', 'Use HH:MM, e.g. 16:30.', 422, { time: 'Use HH:MM, e.g. 16:30.' });

  const cur = await one<{ id: string; state: string; expected_arrival: string | null }>(env, 'SELECT id, state, expected_arrival FROM reservations WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That reservation does not exist.', 404);
  if (['cancelled', 'no_show', 'checked_out'].includes(cur.state)) return fail('CONFLICT', 'That reservation is no longer arriving.', 409);
  if (cur.expected_arrival === time) return json({ ok: true, expectedArrival: time });

  await run(env, 'UPDATE reservations SET expected_arrival = ?, updated_at = ? WHERE id = ?', time, nowIso(), id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'reservation.expected_arrival', entityTable: 'reservations', entityId: id,
    before: { expectedArrival: cur.expected_arrival }, after: { expectedArrival: time },
  });
  return json({ ok: true, expectedArrival: time });
};
