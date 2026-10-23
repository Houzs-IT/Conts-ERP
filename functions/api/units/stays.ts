import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';

const WHEN = ['all', 'upcoming', 'arriving', 'hosting', 'checking_out', 'past', 'cancelled'] as const;
type When = typeof WHEN[number];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Each reservation's one status in the owner's words (docs/VOCABULARY.md section 2), worked out from the stored state
 *  and the dates the way the calendar does (ReservationBar phaseOf): Arriving soon is a check-in today or tomorrow,
 *  Checking out a checkout today. $1 is today, $2 tomorrow. */
const PHASE = `CASE WHEN r.state = 'cancelled' THEN 'cancelled'
  WHEN r.state IN ('checked_out', 'no_show') OR r.check_out < $1 THEN 'past'
  WHEN r.check_out = $1 AND (r.state = 'checked_in' OR r.check_in < $1) THEN 'checking_out'
  WHEN r.state = 'checked_in' OR r.check_in < $1 THEN 'hosting'
  WHEN r.check_in <= $2 THEN 'arriving'
  ELSE 'upcoming' END`;

/**
 * GET /api/units/stays?unitId=&when=all|upcoming|arriving|hosting|checking_out|past|cancelled&from=&to=&page=1&pageSize=20
 * One page of a unit's reservations for the unit record's Reservations tab, with the count of each status so the
 * chips can label them. from/to (YYYY-MM-DD) keep the stays that touch the range. A busy unit has a few hundred
 * reservations a year, so the record itself only carries the next few.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const unitId = url.searchParams.get('unitId');
  if (!unitId) return fail('VALIDATION', 'A unit is required.', 422);
  const whenParam = url.searchParams.get('when') ?? 'all';
  if (!(WHEN as readonly string[]).includes(whenParam)) return fail('VALIDATION', 'Unknown filter.', 422);
  const when = whenParam as When;
  const from = url.searchParams.get('from') || null, to = url.searchParams.get('to') || null;
  if ((from && !ISO.test(from)) || (to && !ISO.test(to))) return fail('VALIDATION', 'Dates are YYYY-MM-DD.', 422);
  if (from && to && to < from) return fail('VALIDATION', 'The end date is before the start date.', 422, { to: 'Pick a later date.' });
  const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get('pageSize')) || 20));
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));

  const unit = await one<{ owner_id: string }>(env, 'SELECT owner_id FROM units WHERE id = ?', unitId);
  if (!unit) return fail('NOT_FOUND', 'That unit no longer exists.', 404);
  if (session.role === 'owner') {
    const owned = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owners WHERE id = ? AND user_id = ?', unit.owner_id, session.userId);
    if (!owned?.n) return fail('FORBIDDEN', 'This unit is not on your account.', 403);
  }
  const money = session.manage || can(session, 'finance', 'view');
  const today = (await one<{ d: string; t: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d,
    to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur' + interval '1 day', 'YYYY-MM-DD') AS t`))!;

  // $1 today, $2 tomorrow, $3 unit, then the range; postgres numbers the placeholders, so the CASE reads them by number.
  const range = `${from ? ' AND r.check_out >= $4' : ''}${to ? ` AND r.check_in <= $${from ? 5 : 4}` : ''}`;
  const base = [today.d, today.t, unitId, ...(from ? [from] : []), ...(to ? [to] : [])];
  const scoped = `SELECT r.*, ${PHASE} AS phase FROM reservations r WHERE r.unit_id = $3${range}`;
  // Upcoming reads soonest first; everything else newest first.
  const order = ['upcoming', 'arriving'].includes(when) ? 'x.check_in ASC, x.id' : 'x.check_in DESC, x.id';
  const n = base.length;
  const [counts, rows] = await Promise.all([
    all<{ phase: string; n: number; gross: number }>(env, `SELECT phase, COUNT(*)::int AS n, COALESCE(SUM(gross_booking_value), 0)::bigint AS gross FROM (${scoped}) x GROUP BY phase`, ...base),
    all<any>(env, `
      SELECT x.id, x.channel, x.state, x.phase, x.block_reason, x.check_in, x.check_out, x.guests_count, x.external_ref,
             x.gross_booking_value, COALESCE(g.full_name, '') AS guest_name
      FROM (${scoped}) x LEFT JOIN guests g ON g.id = x.guest_id
      ${when === 'all' ? '' : `WHERE x.phase = $${n + 1}`}
      ORDER BY ${order}
      LIMIT $${n + (when === 'all' ? 1 : 2)} OFFSET $${n + (when === 'all' ? 2 : 3)}`, ...base, ...(when === 'all' ? [] : [when]), pageSize, (page - 1) * pageSize),
  ]);

  const byPhase = Object.fromEntries(WHEN.map(w => [w, 0])) as Record<When, number>;
  let gross = 0, grossAll = 0;
  for (const c of counts) {
    byPhase[c.phase as When] = Number(c.n); byPhase.all += Number(c.n);
    if (c.phase !== 'cancelled') grossAll += Number(c.gross);
    if (c.phase === when) gross = Number(c.gross);
  }
  const total = byPhase[when];
  return json({
    generatedAt: new Date().toISOString(),
    today: today.d, when, from, to, page, pageSize, total, counts: byPhase,
    // The guest total of what is shown; cancelled reservations never count.
    ...(money && when !== 'cancelled' ? { totalGross: when === 'all' ? grossAll : gross } : {}),
    rows: rows.map(s => ({
      id: s.id, guestName: s.guest_name || null, channel: s.channel, state: s.state, phase: s.phase, blockReason: s.block_reason ?? null,
      checkIn: s.check_in, checkOut: s.check_out, guestsCount: s.guests_count, externalRef: s.external_ref,
      ...(money ? { grossBookingValue: Number(s.gross_booking_value) } : {}),
    })),
  });
};
