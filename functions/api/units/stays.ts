import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const WHEN = ['upcoming', 'past', 'cancelled', 'all'] as const;
type When = typeof WHEN[number];

// Upcoming reads soonest first; everything else newest first.
const FILTER: Record<When, { where: string; order: string; usesToday: boolean }> = {
  upcoming: { where: `AND r.state != 'cancelled' AND r.check_out >= ?`, order: 'r.check_in ASC, r.id', usesToday: true },
  past: { where: `AND r.state != 'cancelled' AND r.check_out < ?`, order: 'r.check_in DESC, r.id', usesToday: true },
  cancelled: { where: `AND r.state = 'cancelled'`, order: 'r.check_in DESC, r.id', usesToday: false },
  all: { where: '', order: 'r.check_in DESC, r.id', usesToday: false },
};

/**
 * GET /api/units/stays?unitId=&when=upcoming|past|cancelled|all&page=1&pageSize=20[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 * from/to keep the stays that overlap those dates (counts too).
 * One page of a unit's bookings for the unit record's Bookings tab, with the count of
 * each filter so the tab can label them. A busy unit has a few hundred bookings a year,
 * so the record itself only carries the latest few.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const unitId = url.searchParams.get('unitId');
  if (!unitId) return fail('VALIDATION', 'A unit is required.', 422);
  const whenParam = url.searchParams.get('when') ?? 'upcoming';
  if (!(WHEN as readonly string[]).includes(whenParam)) return fail('VALIDATION', 'Unknown filter.', 422);
  const when = whenParam as When;
  const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get('pageSize')) || 20));
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if ((from && !ISO.test(from)) || (to && !ISO.test(to))) return fail('VALIDATION', 'Dates must look like 2026-10-01.', 422);
  const range = `${from ? 'AND check_out > ?' : ''} ${to ? 'AND check_in <= ?' : ''}`;
  const rangeArgs = [...(from ? [from] : []), ...(to ? [to] : [])];

  const unit = await one<{ owner_id: string }>(env, 'SELECT owner_id FROM units WHERE id = ?', unitId);
  if (!unit) return fail('NOT_FOUND', 'That unit no longer exists.', 404);
  if (session.role === 'owner') {
    const owned = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owners WHERE id = ? AND user_id = ?', unit.owner_id, session.userId);
    if (!owned?.n) return fail('FORBIDDEN', 'This unit is not on your account.', 403);
  }
  const money = session.manage;
  const today = (await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`))!.d;
  const f = FILTER[when];

  const [counts, rows] = await Promise.all([
    one<any>(env, `
      SELECT COUNT(*) FILTER (WHERE state != 'cancelled' AND check_out >= ?) AS upcoming,
             COUNT(*) FILTER (WHERE state != 'cancelled' AND check_out < ?) AS past,
             COUNT(*) FILTER (WHERE state = 'cancelled') AS cancelled,
             COUNT(*) AS all_count,
             COALESCE(SUM(gross_booking_value) FILTER (WHERE state != 'cancelled' AND check_out >= ?), 0) AS upcoming_gross,
             COALESCE(SUM(gross_booking_value) FILTER (WHERE state != 'cancelled' AND check_out < ?), 0) AS past_gross
      FROM reservations WHERE unit_id = ? ${range}`, today, today, today, today, unitId, ...rangeArgs),
    all<any>(env, `
      SELECT r.id, r.channel, r.state, r.check_in, r.check_out, r.guests_count, r.external_ref,
             r.gross_booking_value, COALESCE(g.full_name, '') AS guest_name
      FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.unit_id = ? ${f.where} ${range.replace(/check_/g, 'r.check_')}
      ORDER BY ${f.order}
      LIMIT ? OFFSET ?`, ...[unitId, ...(f.usesToday ? [today] : []), ...rangeArgs, pageSize, (page - 1) * pageSize]),
  ]);

  const total = when === 'all' ? Number(counts.all_count) : Number(counts[when]);
  const gross = when === 'upcoming' ? counts.upcoming_gross : when === 'past' ? counts.past_gross : null;
  return json({
    generatedAt: new Date().toISOString(),
    today, when, page, pageSize, total,
    counts: { upcoming: Number(counts.upcoming), past: Number(counts.past), cancelled: Number(counts.cancelled), all: Number(counts.all_count) },
    ...(money && gross != null ? { totalGross: Number(gross) } : {}),
    rows: rows.map(s => ({
      id: s.id, guestName: s.guest_name || null, channel: s.channel, state: s.state,
      checkIn: s.check_in, checkOut: s.check_out, guestsCount: s.guests_count, externalRef: s.external_ref,
      ...(money ? { grossBookingValue: Number(s.gross_booking_value) } : {}),
    })),
  });
};
