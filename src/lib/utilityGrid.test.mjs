// node --test src/lib/utilityGrid.test.mjs (npm test). The utility listing's rules (plan 2026-10-28-utility-listing.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billState, buildCells, buildRequestCells, months, requestState, unitAverages, unusual } from './utilityGrid.ts';

let n = 0;
const bill = (o) => ({ id: `b${++n}`, unitId: 'u1', kind: 'electricity', billMonth: '2026-09', deductMonth: o.billMonth ?? '2026-09', amount: 1000,
  chargeTo: 'owner', recordOnly: false, final: false, receiptId: null, reference: null, rolled: false, ...o });

test('the four states of a bill', () => {
  assert.equal(billState(bill({ final: true })), 'charged');
  assert.equal(billState(bill({ final: false })), 'pending');
  assert.equal(billState(bill({ chargeTo: 'company' })), 'company');
  assert.equal(billState(bill({ recordOnly: true, final: true })), 'record');
});
test('a late bill sits in its bill month, coloured by its deduction month', () => {
  const b = bill({ billMonth: '2026-09', deductMonth: '2026-10', rolled: true, final: false });
  const c = buildCells([b]).get('u1|electricity|2026-09');
  assert.equal(c.state, 'pending'); assert.equal(c.amount, 1000);
  assert.equal(buildCells([b]).get('u1|electricity|2026-10'), undefined);
});
test('a cell with several bills shows the first of: not charged yet, charged, record only, company pays', () => {
  const cells = buildCells([bill({ final: true }), bill({ final: false }), bill({ kind: 'water', recordOnly: true }), bill({ kind: 'water', chargeTo: 'company' })]);
  assert.equal(cells.get('u1|electricity|2026-09').state, 'pending');
  assert.equal(cells.get('u1|electricity|2026-09').amount, 2000);
  assert.equal(cells.get('u1|water|2026-09').state, 'record');
});
test('the total cell adds every kind and has no state', () => {
  const t = buildCells([bill({ amount: 500 }), bill({ kind: 'internet', amount: 10494 })]).get('u1|total|2026-09');
  assert.equal(t.amount, 10994); assert.equal(t.state, null);
});
test('months run newest first', () => {
  const m = months('2026-01', '2026-10');
  assert.equal(m.length, 10); assert.equal(m[0], '2026-10'); assert.equal(m[9], '2026-01');
  assert.deepEqual(months('2025-12', '2026-01'), ['2026-01', '2025-12']);
});
test('average per month counts only months with a bill', () => {
  const cells = buildCells([bill({ billMonth: '2026-07', amount: 300 }), bill({ billMonth: '2026-08', amount: 600 }), bill({ billMonth: '2026-10', amount: 900 })]);
  const a = unitAverages(cells, 'u1', months('2026-07', '2026-10'), {});
  assert.equal(a.perMonth, 600); assert.equal(a.perNight, null);
});
test('average per night leaves out months with no nights', () => {
  const cells = buildCells([bill({ billMonth: '2026-08', amount: 600 }), bill({ billMonth: '2026-09', amount: 900 })]);
  const a = unitAverages(cells, 'u1', months('2026-08', '2026-09'), { '2026-08': 0, '2026-09': 30 });
  assert.equal(a.perNight, 30);
});
test('no bills: both averages are empty', () => assert.deepEqual(unitAverages(new Map(), 'u1', months('2026-08', '2026-09'), {}), { perMonth: null, perNight: null }));

const steady = (last) => [bill({ billMonth: '2026-06', amount: 100 }), bill({ billMonth: '2026-07', amount: 100 }), bill({ billMonth: '2026-08', amount: 100 }), bill({ billMonth: '2026-09', amount: last })];
const unusualOf = (bills) => unusual(buildCells(bills), ['u1'], months('2026-06', '2026-09'), { u1: { '2026-09': 20, '2026-06': 10, '2026-07': 10, '2026-08': 10 } });
test('a bill more than 50 % above or below the previous three months is unusual', () => {
  const up = unusualOf(steady(151));
  assert.equal(up.length, 1); assert.equal(up[0].month, '2026-09'); assert.equal(up[0].changePct, 51); assert.equal(up[0].baseline, 100);
  assert.equal(up[0].nights, 20); assert.equal(up[0].baselineNights, 10);
  assert.equal(unusualOf(steady(150)).length, 0);
  assert.equal(unusualOf(steady(149)).length, 0);
  assert.equal(unusualOf(steady(49))[0].changePct, -51);
});
test('a month is judged only when two of the previous three months have a bill', () => {
  assert.equal(unusualOf([bill({ billMonth: '2026-08', amount: 100 }), bill({ billMonth: '2026-09', amount: 900 })]).length, 0);
  assert.equal(unusualOf([bill({ billMonth: '2026-07', amount: 100 }), bill({ billMonth: '2026-08', amount: 100 }), bill({ billMonth: '2026-09', amount: 900 })]).length, 1);
});
test('unusual rows are sorted by the size of the change', () => {
  const rows = unusual(buildCells([...steady(400), ...steady(20).map(b => ({ ...b, kind: 'water' }))]), ['u1'], months('2026-06', '2026-09'), {});
  assert.deepEqual(rows.map(r => r.kind), ['electricity', 'water']);
});
test('the first month shown is compared with the three months before the range', () => {
  const rows = unusual(buildCells(steady(300)), ['u1'], months('2026-09', '2026-09'), {});
  assert.equal(rows.length, 1); assert.equal(rows[0].baseline, 100);
});

