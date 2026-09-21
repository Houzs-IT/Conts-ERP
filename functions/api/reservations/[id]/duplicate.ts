import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { findClash, clashResponseBody } from '../../../_lib/reservations';

/** POST /api/reservations/:id/duplicate — a pending copy placed straight after the original. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot create reservations.', 403);

  const src = await one<any>(env, 'SELECT * FROM reservations WHERE id = ?', String(params.id));
  if (!src) return fail('NOT_FOUND', 'That reservation does not exist.', 404);

  const nights = Math.max(1, Math.round((Date.parse(src.check_out) - Date.parse(src.check_in)) / 864e5));
  const checkIn = src.check_out;
  const checkOut = new Date(Date.parse(checkIn) + nights * 864e5).toISOString().slice(0, 10);
  const clash = await findClash(env, src.unit_id, checkIn, checkOut, null);
  if (clash) return json(clashResponseBody(clash), 409);

  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, check_in_time, check_out_time, guests_count, gross_booking_value, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, src.unit_id, src.guest_id, src.channel, `MAN-${id.slice(0, 6).toUpperCase()}`, checkIn, checkOut,
    src.check_in_time, src.check_out_time, src.guests_count, src.gross_booking_value, src.currency, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.duplicate', entityTable: 'reservations', entityId: id, after: { copiedFrom: src.id } });
  return json({ id }, 201);
};
