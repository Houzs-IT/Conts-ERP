// node --test src/lib/mcpConts4.test.mjs. AI Connector round 4 for The Conts (functions/_lib/mcpConts4.ts, the pure
// shaping, and functions/_lib/mcpConts4Tools.ts, the tools), plus the daily brief's Mail Center line (mcpMore.ts).
// The tools run against a stand-in ERP whose replies have the shapes the real handlers return, AS THREE ACCOUNTS:
//   - management: everything;
//   - a staff account without finance (operations): the money keys the real handlers leave out for that role are left
//     out here too (portfolio/performance revenue 0, dashboard/kpis without the money tiles, units/detail without
//     revenue, lettings without rent), and statements / payouts / analytics / sales-invoices answer 403, as they do;
//   - an account with no access at all: every read answers 403.
// The permission tests prove each tool shows "no access" or leaves money out, never more than the role's own screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const P = await import('../../functions/_lib/mcpConts4.ts');
const T = await import('../../functions/_lib/mcpConts4Tools.ts');
const M = await import('../../functions/_lib/mcpMore.ts');
const Q = await import('../../functions/_lib/mcpQuick.ts');

const O = 'https://erp.example';
const TODAY = Q.myToday();
const add = (n) => M.addDays(TODAY, n);

/* ---------- the period convention ---------- */

test('resolvePeriod: every period name, its previous period, and errors', () => {
  const t = '2026-11-26'; // a Thursday
  const m = P.resolvePeriod({}, t);
  assert.equal(m.period, 'month'); assert.equal(m.from, '2026-11-01'); assert.equal(m.to, '2026-11-30'); assert.equal(m.inProgress, true);
  assert.deepEqual(m.previous, { label: '2026-10', from: '2026-10-01', to: '2026-10-31' });
  assert.equal(P.resolvePeriod({ period: 'today' }, t).previous.from, '2026-11-25');
  const w = P.resolvePeriod({ period: 'week' }, t);
  assert.equal(w.from, '2026-11-23'); assert.equal(w.to, '2026-11-29'); assert.equal(w.previous.from, '2026-11-16');
  const lm = P.resolvePeriod({ period: 'last_month' }, t);
  assert.equal(lm.month, '2026-10'); assert.equal(lm.inProgress, false);
  const q = P.resolvePeriod({ period: 'quarter' }, t);
  assert.equal(q.quarter, '2026-q4'); assert.equal(q.from, '2026-10-01'); assert.equal(q.to, '2026-12-31'); assert.equal(q.prevQuarter, '2026-q3');
  assert.equal(P.resolvePeriod({ quarter: '2026-Q1' }, t).prevQuarter, '2025-q4');
  const y = P.resolvePeriod({ period: 'year' }, t);
  assert.equal(y.year, '2026'); assert.equal(y.previous.from, '2025-01-01');
  assert.equal(P.resolvePeriod({ month: '2026-02' }, t).to, '2026-02-28');
  const c = P.resolvePeriod({ from: '2026-11-01', to: '2026-11-10' }, t);
  assert.equal(c.period, 'custom'); assert.equal(c.days, 10); assert.deepEqual([c.previous.from, c.previous.to], ['2026-10-22', '2026-10-31']);
  assert.ok('error' in P.resolvePeriod({ period: 'fortnight' }, t));
  assert.ok('error' in P.resolvePeriod({ period: 'custom', from: '2026-11-10', to: '2026-11-01' }, t));
  assert.deepEqual(P.portfolioPeriods(q), { cur: '2026-q4', prev: '2026-q3' });
  assert.equal(P.portfolioPeriods(w), null);
});

/* ---------- pure shaping ---------- */

