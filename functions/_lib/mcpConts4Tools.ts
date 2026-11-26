/**
 * AI Connector round 4 tools for The Conts (owner, 26 Nov 2026): unit_overview, leases_expiring, revenue_summary,
 * housekeeping_today, booking_pace, channel_mix, cancellations_summary, reviews_summary, vacancy_summary,
 * company_report and data_gaps. Called from mcpServer.ts callTool, which applies the rate limit and logs every call in
 * mcp_calls. The pure shaping is in mcpConts4.ts.
 *
 * RBAC: every read is ctx.read, the same readValue as erp_get (path gate, in-process GET AS THE PERSON, credential
 * fields stripped), so a tool sees exactly what that person's ERP screens show, including each endpoint's own money
 * hiding. There are no connector-only rules. A refused read is named plainly ("Your account does not have access to
 * ...") and the rest of the answer still comes back; when nothing at all can be read the call is an error. All reads of
 * one tool run in parallel, at most six (unit_overview: one search first, then three).
 *
 * Imports only pure modules (and types), so the tools themselves are unit-tested with a stand-in ERP
 * (src/lib/mcpConts4.test.mjs), including as a low-privilege account.
 */
import type { Outcome, ReadValue, ToolCtx } from './mcpActionTools';
import { myToday } from './mcpQuick';
import { addDays } from './mcpMore';
import {
  LIVE_STATES, MIX_CHANNELS, PERIODS, companyKey, portfolioPeriods, resolvePeriod, summariseCancellations, summariseChannelMix,
  summariseContsReport, summariseDreamCrafterReport, summariseGaps, summariseHousekeeping, summariseLeases, summarisePace,
  summariseRevenue, summariseReviews, summariseUnit, summariseVacancy, unitHits, type ContsReportInput, type PaceInput, type Period,
} from './mcpConts4';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const done = (body: unknown, target: string, note = ''): Outcome => ({ result: text(JSON.stringify(body)), status: 200, note, target });
const refuse = (msg: string, status: number, target: string, note = ''): Outcome => ({ result: text(msg, true), status, note: note || msg.slice(0, 120), target });

const refused = (r: ReadValue) => !r.ok && (r.status === 401 || r.status === 403);
const why = (what: string, r: ReadValue) => (r.ok ? '' : refused(r) ? `Your account does not have access to ${what}.` : `${what} could not be read: ${r.message}`);
const val = (r: ReadValue) => (r.ok ? r.value : null);

type Part = { what: string; r: ReadValue };
/** An answer made of several reads: what could be read, plus `notIncluded` naming the rest; an error only when
 *  nothing at all could be read. */
function partial(target: string, parts: Part[], body: () => Record<string, unknown>): Outcome {
  const failed = parts.filter(p => !p.r.ok);
  if (failed.length === parts.length) {
    const f = failed[0].r as Extract<ReadValue, { ok: false }>;
    return refuse(failed.map(p => why(p.what, p.r)).join(' '), f.status, target, f.note);
  }
  const out = body();
  if (failed.length) out.notIncluded = failed.map(p => why(p.what, p.r));
  return done(out, target, failed.length ? 'partial' : '');
}

const periodOf = (args: Record<string, unknown>, today: string): Period | string => {
  const p = resolvePeriod(args, today);
  return 'error' in p ? p.error : p;
};

/* ---------- C2 unit_overview ---------- */

async function unitOverview(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const today = myToday();
  const q = String(args.unit ?? args.query ?? '').trim().slice(0, 60);
  let unitId = String(args.unitId ?? '').trim();
  const target = `unit:${(unitId || q).slice(0, 60)}`;
  if (!unitId && !q) return refuse('Give a unit, e.g. "Vortex A-12-03", or its unitId.', 400, target, 'invalid');
  let others: { id: string; label: string }[] = [];
  if (!unitId) {
    const s = await c.read('/api/search', { q, kind: 'unit' });
    if (!s.ok) return refuse(why('Units', s), s.status, target, s.note);
    const hits = unitHits(s.value, q);
    if (!hits.length) return refuse(`No unit matches "${q}" among the units your account can see. Try the building and unit number, e.g. "Vortex A-12-03".`, 404, target, 'not found');
    unitId = hits[0].id;
    others = hits.slice(1);
  }
  const [detail, lettings, unpaid] = await Promise.all([
    c.read('/api/units/detail', { unitId }),
    c.read('/api/lettings', { unitId }),
    // Direct guests still owing anywhere (oldest first); the unit's own are picked out by building and unit number.
    c.read('/api/reservations', { view: 'all', todo: 'unpaid', size: 100 }),
  ]);
  if (!detail.ok) return refuse(why('this unit', detail), detail.status, target, detail.note);
  return partial(target, [{ what: 'the unit record', r: detail }, { what: 'Agent to let (tenants)', r: lettings }, { what: 'Reservations (guests owing)', r: unpaid }],
    () => summariseUnit(c.origin, today, detail.value, val(lettings), val(unpaid), others));
}

