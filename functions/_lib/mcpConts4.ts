/**
 * AI Connector round 4 for The Conts (owner, 26 Nov 2026: "complete each system"), the pure parts: the `period`
 * convention every period tool takes, and the shaping of unit_overview, leases_expiring, revenue_summary,
 * housekeeping_today, booking_pace, channel_mix, cancellations_summary, reviews_summary, vacancy_summary, the owner part
 * of owner_statement_summary, company_report and data_gaps. The tools are in mcpConts4Tools.ts; every read there goes
 * through the same readValue as erp_get (as the person, credential fields stripped), so these functions only ever see
 * what the person's own ERP screens would show. A money field an endpoint leaves out for the person's role stays out:
 * nothing here works money back from other figures. Money arrives in sen and leaves as RM (2 dp).
 *
 * Pure, so it is unit-tested (src/lib/mcpConts4.test.mjs).
 */
import { rm, pctChange, prevMonth, monthEnd, validRange, kpiFigures } from './mcpQuick';
import { addDays, daysBetween, rowsOf } from './mcpMore';

type Obj = Record<string, unknown>;
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const ymd = (v: unknown) => str(v).slice(0, 10);
const has = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== null && o[k] !== undefined;
const cut = (v: unknown, n: number) => { const s = str(v).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const enc = encodeURIComponent;

/* ---------- the period convention ---------- */

export const PERIODS = ['today', 'week', 'month', 'last_month', 'quarter', 'year', 'custom'] as const;
export type PeriodName = typeof PERIODS[number];

export interface Period {
  period: PeriodName; label: string; from: string; to: string; days: number; inProgress: boolean;
  previous: { label: string; from: string; to: string };
  /** Set when the period is one calendar month / quarter / year (the endpoints that take those). */
  month?: string; quarter?: string; year?: string;
  prevMonth?: string; prevQuarter?: string; prevYear?: string;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^(\d{4})-?q([1-4])$/i;

const quarterOf = (day: string) => ({ y: Number(day.slice(0, 4)), q: Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1 });
const quarterRange = (y: number, q: number) => ({ from: `${y}-${String(q * 3 - 2).padStart(2, '0')}-01`, to: monthEnd(`${y}-${String(q * 3).padStart(2, '0')}`) });
const prevQ = (y: number, q: number) => (q === 1 ? { y: y - 1, q: 4 } : { y, q: q - 1 });

function build(p: Omit<Period, 'days' | 'inProgress'>, today: string): Period {
  return { ...p, days: daysBetween(p.from, p.to) + 1, inProgress: p.from <= today && today <= p.to };
}

function monthPeriod(ym: string, today: string, name: PeriodName): Period {
  const pm = prevMonth(ym);
  return build({ period: name, label: ym, from: `${ym}-01`, to: monthEnd(ym), month: ym, prevMonth: pm, previous: { label: pm, from: `${pm}-01`, to: monthEnd(pm) } }, today);
}
function quarterPeriod(y: number, q: number, today: string): Period {
  const r = quarterRange(y, q), pq = prevQ(y, q), pr = quarterRange(pq.y, pq.q);
  return build({ period: 'quarter', label: `${y}-q${q}`, ...r, quarter: `${y}-q${q}`, prevQuarter: `${pq.y}-q${pq.q}`, previous: { label: `${pq.y}-q${pq.q}`, ...pr } }, today);
}
function yearPeriod(y: number, today: string): Period {
  return build({ period: 'year', label: String(y), from: `${y}-01-01`, to: `${y}-12-31`, year: String(y), prevYear: String(y - 1), previous: { label: String(y - 1), from: `${y - 1}-01-01`, to: `${y - 1}-12-31` } }, today);
}

/**
 * Every period tool's `period` (today | week | month | last_month | quarter | year | custom), with the previous period
 * of the same length to compare with. `month` (YYYY-MM), `quarter` (YYYY-qN), `year` (YYYY) pick a named one; `from` +
 * `to` make it custom. Default: `fallback` (this month unless said). An error message for anything unusable.
 */
export function resolvePeriod(a: Record<string, unknown>, today: string, fallback: PeriodName = 'month'): Period | { error: string } {
  const raw = str(a.period).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const month = str(a.month).trim(), quarter = str(a.quarter).trim(), year = str(a.year).trim();
  const hasRange = !!(str(a.from) || str(a.to));
  const name: string = raw || (hasRange ? 'custom' : MONTH_RE.test(month) ? 'month' : QUARTER_RE.test(quarter) ? 'quarter' : /^\d{4}$/.test(year) ? 'year' : fallback);
  if (!(PERIODS as readonly string[]).includes(name)) return { error: `period must be one of: ${PERIODS.join(', ')}.` };
  const p = name as PeriodName;
  if (p === 'today') {
    const y = addDays(today, -1);
    return build({ period: p, label: today, from: today, to: today, previous: { label: y, from: y, to: y } }, today);
  }
  if (p === 'week') {
    // Monday to Sunday, Malaysia time.
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const from = addDays(today, -((dow + 6) % 7));
    return build({ period: p, label: `week of ${from}`, from, to: addDays(from, 6), previous: { label: `week of ${addDays(from, -7)}`, from: addDays(from, -7), to: addDays(from, -1) } }, today);
  }
  if (p === 'month') return monthPeriod(MONTH_RE.test(month) ? month : today.slice(0, 7), today, p);
  if (p === 'last_month') return monthPeriod(prevMonth(today.slice(0, 7)), today, p);
  if (p === 'quarter') {
    const m = QUARTER_RE.exec(quarter);
    const { y, q } = m ? { y: Number(m[1]), q: Number(m[2]) } : quarterOf(today);
    return quarterPeriod(y, q, today);
  }
  if (p === 'year') return yearPeriod(/^\d{4}$/.test(year) ? Number(year) : Number(today.slice(0, 4)), today);
  const r = validRange(a.from, a.to);
  if (!r) return { error: 'For a custom period give from and to as YYYY-MM-DD (from on or before to, at most 400 days).' };
  const n = daysBetween(r.from, r.to) + 1;
  const pf = addDays(r.from, -n), pt = addDays(r.from, -1);
  return build({ period: 'custom', label: `${r.from} to ${r.to}`, from: r.from, to: r.to, previous: { label: `${pf} to ${pt}`, from: pf, to: pt } }, today);
}

/** The month or quarter a Portfolio read takes for a period (it knows only those two), or null. */
export function portfolioPeriods(p: Period): { cur: string; prev: string } | null {
  if (p.month && p.prevMonth) return { cur: p.month, prev: p.prevMonth };
  if (p.quarter && p.prevQuarter) return { cur: p.quarter, prev: p.prevQuarter };
  return null;
}

const periodOut = (p: Period) => ({ period: p.period, label: p.label, from: p.from, to: p.to, ...(p.inProgress ? { inProgress: true } : {}), comparedWith: p.previous });

/* ---------- unit_overview: /api/search?kind=unit + /api/units/detail + /api/lettings?unitId + /api/reservations?todo=unpaid ---------- */

/** The unit hits of /api/search (kind=unit): the best match for `q` first (exact label, then the label ending with it). */
export function unitHits(search: unknown, q: string): { id: string; label: string }[] {
  const hits = arr(search).filter(h => h.kind === 'unit' && h.id).map(h => ({ id: str(h.id), label: str(h.label) }));
  const want = q.trim().toLowerCase();
  const score = (l: string) => { const x = l.toLowerCase(); return x === want ? 0 : x.endsWith(` ${want}`) ? 1 : x.includes(want) ? 2 : 3; };
  return hits.sort((a, b) => score(a.label) - score(b.label));
}

const BLOCK_CHANNELS = ['maintenance_block', 'owner_stay'];

export function summariseUnit(origin: string, today: string, detail: unknown, lettings: unknown, unpaid: unknown, others: { id: string; label: string }[] = []) {
  const d = obj(detail), u = obj(d.unit), perf = obj(d.performance), owner = obj(u.owner);
  const stays = arr(d.stays);
  const label = `${str(u.propertyName)} ${str(u.unitNumber)}`.trim();
  const stay = (s: Obj) => ({
    guest: str(s.guestName) || (BLOCK_CHANNELS.includes(str(s.channel)) ? (str(s.channel) === 'owner_stay' ? 'Owner stay' : 'Blocked') : 'Guest'),
    channel: str(s.channel), status: str(s.state), checkIn: ymd(s.checkIn), checkOut: ymd(s.checkOut), ref: str(s.externalRef),
    ...(has(s, 'grossBookingValue') ? { guestTotalRm: rm(s.grossBookingValue) } : {}),
    ...(s.id ? { link: `${origin}/reservations/bookings?view=all&open=${enc(str(s.id))}` } : {}),
  });
  const current = stays.find(s => ymd(s.checkIn) <= today && ymd(s.checkOut) > today);
  const next = stays.find(s => ymd(s.checkIn) > today);
  const tenancy = rowsOf(lettings).filter(l => l.status === 'rented').sort((a, b) => ymd(b.startsOn).localeCompare(ymd(a.startsOn)))[0];
  const mine = rowsOf(unpaid).filter(r => str(r.propertyId) === str(u.propertyId) && str(r.unitNumber) === str(u.unitNumber) && num(r.outstanding) > 0);
  const money = has(perf, 'revenue') || has(perf, 'gross');
  return {
    unit: label, unitId: str(u.id), readiness: str(u.readiness), listed: !!u.isListed, purpose: str(u.purpose) || 'rental',
    owner: str(owner.name) || null,
    terms: str(u.termsLabel) || str(u.revenueModelLabel) || null,
    ...(u.contract ? { contract: { startsOn: ymd(obj(u.contract).startsOn) || null, renewsOn: ymd(obj(u.contract).renewsOn) || null } } : {}),
    guestNow: current ? stay(current) : null,
    nextReservation: next ? stay(next) : null,
    upcoming: stays.filter(s => ymd(s.checkIn) > today).slice(0, 5).map(stay),
    tenant: tenancy ? {
      name: str(tenancy.tenantName) || null, from: ymd(tenancy.startsOn) || null, to: ymd(tenancy.endsOn) || null,
      ...(tenancy.daysLeft !== null && tenancy.daysLeft !== undefined ? { daysLeft: num(tenancy.daysLeft) } : {}),
      ...(has(tenancy, 'monthlyRent') ? { monthlyRentRm: rm(tenancy.monthlyRent) } : {}),
    } : null,
    ...(unpaid ? { arrears: { directGuestsOwing: mine.length, owedRm: rm(mine.reduce((s, r) => s + num(r.outstanding), 0)), oldest: mine.slice(0, 3).map(r => ({ ref: str(r.externalRef), guest: str(r.guestName), checkIn: ymd(r.checkIn), owedRm: rm(r.outstanding) })) } } : {}),
    thisMonth: {
      month: str(perf.period), occupancyPct: num(perf.occupancy), nights: num(perf.occupiedNights),
      rating: perf.rating === null || perf.rating === undefined ? null : num(perf.rating), reviews: num(perf.reviewCount),
      ...(money ? { incomeRm: rm(perf.revenue), guestTotalRm: rm(perf.gross), adrRm: rm(perf.adr), revparRm: rm(perf.revpar) } : {}),
    },
    openMaintenanceJobs: num(d.openMaintenanceCount),
    link: `${origin}/properties/units/${enc(str(u.id))}`,
    ...(others.length ? { otherMatches: others.slice(0, 5).map(o => o.label) } : {}),
    note: `Money in RM.${money ? '' : ' Money figures are not shown for this account.'} Tenant = the Agent-to-let record when the unit is let out.`,
  };
}

/* ---------- leases_expiring: /api/contracts + /api/lettings ---------- */

export function summariseLeases(today: string, days: number, origin: string, contracts: unknown, lettings: unknown) {
  const until = addDays(today, days);
  const out: Obj = {
    date: today, days,
    note: `Owner agreements (Contracts) and tenancies (Agent to let) ending or up for renewal between today and ${until}, soonest first, plus those that ended in the last 30 days. An agreement with no end date counts by its renewal date.`,
  };
  if (contracts) {
    const rows = rowsOf(contracts).map(r => ({ r, end: ymd(r.endsOn) || ymd(r.renewsOn), kind: ymd(r.endsOn) ? 'ends' : 'renews' })).filter(x => x.end);
    const line = (x: { r: Obj; end: string; kind: string }) => ({
      owner: str(x.r.ownerName), units: cut(x.r.unitsLabel, 120), terms: str(x.r.termsLabel) || str(x.r.revenueModel), [x.kind === 'ends' ? 'endsOn' : 'renewsOn']: x.end,
      daysLeft: daysBetween(today, x.end), link: `${origin}/owners/contracts`,
    });
    const soon = rows.filter(x => x.end >= today && x.end <= until).sort((a, b) => a.end.localeCompare(b.end));
    const lapsed = rows.filter(x => x.end < today && x.end >= addDays(today, -30)).sort((a, b) => b.end.localeCompare(a.end));
    out.ownerAgreements = { endingOrRenewing: soon.length, list: soon.slice(0, 20).map(line), endedLast30Days: { count: lapsed.length, list: lapsed.slice(0, 10).map(line) } };
  }
  if (lettings) {
    const rented = rowsOf(lettings).filter(l => l.status === 'rented' && ymd(l.endsOn));
    const line = (l: Obj) => ({
      unit: str(l.unitLabel), tenant: str(l.tenantName) || null, owner: str(l.ownerName), endsOn: ymd(l.endsOn), daysLeft: daysBetween(today, ymd(l.endsOn)),
      ...(has(l, 'monthlyRent') ? { monthlyRentRm: rm(l.monthlyRent) } : {}), link: `${origin}/properties/agent-to-let`,
    });
    const soon = rented.filter(l => ymd(l.endsOn) >= today && ymd(l.endsOn) <= until).sort((a, b) => ymd(a.endsOn).localeCompare(ymd(b.endsOn)));
    const lapsed = rented.filter(l => ymd(l.endsOn) < today && ymd(l.endsOn) >= addDays(today, -30));
    out.tenancies = { ending: soon.length, list: soon.slice(0, 20).map(line), endedLast30DaysStillMarkedRented: { count: lapsed.length, list: lapsed.slice(0, 10).map(line) } };
  }
  return out;
}

/* ---------- revenue_summary: /api/portfolio/performance (period and the one before) + /api/dashboard/kpis ---------- */

type Agg = { units: number; nights: number; revenue: number; unitDays: number };
const aggOut = (a: Agg, money: boolean) => ({
  units: a.units, nights: a.nights, occupancyPct: pct(a.nights, a.unitDays),
  ...(money ? { revenueRm: rm(a.revenue), adrRm: a.nights ? rm(a.revenue / a.nights) : 0, revparRm: a.unitDays ? rm(a.revenue / a.unitDays) : 0 } : {}),
});

function perfAgg(perf: unknown): { total: Agg; byBuilding: Map<string, Agg>; days: number; money: boolean } {
  const p = obj(perf), rows = arr(p.rows), days = num(p.days);
  const total: Agg = { units: 0, nights: 0, revenue: 0, unitDays: 0 };
  const byBuilding = new Map<string, Agg>();
  for (const r of rows) {
    const k = str(r.propertyName) || 'Unknown';
    const b = byBuilding.get(k) ?? { units: 0, nights: 0, revenue: 0, unitDays: 0 };
    for (const a of [total, b]) { a.units++; a.nights += num(r.nights); a.revenue += num(r.revenue); a.unitDays += days; }
    byBuilding.set(k, b);
  }
  return { total, byBuilding, days, money: rows.some(r => num(r.revenue) !== 0) };
}

export function summariseRevenue(p: Period, cur: unknown, prev: unknown, kpis: unknown) {
  const now = perfAgg(cur);
  const before = prev ? perfAgg(prev) : null;
  const money = now.money || !!before?.money;
  const t = aggOut(now.total, money);
  const b = before ? aggOut(before.total, money) : null;
  const change: Obj = {};
  if (b) {
    change.occupancyPoints = Math.round((t.occupancyPct - b.occupancyPct) * 10) / 10;
    change.nightsPct = pctChange(t.nights, b.nights);
    if (money) for (const k of ['revenueRm', 'adrRm', 'revparRm'] as const) change[k.replace(/Rm$/, 'Pct')] = pctChange(num((t as Obj)[k]), num((b as Obj)[k]));
  }
  const dash = kpis ? kpiFigures(kpis) : null;
  return {
    ...periodOut(p),
    note: `Earnings = guest total split by night into the period (the Portfolio and Dashboard definition), listed rental units only. Average nightly price (adrRm) = earnings / nights sold; earnings per available night (revparRm) = earnings / (units x days). ${p.inProgress ? `The period is in progress: counted up to today. ` : ''}${money ? 'Money in RM.' : 'Money figures are not shown for this account (the ERP shows earnings to management and finance only).'}`,
    days: now.days,
    total: t,
    previous: b,
    change: b ? change : null,
    byBuilding: [...now.byBuilding.entries()].map(([building, a]) => ({ building, ...aggOut(a, money) }))
      .sort((x, y) => (money ? num((y as Obj).revenueRm) - num((x as Obj).revenueRm) : y.occupancyPct - x.occupancyPct)).slice(0, 20),
    ...(dash && Object.keys(dash).length ? { dashboard: dash } : {}),
  };
}

/* ---------- housekeeping_today: /api/tasks (cleaning today, cleaning overdue) + /api/maintenance/issues + /api/dashboard/today ---------- */

export function summariseHousekeeping(today: string, origin: string, todayTasks: unknown, overdueTasks: unknown, maintenance: unknown, dashToday: unknown) {
  const out: Obj = { date: today, note: 'Cleaning jobs for today and those left over from earlier days, and maintenance jobs due today or overdue. Only what your account can see.' };
  const job = (r: Obj) => ({
    unit: `${str(r.propertyName)} ${str(r.unitNumber)}`.trim(), kind: str(r.kind).replace(/_/g, ' '), status: str(r.state), day: ymd(r.date),
    cleaner: str(r.assigneeName) || str(r.sheetCleaner) || null, ...(str(r.dueAt) ? { dueBy: str(r.dueAt) } : {}),
  });
  if (todayTasks) {
    const t = obj(todayTasks), rows = rowsOf(t);
    const counts = obj(t.counts);
    out.cleaningToday = {
      jobs: Object.values(counts).reduce((s: number, n) => s + num(n), 0) || rows.length,
      byStatus: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, num(v)])),
      notDone: Object.entries(counts).filter(([k]) => k !== 'resolved').reduce((s: number, [, n]) => s + num(n), 0),
      withoutCleaner: rows.filter(r => !r.assigneeName && !r.sheetCleaner && r.state !== 'resolved').length,
      list: rows.filter(r => r.state !== 'resolved').slice(0, 15).map(job),
      link: `${origin}/operations/cleaning`,
    };
  }
  if (overdueTasks) {
    const t = obj(overdueTasks), rows = rowsOf(t);
    out.cleaningOverdue = { jobs: num(t.total) || rows.length, oldest: rows.slice(0, 10).map(r => ({ ...job(r), daysLate: Math.max(0, daysBetween(ymd(r.date), today)) })), link: `${origin}/operations/cleaning` };
  }
  if (maintenance) {
    const open = rowsOf(maintenance).filter(r => r.state !== 'resolved');
    const due = open.filter(r => ymd(r.dueOn) && ymd(r.dueOn) <= today).sort((a, b) => ymd(a.dueOn).localeCompare(ymd(b.dueOn)));
    out.maintenance = {
      open: open.length,
      dueToday: due.filter(r => ymd(r.dueOn) === today).length,
      overdue: due.filter(r => ymd(r.dueOn) < today).length,
      noDueDate: open.filter(r => !ymd(r.dueOn)).length,
      list: due.slice(0, 10).map(r => ({
        title: cut(r.title, 100), unit: `${str(r.propertyName)} ${str(r.unitNumber)}`.trim(), status: str(r.state), dueOn: ymd(r.dueOn),
        assignee: str(r.assigneeName) || null, link: `${origin}/operations/maintenance?id=${enc(str(r.id))}`,
      })),
    };
  }
  if (dashToday) {
    const c: Record<string, number> = {};
    for (const r of arr(obj(dashToday).rows)) c[str(r.key)] = num(r.count);
    out.dashboard = { checkIns: c.check_ins ?? 0, checkOuts: c.check_outs ?? 0, cleaningPending: c.cleaning_pending ?? 0, maintenanceOpen: c.maintenance_open ?? 0 };
  }
  return out;
}

