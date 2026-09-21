import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { findClash, clashResponseBody, upsertGuest } from '../../_lib/reservations';

const OPS = ['management', 'operations_manager', 'operations_staff'];
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));
const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const at = (date: string, time: string) => `${date}T${time}:00+08:00`;

/** GET /api/guests — the guest directory, each guest with their history and today/tomorrow movement. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Guest contact details are not available to field roles.', 403);
  const contact = OPS.includes(session.role);

  const today = (await one<{ d: string; t: string }>(env, `
    SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d,
           to_char((now() AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '1 day', 'YYYY-MM-DD') AS t`))!;

  const guests = await all<any>(env, 'SELECT id, full_name, email, phone, created_at FROM guests ORDER BY full_name');
  const stays = await all<any>(env, `
    SELECT r.id, r.guest_id, r.channel, r.state, r.check_in, r.check_out, r.check_in_time, r.check_out_time, r.guests_count,
           r.gross_booking_value, r.notes, u.unit_number, u.readiness, p.name AS property_name,
           (SELECT MIN(t.created_at) FROM tasks t WHERE t.reservation_id = r.id) AS prepared_at,
           (SELECT MAX(n.sent_at) FROM notification_log n WHERE n.template = 'access_details' AND n.entity_id = r.id) AS access_sent_at,
           (SELECT AVG(v.rating) FROM reviews v WHERE v.reservation_id = r.id) AS rating
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id
    WHERE r.guest_id IS NOT NULL AND r.channel NOT IN ('maintenance_block','owner_stay') AND r.state != 'cancelled'
    ORDER BY r.check_in DESC`);

  const byGuest = new Map<string, any[]>();
  for (const s of stays) {
    const list = byGuest.get(s.guest_id) ?? [];
    list.push(s);
    byGuest.set(s.guest_id, list);
  }

  const data = guests.map(g => {
    const mine = byGuest.get(g.id) ?? [];
    const done = mine.filter(s => s.state === 'checked_out' || s.state === 'checked_in');
    const latest = mine[0];
    const ratings = mine.map(s => s.rating).filter(x => x !== null).map(Number);

    let movement: Record<string, unknown> | undefined;
    const candidates = mine.flatMap(s => {
      const out: { kind: 'arrival' | 'departure'; day: 'today' | 'tomorrow'; s: any }[] = [];
      if ((s.state === 'confirmed' || s.state === 'pending' || s.state === 'checked_in') && (s.check_in === today.d || s.check_in === today.t)) out.push({ kind: 'arrival', day: s.check_in === today.d ? 'today' : 'tomorrow', s });
      if ((s.state === 'checked_in' || s.state === 'checked_out') && (s.check_out === today.d || s.check_out === today.t)) out.push({ kind: 'departure', day: s.check_out === today.d ? 'today' : 'tomorrow', s });
      return out;
    }).sort((a, b) => (a.day === b.day ? (a.kind === 'arrival' ? -1 : 1) : a.day === 'today' ? -1 : 1));
    if (candidates[0]) {
      const { kind, day, s } = candidates[0];
      movement = {
        reservationId: s.id, kind, day,
        checkInAt: at(s.check_in, s.check_in_time), checkOutAt: at(s.check_out, s.check_out_time),
        unitNumber: s.unit_number, propertyName: s.property_name, channel: s.channel,
        nights: nightsBetween(s.check_in, s.check_out), guestsCount: s.guests_count,
        state: s.state, readiness: s.readiness, preparedAt: s.prepared_at, accessSentAt: s.access_sent_at,
      };
    }

    const tag = done.length >= 2 ? { label: 'Repeat guest', tone: 'success' }
      : latest?.channel === 'direct' ? { label: 'Direct', tone: 'info' }
      : { label: mine.length ? 'New' : 'No stays yet', tone: 'neutral' };

    return {
      id: g.id, fullName: g.full_name,
      email: contact ? g.email : null, phone: contact ? g.phone : null,
      channel: latest?.channel ?? 'direct', tag, since: `Guest since ${monthYear(g.created_at)}`,
      stays: done.length, nights: done.reduce((n, s) => n + nightsBetween(s.check_in, s.check_out), 0),
      lifetimeValue: done.reduce((n, s) => n + Number(s.gross_booking_value), 0),
      ratingScore: ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)) : null,
      history: mine.map(s => ({
        checkIn: s.check_in, checkOut: s.check_out, unitNumber: s.unit_number, propertyName: s.property_name,
        nights: nightsBetween(s.check_in, s.check_out), channel: s.channel, value: Number(s.gross_booking_value), state: s.state,
      })),
      ...(movement ? { movement } : {}),
    };
  });

  return json({ generatedAt: nowIso(), total: data.length, data });
};

/** POST /api/guests { fullName, phone, email, unitNumber, propertyName, guestsCount } — a walk-in: guest plus a stay from today. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!OPS.includes(session.role)) return fail('FORBIDDEN', 'Only operations and management can add guests.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.fullName?.trim()) return fail('VALIDATION', 'Enter the guest name.', 422, { fullName: 'Enter the guest name.' });

  const unit = await one<{ id: string }>(env, `
    SELECT u.id FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.unit_number = ? AND (? = '' OR p.name = ?) LIMIT 1`, String(b.unitNumber ?? ''), String(b.propertyName ?? ''), String(b.propertyName ?? ''));
  if (!unit) return fail('NOT_FOUND', 'Pick a unit that exists.', 404, { unitNumber: 'Pick a unit.' });

  const d = (await one<{ d: string; t: string }>(env, `
    SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d,
           to_char((now() AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '1 day', 'YYYY-MM-DD') AS t`))!;
  const clash = await findClash(env, unit.id, d.d, d.t, null);
  if (clash) return json(clashResponseBody(clash), 409);

  const guestId = await upsertGuest(env, { fullName: b.fullName, email: b.email, phone: b.phone });
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, currency, created_at, updated_at)
    VALUES (?, ?, ?, 'direct', ?, 'confirmed', ?, ?, ?, 0, 'MYR', ?, ?)`,
    id, unit.id, guestId, `WALK-${id.slice(0, 6).toUpperCase()}`, d.d, d.t, b.guestsCount ?? 1, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest.walk_in', entityTable: 'reservations', entityId: id, after: { guestId, unitId: unit.id } });
  return json({ id: guestId, reservationId: id }, 201);
};