/* ---------- C3 leases_expiring ---------- */

async function leasesExpiring(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const today = myToday();
  const days = Math.min(365, Math.max(1, Math.floor(Number(args.days) || 60)));
  const [contracts, lettings] = await Promise.all([c.read('/api/contracts'), c.read('/api/lettings')]);
  return partial(`leases:${days}d`, [{ what: 'Contracts (owner agreements)', r: contracts }, { what: 'Agent to let (tenancies)', r: lettings }],
    () => summariseLeases(today, days, c.origin, val(contracts), val(lettings)));
}

/* ---------- C4 revenue_summary ---------- */

async function revenueSummary(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const today = myToday();
  const p = periodOf(args, today);
  if (typeof p === 'string') return refuse(p, 400, 'revenue', 'invalid');
  const pp = portfolioPeriods(p);
  const target = `revenue:${p.label}`;
  if (!pp) return refuse('revenue_summary covers one month or one quarter (the Portfolio figures): use period month, last_month or quarter (or month / quarter). For a year use company_report {period: "year"}.', 400, target, 'unsupported period');
  const [cur, prev, kpis] = await Promise.all([
    c.read('/api/portfolio/performance', { period: pp.cur }),
    c.read('/api/portfolio/performance', { period: pp.prev }),
    p.month ? c.read('/api/dashboard/kpis', { period: p.month }) : Promise.resolve(null),
  ]);
  if (!cur.ok) return refuse(why('Portfolio (earnings by building)', cur), cur.status, target, cur.note);
  const parts: Part[] = [{ what: 'Portfolio', r: cur }, { what: 'Portfolio (the period before)', r: prev }, ...(kpis ? [{ what: 'the Dashboard', r: kpis }] : [])];
  return partial(target, parts, () => summariseRevenue(p, cur.value, val(prev), kpis ? val(kpis) : null));
}

/* ---------- C5 housekeeping_today ---------- */

async function housekeepingToday(c: ToolCtx): Promise<Outcome> {
  const today = myToday();
  const [todayJobs, overdue, maint, dash] = await Promise.all([
    c.read('/api/tasks', { kind: 'cleaning', state: 'all', from: today, to: today, size: 100 }),
    c.read('/api/tasks', { kind: 'cleaning', state: 'active', to: addDays(today, -1), sort: 'day:asc', size: 50 }),
    c.read('/api/maintenance/issues', { view: 'open', limit: 200 }),
    c.read('/api/dashboard/today'),
  ]);
  return partial('housekeeping', [
    { what: 'Cleaning (today)', r: todayJobs }, { what: 'Cleaning (overdue)', r: overdue }, { what: 'Maintenance', r: maint }, { what: 'the Dashboard', r: dash },
  ], () => summariseHousekeeping(today, c.origin, val(todayJobs), val(overdue), val(maint), val(dash)));
}

/* ---------- C6 booking_pace ---------- */

const PACE_PAGE = 1000;

/** Live reservations with nights in [start, start + 90): one page of 1,000, a second when the first says there are more. */
async function paceRows(c: ToolCtx, start: string): Promise<{ r: ReadValue; rows: Record<string, unknown>[]; truncated: boolean }> {
  const q = (page: number) => ({ view: 'all', st: LIVE_STATES, from: start, to: addDays(start, 89), size: PACE_PAGE, export: 1, page });
  const first = await c.read('/api/reservations', q(1));
  if (!first.ok) return { r: first, rows: [], truncated: false };
  const body = first.value as { total?: unknown; data?: unknown };
  const rows = Array.isArray(body?.data) ? body.data as Record<string, unknown>[] : [];
  const total = Number(body?.total) || rows.length;
  if (total > PACE_PAGE) {
    const second = await c.read('/api/reservations', q(2));
    const more = second.ok && Array.isArray((second.value as { data?: unknown })?.data) ? (second.value as { data: Record<string, unknown>[] }).data : [];
    rows.push(...more);
    return { r: first, rows, truncated: total > rows.length };
  }
  return { r: first, rows, truncated: false };
}