/* ---------- booking_pace: /api/reservations (stays in the next 90 days, now / a month ago / a year ago) ---------- */

export const PACE_WINDOWS = [30, 60, 90] as const;
/** The live states the pace counts (no inquiries, cancellations or no-shows). */
export const LIVE_STATES = 'pending,confirmed,checked_in,checked_out';

type Fig = { bookings: number; nights: number; guestTotalRm: number };

/** Bookings, nights inside [start, start + days) and the guest total pro-rated to those nights, for the rows given. */
export function windowFigures(rows: Obj[], start: string, days: number): Fig {
  const end = addDays(start, days);
  let bookings = 0, nights = 0, gross = 0;
  for (const r of rows) {
    const a = ymd(r.checkIn), b = ymd(r.checkOut);
    if (!a || !b) continue;
    const lo = a > start ? a : start, hi = b < end ? b : end;
    const n = daysBetween(lo, hi);
    if (n <= 0) continue;
    const all = Math.max(1, daysBetween(a, b));
    bookings++; nights += n; gross += num(r.grossBookingValue) * (n / all);
  }
  return { bookings, nights, guestTotalRm: rm(gross) };
}

export interface PaceInput { label: string; start: string; asOf: string; rows: Obj[]; truncated: boolean }

export function summarisePace(today: string, now: PaceInput, lastMonth: PaceInput | null, lastYear: PaceInput | null) {
  const money = now.rows.some(r => has(r, 'grossBookingValue'));
  const drop = (f: Fig) => (money ? f : { bookings: f.bookings, nights: f.nights });
  const created = (r: Obj, asOf: string) => { const c = ymd(r.createdAt); return !!c && c <= asOf; };
  const compare = (x: PaceInput | null, days: number) => (x ? {
    from: x.start, to: addDays(x.start, days - 1),
    onTheBooksThen: drop(windowFigures(x.rows.filter(r => created(r, x.asOf)), x.start, days)),
    finalResult: drop(windowFigures(x.rows, x.start, days)),
  } : null);
  return {
    date: today,
    note: 'On the books = live reservations (not cancelled, no-show or inquiry) with nights in the window, blocks and owner stays left out. Nights are counted inside the window only; the guest total is shared out by night. "onTheBooksThen" = what had been reserved by the same day a month / a year earlier, by the day the reservation was made; "finalResult" = what those dates ended up with. Reservations cancelled since are in neither (the ERP keeps no cancellation history on the list). Imported reservations carry their import date, not the day the guest booked, so older comparisons can read low. Money in RM.',
    windows: PACE_WINDOWS.map(days => {
      const cur = windowFigures(now.rows, now.start, days);
      const lm = compare(lastMonth, days), ly = compare(lastYear, days);
      const vs = (c: { onTheBooksThen: Partial<Fig> } | null) => (c ? { nightsPct: pctChange(cur.nights, num(c.onTheBooksThen.nights)), bookingsPct: pctChange(cur.bookings, num(c.onTheBooksThen.bookings)) } : null);
      return {
        nextDays: days, from: now.start, to: addDays(now.start, days - 1), onTheBooksNow: drop(cur),
        sameTimeLastMonth: lm, sameTimeLastYear: ly, changeVsLastMonth: vs(lm), changeVsLastYear: vs(ly),
      };
    }),
    pickup: {
      bookedLast7Days: now.rows.filter(r => ymd(r.createdAt) >= addDays(today, -7)).length,
      bookedLast30Days: now.rows.filter(r => ymd(r.createdAt) >= addDays(today, -30)).length,
      note: 'Reservations made in the last 7 / 30 days for stays in the next 90 days.',
    },
    ...([now, lastMonth, lastYear].some(x => x?.truncated) ? { incomplete: 'More reservations matched than one answer reads (2,000 per window); the counts are a lower bound.' } : {}),
  };
}

