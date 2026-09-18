import { type Env, all, one, run, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? 25), 100);

  const rows = await all(env, `
    SELECT r.*, COALESCE(g.full_name,'') AS guest_name, g.email AS guest_email, g.phone AS guest_phone,
           u.unit_number, p.name AS property_name
    FROM reservations r
    LEFT JOIN guests g ON g.id = r.guest_id
    JOIN units u ON u.id = r.unit_id
    JOIN properties p ON p.id = u.property_id
    ORDER BY r.check_in DESC
    LIMIT ? OFFSET ?`, pageSize, (page - 1) * pageSize);

  const total = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM reservations');

  return json({
    generatedAt: new Date().toISOString(),
    page, pageSize, total: total?.n ?? 0,
    data: rows.map((r: any) => ({
      id: r.id,
      externalRef: r.external_ref,
      guestName: r.guest_name || null,
      guestEmail: r.guest_email,
      guestPhone: r.guest_phone,
      guestsCount: r.guests_count,
      unitNumber: r.unit_number,
      propertyName: r.property_name,
      channel: r.channel,
      state: r.state,
      checkIn: r.check_in,
      checkOut: r.check_out,
      grossBookingValue: r.gross_booking_value,
      collectedRevenue: r.collected_revenue,
      notes: r.notes,
    })),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const b = await request.json<any>();
  if (!b.unitId || !b.checkIn || !b.checkOut) return fail('VALIDATION', 'Unit and dates are required.', 422);
  if (b.checkOut <= b.checkIn) return fail('VALIDATION', 'Check-out must be after check-in.', 422, { checkOut: 'Check-out must be after check-in.' });

  // D1 has no EXCLUDE constraint, so the overlap rule is enforced here.
  // The conflicting reservation is returned so the UI can explain the refusal.
  const clash = await one<any>(env, `
    SELECT r.id, r.check_in, r.check_out, COALESCE(g.full_name,'Block') AS guest_name
    FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.unit_id = ? AND r.state NOT IN ('cancelled','no_show','inquiry')
      AND r.check_in < ? AND r.check_out > ? LIMIT 1`,
    b.unitId, b.checkOut, b.checkIn);

  if (clash) {
    return json({
      error: { code: 'DATE_CONFLICT', message: `Blocked. This unit already has ${clash.guest_name} on those dates.` },
      conflict: { reservationId: clash.id, guestName: clash.guest_name, checkIn: clash.check_in, checkOut: clash.check_out },
    }, 409);
  }

  const id = crypto.randomUUID();
  await run(env, `
    INSERT INTO reservations (id, unit_id, guest_id, channel, state, check_in, check_out, guests_count, gross_booking_value, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, 'MYR', ?, ?)`,
    id, b.unitId, b.guestId ?? null, b.channel, b.checkIn, b.checkOut,
    b.guestsCount ?? 1, b.grossBookingValue ?? 0, new Date().toISOString(), new Date().toISOString());

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.create', entityTable: 'reservations', entityId: id, after: b });
  return json({ id }, 201);
};
