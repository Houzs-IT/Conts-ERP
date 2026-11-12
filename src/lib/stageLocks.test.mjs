// Owner report stage locks (chew, 11 Nov 2026; spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md):
// the rules that decide where a late change goes and what unlocking does, without the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lockMonthProblem, openMonthAfter, planLate, planUnlock, carriedText, monthAfter, monthLabel, lateText, incomeLockable,
  lockable, splitLate, lockedText, rolledText, editedText, refusedText, movedO2Text, deductionChecks, o2Checks,
  companyFigure, companyCarriedText, incomeNoticeText, lateLabel, quietly,
  finalWaiting, waitingText, unlockFinalPlan, finalUnlockText,
} from '../../functions/_lib/stageLocks.ts';

// Part 3 (GP and final): Make final needs every step that lists one of the owner's units locked (spec goal 7), and
// Unlock final follows how far the payout has gone (spec calls 5 and 6, chew 11 Nov 2026 "可以").
test('nothing is waiting once every step that lists a unit is locked', () => {
  assert.deepEqual(finalWaiting([
    { unitId: 'a', label: 'S-22-04', steps: ['income', 'deductions', 'o2'], locked: ['o2', 'income', 'deductions'] },
    { unitId: 'b', label: 'D-48-09', steps: ['o2'], locked: ['o2'] },
  ]), []);
});

test('a unit waits on the steps not yet locked, in step order', () => {
  assert.deepEqual(finalWaiting([
    { unitId: 'a', label: 'B-16-05 (A)', steps: ['income', 'deductions', 'o2'], locked: ['income', 'deductions', 'o2'] },
    { unitId: 'b', label: 'B-16-05 (B)', steps: ['o2', 'income', 'deductions'], locked: ['deductions'] },
  ]), [{ unitId: 'b', label: 'B-16-05 (B)', stages: ['income', 'o2'] }]);
});

test('the waiting text names the steps for a one-unit owner and the units otherwise', () => {
  assert.equal(waitingText([{ label: 'A-20-05', stages: ['deductions', 'o2'] }], 1), 'Waiting: deductions, O2');
  assert.equal(waitingText([{ label: 'B-16-05 (B)', stages: ['o2'] }], 2), 'Waiting: B-16-05 (B) O2');
  assert.equal(waitingText([{ label: 'B-16-05 (B)', stages: ['income', 'o2'] }], 2), 'Waiting: B-16-05 (B) income and O2');
  assert.equal(waitingText([{ label: 'X', stages: ['income'] }, { label: 'Y', stages: ['o2'] }, { label: 'Z', stages: ['o2'] }], 5),
    'Waiting: X income, Y O2 and 1 more unit');
  assert.equal(waitingText([{ label: 'X', stages: ['income'] }, { label: 'Y', stages: ['o2'] }, { label: 'Z', stages: ['o2'] }, { label: 'W', stages: ['o2'] }], 5),
    'Waiting: X income, Y O2 and 2 more units');
});

test('unlocking a final statement follows its payout', () => {
  assert.deepEqual(unlockFinalPlan('finalised', null), { kind: 'draft', cancelPayout: null });
  assert.deepEqual(unlockFinalPlan('sent', null), { kind: 'draft', cancelPayout: null });
  assert.deepEqual(unlockFinalPlan('sent', { id: 'p1', state: 'pending' }), { kind: 'draft', cancelPayout: 'p1' });
  assert.deepEqual(unlockFinalPlan('sent', { id: 'p1', state: 'failed' }), { kind: 'draft', cancelPayout: 'p1' });
  assert.deepEqual(unlockFinalPlan('paid', { id: 'p1', state: 'paid' }), { kind: 'paid' });
  assert.deepEqual(unlockFinalPlan('sent', { id: 'p1', state: 'paid' }), { kind: 'paid' });
  const transferring = unlockFinalPlan('sent', { id: 'p1', state: 'processing' });
  assert.equal(transferring.kind, 'refused');
  assert.match(transferring.problem, /being transferred/);
  assert.equal(unlockFinalPlan('provisional', null).kind, 'refused');
});

test('a paid statement unlocked again names its change in the owner adjustment', () => {
  assert.equal(finalUnlockText('Skyline KL C27-01', 'October 2026'), 'Change to Skyline KL C27-01 for October 2026 after it was paid (statement unlocked)');
});

