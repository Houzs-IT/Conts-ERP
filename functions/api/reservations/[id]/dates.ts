import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { findClash, clashResponseBody } from '../../../_lib/reservations';
import { syncAvailabilityIfLinked } from '../../../_lib/channexSync';

/** PATCH /api/reservations/:id/dates { checkIn, checkOut, confirm } — without confirm: 428 with the consequence. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot change reservations.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (!b?.checkIn || !b.checkOut) return fail('VALIDATION', 'Both dates are required.', 422);
  if (b.checkOut <= b.checkIn) return fail('VALIDATION', 'Check-out must be after check-in.', 422, { checkOut: 'Check-out must be after check-in.' });

  const cur = await one<any>(env, `
    SELECT r.id, r.unit_id, r.check_in, r.check_out, COALESCE(g.full_name, 'The guest') AS guest_name
    FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id WHERE r.id = ?`, id);
  if (!cur) return fail('NOT_FOUND', 'That reservation does not exist.', 404);

  const clash = await findClash(env, cur.unit_id, b.checkIn, b.checkOut, id);
  if (clash) return json(clashResponseBody(clash), 409);

  if (!b.confirm) {
    return fail('CONFIRMATION_REQUIRED', `${cur.guest_name} moves from ${cur.check_in} - ${cur.check_out} to ${b.checkIn} - ${b.checkOut} and is notified. Confirm to continue.`, 428);
  }

  await run(env, 'UPDATE reservations SET check_in = ?, check_out = ?, updated_at = ? WHERE id = ?', b.checkIn, b.checkOut, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.dates', entityTable: 'reservations', entityId: id, before: { checkIn: cur.check_in, checkOut: cur.check_out }, after: { checkIn: b.checkIn, checkOut: b.checkOut } });
  await syncAvailabilityIfLinked(env, cur.unit_id, cur.check_in, cur.check_out, true);
  await syncAvailabilityIfLinked(env, cur.unit_id, b.checkIn, b.checkOut, false);
  return json({ id, checkIn: b.checkIn, checkOut: b.checkOut });
};
