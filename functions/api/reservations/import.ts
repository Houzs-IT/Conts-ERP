import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { findClash, upsertGuest } from '../../_lib/reservations';

/** POST /api/reservations/import { rows: [{ unitNumber, channel, guest, checkIn, checkOut, guestsCount, grossBookingValue }] }
 *  Each row stands alone: a clash or unknown unit rejects that row only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot import reservations.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!Array.isArray(b?.rows) || b.rows.length === 0 || b.rows.length > 500) return fail('VALIDATION', 'Send between 1 and 500 rows.', 422);

  let created = 0;
  const failed: { row: number; reason: string }[] = [];
  for (const [i, r] of b.rows.entries()) {
    const unit = await one<{ id: string }>(env, 'SELECT id FROM units WHERE unit_number = ? LIMIT 1', String(r.unitNumber ?? ''));
    if (!unit) { failed.push({ row: i + 1, reason: `No unit ${r.unitNumber}.` }); continue; }
    if (!r.checkIn || !r.checkOut || r.checkOut <= r.checkIn) { failed.push({ row: i + 1, reason: 'Check-out must be after check-in.' }); continue; }
    if (!['airbnb', 'booking_com', 'agoda', 'direct'].includes(r.channel)) { failed.push({ row: i + 1, reason: 'Unknown channel.' }); continue; }
    if (await findClash(env, unit.id, r.checkIn, r.checkOut, null)) { failed.push({ row: i + 1, reason: 'Dates already taken.' }); continue; }
    const guestId = r.guest?.fullName ? await upsertGuest(env, r.guest) : null;
    const id = crypto.randomUUID(), now = nowIso();
    await run(env, `
      INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, currency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, 'MYR', ?, ?)`,
      id, unit.id, guestId, r.channel, `IMP-${id.slice(0, 6).toUpperCase()}`, r.checkIn, r.checkOut, r.guestsCount ?? 1, r.grossBookingValue ?? 0, now, now);
    created++;
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.import', entityTable: 'reservations', entityId: 'import', after: { created, failed: failed.length } });
  return json({ created, failed }, created ? 201 : 200);
};
