// Owner report stage locks (chew, 11 Nov 2026; spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md):
// the rules that decide where a late change goes and what unlocking does, without the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockMonthProblem, openMonthAfter, planLate, planUnlock, carriedText, monthAfter, monthLabel, lateText, incomeLockable } from '../../functions/_lib/stageLocks.ts';

test('locks start from October 2026, and only for a month that has ended', () => {
  const today = '2026-11-11';
  assert.equal(lockMonthProblem('2026-09', today), 'Locks start from October 2026.');
  assert.equal(lockMonthProblem('2026-10', today), null);
  assert.equal(lockMonthProblem('2026-11', today), 'November 2026 has not ended yet.');
  assert.equal(lockMonthProblem('2027-01', today), 'January 2027 has not ended yet.');
  assert.equal(lockMonthProblem('2027-01', '2027-02-01'), null);
  assert.equal(lockMonthProblem('2026-13', today), 'Month must look like 2026-10.');
});

test('a fixed rent or master lease unit has no income to lock: the owner is paid the same whatever it earns', () => {
  assert.equal(incomeLockable('share'), true);
  assert.equal(incomeLockable('fixed_rent'), false);
  assert.equal(incomeLockable('none'), false);
});

test('next open month skips closed months and crosses the year', () => {
  assert.equal(monthAfter('2026-12'), '2027-01');
  assert.equal(openMonthAfter('2026-10', new Set()), '2026-11');
  assert.equal(openMonthAfter('2026-10', new Set(['2026-11', '2026-12'])), '2027-01');
});

test('month label and the lines the owner sees', () => {
  assert.equal(monthLabel('2026-10'), 'October 2026');
  assert.equal(lateText('Skyline D-49-03A', 'October 2026'), 'Late change to Skyline D-49-03A income for October 2026 (income locked)');
  assert.equal(carriedText(['November 2026']), 'Already settled on the November 2026 statement');
  assert.equal(carriedText(['November 2026', 'December 2026']), 'Already settled on the November 2026 and December 2026 statement');
});

test('late difference: insert, top up the open one, remove when back to zero, nothing under a sen', () => {
  assert.deepEqual(planLate(7500, [], '2026-11'), { kind: 'insert', month: '2026-11', amount: 7500 });
  assert.deepEqual(planLate(0.4, [], '2026-11'), { kind: 'none' });
  assert.deepEqual(planLate(9000, [{ id: 'a', month: '2026-11', amount: 7500, movable: true }], '2026-11'), { kind: 'update', id: 'a', amount: 9000 });
  assert.deepEqual(planLate(7500, [{ id: 'a', month: '2026-11', amount: 7500, movable: true }], '2026-11'), { kind: 'none' });
  assert.deepEqual(planLate(0, [{ id: 'a', month: '2026-11', amount: 7500, movable: true }], '2026-11'), { kind: 'remove', id: 'a' });
  assert.deepEqual(planLate(7500, [{ id: 'a', month: '2026-11', amount: 7500, movable: false }], '2026-12'), { kind: 'none' });
  assert.deepEqual(planLate(9000, [{ id: 'a', month: '2026-11', amount: 7500, movable: false }], '2026-12'), { kind: 'insert', month: '2026-12', amount: 1500 });
  assert.deepEqual(planLate(-2000, [], '2026-11'), { kind: 'insert', month: '2026-11', amount: -2000 });
});

test('unlock: open differences are withdrawn, final ones are balanced, a final month is refused', () => {
  assert.deepEqual(planUnlock([], false, 'October 2026'), { problem: null, remove: [], carried: null, regenerate: [] });
  assert.deepEqual(planUnlock([{ id: 'a', month: '2026-11', amount: 7500, movable: true }], false, 'October 2026'),
    { problem: null, remove: ['a'], carried: null, regenerate: [] });
  assert.deepEqual(planUnlock([{ id: 'a', month: '2026-11', amount: 7500, movable: false }, { id: 'b', month: '2026-12', amount: 500, movable: true }], false, 'October 2026'),
    { problem: null, remove: ['b'], carried: { amount: 7500, months: ['2026-11'] }, regenerate: [] });
  assert.equal(planUnlock([], true, 'October 2026').problem, 'The October 2026 statement is final. Unlock the final statement first.');
});

test('unlock names the draft statements that printed a withdrawn difference, to be generated again', () => {
  assert.deepEqual(planUnlock([
    { id: 'a', month: '2026-11', amount: 7500, movable: true, onDraft: true },
    { id: 'b', month: '2026-12', amount: 500, movable: true, onDraft: false },
    { id: 'c', month: '2026-11', amount: 100, movable: true, onDraft: true },
  ], false, 'October 2026'), { problem: null, remove: ['a', 'b', 'c'], carried: null, regenerate: ['2026-11'] });
});
