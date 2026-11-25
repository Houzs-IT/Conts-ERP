// node --test src/lib/mcpQuick.test.mjs. The AI Connector's quick answers, search / fetch shape, erp_get `fields`,
// prompts (functions/_lib/mcpQuick.ts) and the one-token-check-per-lookup cache (functions/_lib/mcpInner.ts).
// The replies below have the shapes the real handlers return (functions/api/dashboard/*, reservations/index.ts,
// search/index.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const Q = await import('../../functions/_lib/mcpQuick.ts');
const { rememberVerified, recallVerified } = await import('../../functions/_lib/mcpInner.ts');

test('money, percent, months and ranges', () => {
  assert.equal(Q.rm(1234567), 12345.67);
  assert.equal(Q.rm('x'), 0);
  assert.equal(Q.pctChange(110, 100), 10);
  assert.equal(Q.pctChange(5, 0), null);
  assert.equal(Q.myToday(new Date('2026-11-25T17:00:00Z')), '2026-11-26'); // Malaysia is UTC+8
  assert.equal(Q.normaliseMonth('2026-10', '2026-11-25'), '2026-10');
  assert.equal(Q.normaliseMonth('2026-13', '2026-11-25'), '2026-11');
  assert.equal(Q.normaliseMonth(undefined, '2026-11-25'), '2026-11');
  assert.equal(Q.prevMonth('2026-01'), '2025-12');
  assert.equal(Q.prevMonth('2026-11'), '2026-10');
  assert.equal(Q.monthEnd('2028-02'), '2028-02-29');
  assert.equal(Q.monthEnd('2026-11'), '2026-11-30');
  assert.deepEqual(Q.validRange('2026-11-01', '2026-11-30'), { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(Q.validRange('2026-11-30', '2026-11-01'), null);
  assert.equal(Q.validRange('2026-11-01', 'soon'), null);
  assert.equal(Q.validRange('2024-01-01', '2026-01-01'), null); // over 400 days
});

const kpis = (occ, gross, extra = true) => ({
  generatedAt: 'x', period: '2026-11',
  kpis: [
    { key: 'occupancy', value: occ, unit: 'percent' },
    ...(extra ? [
      { key: 'accommodation_revenue', value: gross, currency: 'MYR' },
      { key: 'income_per_unit', value: 250000, currency: 'MYR', units: 40.5 },
      { key: 'adr', value: 18000, currency: 'MYR' },
      { key: 'revpar', value: 13000, currency: 'MYR' },
      { key: 'net_owner_payout', value: 5000000, currency: 'MYR', estimate: true },
    ] : []),
  ],
});

test('business summary: the Dashboard tiles, against the month before, by channel', () => {
  const ch = { channels: [{ key: 'airbnb', label: 'Airbnb', share: 70, revenue: 7000000 }, { key: 'booking_com', label: 'Booking.com', share: 30, revenue: 3000000 }] };
  const s = Q.summariseBusiness('2026-11', '2026-11-25', kpis('72.5', 10000000), kpis('80.0', 12500000), ch);
  assert.equal(s.thisMonth.occupancyPct, 72.5);
  assert.equal(s.thisMonth.reservationIncomeRm, 100000);
  assert.equal(s.thisMonth.activeUnits, 40.5);
  assert.equal(s.previousMonth.month, '2026-10');
  assert.equal(s.change.occupancyPct, -7.5); // percentage points
  assert.equal(s.change.reservationIncomeRm, -20); // percent
  assert.deepEqual(s.byChannel[0], { channel: 'Airbnb', sharePct: 70, incomeRm: 70000 });
  assert.match(s.note, /in progress/);
  assert.ok(JSON.stringify(s).length < 1500);
});

test('business summary without money access shows occupancy only and says so', () => {
  const s = Q.summariseBusiness('2026-10', '2026-11-25', kpis('81', 0, false), null, { channels: [] });
  assert.deepEqual(s.thisMonth, { occupancyPct: 81 });
  assert.equal(s.previousMonth, null);
  assert.match(s.note, /Money figures are not shown/);
  assert.doesNotMatch(s.note, /in progress/);
});

test('reservations summary: the Reservations list totals, tabs, facets and to-do cards', () => {
  const reply = {
    total: 120, counts: { upcoming: 30, inhouse: 12, past: 70, cancelled: 8, all: 120 },
    todos: { arriving: { count: 4, outstanding: 0 }, departing: { count: 3, outstanding: 0 }, unpaid: { count: 2, outstanding: 45000 }, payout: { count: 9, outstanding: 812300 } },
    totals: { bookings: 120, nights: 410, gross: 9876543, fees: 1200000, payout: 8000000, outstanding: 857300 },
    facets: { ch: [{ value: 'airbnb', count: 80 }, { value: 'agoda', count: 40 }], st: [{ value: 'confirmed', count: 100 }], building: [], country: [] },
    data: [{ id: 'r1' }], buildings: [{ id: 'b1', name: 'Skyline' }],
  };
  const s = Q.summariseReservations({ from: '2026-11-01', to: '2026-11-30' }, reply);
  assert.equal(s.reservations, 120);
  assert.equal(s.guestTotalRm, 98765.43);
  assert.equal(s.stillOwedRm, 8573);
  assert.deepEqual(s.toDo.hostPayoutsOutstanding, { count: 9, owedRm: 8123 });
  assert.deepEqual(s.toDo.directGuestsStillOwing, { count: 2, owedRm: 450 });
  assert.equal(s.byTab.inhouse, 12);
  assert.deepEqual(s.byChannel[1], { channel: 'agoda', reservations: 40 });
  assert.equal('data' in s, false); // the page of rows is not passed on
  assert.ok(JSON.stringify(s).length < 1500);
});

test('today summary: the Today card and what needs someone', () => {
  const today = { date: '2026-11-25', rows: [{ key: 'check_ins', count: 6 }, { key: 'check_outs', count: 5 }, { key: 'cleaning_pending', count: 3 }, { key: 'maintenance_open', count: 11 }, { key: 'escalations', count: 2 }] };
  const ex = { exceptions: [
    { id: 'risk-1', tone: 'critical', title: 'Check-in at risk in 40 minutes', detail: 'Skyline D25-13 is dirty with no cleaner assigned.', action: { label: 'Assign cleaner' } },
    { id: 'block-1', tone: 'warning', title: 'Unit blocked for maintenance', detail: 'x', revenueAtRisk: 45000 },
  ] };
  const s = Q.summariseToday(today, ex);
  assert.deepEqual(s.counts, { checkIns: 6, checkOuts: 5, cleaningPending: 3, maintenanceOpen: 11, unreadGuestMessages: 2 });
  assert.equal(s.needsAttention[0].level, 'critical');
  assert.equal(s.needsAttention[1].revenueAtRiskRm, 450);
  assert.equal('revenueAtRiskRm' in s.needsAttention[0], false);
  assert.equal(Q.summariseToday(today, null).needsAttention.length, 0);
});

test('pickFields keeps only the named keys, at any depth', () => {
  const v = { total: 2, data: [{ externalRef: 'HM1', checkIn: '2026-11-01', guest: { name: 'A', phone: '1' } }, { externalRef: 'HM2', junk: 1 }] };
  assert.deepEqual(Q.pickFields(v, ['externalRef', 'total']), { total: 2, data: [{ externalRef: 'HM1' }, { externalRef: 'HM2' }] });
  assert.deepEqual(Q.pickFields(v, ['name']), { data: [{ guest: { name: 'A' } }, {}] });
  assert.equal(Q.pickFields(v, []), v);
});

test('search results in the shape ChatGPT requires; the engine notice is left out', () => {
  const body = [
    { id: 'res1', kind: 'reservation', label: 'Tan Mei Ling', sub: 'Skyline KL D25-13', channel: 'airbnb', state: 'confirmed', checkIn: '2026-11-20', checkOut: '2026-11-23', ref: 'HMABC123', target: '/reservations/bookings?view=all&ref=HMABC123&open=res1' },
    { id: 'u1', kind: 'unit', label: 'Skyline KL D25-13', sub: '2 bedrooms', target: '/properties/units/u1' },
    { id: 'engine', kind: 'notice', label: 'Some supply chain records could not be searched just now', sub: '', target: '' },
  ];
  const { results, partial } = Q.searchResults(body, 'https://erp.theconts.com');
  assert.equal(partial, true);
  assert.equal(results.length, 2);
  assert.deepEqual(Object.keys(results[0]).sort(), ['id', 'title', 'url']);
  assert.equal(results[0].id, 'reservation:res1');
  assert.match(results[0].title, /^Reservation: Tan Mei Ling · Skyline KL D25-13 · 2026-11-20 to 2026-11-23 · ref HMABC123$/);
  assert.equal(results[1].url, 'https://erp.theconts.com/properties/units/u1');
  assert.deepEqual(Q.searchResults({ error: 'x' }, 'o'), { results: [], partial: false });
});

test('fetch ids round-trip; anything else is refused; list kinds are picked out by id', () => {
  assert.deepEqual(Q.parseFetchId('reservation:res1'), { kind: 'reservation', rowId: 'res1' });
  assert.deepEqual(Q.parseFetchId(' unit:11111111-1111-4111-8111-000000000004 '), { kind: 'unit', rowId: '11111111-1111-4111-8111-000000000004' });
  for (const bad of ['../etc', 'reservation:a/b', 'reservation:', 'Reservation:x', 'reservation:a?b=1', '']) assert.equal(Q.parseFetchId(bad), null, bad);
  assert.equal(Q.FETCH_SPECS.reservation.path('a b'), '/api/reservations/a%20b');
  assert.deepEqual(Q.FETCH_SPECS.unit.query('u1'), { unitId: 'u1' });
  assert.equal(Q.FETCH_SPECS.owner.page('o1'), '/owners/o1');
  assert.equal(Q.FETCH_SPECS.sales_order, undefined); // engine kinds: open the link from search
  // Every detail path stays a readable connector path.
  for (const [kind, s] of Object.entries(Q.FETCH_SPECS)) assert.match(s.path('x'), /^\/api\/[a-z/-]+(\/x)?$/, kind);
  const props = { generatedAt: 'x', buildings: [{ id: 'b1', name: 'Skyline' }], units: [{ id: 'u1', buildingId: 'b1' }] };
  assert.deepEqual(Q.findById(props, 'b1'), { id: 'b1', name: 'Skyline' });
  assert.equal(Q.findById(props, 'zz'), null);
  assert.equal(Q.findById({ id: 'top' }, 'top'), null); // the reply itself is not a record
  assert.equal(Q.docTitle('reservation', { externalRef: 'HM1', guestName: 'A' }), 'Reservation HM1');
  assert.equal(Q.docTitle('building', { name: 'Skyline' }), 'Building Skyline');
});

test('prompts expand to a question; unknown prompt is refused', () => {
  assert.equal(Q.PROMPTS.length, 3);
  assert.match(Q.promptText('monthly_review', { month: '2026-10' }), /2026-10.*business_summary/);
  assert.match(Q.promptText('monthly_review', { month: 'junk' }), /this month/);
  assert.match(Q.promptText('today_at_a_glance', {}), /today_summary/);
  assert.match(Q.promptText('find_reservation', { query: 'HMABC123' }), /"HMABC123".*search.*fetch/);
  assert.equal(Q.promptText('nope', {}), null);
  for (const p of Q.PROMPTS) assert.notEqual(Q.promptText(p.name, {}), null);
});

test('a verified token is reused briefly by the inner reads, then forgotten', () => {
  rememberVerified('ctmcp_x', { tokenId: 't1' }, 1_000);
  assert.deepEqual(recallVerified('ctmcp_x', 5_000), { tokenId: 't1' });
  assert.equal(recallVerified('ctmcp_x', 16_001), null);
  assert.equal(recallVerified('ctmcp_x', 5_000), null); // dropped once expired
  assert.equal(recallVerified('ctmcp_never', 1_000), null);
});
