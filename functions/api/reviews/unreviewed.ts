import { type Env, all, one, json, fail, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { STAY_SQL } from '../../_lib/reviewStays';
import { REVIEW_WINDOW_DAYS, daysSince, windowClosed } from '../../../src/lib/reviewRules';

const CHANNELS = ['airbnb', 'booking_com', 'agoda', 'direct'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/reviews/unreviewed — finished stays that have not left a review yet, newest checkout first.
 *    ?from=yyyy-mm-dd&to=yyyy-mm-dd   checkout between (default: the last 90 days up to yesterday)
 *    &channel=...  &unitId=...  &propertyId=<building>  &window=open|closed  &page=1&pageSize=50
 *  `totals` counts the stays checked out in the same range and filters: how many left a review and the review rate.
 *  A channel stay past the channel's review window (src/lib/reviewWindow.ts) is "Window closed". */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);
  const url = new URL(request.url);
  const today = mytToday();
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const fromQ = url.searchParams.get('from'), toQ = url.searchParams.get('to');
  const from = fromQ && DATE.test(fromQ) ? fromQ : day(-90);
  // A stay that checks out today has not finished yet, so the range ends yesterday at the latest.
  const to = toQ && DATE.test(toQ) && toQ < today ? toQ : day(-1);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 50)));

  const where = [STAY_SQL, 'r.check_out BETWEEN ? AND ?'], args: unknown[] = [from, to];
  const channel = url.searchParams.get('channel');
  if (channel && CHANNELS.includes(channel)) { where.push('r.channel = ?'); args.push(channel); }
  const unitId = url.searchParams.get('unitId');
  if (unitId) { where.push('r.unit_id = ?'); args.push(unitId); }
  const propertyId = url.searchParams.get('propertyId');
  if (propertyId) { where.push('u.property_id = ?'); args.push(propertyId); }
  const base = `FROM reservations r JOIN units u ON u.id = r.unit_id LEFT JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE ${where.join(' AND ')}`;
  const noReview = 'NOT EXISTS (SELECT 1 FROM reviews v WHERE v.reservation_id = r.id)';

  // Window open / closed, worked out in SQL from the same constant the screen uses.
  const windowCase = `CASE r.channel ${Object.entries(REVIEW_WINDOW_DAYS).map(([c, d]) => `WHEN '${c}' THEN ${Number(d)}`).join(' ')} ELSE NULL END`;
  const closedSql = `(${windowCase} IS NOT NULL AND (?::date - r.check_out::date) > ${windowCase})`;
  const win = url.searchParams.get('window');
  const winCond = win === 'closed' ? ` AND ${closedSql}` : win === 'open' ? ` AND NOT ${closedSql}` : '';
  const winArgs = win === 'closed' || win === 'open' ? [today] : [];

  const [rows, totals, filteredN, perUnit] = await Promise.all([
    all<any>(env, `
      SELECT r.id, r.channel, r.check_in, r.check_out, r.external_ref, r.guests_count, COALESCE(g.full_name, 'Guest') AS guest_name,
        u.id AS unit_id, u.unit_number, p.id AS property_id, p.name AS property_name,
        (SELECT t.id FROM message_threads t WHERE t.reservation_id = r.id ORDER BY t.last_message_at DESC LIMIT 1) AS thread_id
      ${base} AND ${noReview}${winCond}
      ORDER BY r.check_out DESC, r.id LIMIT ? OFFSET ?`, ...args, ...winArgs, pageSize, (page - 1) * pageSize),
    one<{ stays: number; reviewed: number; closed: number }>(env, `
      SELECT count(*)::int AS stays, count(*) FILTER (WHERE NOT ${noReview})::int AS reviewed,
        count(*) FILTER (WHERE ${noReview} AND ${closedSql})::int AS closed
      ${base}`, today, ...args),
    one<{ n: number }>(env, `SELECT count(*)::int AS n ${base} AND ${noReview}${winCond}`, ...args, ...winArgs),
    // Stays without a review per unit, in the same range and filters, for the grouping on the screen.
    all<any>(env, `
      SELECT u.id AS unit_id, u.unit_number, p.id AS property_id, p.name AS property_name, count(*)::int AS n,
        count(*) FILTER (WHERE NOT ${closedSql})::int AS open
      ${base} AND ${noReview}${winCond}
      GROUP BY u.id, u.unit_number, p.id, p.name ORDER BY n DESC, p.name, u.unit_number`, today, ...args, ...winArgs),
  ]);
  const stays = totals?.stays ?? 0, reviewed = totals?.reviewed ?? 0;

  return json({
    generatedAt: new Date().toISOString(),
    from, to, page, pageSize, total: filteredN?.n ?? 0,
    totals: { checkedOut: stays, reviewed, notReviewed: stays - reviewed, windowClosed: totals?.closed ?? 0, reviewRate: stays ? Math.round((reviewed / stays) * 100) : null },
    windowDays: REVIEW_WINDOW_DAYS,
    perUnit: perUnit.map(u => ({ unitId: u.unit_id, unitNumber: u.unit_number, propertyId: u.property_id ?? null, propertyName: u.property_name ?? null, withoutReview: Number(u.n), windowOpen: Number(u.open) })),
    data: rows.map(r => ({
      reservationId: r.id, channel: r.channel, guestName: r.guest_name, checkIn: r.check_in, checkOut: r.check_out, bookingRef: r.external_ref ?? null,
      unitId: r.unit_id, unitNumber: r.unit_number, propertyId: r.property_id ?? null, propertyName: r.property_name ?? null, threadId: r.thread_id ?? null,
      daysSinceCheckout: daysSince(r.check_out, today), windowClosed: windowClosed(r.channel, r.check_out, today),
    })),
  });
};