/* ---------- channel_mix: /api/reservations per channel + the period before + /api/dashboard/channels ---------- */

export const MIX_CHANNELS: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct' };

export function summariseChannelMix(p: Period, per: { channel: string; reply: unknown }[], prev: unknown, dashChannels: unknown) {
  const rows = per.map(({ channel, reply }) => {
    const t = obj(obj(reply).totals);
    return { channel, bookings: num(t.bookings), nights: num(t.nights), gross: num(t.gross), money: has(t, 'gross') };
  });
  const money = rows.some(r => r.money);
  const allBookings = rows.reduce((s, r) => s + r.bookings, 0), allGross = rows.reduce((s, r) => s + r.gross, 0);
  const before = new Map(arr(obj(obj(prev).facets).ch).map(f => [str(f.value), num(f.count)]));
  return {
    ...periodOut(p),
    note: 'Live reservations (not cancelled, no-show or inquiry) whose stay touches the period, by channel, as the Reservations list counts them: nights and guest total are whole stays. Average nightly price (adrRm) = guest total / nights; length of stay = nights / reservations. Money in RM.',
    channels: rows.map(r => ({
      channel: MIX_CHANNELS[r.channel] ?? r.channel, bookings: r.bookings, bookingsSharePct: pct(r.bookings, allBookings), nights: r.nights,
      avgLengthOfStayNights: r.bookings ? Math.round((r.nights / r.bookings) * 10) / 10 : 0,
      ...(money ? { guestTotalRm: rm(r.gross), guestTotalSharePct: pct(r.gross, allGross), adrRm: r.nights ? rm(r.gross / r.nights) : 0 } : {}),
      ...(prev ? { previousBookings: before.get(r.channel) ?? 0, bookingsChangePct: pctChange(r.bookings, before.get(r.channel) ?? 0) } : {}),
    })),
    ...(dashChannels ? { dashboardIncomeByChannel: arr(obj(dashChannels).channels).map(c => ({ channel: str(c.label ?? c.key), sharePct: num(c.share), incomeRm: rm(c.revenue) })) } : {}),
  };
}

