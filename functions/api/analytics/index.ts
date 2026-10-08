import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { monthsBack, daysIn, todayMyt } from '../../_lib/ops';
import { stayMonths, metrics, groupBy, monthEndExclusive } from '../../_lib/revenue';

const RANGES = ['3m', '12m', 'ytd'];

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
 *  Definitions in functions/_lib/revenue.ts: gross booking value and nights split by night into each month;
 *  occupancy = booked nights / available nights of listed units; ADR = gross / booked nights; RevPAR = gross / available nights.
 *  Maintenance blocks, owner stays and cancellations are excluded. */
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

  // functions/_lib/revenue.ts: gross value and nights split by night into the months they fall in.
  const from = `${[periods[0], before[0]].sort()[0]}-01`, to = monthEndExclusive(periods[periods.length - 1]);
  const rows = await stayMonths(env, from, to);
  const listedIds = new Set((await all<{ id: string }>(env, 'SELECT id FROM units WHERE is_listed = 1')).map(u => u.id));
  const listed = listedIds.size;
  const inList = (list: string[]) => { const set = new Set(list); return rows.filter(r => set.has(r.month)); };
  const listedRows = (rs: typeof rows) => rs.filter(r => listedIds.has(r.unit_id));
  const by = groupBy(rows, r => r.month);

  const summarise = (list: string[]) => {
    const rs = inList(list), total = metrics(rs, 0);
    const occ = metrics(listedRows(rs), list.reduce((n, p) => n + listed * daysIn(p), 0));
    return { revenue: total.gross, occupancy: occ.available ? (occ.nights / occ.available) * 100 : 0, adr: occ.adr, revpar: occ.revpar };
  };

  const points = periods.map(p => {
    const rs = by.get(p) ?? [], occ = metrics(listedRows(rs), listed * daysIn(p));
    return { period: p, revenue: metrics(rs, 0).gross, isCurrent: p === today.slice(0, 7), occupancy: occ.occupancy, adr: occ.adr, revpar: occ.revpar };
  });

  const now = summarise(periods), prev = summarise(before);
  const window = inList(periods);

  const fees = (await all<any>(env, `SELECT COALESCE(SUM(management_fee), 0) AS fee, COALESCE(SUM(net_payout), 0) AS net FROM owner_statements WHERE substr(period_start, 1, 7) BETWEEN ? AND ?`, periods[0], periods[periods.length - 1]))[0];

  const days = periods.reduce((n, p) => n + daysIn(p), 0);
  const unitRows = await all<any>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name,
           (SELECT ROUND(AVG(v.rating)::numeric, 2) FROM reviews v WHERE v.unit_id = u.id) AS rating
    FROM units u JOIN properties p ON p.id = u.property_id WHERE u.is_listed = 1`);
  const byUnit = groupBy(window, r => r.unit_id);
  const byChannel = groupBy(window, r => r.channel);
  const channels = [...byChannel.entries()].map(([channel, rs]) => ({ channel, revenue: metrics(rs, 0).gross })).sort((a, b) => b.revenue - a.revenue);
  const channelTotal = channels.reduce((n, c) => n + c.revenue, 0);

  return json({
    generatedAt: new Date().toISOString(), currency: 'MYR', range, points,
    deltas: {
      revenue: pctDelta(now.revenue, prev.revenue),
      occupancy: pointDelta(now.occupancy, prev.occupancy),
      adr: pctDelta(now.adr, prev.adr),
      revpar: pctDelta(now.revpar, prev.revpar),
    },
    totals: {
      grossBookingValue: metrics(window, 0).gross,
      collectedRevenue: metrics(window, 0).collected, managementFees: Number(fees?.fee ?? 0), netOwnerPayout: Number(fees?.net ?? 0),
    },
    units: unitRows.map(u => {
      const m = metrics(byUnit.get(u.id) ?? [], days);
      return {
        unitId: u.id, unitNumber: u.unit_number, propertyName: u.property_name,
        occupancy: m.occupancy, adr: m.adr, revpar: m.revpar, revenue: m.gross,
        rating: u.rating === null ? null : Number(u.rating),
      };
    }),
    channelMix: channels.map(c => ({ channel: c.channel, revenue: c.revenue, share: channelTotal ? Number(((Number(c.revenue) / channelTotal) * 100).toFixed(1)) : 0 })),
  });
};
