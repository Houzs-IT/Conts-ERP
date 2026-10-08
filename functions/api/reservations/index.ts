import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { findClash, clashResponseBody, upsertGuest } from '../../_lib/reservations';
import { syncAvailabilityIfLinked } from '../../_lib/channexSync';
import { VIEWS, FROM, COLUMNS, parseListQuery, viewWhere, toRow } from '../../_lib/bookingList';

/** GET /api/reservations?view=&page=&size=&sort=&q=&ref=&guest=&unit=&channel=&stay=&gross=&status=
 *  One page of the Bookings list, every tab's count under the same searches, and the totals of the
 *  whole filtered set (not just the page). Blocks and owner stays appear only under view=blocks. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Bookings are not available to field roles.', 403);

  const q = parseListQuery(new URL(request.url));
  const current = viewWhere(q.view, q.today);
  const sums = await one<Record<string, number>>(env, `
    SELECT ${VIEWS.map(v => `COUNT(*) FILTER (WHERE ${viewWhere(v, q.today)}) AS "${v}"`).join(',\n           ')},
           COUNT(*) FILTER (WHERE ${current}) AS n,
           COALESCE(SUM(r.check_out::date - r.check_in::date) FILTER (WHERE ${current}), 0) AS nights,
           COALESCE(SUM(r.gross_booking_value) FILTER (WHERE ${current}), 0) AS gross,
           COALESCE(SUM(r.channel_fee) FILTER (WHERE ${current}), 0) AS fees
    ${FROM} WHERE ${q.where}`, ...q.args);

  const total = Number(sums?.n ?? 0);
  const page = Math.min(q.page, Math.max(1, Math.ceil(total / q.pageSize)));
  const rows = total ? await all<any>(env, `
    SELECT ${COLUMNS} ${FROM} WHERE ${q.where} AND ${current}
    ORDER BY ${q.orderBy} LIMIT ${q.pageSize} OFFSET ${(page - 1) * q.pageSize}`, ...q.args) : [];

  return json({
    generatedAt: nowIso(), today: q.today, view: q.view, page, pageSize: q.pageSize, total,
    counts: Object.fromEntries(VIEWS.map(v => [v, Number(sums?.[v] ?? 0)])),
    totals: { bookings: total, nights: Number(sums?.nights ?? 0), gross: Number(sums?.gross ?? 0), fees: Number(sums?.fees ?? 0) },
    data: rows.map(toRow),
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