/* ---------- cancellations_summary: /api/reservations view=all (by status) + view=cancelled + cancelled during ---------- */

export function summariseCancellations(p: Period, origin: string, all: unknown, cancelled: unknown, prevAll: unknown, during: unknown) {
  const st = (reply: unknown) => new Map(arr(obj(obj(reply).facets).st).map(f => [str(f.value), num(f.count)]));
  const rate = (m: Map<string, number>) => {
    const total = [...m.entries()].filter(([k]) => k !== 'inquiry').reduce((s, [, n]) => s + n, 0);
    const c = m.get('cancelled') ?? 0, ns = m.get('no_show') ?? 0;
    return { reservations: total, cancelled: c, noShows: ns, cancellationRatePct: pct(c, total), noShowRatePct: pct(ns, total) };
  };
  const now = all ? rate(st(all)) : null;
  const before = prevAll ? rate(st(prevAll)) : null;
  const out: Obj = {
    ...periodOut(p),
    note: 'Reservations whose stay touches the period (blocks and owner stays left out); rate = cancelled (or no-show) / all except inquiries. "Cancelled during the period" counts by the day it was cancelled (by stay dates when that day is not known). Money in RM.',
    ...(now ? { rates: now } : {}),
    ...(before && now ? { previous: before, change: { cancellationRatePoints: Math.round((now.cancellationRatePct - before.cancellationRatePct) * 10) / 10, noShowRatePoints: Math.round((now.noShowRatePct - before.noShowRatePct) * 10) / 10 } } : {}),
  };
  if (cancelled) {
    const c = obj(cancelled), t = obj(c.totals), rows = rowsOf(c);
    const money = has(t, 'gross');
    out.cancelledStays = {
      count: num(t.bookings) || rows.length,
      ...(money ? { lostGuestTotalRm: rm(t.gross) } : {}),
      byChannel: arr(obj(c.facets).ch).map(f => ({ channel: MIX_CHANNELS[str(f.value)] ?? str(f.value), count: num(f.count) })),
      biggest: [...rows].sort((a, b) => num(b.grossBookingValue) - num(a.grossBookingValue)).slice(0, 5).map(r => ({
        ref: str(r.externalRef), guest: str(r.guestName), unit: `${str(r.propertyName)} ${str(r.unitNumber)}`.trim(), channel: MIX_CHANNELS[str(r.channel)] ?? str(r.channel),
        status: str(r.state), checkIn: ymd(r.checkIn), nights: num(r.nights), ...(has(r, 'grossBookingValue') && money ? { guestTotalRm: rm(r.grossBookingValue) } : {}),
        link: `${origin}/reservations/bookings?view=all&open=${enc(str(r.id))}`,
      })),
    };
  }
  if (during) out.cancelledDuringThePeriod = num(obj(obj(during).totals).bookings) || num(obj(during).total);
  return out;
}