async function bookingPace(c: ToolCtx): Promise<Outcome> {
  const today = myToday();
  const monthAgo = addDays(today, -30);
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`.replace(/-02-29$/, '-02-28');
  const [now, lm, ly] = await Promise.all([paceRows(c, today), paceRows(c, monthAgo), paceRows(c, yearAgo)]);
  if (!now.r.ok) return refuse(why('Reservations', now.r), now.r.status, 'pace', now.r.note);
  const input = (x: typeof now, start: string, label: string): PaceInput | null => (x.r.ok ? { label, start, asOf: start, rows: x.rows, truncated: x.truncated } : null);
  return partial('pace', [{ what: 'Reservations', r: now.r }, { what: 'Reservations a month ago', r: lm.r }, { what: 'Reservations a year ago', r: ly.r }],
    () => summarisePace(today, { label: 'now', start: today, asOf: today, rows: now.rows, truncated: now.truncated }, input(lm, monthAgo, 'a month ago'), input(ly, yearAgo, 'a year ago')));
}

/* ---------- C7 channel_mix ---------- */

async function channelMix(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const today = myToday();
  const p = periodOf(args, today);
  if (typeof p === 'string') return refuse(p, 400, 'channels', 'invalid');
  const target = `channels:${p.label}`;
  const channels = Object.keys(MIX_CHANNELS);
  const reads = await Promise.all([
    ...channels.map(ch => c.read('/api/reservations', { view: 'all', st: LIVE_STATES, ch, from: p.from, to: p.to, size: 25 })),
    c.read('/api/reservations', { view: 'all', st: LIVE_STATES, from: p.previous.from, to: p.previous.to, size: 25 }),
    p.month ? c.read('/api/dashboard/channels', { period: p.month }) : Promise.resolve(null),
  ]);
  const per = channels.map((channel, i) => ({ channel, r: reads[i] as ReadValue }));
  const prev = reads[channels.length] as ReadValue, dash = reads[channels.length + 1];
  if (per.every(x => !x.r.ok)) return refuse(why('Reservations', per[0].r), (per[0].r as Extract<ReadValue, { ok: false }>).status, target);
  const parts: Part[] = [{ what: 'Reservations', r: per.find(x => x.r.ok)!.r }, { what: 'Reservations (the period before)', r: prev }, ...(dash ? [{ what: 'the Dashboard channel split', r: dash }] : [])];
  return partial(target, parts, () => summariseChannelMix(p, per.filter(x => x.r.ok).map(x => ({ channel: x.channel, reply: val(x.r) })), val(prev), dash ? val(dash) : null));
}

/* ---------- C8 cancellations_summary ---------- */

async function cancellations(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const today = myToday();
  const p = periodOf(args, today);
  if (typeof p === 'string') return refuse(p, 400, 'cancellations', 'invalid');
  const [all, cancelled, prevAll, during] = await Promise.all([
    c.read('/api/reservations', { view: 'all', from: p.from, to: p.to, size: 25 }),
    c.read('/api/reservations', { view: 'cancelled', from: p.from, to: p.to, sort: 'gross:desc', size: 25 }),
    c.read('/api/reservations', { view: 'all', from: p.previous.from, to: p.previous.to, size: 25 }),
    c.read('/api/reservations', { view: 'all', cancelledFrom: p.from, cancelledTo: p.to, size: 25 }),
  ]);
  return partial(`cancellations:${p.label}`, [
    { what: 'Reservations', r: all }, { what: 'Cancelled reservations', r: cancelled }, { what: 'Reservations (the period before)', r: prevAll }, { what: 'Cancellations by day cancelled', r: during },
  ], () => summariseCancellations(p, c.origin, val(all), val(cancelled), val(prevAll), val(during)));
}

/* ---------- C9 reviews_summary ---------- */

async function reviewsSummary(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const today = myToday();
  const p = periodOf(args, today);
  if (typeof p === 'string') return refuse(p, 400, 'reviews', 'invalid');
  const [now, prev, waiting] = await Promise.all([
    c.read('/api/reviews', { from: p.from, to: p.to, pageSize: 200 }),
    c.read('/api/reviews', { from: p.previous.from, to: p.previous.to, pageSize: 200 }),
    c.read('/api/reviews', { reply: 'needs_reply', pageSize: 1 }),
  ]);
  if (!now.ok) return refuse(why('Reviews', now), now.status, `reviews:${p.label}`, now.note);
  return partial(`reviews:${p.label}`, [{ what: 'Reviews', r: now }, { what: 'Reviews (the period before)', r: prev }, { what: 'Reviews waiting for a reply', r: waiting }],
    () => summariseReviews(p, c.origin, now.value, val(prev), val(waiting)));
}

/* ---------- C11 vacancy_summary ---------- */

async function vacancySummary(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const today = myToday();
  const days = Math.min(31, Math.max(1, Math.floor(Number(args.days) || 14)));
  const [cal, units] = await Promise.all([c.read('/api/reservations/calendar', { from: today, to: addDays(today, days - 1) }), c.read('/api/units')]);
  if (!cal.ok) return refuse(why('the Calendar', cal), cal.status, `vacancy:${days}d`, cal.note);
  return partial(`vacancy:${days}d`, [{ what: 'the Calendar', r: cal }, { what: 'Units (which are listed)', r: units }],
    () => summariseVacancy(today, days, c.origin, cal.value, val(units)));
}

/* ---------- company_report ---------- */

async function companyReport(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const today = myToday();
  const company = companyKey(args.company);
  if (!company) return refuse('company is "The Conts" (default) or "Dream Crafter".', 400, 'company_report', 'invalid');
  const p = periodOf(args, today);
  if (typeof p === 'string') return refuse(p, 400, 'company_report', 'invalid');
  const target = `company_report:${company}:${p.label}`;
  if (company === 'dream_crafter') {
    const [sales, purchases] = await Promise.all([c.read('/api/sales-invoices'), c.read('/api/purchase-invoices')]);
    return partial(target, [{ what: 'Sales invoices', r: sales }, { what: 'Purchase invoices', r: purchases }],
      () => summariseDreamCrafterReport(p, c.origin, val(sales), val(purchases)));
  }
  if (!['month', 'last_month', 'quarter', 'year'].includes(p.period)) return refuse('company_report takes period month, last_month, quarter or year (or month / quarter / year).', 400, target, 'unsupported period');
  const res = (from: string, to: string) => c.read('/api/reservations', { view: 'all', st: LIVE_STATES, from, to, size: 25 });
  const named: Record<string, Promise<ReadValue>> = {};
  if (p.month) {
    Object.assign(named, {
      kpis: c.read('/api/dashboard/kpis', { period: p.month }), prevKpis: c.read('/api/dashboard/kpis', { period: p.prevMonth }),
      channels: c.read('/api/dashboard/channels', { period: p.month }), perf: c.read('/api/portfolio/performance', { period: p.month }),
      statements: c.read('/api/statements', { period: p.month, pageSize: 1 }), reservations: res(p.from, p.to),
    });
  } else if (p.quarter) {
    Object.assign(named, {
      perf: c.read('/api/portfolio/performance', { period: p.quarter }), prevPerf: c.read('/api/portfolio/performance', { period: p.prevQuarter }),
      statementsAll: c.read('/api/statements', { period: 'all', pageSize: 1 }), reservations: res(p.from, p.to), prevReservations: res(p.previous.from, p.previous.to),
    });
  } else {
    // A year: the Performance page's year to date (this year only), owner statements by month, reservations against last year.
    if (p.year !== today.slice(0, 4)) return refuse(`company_report for a year covers this year to date (${today.slice(0, 4)}). For an earlier year ask for each quarter, e.g. {period: "quarter", quarter: "${p.year}-q1"}.`, 400, target, 'unsupported year');
    const lyTo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`.replace(/-02-29$/, '-02-28');
    Object.assign(named, {
      analytics: c.read('/api/analytics', { range: 'ytd' }), statementsAll: c.read('/api/statements', { period: 'all', pageSize: 1 }),
      reservations: res(p.from, today), prevReservations: res(p.previous.from, lyTo),
    });
  }
  const keys = Object.keys(named);
  const got = await Promise.all(keys.map(k => named[k]));
  const NAMES: Record<string, string> = {
    kpis: 'the Dashboard', prevKpis: 'the Dashboard (the month before)', channels: 'the Dashboard channel split', perf: 'Portfolio', prevPerf: 'Portfolio (the quarter before)',
    statements: 'Owner statements', statementsAll: 'Owner statements', reservations: 'Reservations', prevReservations: 'Reservations (the period before)', analytics: 'Performance (finance and management)',
  };
  const input = Object.fromEntries(keys.map((k, i) => [k, val(got[i])])) as ContsReportInput;
  return partial(target, keys.map((k, i) => ({ what: NAMES[k], r: got[i] })), () => summariseContsReport(p, input));
}

