// node --test src/lib/laborCost.test.mjs. Labour cost of logged hours, functions/_lib/laborCostCalc.ts (Hookka's
// labor-day-cost). November 2026 has 25 working days (Mon to Sat; the 1st is a Sunday).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { rowCosts, byDepartment, workingDaysInMonth } = await import('../../functions/_lib/laborCostCalc.ts');

const person = { id: 'e1', payBasis: 'monthly', dailyRateSen: 0, workingHoursPerDay: 8, workingDaysPerMonth: 26, otMultiplier: 1.5, resignedAt: null };
const people = new Map([['e1', person], ['d1', { ...person, id: 'd1', payBasis: 'daily', dailyRateSen: 12_000 }]]);
const salary = () => 250_000; // RM 2,500: ordinary rate 2,500 / 25 / 8 = RM 12.50, overtime base 2,500 / 26 / 8
const rules = { sundayMultiplier: 2, holidayMultiplier: 3 };
const none = new Set();

test('working days in a month: Monday to Saturday less public holidays', () => {
  assert.equal(workingDaysInMonth('2026-11', none), 25);
  assert.equal(workingDaysInMonth('2026-11', new Set(['2026-11-09'])), 24);
});

test('an ordinary 8 hour day costs the ordinary rate', () => {
  const [c] = rowCosts([{ employeeId: 'e1', date: '2026-11-02', department: 'cleaning', hours: 8 }], people, salary, none, rules);
  assert.equal(Math.round(c), 10_000);
});

test('a 10 hour day split 6 / 4: overtime shared by hours, at the 26-day base times 1.5', () => {
  const rows = [
    { employeeId: 'e1', date: '2026-11-02', department: 'cleaning', hours: 6 },
    { employeeId: 'e1', date: '2026-11-02', department: 'maintenance', hours: 4 },
  ];
  const costs = rowCosts(rows, people, salary, none, rules);
  const otRate = 250_000 / 26 / 8 * 1.5;
  assert.ok(Math.abs(costs[0] - (6 * 0.8 * 1_250 + 6 * 0.2 * otRate)) < 1e-6);
  assert.ok(Math.abs(costs[0] + costs[1] - (8 * 1_250 + 2 * otRate)) < 1e-6);
  assert.deepEqual(byDepartment(rows, costs).map(d => [d.department, d.hours, d.workers]), [['cleaning', 6, 1], ['maintenance', 4, 1]]);
});

test('Sunday and public holiday hours all at the premium on the 26-day base', () => {
  const [sun] = rowCosts([{ employeeId: 'e1', date: '2026-11-08', department: 'cleaning', hours: 4 }], people, salary, none, rules);
  assert.ok(Math.abs(sun - 4 * (250_000 / 26 / 8) * 2) < 1e-6);
  const [ph] = rowCosts([{ employeeId: 'e1', date: '2026-11-09', department: 'cleaning', hours: 4 }], people, salary, new Set(['2026-11-09']), rules);
  assert.ok(Math.abs(ph - 4 * (250_000 / 26 / 8) * 3) < 1e-6);
});

test('daily paid: the day rate shared by hours; nothing after the last day', () => {
  const costs = rowCosts([
    { employeeId: 'd1', date: '2026-11-02', department: 'cleaning', hours: 3 },
    { employeeId: 'd1', date: '2026-11-02', department: 'maintenance', hours: 1 },
  ], people, salary, none, rules);
  assert.deepEqual(costs, [9_000, 3_000]);
  const gone = new Map([['e1', { ...person, resignedAt: '2026-11-01' }]]);
  assert.deepEqual(rowCosts([{ employeeId: 'e1', date: '2026-11-02', department: 'cleaning', hours: 8 }], gone, salary, none, rules), [0]);
});
