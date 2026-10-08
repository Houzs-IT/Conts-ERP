import { mayWork } from '../../_lib/access';
import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { CONTACT_ROLES, guestTag, monthYear, todayAndTomorrow } from '../../_lib/guestList';

const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));
const at = (date: string, time: string) => `${date}T${time}:00+08:00`;

/** GET /api/guests/:id — one guest's profile: lifetime figures, stay history and today/tomorrow movement. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Guest contact details are not available to field roles.', 403);
  const contact = mayWork(session, CONTACT_ROLES);

  const g = await one<any>(env, 'SELECT id, full_name, email, phone, created_at FROM guests WHERE id = ?', String(params.id));
  if (!g) return fail('NOT_FOUND', 'That guest does not exist.', 404);

  const { today, tomorrow } = todayAndTomorrow();
  const mine = await all<any>(env, `
    SELECT r.id, r.channel, r.state, r.check_in, r.check_out, r.check_in_time, r.check_out_time, r.guests_count,
           r.gross_booking_value, u.unit_number, u.readiness, p.name AS property_name,
           (SELECT MIN(t.created_at) FROM tasks t WHERE t.reservation_id = r.id) AS prepared_at,
           (SELECT MAX(n.sent_at) FROM notification_log n WHERE n.template = 'access_details' AND n.entity_id = r.id) AS access_sent_at,
           (SELECT AVG(v.rating) FROM reviews v WHERE v.reservation_id = r.id) AS rating
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id
    WHERE r.guest_id = ? AND r.channel NOT IN ('maintenance_block','owner_stay') AND r.state != 'cancelled'
    ORDER BY r.check_in DESC`, g.id);

  const done = mine.filter(s => s.state === 'checked_out' || s.state === 'checked_in');
  const ratings = mine.map(s => s.rating).filter(x => x !== null).map(Number);

  let movement: Record<string, unknown> | undefined;
  const candidates = mine.flatMap(s => {
    const out: { kind: 'arrival' | 'departure'; day: 'today' | 'tomorrow'; s: any }[] = [];
    if ((s.state === 'confirmed' || s.state === 'pending' || s.state === 'checked_in') && (s.check_in === today || s.check_in === tomorrow)) out.push({ kind: 'arrival', day: s.check_in === today ? 'today' : 'tomorrow', s });
    if ((s.state === 'checked_in' || s.state === 'checked_out') && (s.check_out === today || s.check_out === tomorrow)) out.push({ kind: 'departure', day: s.check_out === today ? 'today' : 'tomorrow', s });
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

  const latest = mine[0]?.channel ?? null;
  const channel = latest ?? 'direct';
  return json({
    id: g.id, fullName: g.full_name,
    email: contact ? g.email : null, phone: contact ? g.phone : null,
    channel, tag: guestTag(done.length, mine.length, latest), since: `Guest since ${monthYear(g.created_at)}`,
    stays: done.length, nights: done.reduce((n, s) => n + nightsBetween(s.check_in, s.check_out), 0),
    lifetimeValue: done.reduce((n, s) => n + Number(s.gross_booking_value), 0),
    ratingScore: ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)) : null,
    history: mine.map(s => ({
      reservationId: s.id, checkIn: s.check_in, checkOut: s.check_out, unitNumber: s.unit_number, propertyName: s.property_name,
      nights: nightsBetween(s.check_in, s.check_out), channel: s.channel, value: Number(s.gross_booking_value), state: s.state,
    })),
    ...(movement ? { movement } : {}),
  });
};