/* ---------- D4 data_gaps ---------- */

async function dataGaps(c: ToolCtx): Promise<Outcome> {
  const today = myToday();
  const [units, owners, reviews, cleaning, lettings] = await Promise.all([
    c.read('/api/units'), c.read('/api/owners'), c.read('/api/reviews', { matched: 'no', pageSize: 1 }),
    c.read('/api/tasks', { kind: 'cleaning', state: 'active', assignee: 'none', from: today, to: addDays(today, 3), sort: 'day:asc', size: 25 }),
    c.read('/api/lettings'),
  ]);
  return partial('data_gaps', [
    { what: 'Units', r: units }, { what: 'Owners', r: owners }, { what: 'Reviews', r: reviews }, { what: 'Cleaning', r: cleaning }, { what: 'Agent to let', r: lettings },
  ], () => summariseGaps(today, c.origin, { units: val(units), owners: val(owners), reviews: val(reviews), cleaning: val(cleaning), lettings: val(lettings) }));
}

/** One of the tools above, or null when `name` is not one of them. */
export async function runConts4Tool(name: string, args: Record<string, unknown>, c: ToolCtx): Promise<Outcome | null> {
  switch (name) {
    case 'unit_overview': return unitOverview(c, args);
    case 'leases_expiring': return leasesExpiring(c, args);
    case 'revenue_summary': return revenueSummary(c, args);
    case 'housekeeping_today': return housekeepingToday(c);
    case 'booking_pace': return bookingPace(c);
    case 'channel_mix': return channelMix(c, args);
    case 'cancellations_summary': return cancellations(c, args);
    case 'reviews_summary': return reviewsSummary(c, args);
    case 'vacancy_summary': return vacancySummary(c, args);
    case 'company_report': return companyReport(c, args);
    case 'data_gaps': return dataGaps(c);
    default: return null;
  }
}

