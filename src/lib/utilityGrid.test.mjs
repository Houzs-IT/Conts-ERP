// node --test src/lib/utilityGrid.test.mjs (npm test). The utility listing's rules (plan 2026-10-28-utility-listing.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billState, buildCells, months, unitAverages, unusual } from './utilityGrid.ts';

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