test('locks start from October 2026, and only for a month that has ended', () => {
  const today = '2026-11-11';
  assert.equal(lockMonthProblem('2026-09', today), 'Locks start from October 2026.');
  assert.equal(lockMonthProblem('2026-10', today), null);
  assert.equal(lockMonthProblem('2026-11', today), 'November 2026 has not ended yet.');
  assert.equal(lockMonthProblem('2027-01', today), 'January 2027 has not ended yet.');
  assert.equal(lockMonthProblem('2027-01', '2027-02-01'), null);
  assert.equal(lockMonthProblem('2026-13', today), 'Month must look like 2026-10.');
});

test('income is locked on a share only: a master lease has no statement, and GRR is no longer a contract type', () => {
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

// Part 2b (plan docs/superpowers/plans/2026-11-12-owner-report-locks-part2b-company-share.md).

test("the company's figure of a unit-month: what is left of the gross after the deductions and the owner", () => {
  assert.equal(companyFigure({ gross: 10000, deductions: 2000, payoutBeforeAdjustments: 6000 }), 2000);
  // An owner due more than the unit made (a guarantee): the company carries the loss.
  assert.equal(companyFigure({ gross: 120000, deductions: 30000, payoutBeforeAdjustments: 150000 }), -60000);
  // The company's share of a late change splits between the locks the same way the owner's does.
  const run = { statement: companyFigure({ gross: 100000, deductions: 10000, payoutBeforeAdjustments: 72000 }),
    incomeLive: companyFigure({ gross: 110000, deductions: 10000, payoutBeforeAdjustments: 80000 }),
    live: companyFigure({ gross: 110000, deductions: 11000, payoutBeforeAdjustments: 79200 }) };
  assert.deepEqual(splitLate(run, { income: true, deductions: true }), { income: 2000, deductions: -200 });
});

test("a yearly guarantee's true-up top-up is left out of the company's figure, as the reports leave it out (review finding)", () => {
  // 75% owner, the contract year's last month: the owner is topped up to the yearly guarantee (RM 5,000 due).
  const before = companyFigure({ gross: 100000, deductions: 10000, payoutBeforeAdjustments: 500000, topUp: 432500, yearlyGuarantee: true });
  assert.equal(before, 22500);
  // RM 100 more in that month after its lock: the top-up shrinks by the owner's RM 75, so the owner's payout does not
  // move; the company's share is RM 25, the same as the reports would show had the month not been locked.
  const after = companyFigure({ gross: 110000, deductions: 10000, payoutBeforeAdjustments: 500000, topUp: 425000, yearlyGuarantee: true });
  assert.equal(after - before, 2500);
  // A monthly guarantee's top-up is part of the owner base in the reports, so it stays in.
  assert.equal(companyFigure({ gross: 100000, deductions: 10000, payoutBeforeAdjustments: 80000, topUp: 12500 }), 10000);
});

test('a late change named by its month and step where the unit is already on screen (the company views)', () => {
  assert.equal(lateLabel('Late change to Vista Jaya One #A-12-03 income for October 2026 (income locked)'), 'October 2026 income');
  assert.equal(lateLabel(lateText('deductions', 'Skyline D-49-03A', 'October 2026')), 'October 2026 deductions');
  assert.equal(lateLabel('Already counted in November 2026'), 'Already counted in November 2026');
});

test('the balancing row an unlock leaves on the company side', () => {
  assert.equal(companyCarriedText(['November 2026']), 'Already counted in November 2026');
  assert.equal(companyCarriedText(['November 2026', 'December 2026']), 'Already counted in November 2026 and December 2026');
});

test('working out a notice after a saved change never turns that change into an error (review finding)', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    assert.equal(await quietly(async () => { throw new Error('the read failed'); }, null), null);
    assert.equal(await quietly(async () => 'October 2026 income is locked for Vista 22-04.', null), 'October 2026 income is locked for Vista 22-04.');
  } finally { console.error = quiet; }
});

test('what someone editing a reservation in an income-locked month is told', () => {
  assert.equal(incomeNoticeText('Vista 22-04', ['October 2026'], 'November 2026'),
    'October 2026 income is locked for Vista 22-04. The difference goes to November 2026.');
  assert.equal(incomeNoticeText('Vista 22-04', ['October 2026', 'November 2026'], null),
    'October 2026 and November 2026 income are locked for Vista 22-04. The difference goes to the next open month.');
  assert.equal(incomeNoticeText('Vista 22-04', ['October 2026'], null),
    'October 2026 income is locked for Vista 22-04. The difference goes to the next open month.');
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
