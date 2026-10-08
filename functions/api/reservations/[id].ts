import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { applyStayState } from '../../_lib/reservations';
import { FROM, COLUMNS, toRow } from '../../_lib/bookingList';

const STATES = ['inquiry', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'];

/** GET /api/reservations/:id — one booking in the list's row shape, for a drawer opened from a link or a copy not on the current page. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Bookings are not available to field roles.', 403);
  const row = await one<any>(env, `SELECT ${COLUMNS} ${FROM} WHERE r.id = ?`, String(params.id));
  if (!row) return fail('NOT_FOUND', 'That reservation does not exist.', 404);
  return json(toRow(row));
};

/** PATCH /api/reservations/:id { state } — the quick status change. ("status" is accepted too.) */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot change reservations.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const state = b?.state ?? b?.status;
  if (!STATES.includes(state)) return fail('VALIDATION', 'Pick a valid status.', 422, { state: 'Pick a valid status.' });

  const cur = await one<any>(env, 'SELECT id, unit_id, state FROM reservations WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That reservation does not exist.', 404);

  await run(env, 'UPDATE reservations SET state = ?, updated_at = ? WHERE id = ?', state, nowIso(), id);
  await applyStayState(env, session, id, cur.unit_id, state);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.status', entityTable: 'reservations', entityId: id, before: { state: cur.state }, after: { state } });
  return json({ id, state });
};