test('booking pace: nights clipped to the window, guest total shared by night, booked-by-then', () => {
  const rows = [
    { checkIn: '2026-12-01', checkOut: '2026-12-05', grossBookingValue: 40000, createdAt: '2026-11-01T00:00:00Z' },
    { checkIn: '2026-12-24', checkOut: '2026-12-30', grossBookingValue: 60000, createdAt: '2026-12-20T00:00:00Z' },
  ];
  // Row 2 has 2 of its 6 nights inside the 25 days: a third of its guest total.
  assert.deepEqual(P.windowFigures(rows, '2026-12-01', 25), { bookings: 2, nights: 6, guestTotalRm: 600 });
  const s = P.summarisePace('2026-12-01', { start: '2026-12-01', asOf: '2026-12-01', rows, truncated: false },
    { start: '2026-11-01', asOf: '2026-11-01', rows: [{ checkIn: '2026-11-02', checkOut: '2026-11-04', grossBookingValue: 10000, createdAt: '2026-11-03' }, { checkIn: '2026-11-05', checkOut: '2026-11-06', grossBookingValue: 5000, createdAt: '2026-10-01' }], truncated: false }, null);
  const w30 = s.windows[0];
  assert.equal(w30.nextDays, 30);
  assert.deepEqual(w30.sameTimeLastMonth.onTheBooksThen, { bookings: 1, nights: 1, guestTotalRm: 50 });
  assert.deepEqual(w30.sameTimeLastMonth.finalResult, { bookings: 2, nights: 3, guestTotalRm: 150 });
  assert.equal(s.windows[0].sameTimeLastYear, null);
});

test('revenue: by building, ADR / RevPAR from the Portfolio rows; money only when the reply carried it', () => {
  const p = P.resolvePeriod({ month: '2026-10' }, '2026-11-26');
  const perf = { days: 31, rows: [
    { propertyName: 'Alpha', nights: 31, revenue: 310000 }, { propertyName: 'Alpha', nights: 0, revenue: 0 }, { propertyName: 'Beta', nights: 10, revenue: 50000 },
  ] };
  const r = P.summariseRevenue(p, perf, { days: 30, rows: [{ propertyName: 'Alpha', nights: 15, revenue: 150000 }] }, null);
  assert.equal(r.total.revenueRm, 3600); assert.equal(r.total.nights, 41); assert.equal(r.total.adrRm, 87.8);
  assert.equal(r.byBuilding[0].building, 'Alpha'); assert.equal(r.byBuilding[0].revparRm, 50);
  const staff = P.summariseRevenue(p, { days: 31, rows: perf.rows.map(x => ({ ...x, revenue: 0, adr: 0, revpar: 0 })) }, null, null);
  assert.equal('revenueRm' in staff.total, false);
  assert.match(staff.note, /not shown for this account/);
});