/* ---------- reviews_summary: /api/reviews in the period, the period before, and those needing a reply ---------- */

export function summariseReviews(p: Period, origin: string, inPeriod: unknown, prev: unknown, needsReply: unknown) {
  const r = obj(inPeriod), rows = rowsOf(r), total = num(r.total) || rows.length, badMax = num(r.badMax) || 3;
  const avg = (xs: Obj[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + num(x.rating), 0) / xs.length) * 100) / 100 : null);
  const byChannel = new Map<string, Obj[]>();
  for (const x of rows) { const k = str(x.channel); byChannel.set(k, [...(byChannel.get(k) ?? []), x]); }
  const stars: Record<string, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const x of rows) { const s = Math.min(5, Math.max(1, Math.round(num(x.rating)))); stars[s] = (stars[s] ?? 0) + 1; }
  const prevRows = prev ? rowsOf(prev) : [];
  const bad = rows.filter(x => num(x.rating) <= badMax);
  return {
    ...periodOut(p),
    note: `Guest reviews dated in the period, all channels, ratings out of 5 (Booking.com's 10-point score halved). Bad = ${badMax} stars or fewer.${rows.length < total ? ` Averages are over the newest ${rows.length} of ${total}.` : ''}`,
    reviews: total,
    averageRating: avg(rows),
    byChannel: [...byChannel.entries()].map(([channel, xs]) => ({ channel: MIX_CHANNELS[channel] ?? channel, reviews: xs.length, averageRating: avg(xs) })),
    stars,
    notRepliedInPeriod: rows.filter(x => !x.reply).length,
    ...(prev ? { previous: { reviews: num(obj(prev).total) || prevRows.length, averageRating: avg(prevRows) } } : {}),
    badReviews: { count: bad.length, list: bad.slice(0, 5).map(x => ({
      date: ymd(x.reviewedAt), rating: num(x.rating), channel: MIX_CHANNELS[str(x.channel)] ?? str(x.channel), unit: `${str(x.propertyName)} ${str(x.unitNumber)}`.trim(),
      guest: str(x.guestName), comment: cut(x.comment, 200), replied: !!x.reply,
    })) },
    allTime: { averageRating: r.average === null || r.average === undefined ? null : num(r.average), ...(obj(r.summary).total !== undefined ? { reviews: num(obj(r.summary).total) } : {}) },
    ...(needsReply ? { waitingForAReplyAllTime: num(obj(needsReply).total) } : {}),
    link: `${origin}/performance/reviews`,
  };
}

