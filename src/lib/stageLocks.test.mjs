// Owner report stage locks (chew, 11 Nov 2026; spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md):
// the rules that decide where a late change goes and what unlocking does, without the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lockMonthProblem, openMonthAfter, planLate, planUnlock, carriedText, monthAfter, monthLabel, lateText, incomeLockable,
  lockable, splitLate, lockedText, rolledText, editedText, refusedText, movedO2Text, deductionChecks, o2Checks,
} from '../../functions/_lib/stageLocks.ts';

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
  assert.equal(lateText('income', 'Skyline D-49-03A', 'October 2026'), 'Late change to Skyline D-49-03A income for October 2026 (income locked)');
  assert.equal(lateText('deductions', 'Skyline D-49-03A', 'October 2026'), 'Late change to Skyline D-49-03A deductions for October 2026 (deductions locked)');
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

// Part 2a (plan docs/superpowers/plans/2026-11-11-owner-report-locks-part2a-deductions-o2.md): deductions and O2 locks.

test('who each step can lock: income and deductions on a share contract, O2 on any unit', () => {
  assert.equal(lockable('income', 'share'), true);
  assert.equal(lockable('income', 'fixed_rent'), false);
  assert.equal(lockable('deductions', 'share'), true);
  assert.equal(lockable('deductions', 'fixed_rent'), false);
  assert.equal(lockable('deductions', 'none'), false);
  assert.equal(lockable('o2', 'none'), true);
  assert.equal(lockable('o2', 'fixed_rent'), true);
});

test('a late difference is shared out between the locks: income first, then deductions (so a misc change from occupancy goes with income)', () => {
  const both = { statement: 75000, incomeLive: 82500, live: 81000 };
  assert.deepEqual(splitLate(both, { income: true, deductions: true }), { income: 7500, deductions: -1500 });
  assert.deepEqual(splitLate({ statement: 75000, live: 81000 }, { income: true, deductions: false }), { income: 6000 });
  assert.deepEqual(splitLate({ statement: 75000, live: 81000 }, { income: false, deductions: true }), { deductions: 6000 });
  assert.deepEqual(splitLate({ statement: 75000, live: 81000 }, { income: false, deductions: false }), {});
});

test('what people are told when a month is locked or final', () => {
  assert.equal(lockedText('income', 'Vista 22-04', 'October 2026'), 'October 2026 income is locked for Vista 22-04.');
  assert.equal(lockedText('deductions', 'Vista 22-04', 'October 2026'), 'October 2026 deductions are locked for Vista 22-04.');
  assert.equal(lockedText('o2', 'Vista 22-04', 'October 2026'), 'October 2026 O2 is locked for Vista 22-04.');
  assert.equal(rolledText('Vista 22-04', 'October 2026', 'November 2026', 'locked'),
    'October 2026 deductions are locked for Vista 22-04. This cost goes on the November 2026 statement.');
  assert.equal(rolledText('Vista 22-04', 'October 2026', 'December 2026', 'final'),
    'The October 2026 statement is final for Vista 22-04. This cost goes on the December 2026 statement.');
  assert.equal(editedText('Vista 22-04', 'October 2026'),
    'October 2026 deductions are locked for Vista 22-04. The October 2026 statement keeps the old amount; the difference goes to the next open month as an owner adjustment.');
  assert.equal(refusedText('deductions', 'Vista 22-04', 'October 2026'), 'October 2026 deductions are locked for Vista 22-04. Ask someone who can unlock a step to unlock them first.');
  assert.equal(refusedText('o2', 'Vista 22-04', 'October 2026'), 'October 2026 O2 is locked for Vista 22-04. Ask someone who can unlock a step to unlock it first.');
  assert.equal(movedO2Text('Vista 22-04', 'October 2026', 'November 2026'), 'October 2026 O2 is locked for Vista 22-04. This owner adjustment is dated November 2026.');
});

test('deductions: what to look at before locking', () => {
  assert.deepEqual(deductionChecks({ checkouts: 9, cleaning: 0, utilities: 0, contractEnd: null, monthEnd: '2026-10-31' }), ['9 check-outs, no cleaning charged']);
  assert.deepEqual(deductionChecks({ checkouts: 1, cleaning: 0, utilities: 0, contractEnd: null, monthEnd: '2026-10-31' }), ['1 check-out, no cleaning charged']);
  assert.deepEqual(deductionChecks({ checkouts: 1, cleaning: 6500, utilities: 31424, contractEnd: '2026-10-15', monthEnd: '2026-10-31' }), ['Contract ended 15 Oct: check the bills']);
  assert.deepEqual(deductionChecks({ checkouts: 0, cleaning: 0, utilities: 100, contractEnd: '2026-09-30', monthEnd: '2026-10-31' }), ['Contract ended 30 Sep: check the bills']);
  assert.deepEqual(deductionChecks({ checkouts: 0, cleaning: 0, utilities: 31424, contractEnd: '2026-11-15', monthEnd: '2026-10-31' }), []);
  assert.deepEqual(deductionChecks({ checkouts: 0, cleaning: 0, utilities: 0, contractEnd: '2026-10-15', monthEnd: '2026-10-31' }), []);
});

test('O2: what to look at before locking', () => {
  assert.deepEqual(o2Checks({ held: -354192, repeats: 1, prevMonth: 'September' }), ['Held debt RM 3,541.92 not released', 'Repeats one from September']);
  assert.deepEqual(o2Checks({ held: 0, repeats: 2, prevMonth: 'September' }), ['Repeats 2 from September']);
  assert.deepEqual(o2Checks({ held: 0, repeats: 0, prevMonth: 'September' }), []);
});