test('leases, vacancy, unit, gaps, owner payouts, cancellations, reviews, channel mix', () => {
  const t = '2026-11-26';
  const l = P.summariseLeases(t, 60, O,
    { data: [{ ownerName: 'Tan', unitsLabel: 'Alpha A-1', endsOn: '2026-12-10' }, { ownerName: 'Lee', renewsOn: '2027-06-01' }, { ownerName: 'Old', endsOn: '2026-11-10' }] },
    { data: [{ status: 'rented', unitLabel: 'Beta B-2', tenantName: 'Ali', endsOn: '2027-01-05', monthlyRent: 180000 }, { status: 'vacant', endsOn: '2026-12-01' }] });
  assert.equal(l.ownerAgreements.endingOrRenewing, 1); assert.equal(l.ownerAgreements.list[0].daysLeft, 14); assert.equal(l.ownerAgreements.endedLast30Days.count, 1);
  assert.equal(l.tenancies.ending, 1); assert.equal(l.tenancies.list[0].monthlyRentRm, 1800);

  const v = P.summariseVacancy(t, 3, O,
    { units: [{ id: 'u1', unitNumber: 'A-1', propertyName: 'Alpha' }, { id: 'u2', unitNumber: 'A-2', propertyName: 'Alpha' }, { id: 'u3', unitNumber: 'X', propertyName: 'Alpha' }],
      blocks: [{ unitId: 'u1', channel: 'airbnb', checkIn: '2026-11-25', checkOut: '2026-11-27' }, { unitId: 'u2', channel: 'direct', checkIn: '2026-11-28', checkOut: '2026-12-02' }] },
    { data: [{ id: 'u1', isListed: true }, { id: 'u2', isListed: true, readiness: 'dirty' }, { id: 'u3', isListed: false }] });
  assert.equal(v.units, 2); assert.equal(v.emptyTonight, 1); assert.equal(v.emptyTonightList[0].nextCheckIn, '2026-11-28');
  assert.equal(v.vacantNightsNext, 2 + 2); // u1 free 27, 28; u2 free 26, 27

  const u = P.summariseUnit(O, t, {
    unit: { id: 'u1', unitNumber: 'A-1', propertyId: 'pa', propertyName: 'Alpha', readiness: 'clean', isListed: true, owner: { name: 'Tan' } },
    performance: { period: '2026-11', occupancy: 80, occupiedNights: 20, adr: 15000, revpar: 12000 },
    stays: [{ id: 'r1', guestName: 'Ann', channel: 'airbnb', state: 'checked_in', checkIn: '2026-11-25', checkOut: '2026-11-28' }, { id: 'r2', guestName: 'Bob', channel: 'direct', state: 'confirmed', checkIn: '2026-12-01', checkOut: '2026-12-03' }],
    openMaintenanceCount: 1,
  }, { data: [] }, { data: [{ propertyId: 'pa', unitNumber: 'A-1', outstanding: 5000, externalRef: 'TC-1' }, { propertyId: 'pa', unitNumber: 'A-10', outstanding: 9000 }] });
  assert.equal(u.guestNow.guest, 'Ann'); assert.equal(u.nextReservation.guest, 'Bob');
  assert.deepEqual([u.arrears.directGuestsOwing, u.arrears.owedRm], [1, 50]);
  assert.equal('adrRm' in u.thisMonth, false, 'no revenue in the reply: no ADR either');

  const g = P.summariseGaps(t, O, {
    units: { data: [{ propertyName: 'Alpha', unitNumber: 'A-1', ownerName: 'Owner to be confirmed' }, { ownerName: 'Tan' }] },
    owners: { data: [{ displayName: 'Tan', hasBankDetails: false, contract: null, units: [{}] }, { displayName: 'Lee', hasBankDetails: true, contract: {}, units: [] }] },
    reviews: { total: 4 }, cleaning: { total: 2, data: [{ date: t, propertyName: 'Alpha', unitNumber: 'A-2' }] }, lettings: { data: [{ status: 'rented', unitLabel: 'Beta B-2' }] },
  });
  assert.deepEqual(g.gaps.map(x => x.count), [1, 1, 1, 4, 2, 1]);

  const op = P.summariseOwnerPayouts(O, 'Tan', { data: [{ id: 's1', ownerName: 'Tan', period: '2026-10', state: 'sent', netPayout: 123456 }] }, { counts: { paid: 3, pending: 1 }, outstanding: 50000, data: [{ ref: 'PAY-1', amount: 50000, state: 'pending' }] });
  assert.equal(op.statements.latest[0].netPayoutToOwnerRm, 1234.56); assert.equal(op.payouts.stillToPayRm, 500);

  const p = P.resolvePeriod({ month: '2026-10' }, t);
  const c = P.summariseCancellations(p, O, { facets: { st: [{ value: 'confirmed', count: 90 }, { value: 'cancelled', count: 8 }, { value: 'no_show', count: 2 }] } },
    { totals: { bookings: 10, gross: 200000 }, facets: { ch: [{ value: 'airbnb', count: 7 }] }, data: [] }, { facets: { st: [{ value: 'confirmed', count: 95 }, { value: 'cancelled', count: 5 }] } }, { totals: { bookings: 6 } });
  assert.equal(c.rates.cancellationRatePct, 8); assert.equal(c.change.cancellationRatePoints, 3); assert.equal(c.cancelledStays.lostGuestTotalRm, 2000); assert.equal(c.cancelledDuringThePeriod, 6);

  const rv = P.summariseReviews(p, O, { total: 3, badMax: 3, average: 4.5, data: [{ channel: 'airbnb', rating: 5, reply: 'x' }, { channel: 'airbnb', rating: 4 }, { channel: 'booking_com', rating: 2, comment: 'Dirty' }] }, { total: 1, data: [{ rating: 5 }] }, { total: 7 });
  assert.equal(rv.averageRating, 3.67); assert.equal(rv.badReviews.count, 1); assert.equal(rv.notRepliedInPeriod, 2); assert.equal(rv.waitingForAReplyAllTime, 7);

  const mx = P.summariseChannelMix(p, [{ channel: 'airbnb', reply: { totals: { bookings: 3, nights: 9, gross: 90000 } } }, { channel: 'direct', reply: { totals: { bookings: 1, nights: 1, gross: 10000 } } }], { facets: { ch: [{ value: 'airbnb', count: 2 }] } }, null);
  assert.deepEqual([mx.channels[0].bookingsSharePct, mx.channels[0].adrRm, mx.channels[0].avgLengthOfStayNights, mx.channels[0].bookingsChangePct], [75, 100, 3, 50]);
});