/* ---------- vacancy_summary: /api/reservations/calendar (today + N days) + /api/units ---------- */

export function summariseVacancy(today: string, days: number, origin: string, calendar: unknown, units: unknown) {
  const cal = obj(calendar);
  const listed = new Map(rowsOf(units).map(u => [str(u.id), u]));
  const known = listed.size > 0;
  const calUnits = arr(cal.units).filter(u => !known || (listed.get(str(u.id))?.isListed && (str(listed.get(str(u.id))?.purpose) || 'rental') === 'rental'));
  const end = addDays(today, days);
  const byUnit = new Map<string, Obj[]>();
  for (const b of arr(cal.blocks)) { const k = str(b.unitId); byUnit.set(k, [...(byUnit.get(k) ?? []), b]); }
  let vacantNights = 0, blockedTonight = 0;
  const empty: Obj[] = [];
  const perBuilding = new Map<string, { building: string; units: number; emptyTonight: number }>();
  for (const u of calUnits) {
    const bs = byUnit.get(str(u.id)) ?? [];
    const taken = new Set<string>();
    for (const b of bs) for (let d = ymd(b.checkIn) > today ? ymd(b.checkIn) : today; d < ymd(b.checkOut) && d < end; d = addDays(d, 1)) taken.add(d);
    const tonight = bs.find(b => ymd(b.checkIn) <= today && ymd(b.checkOut) > today);
    if (tonight && str(tonight.channel) === 'maintenance_block') blockedTonight++;
    const free = days - taken.size;
    vacantNights += free;
    const bld = str(u.propertyName) || 'Unknown';
    const pb = perBuilding.get(bld) ?? { building: bld, units: 0, emptyTonight: 0 };
    pb.units++;
    if (!tonight) {
      pb.emptyTonight++;
      const nextIn = bs.map(b => ymd(b.checkIn)).filter(d => d > today).sort()[0] ?? null;
      empty.push({ unit: `${bld} ${str(u.unitNumber)}`.trim(), readiness: str(listed.get(str(u.id))?.readiness) || null, nextCheckIn: nextIn, emptyNightsNext: free, link: `${origin}/properties/units/${enc(str(u.id))}` });
    }
    perBuilding.set(bld, pb);
  }
  return {
    date: today, days,
    note: `Listed rental units with no reservation, owner stay or block over tonight, and empty nights from today to ${addDays(end, -1)}. ${known ? '' : 'The unit list could not be read for your account, so every unit on the calendar is counted, listed or not. '}`,
    units: calUnits.length,
    occupiedTonight: calUnits.length - empty.length,
    blockedTonight,
    emptyTonight: empty.length,
    emptyTonightPct: pct(empty.length, calUnits.length),
    vacantNightsNext: vacantNights,
    vacancyPctNext: pct(vacantNights, calUnits.length * days),
    byBuilding: [...perBuilding.values()].sort((a, b) => b.emptyTonight - a.emptyTonight).slice(0, 15),
    emptyTonightList: empty.sort((a, b) => num(b.emptyNightsNext) - num(a.emptyNightsNext)).slice(0, 30),
    link: `${origin}/reservations/calendar`,
  };
}

/* ---------- owner_statement_summary {owner}: /api/statements?period=all&q= + /api/payouts?q= ---------- */