// The "By payment request" view (chew, 5 Nov 2026; SOP 3.10): a bill sits in the month its payment request was made.
const req = (o, b = {}) => bill({ ...b, request: { id: 'r1', no: 'PRQ-2610-001', status: 'SUBMITTED', month: '2026-10', ...o } });
test('a request is waiting, part paid or paid; rejected and withdrawn ones do not count', () => {
  assert.equal(requestState('SUBMITTED'), 'waiting');
  assert.equal(requestState('PART_PAID'), 'part_paid');
  assert.equal(requestState('PAID'), 'paid');
  assert.equal(requestState('CLOSED'), 'paid');
  assert.equal(requestState('REJECTED'), null);
  assert.equal(requestState('WITHDRAWN'), null);
});
test('a September bill requested in October sits in October, coloured by its request', () => {
  const cells = buildRequestCells([req({ status: 'PART_PAID' })]);
  assert.equal(cells.get('u1|electricity|2026-09'), undefined);
  assert.equal(cells.get('u1|electricity|2026-10').state, 'part_paid');
  assert.equal(cells.get('u1|electricity|2026-10').amount, 1000);
  assert.equal(cells.get('u1|total|2026-10').amount, 1000);
});
test('bills with no request, or on a rejected or withdrawn one, are left out', () => {
  const cells = buildRequestCells([bill({}), req({ status: 'REJECTED' }), req({ status: 'WITHDRAWN' })]);
  assert.equal(cells.size, 0);
});
test('a cell with several requests shows the first of: waiting, part paid, paid', () => {
  const cells = buildRequestCells([req({ status: 'PAID' }), req({ status: 'SUBMITTED', id: 'r2' }), req({ status: 'PAID' }, { kind: 'water' }), req({ status: 'PART_PAID' }, { kind: 'water' })]);
  assert.equal(cells.get('u1|electricity|2026-10').state, 'waiting');
  assert.equal(cells.get('u1|electricity|2026-10').amount, 2000);
  assert.equal(cells.get('u1|water|2026-10').state, 'part_paid');
});
test('by payment request a cell shows what was asked for: the whole bill of a bill split at the contract start', () => {
  const split = req({ amount: 31000 }, { amount: 4000 });
  assert.equal(buildRequestCells([split]).get('u1|electricity|2026-10').amount, 31000);
  assert.equal(buildCells([split]).get('u1|electricity|2026-09').amount, 4000);
});

// Requests sent back (chew, 13 Nov 2026; SOP 3.10): each withdrawn or rejected request once, with why, its bills and the
// total it will ask for when sent again; requests still with finance are not listed.
test('requests sent back: one each, with the reason, who, the bills and their total, newest request number first', async () => {
  const { sentBack } = await import('./utilityGrid.ts');
  const req = (id, no, status, extra = {}) => ({ id, no, status, month: '2026-11', ...extra });
  const bills = [
    bill({ request: req('r1', 'PRQ-2611-0003', 'REJECTED', { amount: 7100, reason: 'Wrong amount', decidedBy: 'Chew' }) }),
    bill({ unitId: 'u2', request: req('r1', 'PRQ-2611-0003', 'REJECTED', { amount: 4510, reason: 'Wrong amount', decidedBy: 'Chew' }) }),
    bill({ request: req('r2', 'PRQ-2611-0007', 'WITHDRAWN', { amount: 1500 }) }),
    bill({ request: req('r3', 'PRQ-2611-0009', 'SUBMITTED', { amount: 900 }) }),
    bill({}),
  ];
  const out = sentBack(bills);
  assert.deepEqual(out.map(g => g.no), ['PRQ-2611-0007', 'PRQ-2611-0003']);
  const r1 = out.find(g => g.id === 'r1');
  assert.equal(r1.status, 'REJECTED');
  assert.equal(r1.reason, 'Wrong amount');
  assert.equal(r1.decidedBy, 'Chew');
  assert.equal(r1.bills.length, 2);
  assert.equal(r1.amount, 11610);
  assert.equal(out.find(g => g.id === 'r2').reason, null);
});
