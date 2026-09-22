import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { findClash, clashResponseBody, upsertGuest } from '../../_lib/reservations';
import { syncAvailabilityIfLinked } from '../../_lib/channexSync';

const stamp = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 16) : null);
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));

/** GET /api/reservations — guest bookings (blocks and owner stays are not bookings). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Bookings are not available to field roles.', 403);

  const rows = await all<any>(env, `
    SELECT r.*, COALESCE(g.full_name, '') AS guest_name, g.phone AS guest_phone, u.unit_number, p.name AS property_name
    FROM reservations r
    LEFT JOIN guests g ON g.id = r.guest_id
    JOIN units u ON u.id = r.unit_id
    JOIN properties p ON p.id = u.property_id
    WHERE r.channel NOT IN ('maintenance_block','owner_stay')
    ORDER BY r.check_in DESC LIMIT 1000`);
  const total = await one<{ n: number }>(env, `SELECT COUNT(*) AS n FROM reservations WHERE channel NOT IN ('maintenance_block','owner_stay')`);

  return json({
    generatedAt: nowIso(), page: 1, total: Number(total?.n ?? 0),
    data: rows.map(r => ({
      id: r.id, externalRef: r.external_ref, guestName: r.guest_name, guestsCount: r.guests_count,
      guestPhone: r.guest_phone, unitNumber: r.unit_number, propertyName: r.property_name,
      channel: r.channel, state: r.state, checkIn: r.check_in, checkOut: r.check_out,
      checkInTime: r.check_in_time, checkOutTime: r.check_out_time,
      nights: nightsBetween(r.check_in, r.check_out), grossBookingValue: r.gross_booking_value,
      paidAt: Number(r.collected_revenue) > 0 ? stamp(r.created_at) : null, receivedAt: stamp(r.created_at),
    })),
  });
};

/** POST /api/reservations { unitId, channel, guest | guestId, checkIn, checkOut, guestsCount, grossBookingValue } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot create reservations.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.unitId || !b.checkIn || !b.checkOut) return fail('VALIDATION', 'Unit and dates are required.', 422);
  if (b.checkOut <= b.checkIn) return fail('VALIDATION', 'Check-out must be after check-in.', 422, { checkOut: 'Check-out must be after check-in.' });
  const channel = b.channel ?? 'direct';
  if (!['airbnb', 'booking_com', 'agoda', 'direct', 'owner_stay'].includes(channel)) return fail('VALIDATION', 'Unknown channel.', 422, { channel: 'Pick a channel.' });
  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', b.unitId))) return fail('NOT_FOUND', 'That unit does not exist.', 404);

  const clash = await findClash(env, b.unitId, b.checkIn, b.checkOut, null);
  if (clash) return json(clashResponseBody(clash), 409);

  const guestId = b.guest?.fullName ? await upsertGuest(env, b.guest) : (b.guestId ?? null);
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, 'MYR', ?, ?)`,
    id, b.unitId, guestId, channel, b.externalRef ?? `MAN-${id.slice(0, 6).toUpperCase()}`, b.checkIn, b.checkOut,
    b.guestsCount ?? 1, b.grossBookingValue ?? 0, now, now);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.create', entityTable: 'reservations', entityId: id, after: { unitId: b.unitId, checkIn: b.checkIn, checkOut: b.checkOut, channel } });
  await syncAvailabilityIfLinked(env, b.unitId, b.checkIn, b.checkOut, false);
  return json({ id }, 201);
};