export function summariseOwnerPayouts(origin: string, owner: string, statements: unknown, payouts: unknown) {
  const out: Obj = { search: owner };
  if (statements) {
    const rows = rowsOf(statements);
    const owners = [...new Set(rows.map(r => str(r.ownerName)).filter(Boolean))];
    out.statements = {
      owners: owners.slice(0, 10),
      ...(owners.length > 1 ? { note: `${owners.length} owners match "${owner}"; give the full name for one.` } : {}),
      latest: rows.slice(0, 12).map(r => ({
        owner: str(r.ownerName), period: str(r.period) || ymd(r.periodStart).slice(0, 7), status: { provisional: 'draft', finalised: 'final', sent: 'sent', paid: 'paid' }[str(r.state)] ?? str(r.state),
        guestTotalRm: rm(r.grossBookingValue), operatorShareRm: rm(r.managementFee), expensesRm: rm(r.expensesTotal), netPayoutToOwnerRm: rm(r.netPayout),
        link: `${origin}/finance/statements/${enc(str(r.id))}`,
      })),
    };
  }
  if (payouts) {
    const p = obj(payouts);
    out.payouts = {
      byStatus: Object.fromEntries(Object.entries(obj(p.counts)).map(([k, v]) => [k, num(v)])),
      stillToPayRm: rm(p.outstanding),
      latest: rowsOf(p).slice(0, 10).map(r => ({ ref: str(r.ref), owner: str(r.ownerName), period: str(r.period), amountRm: rm(r.amount), status: str(r.state), paidAt: ymd(r.paidAt) || null, ...(str(r.failureReason) ? { failureReason: cut(r.failureReason, 120) } : {}) })),
      link: `${origin}/owners/payouts`,
    };
  }
  return out;
}

/* ---------- company_report ---------- */

export const COMPANIES: Record<string, string> = { conts: 'The Conts (short-stay rentals)', dream_crafter: 'Dream Crafter (supply chain)' };
/** "The Conts", "conts", "dream crafter", "DC" -> a COMPANIES key; null when unknown. Default conts. */
export function companyKey(raw: unknown): string | null {
  const s = str(raw).trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!s || s === 'theconts' || s === 'conts' || s === 'tc') return 'conts';
  if (s === 'dreamcrafter' || s === 'dc' || s.startsWith('dream')) return 'dream_crafter';
  return null;
}

/** Owner statements summed over the months of a period, from /api/statements?period=all (its `periods` list). */
export function statementMonths(reply: unknown, from: string, to: string) {
  const months = arr(obj(reply).periods).filter(x => { const m = str(x.period); return m >= from.slice(0, 7) && m <= to.slice(0, 7); });
  return { months: months.length, statements: months.reduce((s, x) => s + num(x.count), 0), netPayoutToOwnersRm: rm(months.reduce((s, x) => s + num(x.net), 0)), paid: months.reduce((s, x) => s + num(x.paid), 0) };
}

const resTotals = (reply: unknown) => { const t = obj(obj(reply).totals); return { reservations: num(t.bookings), nights: num(t.nights), ...(has(t, 'gross') ? { guestTotalRm: rm(t.gross), expectedPayoutRm: rm(t.payout), stillOwedRm: rm(t.outstanding) } : {}) }; };

export interface ContsReportInput {
  kpis?: unknown; prevKpis?: unknown; channels?: unknown; perf?: unknown; prevPerf?: unknown; statements?: unknown; statementsAll?: unknown;
  reservations?: unknown; prevReservations?: unknown; analytics?: unknown;
}

export function summariseContsReport(p: Period, i: ContsReportInput) {
  const out: Obj = {
    company: COMPANIES.conts, ...periodOut(p),
    note: `The management report for The Conts, from the Dashboard, Portfolio, Performance, Reservations and Owner statements. ${p.inProgress ? 'The period is in progress: counted up to today. ' : ''}Money in RM; money parts appear only for accounts the ERP shows them to.`,
  };
  if (i.kpis) {
    const now = kpiFigures(i.kpis), before = i.prevKpis ? kpiFigures(i.prevKpis) : null;
    const change: Obj = {};
    if (before) for (const [k, v] of Object.entries(now)) if (k in before && k !== 'activeUnits') change[k] = k === 'occupancyPct' ? Math.round((v - before[k]) * 10) / 10 : pctChange(v, before[k]);
    out.headline = { thisPeriod: now, previous: before, change: before ? change : null };
  }
  if (i.perf) {
    const r = summariseRevenue(p, i.perf, i.prevPerf ?? null, null);
    out.rentalPerformance = { total: r.total, previous: r.previous, change: r.change, byBuilding: r.byBuilding.slice(0, 10) };
  }
  if (i.analytics) {
    const a = obj(i.analytics), s = obj(a.summary), d = obj(a.deltas), t = obj(a.totals);
    const delta = (x: unknown) => { const o = obj(x); return o.direction ? `${o.direction === 'down' ? '-' : o.direction === 'up' ? '+' : ''}${num(o.value)}${o.unit === 'points' ? ' points' : '%'}` : null; };
    out.rentalPerformance = {
      revenueRm: rm(s.revenue), occupancyPct: num(s.occupancy), adrRm: rm(s.adr), revparRm: rm(s.revpar), nights: num(s.nights), listedUnits: num(s.listedUnits),
      vsSameMonthsLastYear: { revenue: delta(d.revenue), occupancy: delta(d.occupancy), adr: delta(d.adr), revpar: delta(d.revpar) },
      operatorShareRm: rm(t.managementFees), netOwnerPayoutRm: rm(t.netOwnerPayout),
      byMonth: arr(a.points).map(x => ({ month: str(x.period), revenueRm: rm(x.revenue), occupancyPct: Math.round(num(x.occupancy) * 10) / 10 })),
    };
  }
  if (i.channels) out.incomeByChannel = arr(obj(i.channels).channels).map(c => ({ channel: str(c.label ?? c.key), sharePct: num(c.share), incomeRm: rm(c.revenue) }));
  if (i.statements) {
    const s = obj(i.statements), t = obj(s.totals);
    out.ownerStatements = { statements: num(s.total), guestTotalRm: rm(t.gross), operatorShareRm: rm(t.fee), expensesRm: rm(t.expenses), netPayoutToOwnersRm: rm(t.net) };
  } else if (i.statementsAll) {
    const now = statementMonths(i.statementsAll, p.from, p.to), before = statementMonths(i.statementsAll, p.previous.from, p.previous.to);
    out.ownerStatements = { ...now, previous: before, netPayoutChangePct: pctChange(now.netPayoutToOwnersRm, before.netPayoutToOwnersRm) };
  }
  if (i.reservations) {
    const now = resTotals(i.reservations), before = i.prevReservations ? resTotals(i.prevReservations) : null;
    out.reservations = { ...now, ...(before ? { previous: before, reservationsChangePct: pctChange(now.reservations, before.reservations), nightsChangePct: pctChange(now.nights, before.nights) } : {}) };
  }
  return out;
}

