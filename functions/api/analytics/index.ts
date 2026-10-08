import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { monthsBack, daysIn, todayMyt } from '../../_lib/ops';

const RANGES = ['3m', '12m', 'ytd'];
const COUNTED = `r.state IN ('confirmed','checked_in','checked_out') AND r.channel NOT IN ('maintenance_block','owner_stay')`;

type Delta = { value: number; unit: 'percent' | 'points'; direction: 'up' | 'down' | 'flat'; tone: 'success' | 'warning' | 'neutral' };
const pctDelta = (now: number, before: number): Delta => {
  if (before <= 0) return { value: 0, unit: 'percent', direction: 'flat', tone: 'neutral' };
  const v = Number((((now - before) / before) * 100).toFixed(1));
  return { value: Math.abs(v), unit: 'percent', direction: v > 0 ? 'up' : v < 0 ? 'down' : 'flat', tone: v > 0 ? 'success' : v < 0 ? 'warning' : 'neutral' };
};
const pointDelta = (now: number, before: number): Delta => {
  const v = Number((now - before).toFixed(1));
  return { value: Math.abs(v), unit: 'points', direction: v > 0 ? 'up' : v < 0 ? 'down' : 'flat', tone: v > 0 ? 'success' : v < 0 ? 'warning' : 'neutral' };
};

/** GET /api/analytics?range=3m|12m|ytd
 *  Occupancy = occupied nights / available nights; ADR = collected revenue / occupied nights; RevPAR = collected revenue / available nights.
 *  Maintenance blocks and owner stays are excluded. Stays count in the month they start. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Analytics are visible to finance and management roles.', 403);

  const range = new URL(request.url).searchParams.get('range') ?? '12m';
  if (!RANGES.includes(range)) return fail('VALIDATION', 'Range must be 3m, 12m or ytd.', 422);

  const today = todayMyt();
  const count = range === '3m' ? 3 : range === '12m' ? 12 : Number(today.slice(5, 7));
  const periods = monthsBack(today, count);
  // The window we compare against: the same number of months straight before, or for year-to-date the same months last year.
  const before = range === 'ytd' ? periods.map(p => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`) : monthsBack(`${periods[0]}-01`, count + 1).slice(0, count);

  const listed = (await all<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM units WHERE is_listed = 1'))[0]?.n ?? 0;

  const monthRows = await all<any>(env, `
    SELECT substr(r.check_in, 1, 7) AS period, COALESCE(SUM(r.collected_revenue), 0) AS revenue, COALESCE(SUM(r.gross_booking_value), 0) AS gross,
           COALESCE(SUM(r.check_out::date - r.check_in::date), 0) AS nights
    FROM reservations r WHERE ${COUNTED} AND substr(r.check_in, 1, 7) BETWEEN ? AND ? GROUP BY period`,
    [periods[0], before[0]].sort()[0], periods[periods.length - 1]);
  const by = new Map(monthRows.map(r => [r.period, r]));

  const summarise = (list: string[]) => {
    const revenue = list.reduce((n, p) => n + Number(by.get(p)?.revenue ?? 0), 0);
    const nights = list.reduce((n, p) => n + Number(by.get(p)?.nights ?? 0), 0);
    const available = list.reduce((n, p) => n + listed * daysIn(p), 0);
    return { revenue, nights, occupancy: available ? (nights / available) * 100 : 0, adr: nights ? revenue / nights : 0, revpar: available ? revenue / available : 0 };
  };

  const points = periods.map(p => {
    const r = by.get(p), nights = Number(r?.nights ?? 0), revenue = Number(r?.revenue ?? 0), available = listed * daysIn(p);
    return {
      period: p, revenue, isCurrent: p === today.slice(0, 7),
      occupancy: available ? Math.min(100, Number(((nights / available) * 100).toFixed(1))) : 0,
      adr: nights ? Math.round(revenue / nights) : 0, revpar: available ? Math.round(revenue / available) : 0,
    };
  });

  const now = summarise(periods), prev = summarise(before);

  const fees = (await all<any>(env, `SELECT COALESCE(SUM(management_fee), 0) AS fee, COALESCE(SUM(net_payout), 0) AS net FROM owner_statements WHERE substr(period_start, 1, 7) BETWEEN ? AND ?`, periods[0], periods[periods.length - 1]))[0];

  const days = periods.reduce((n, p) => n + daysIn(p), 0);
  const unitRows = await all<any>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name,
           COALESCE(SUM(r.collected_revenue), 0) AS revenue, COALESCE(SUM(r.check_out::date - r.check_in::date), 0) AS nights,
           (SELECT ROUND(AVG(v.rating)::numeric, 2) FROM reviews v WHERE v.unit_id = u.id) AS rating
    FROM units u JOIN properties p ON p.id = u.property_id
    LEFT JOIN reservations r ON r.unit_id = u.id AND ${COUNTED} AND substr(r.check_in, 1, 7) BETWEEN ? AND ?
    WHERE u.is_listed = 1 GROUP BY u.id, p.name`, periods[0], periods[periods.length - 1]);

  const channels = await all<any>(env, `
    SELECT r.channel, COALESCE(SUM(r.collected_revenue), 0) AS revenue FROM reservations r
    WHERE ${COUNTED} AND substr(r.check_in, 1, 7) BETWEEN ? AND ? GROUP BY r.channel ORDER BY revenue DESC`, periods[0], periods[periods.length - 1]);
  const channelTotal = channels.reduce((n, c) => n + Number(c.revenue), 0);

  return json({
    generatedAt: new Date().toISOString(), currency: 'MYR', range, points,
    deltas: {
      revenue: pctDelta(now.revenue, prev.revenue),
      occupancy: pointDelta(now.occupancy, prev.occupancy),
      adr: pctDelta(now.adr, prev.adr),
      revpar: pctDelta(now.revpar, prev.revpar),
    },
    totals: {
      grossBookingValue: periods.reduce((n, p) => n + Number(by.get(p)?.gross ?? 0), 0),
      collectedRevenue: now.revenue, managementFees: Number(fees?.fee ?? 0), netOwnerPayout: Number(fees?.net ?? 0),
    },
    units: unitRows.map(u => {
      const revenue = Number(u.revenue), nights = Number(u.nights);
      return {
        unitId: u.id, unitNumber: u.unit_number, propertyName: u.property_name,
        occupancy: Math.min(100, Number(((nights / days) * 100).toFixed(1))),
        adr: nights ? Math.round(revenue / nights) : 0, revpar: Math.round(revenue / days), revenue,
        rating: u.rating === null ? null : Number(u.rating),
      };
    }),
    channelMix: channels.map(c => ({ channel: c.channel, revenue: Number(c.revenue), share: channelTotal ? Number(((Number(c.revenue) / channelTotal) * 100).toFixed(1)) : 0 })),
  });
};