test('daily brief: Mail Center waiting count as its own section; not readable -> said plainly', () => {
  const base = { today: TODAY, origin: O, name: 'A', badges: null, tasks: null, approvals: null, salesOrders: null, purchaseOrders: null, maintenance: null, noAccess: [] };
  const b = M.buildBrief({ ...base, mail: { count: 4 } });
  const s = b.sections.find(x => x.section.startsWith('Mail Center'));
  assert.equal(s.count, 4); assert.equal(s.top[0].link, `${O}/mail`);
  assert.equal(b.notCovered, undefined);
  const none = M.buildBrief({ ...base, mail: null, noAccess: ['Mail Center'] });
  assert.match(none.notCovered, /Mail Center is not included/);
});

/* ---------- the tools, against a stand-in ERP, as three accounts ---------- */

const FORBID = { status: 403, body: { error: { code: 'FORBIDDEN', message: 'Your access does not include this.' } } };
const perfRows = (money) => [
  { unitId: 'u1', unitNumber: 'A-1', propertyId: 'pa', propertyName: 'Alpha', nights: 20, occupancy: 66.7, adr: money ? 15000 : 0, revpar: money ? 10000 : 0, revenue: money ? 300000 : 0 },
];
const kpis = (money) => ({ kpis: [{ key: 'occupancy', value: 66.7 }, ...(money ? [{ key: 'accommodation_revenue', value: 300000 }, { key: 'adr', value: 15000 }] : [])] });
const resList = { total: 2, counts: { all: 2 }, todos: { unpaid: { count: 1, outstanding: 5000 } }, totals: { bookings: 2, nights: 5, gross: 80000, fees: 0, payout: 70000, outstanding: 5000 },
  facets: { ch: [{ value: 'airbnb', count: 2 }], st: [{ value: 'confirmed', count: 2 }] },
  data: [{ id: 'r1', externalRef: 'HM1', guestName: 'Ann', propertyId: 'pa', propertyName: 'Alpha', unitNumber: 'A-1', channel: 'airbnb', state: 'confirmed', checkIn: add(1), checkOut: add(3), nights: 2, grossBookingValue: 40000, outstanding: 5000, createdAt: `${add(-2)}T00:00:00Z` }] };