/** Dream Crafter from its sales and purchase invoices (the Sales invoices and Purchase invoices lists): invoiced, paid,
 *  open in the period against the period before, top customers / suppliers. */
export function summariseDreamCrafterReport(p: Period, origin: string, sales: unknown, purchases: unknown) {
  const live = (r: Obj) => str(r.status) !== 'CANCELLED';
  const inRange = (r: Obj, from: string, to: string) => { const d = ymd(r.invoiceDate); return !!d && d >= from && d <= to; };
  const fig = (rows: Obj[], from: string, to: string, who: string) => {
    const xs = rows.filter(r => live(r) && inRange(r, from, to));
    const per = new Map<string, number>();
    for (const r of xs) per.set(str(r[who]) || 'Unknown', (per.get(str(r[who]) || 'Unknown') ?? 0) + num(r.totalSen));
    return { invoices: xs.length, totalRm: rm(xs.reduce((s, r) => s + num(r.totalSen), 0)), paidRm: rm(xs.reduce((s, r) => s + num(r.paidSen), 0)), stillOpenRm: rm(xs.reduce((s, r) => s + num(r.outstandingSen), 0)), top: [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, sen]) => ({ name, totalRm: rm(sen) })) };
  };
  const out: Obj = { company: COMPANIES.dream_crafter, ...periodOut(p), note: 'Dream Crafter invoices dated in the period (cancelled left out), against the period before. Money in RM.' };
  if (sales) {
    const rows = rowsOf(sales), now = fig(rows, p.from, p.to, 'customerName'), before = fig(rows, p.previous.from, p.previous.to, 'customerName');
    out.sales = { ...now, previous: { invoices: before.invoices, totalRm: before.totalRm }, changePct: pctChange(now.totalRm, before.totalRm), link: `${origin}/sales/invoices` };
  }
  if (purchases) {
    const rows = rowsOf(purchases), now = fig(rows, p.from, p.to, 'supplierName'), before = fig(rows, p.previous.from, p.previous.to, 'supplierName');
    out.purchases = { ...now, previous: { invoices: before.invoices, totalRm: before.totalRm }, changePct: pctChange(now.totalRm, before.totalRm), link: `${origin}/procurement/purchase-invoices` };
  }
  if (sales && purchases) out.grossDifferenceRm = Math.round((num(obj(out.sales).totalRm) - num(obj(out.purchases).totalRm)) * 100) / 100;
  return out;
}

/* ---------- data_gaps: /api/units + /api/owners + /api/reviews?matched=no + /api/tasks?assignee=none + /api/lettings ---------- */

/** The stand-in owner a unit is put under when nobody is known yet (functions/_lib/hostplatformImport.ts PLACEHOLDER_OWNER). */
export const PLACEHOLDER_OWNER = 'Owner to be confirmed';

export function summariseGaps(today: string, origin: string, i: { units?: unknown; owners?: unknown; reviews?: unknown; cleaning?: unknown; lettings?: unknown }) {
  const gaps: { gap: string; count: number; examples: string[]; link: string }[] = [];
  const add = (gap: string, items: string[], link: string, count = items.length) => { gaps.push({ gap, count, examples: items.slice(0, 10), link }); };
  if (i.units) {
    const rows = rowsOf(i.units);
    add('Units without an owner (under "Owner to be confirmed")', rows.filter(u => str(u.ownerName).trim() === PLACEHOLDER_OWNER).map(u => `${str(u.propertyName)} ${str(u.unitNumber)}`.trim()), `${origin}/properties/units`);
  }
  if (i.owners) {
    const rows = rowsOf(i.owners).filter(o => arr(o.units).length > 0 || num(o.unitCount) > 0);
    add('Owners with units but no bank details (payouts cannot be made)', rows.filter(o => o.hasBankDetails === false).map(o => str(o.displayName)), `${origin}/owners`);
    add('Owners with units but no contract', rows.filter(o => 'contract' in o && !o.contract && str(o.displayName) !== PLACEHOLDER_OWNER).map(o => str(o.displayName)), `${origin}/owners/contracts`);
  }
  if (i.reviews) add('Guest reviews not matched to a reservation', [], `${origin}/performance/reviews`, num(obj(i.reviews).total));
  if (i.cleaning) {
    const c = obj(i.cleaning);
    add('Cleaning jobs in the next 3 days with no cleaner', rowsOf(c).map(r => `${ymd(r.date)} ${str(r.propertyName)} ${str(r.unitNumber)}`.trim()), `${origin}/operations/cleaning`, num(c.total) || rowsOf(c).length);
  }
  if (i.lettings) add('Let-out units marked rented with no end date', rowsOf(i.lettings).filter(l => l.status === 'rented' && !ymd(l.endsOn)).map(l => str(l.unitLabel)), `${origin}/properties/agent-to-let`);
  const open = gaps.filter(g => g.count > 0);
  return {
    date: today,
    note: 'Records missing something the ERP needs to work out money or plan work, from the lists your account can open. Each gap: how many, up to 10 examples and where to fix it.',
    gaps: open,
    checkedWithNothingMissing: gaps.filter(g => g.count === 0).map(g => g.gap),
  };
}