/** Which ERP reads each tool makes, for the docs and the PR's permission table (kept beside the code). */
export const CONTS4_READS: Record<string, string[]> = {
  unit_overview: ['/api/search?kind=unit', '/api/units/detail', '/api/lettings?unitId', '/api/reservations?todo=unpaid'],
  leases_expiring: ['/api/contracts', '/api/lettings'],
  revenue_summary: ['/api/portfolio/performance (period + before)', '/api/dashboard/kpis'],
  housekeeping_today: ['/api/tasks?kind=cleaning (today, overdue)', '/api/maintenance/issues?view=open', '/api/dashboard/today'],
  booking_pace: ['/api/reservations?view=all&st=live (next 90 days: now, a month ago, a year ago)'],
  channel_mix: ['/api/reservations?ch=<channel> (x4)', '/api/reservations (period before)', '/api/dashboard/channels'],
  cancellations_summary: ['/api/reservations?view=all|cancelled (period, period before, cancelledFrom/To)'],
  reviews_summary: ['/api/reviews (period, period before, reply=needs_reply)'],
  vacancy_summary: ['/api/reservations/calendar', '/api/units'],
  company_report: ['/api/dashboard/kpis', '/api/dashboard/channels', '/api/portfolio/performance', '/api/statements', '/api/reservations', '/api/analytics?range=ytd', '/api/sales-invoices', '/api/purchase-invoices'],
  data_gaps: ['/api/units', '/api/owners', '/api/reviews?matched=no', '/api/tasks?assignee=none', '/api/lettings'],
};

const RO = { readOnlyHint: true, openWorldHint: false };
const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
/** The `period` convention (mcpConts4.ts resolvePeriod). */
export const PERIOD_PROPS = {
  period: { type: 'string', enum: [...PERIODS], description: 'today | week (Mon-Sun) | month | last_month | quarter | year | custom (from + to). Compared with the period before. Default: this month.' },
  month: { type: 'string', description: 'YYYY-MM: that month.' },
  quarter: { type: 'string', description: 'YYYY-qN, e.g. 2026-q3: that quarter.' },
  year: { type: 'string', description: 'YYYY.' },
  from: { type: 'string', description: 'YYYY-MM-DD, with period custom.' },
  to: { type: 'string', description: 'YYYY-MM-DD, with period custom.' },
};
const PERIOD_ARGS = { type: 'object', properties: PERIOD_PROPS, additionalProperties: false };