/** The replies each endpoint gives `role`: 'management', 'staff' (operations, no finance) or 'none'. */
function erp(role) {
  const money = role === 'management';
  return (path) => {
    if (role === 'none') return FORBID;
    if (!money && ['/api/statements', '/api/payouts', '/api/analytics', '/api/sales-invoices', '/api/purchase-invoices'].includes(path)) return FORBID;
    switch (path) {
      case '/api/search': return { body: [{ kind: 'unit', id: 'u1', label: 'Alpha A-1' }] };
      case '/api/units/detail': return { body: { unit: { id: 'u1', unitNumber: 'A-1', propertyId: 'pa', propertyName: 'Alpha', owner: { name: 'Tan' } }, performance: { period: TODAY.slice(0, 7), occupancy: 50, occupiedNights: 10, adr: 15000, revpar: 9000, ...(money ? { revenue: 150000, gross: 170000 } : {}) }, stays: resList.data, openMaintenanceCount: 0 } };
      case '/api/lettings': return { body: { ready: true, data: [{ status: 'rented', unitId: 'u1', unitLabel: 'Alpha A-1', tenantName: 'Ali', startsOn: add(-100), endsOn: add(20), daysLeft: 20, ...(money ? { monthlyRent: 200000 } : {}) }] } };
      case '/api/reservations': return { body: resList };
      case '/api/reservations/calendar': return { body: { units: [{ id: 'u1', unitNumber: 'A-1', propertyName: 'Alpha' }], blocks: [] } };
      case '/api/units': return { body: { data: [{ id: 'u1', propertyName: 'Alpha', unitNumber: 'A-1', isListed: true, ownerName: 'Tan', ...(money ? { baseRate: 20000 } : {}) }] } };
      case '/api/contracts': return { body: { data: [{ ownerName: 'Tan', unitsLabel: 'Alpha A-1', endsOn: add(10), managementFeePct: 20 }] } };
      case '/api/portfolio/performance': return { body: { days: 30, units: 1, rows: perfRows(money) } };
      case '/api/dashboard/kpis': return { body: kpis(money) };
      case '/api/dashboard/channels': return { body: { channels: money ? [{ key: 'airbnb', label: 'Airbnb', share: 100, revenue: 300000 }] : [] } };
      case '/api/dashboard/today': return { body: { rows: [{ key: 'cleaning_pending', count: 1 }] } };
      case '/api/tasks': return { body: { total: 1, counts: { open: 1 }, data: [{ propertyName: 'Alpha', unitNumber: 'A-1', kind: 'turnover', state: 'open', date: TODAY }] } };
      case '/api/maintenance/issues': return { body: { data: [{ id: 'm1', title: 'Leak', state: 'open', dueOn: TODAY, propertyName: 'Alpha', unitNumber: 'A-1' }] } };
      case '/api/reviews': return { body: { total: 1, average: 4, summary: { total: 1 }, data: [{ channel: 'airbnb', rating: 4 }] } };
      case '/api/owners': return { body: { data: [{ displayName: 'Tan', hasBankDetails: true, contract: {}, units: [{}] }] } };
      case '/api/statements': return { body: { total: 1, totals: { gross: 300000, fee: 60000, expenses: 10000, net: 230000 }, periods: [{ period: TODAY.slice(0, 7), count: 1, net: 230000 }] } };
      case '/api/analytics': return { body: { summary: { revenue: 300000, occupancy: 60, adr: 15000, revpar: 9000 }, deltas: {}, totals: {}, points: [] } };
      case '/api/sales-invoices': return { body: [{ invoiceDate: TODAY, status: 'SENT', totalSen: 100000, paidSen: 0, outstandingSen: 100000, customerName: 'C' }] };
      case '/api/purchase-invoices': return { body: [] };
      default: return { status: 404, body: { error: { message: 'That address does not exist.' } } };
    }
  };
}

function ctxFor(role) {
  const reads = [];
  const answer = erp(role);
  return {
    reads,
    c: {
      origin: O, id: { user: { id: 'user-1', fullName: 'Test', email: 't@x', role } },
      read: async (path, q) => {
        reads.push(path);
        const r = answer(path, q);
        const status = r.status ?? 200;
        if (status === 401 || status === 403) return { ok: false, status, message: `Not available to your role: your ERP account does not have access to this. The ERP says: ${r.body.error.message}`, note: 'no access', target: path };
        if (status >= 400) return { ok: false, status, message: `The ERP answered: ${r.body.error.message}`, note: 'error', target: path };
        return { ok: true, status, value: r.body, removed: [], target: path };
      },
    },
  };
}

const CALLS = [
  ['unit_overview', { unit: 'A-1' }], ['leases_expiring', {}], ['revenue_summary', {}], ['housekeeping_today', {}], ['booking_pace', {}],
  ['channel_mix', { period: 'month' }], ['cancellations_summary', { period: 'last_month' }], ['reviews_summary', { period: 'quarter' }],
  ['vacancy_summary', { days: 7 }], ['company_report', { period: 'month' }], ['company_report', { period: 'quarter' }], ['company_report', { period: 'year' }],
  ['company_report', { company: 'Dream Crafter', period: 'month' }], ['data_gaps', {}],
];

/** Every money key (ending Rm) at any depth with a non-zero value. */
const moneyKeys = (v, out = []) => {
  if (Array.isArray(v)) v.forEach(x => moneyKeys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/Rm$/.test(k) && Number(x) !== 0 && x !== null) out.push(k); moneyKeys(x, out); }
  return out;
};

test('every round 4 tool is listed, has a schema, and reads only the endpoints its permission table names', async () => {
  const names = T.CONTS4_TOOLS.map(t => t.name);
  assert.deepEqual([...new Set(CALLS.map(c => c[0]))].sort(), [...names].sort());
  for (const t of T.CONTS4_TOOLS) { assert.equal(t.inputSchema.type, 'object'); assert.equal(t.annotations.readOnlyHint, true); assert.ok(T.CONTS4_READS[t.name]); }
  for (const [name, args] of CALLS) {
    const { c, reads } = ctxFor('management');
    const out = await T.runConts4Tool(name, args, c);
    assert.ok(out, name);
    assert.equal(out.result.isError, undefined, `${name} as management: ${out.result.content[0].text}`);
    assert.ok(reads.length <= 6 || name === 'booking_pace', `${name}: ${reads.length} reads`);
    const declared = T.CONTS4_READS[name].join(' ');
    for (const p of reads) assert.ok(declared.includes(p), `${name} read ${p}, not in CONTS4_READS`);
  }
  assert.equal(await T.runConts4Tool('not_a_tool', {}, ctxFor('management').c), null);
});

test('PERMISSIONS: an account with no access gets "no access" from every tool, and no data', async () => {
  for (const [name, args] of CALLS) {
    const { c } = ctxFor('none');
    const out = await T.runConts4Tool(name, args, c);
    const txt = out.result.content[0].text;
    assert.equal(out.result.isError, true, `${name} must refuse: ${txt}`);
    assert.equal(out.status, 403, name);
    assert.match(txt, /does not have access/i, name);
    assert.doesNotMatch(txt, /Alpha|Tan|Ann|Ali/, `${name} leaked a record`);
  }
});

test('PERMISSIONS: staff without finance get no money from any tool, and are told what was left out', async () => {
  for (const [name, args] of CALLS) {
    const { c } = ctxFor('staff');
    const out = await T.runConts4Tool(name, args, c);
    const txt = out.result.content[0].text;
    if (name === 'company_report' && args.company === 'Dream Crafter') {
      assert.equal(out.result.isError, true, 'Dream Crafter invoices are finance-only'); assert.match(txt, /does not have access to Sales invoices/); continue;
    }
    assert.equal(out.result.isError, undefined, `${name} as staff: ${txt}`);
    const body = JSON.parse(txt);
    // Reservations money (guest totals, and channel_mix's ADR = guest total / nights from the same list) is what the
    // Reservations list itself shows to staff; every other money key must be gone.
    const allowed = new Set(['guestTotalRm', 'owedRm', 'expectedPayoutRm', 'stillOwedRm', 'lostGuestTotalRm', ...(name === 'channel_mix' ? ['adrRm'] : [])]);
    const leaked = moneyKeys(body).filter(k => !allowed.has(k));
    assert.deepEqual(leaked, [], `${name} leaked money to staff: ${leaked.join(', ')}`);
  }
  // The finance-only parts are named, not silently missing.
  const { c } = ctxFor('staff');
  const rep = JSON.parse((await T.runConts4Tool('company_report', { period: 'month' }, c)).result.content[0].text);
  assert.ok(rep.notIncluded.some(x => /Owner statements/.test(x)));
  assert.equal(rep.ownerStatements, undefined);
  assert.equal('revenueRm' in rep.rentalPerformance.total, false);
  const year = JSON.parse((await T.runConts4Tool('company_report', { period: 'year' }, ctxFor('staff').c)).result.content[0].text);
  assert.ok(year.notIncluded.some(x => /Performance \(finance and management\)/.test(x)));
  const unit = JSON.parse((await T.runConts4Tool('unit_overview', { unit: 'A-1' }, ctxFor('staff').c)).result.content[0].text);
  assert.equal(unit.tenant.monthlyRentRm, undefined);
  assert.equal(unit.thisMonth.incomeRm, undefined);
});

test('period errors are plain, not a crash', async () => {
  const { c } = ctxFor('management');
  const bad = await T.runConts4Tool('channel_mix', { period: 'fortnight' }, c);
  assert.equal(bad.result.isError, true); assert.equal(bad.status, 400);
  const week = await T.runConts4Tool('revenue_summary', { period: 'week' }, c);
  assert.match(week.result.content[0].text, /one month or one quarter/);
  const old = await T.runConts4Tool('company_report', { period: 'year', year: '2024' }, c);
  assert.match(old.result.content[0].text, /this year to date/);
  const nope = await T.runConts4Tool('company_report', { company: 'Acme' }, c);
  assert.equal(nope.status, 400);
});