export const CONTS4_TOOLS = [
  {
    name: 'unit_overview', title: 'Unit overview (quick answer)',
    description: 'One unit in ONE call: the guest in it now, the next reservation and the next few, the tenant when it is let out (Agent to let), direct guests still owing on it, the owner and terms, this month\'s occupancy and rating (income only for finance), open repairs, and the link. Give the building and unit number.',
    inputSchema: { type: 'object', properties: { unit: { type: 'string', description: 'Building and unit, e.g. "Vortex A-12-03", or part of it.' }, unitId: { type: 'string', description: 'A unit id from search, instead of unit.' } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'leases_expiring', title: 'Contracts and tenancies ending (quick answer)',
    description: 'Owner agreements (Contracts) ending or up for renewal and Agent-to-let tenancies ending in the next N days (default 60), soonest first, plus those that ended in the last 30 days.',
    inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead, 1-365. Default 60.' } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'revenue_summary', title: 'Earnings, average nightly price and earnings per available night by building (quick answer)',
    description: 'A month or quarter: earnings, nights, occupancy, average nightly price and earnings per available night in total and by building, against the period before (Portfolio figures; money for management and finance only). period: month (default), last_month or quarter.',
    inputSchema: PERIOD_ARGS, annotations: RO,
  },
  {
    name: 'housekeeping_today', title: 'Cleaning and maintenance today (quick answer)',
    description: "Today's cleaning jobs by status and those with no cleaner, cleaning left over from earlier days, maintenance jobs due today or overdue, in ONE call.",
    inputSchema: NO_ARGS, annotations: RO,
  },
  {
    name: 'booking_pace', title: 'Reservation pace (quick answer)',
    description: 'On the books for the next 30 / 60 / 90 days (reservations, nights, guest total) against the same time last month and last year (what was reserved by then, and what those dates ended up with), plus reservations made in the last 7 / 30 days.',
    inputSchema: NO_ARGS, annotations: RO,
  },
  {
    name: 'channel_mix', title: 'Channel mix (quick answer)',
    description: 'Airbnb / Booking.com / Agoda / Direct for a period: reservations and share, nights, guest total, average nightly price and average length of stay, against the period before.',
    inputSchema: PERIOD_ARGS, annotations: RO,
  },
  {
    name: 'cancellations_summary', title: 'Cancellations and no-shows (quick answer)',
    description: 'For a period: cancellation and no-show rates against the period before, cancelled stays by channel with the guest total lost and the biggest, and how many were cancelled during the period.',
    inputSchema: PERIOD_ARGS, annotations: RO,
  },
  {
    name: 'reviews_summary', title: 'Guest reviews and ratings (quick answer)',
    description: 'Reviews dated in a period: count, average rating, by channel, star split, bad reviews with what the guest said, not yet replied, against the period before, and how many wait for a reply overall.',
    inputSchema: PERIOD_ARGS, annotations: RO,
  },
  {
    name: 'vacancy_summary', title: 'Empty units tonight and vacancy (quick answer)',
    description: 'Listed units empty tonight (with readiness and next check-in) and empty nights over the next N days (default 14), by building.',
    inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'Days ahead from today, 1-31. Default 14.' } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'company_report', title: 'Company management report',
    description: 'The management report for a company and period, against the period before: The Conts (default) = headline KPIs, earnings / occupancy / average nightly price / earnings per available night by building, income by channel, owner statements and payouts, reservations; Dream Crafter = sales and purchase invoices. period: month (default), last_month, quarter or year (this year to date). Money parts only where the ERP shows them to your account.',
    inputSchema: { type: 'object', properties: { ...PERIOD_PROPS, company: { type: 'string', description: '"The Conts" (default) or "Dream Crafter".' } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'data_gaps', title: 'Data gaps (what is missing)',
    description: 'Records missing something: units with no owner (under "Owner to be confirmed"), owners with units but no bank details or no contract, reviews not matched to a reservation, cleaning jobs in the next 3 days with no cleaner, let-out units with no end date. Counts, examples and where to fix.',
    inputSchema: NO_ARGS, annotations: RO,
  },
];
