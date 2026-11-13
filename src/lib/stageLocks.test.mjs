// Owner report stage locks (chew, 11 Nov 2026; spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md):
// the rules that decide where a late change goes and what unlocking does, without the database. Since 13 Nov 2026
// (docs/superpowers/specs/2026-11-13-unit-report-click-locks-design.md) a month has six lock categories: Revenue (the
// income lock), Cleaning, Utilities, Add. ded., Misc and O2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lockMonthProblem, openMonthAfter, planLate, planUnlock, carriedText, monthAfter, monthLabel, lateText, incomeLockable,
  lockable, lockedText, rolledText, editedText, refusedText, movedO2Text, o2Checks,
  companyFigure, companyCarriedText, incomeNoticeText, lateLabel, quietly,
  finalWaiting, waitingText, unlockFinalPlan, finalUnlockText,
  STAGES, LATE_STAGES, COST_STAGES, STAGE_LABEL, stageName, costStageOf, lateShares, cleaningChecks, utilitiesChecks,
} from '../../functions/_lib/stageLocks.ts';

const SIX = ['income', 'cleaning', 'utilities', 'additional', 'misc', 'o2'];

test('six lock categories, in the order the Unit report shows them; the late update turns them live in this order', () => {
  assert.deepEqual(STAGES, SIX);
  assert.deepEqual(LATE_STAGES, ['income', 'cleaning', 'utilities', 'additional', 'misc']);
  assert.deepEqual([...COST_STAGES], ['cleaning', 'utilities', 'additional']);
  assert.deepEqual(SIX.map(s => STAGE_LABEL[s]), ['Revenue', 'Cleaning', 'Utilities', 'Add. ded.', 'Misc', 'O2']);
  assert.deepEqual(SIX.map(stageName), ['income', 'cleaning', 'utilities', 'other deductions', 'misc', 'O2']);
});

test("a cost's lock category follows the statement's own split (classifyCost)", () => {
  assert.equal(costStageOf('cleaning', null), 'cleaning');
  assert.equal(costStageOf('housekeeping', ''), 'cleaning');
  assert.equal(costStageOf('electricity', 'TNB Oct'), 'utilities');
  assert.equal(costStageOf('water', null), 'utilities');
  assert.equal(costStageOf('internet', null), 'utilities');
  assert.equal(costStageOf('sewerage', ''), 'utilities');
  assert.equal(costStageOf('utilities', 'Indah Water Oct'), 'utilities');
  assert.equal(costStageOf('utilities', 'IWK bill'), 'utilities');
  assert.equal(costStageOf('utilities', 'Lift repair'), 'additional');
  assert.equal(costStageOf('maintenance', 'Aircon service'), 'additional');
  assert.equal(costStageOf('repair', null), 'additional');
});

// Part 3 (GP and final): Make final needs every step that lists one of the owner's units locked (spec goal 7), and
// Unlock final follows how far the payout has gone (spec calls 5 and 6, chew 11 Nov 2026 "可以").
test('nothing is waiting once every category that lists a unit is locked', () => {
  assert.deepEqual(finalWaiting([
    { unitId: 'a', label: 'S-22-04', steps: SIX, locked: ['o2', 'misc', 'income', 'additional', 'utilities', 'cleaning'] },
    { unitId: 'b', label: 'D-48-09', steps: ['o2'], locked: ['o2'] },
  ]), []);
});

test('a unit waits on the categories not yet locked, in category order', () => {
  assert.deepEqual(finalWaiting([
    { unitId: 'a', label: 'B-16-05 (A)', steps: SIX, locked: SIX },
    { unitId: 'b', label: 'B-16-05 (B)', steps: ['o2', 'misc', 'income', 'cleaning', 'utilities', 'additional'], locked: ['cleaning', 'utilities', 'additional'] },
  ]), [{ unitId: 'b', label: 'B-16-05 (B)', stages: ['income', 'misc', 'o2'] }]);
});

test('the waiting text names the categories as the Unit report does, and the units for an owner with several', () => {
  assert.equal(waitingText(finalWaiting([{ unitId: 'u', label: 'A-1', steps: SIX, locked: ['income', 'cleaning', 'utilities', 'additional'] }]), 1), 'Waiting: Misc and O2');
  assert.equal(waitingText([{ label: 'B-16-05 (B)', stages: ['o2'] }], 2), 'Waiting: B-16-05 (B) O2');
  assert.equal(waitingText([{ label: 'B-16-05 (B)', stages: ['income', 'o2'] }], 2), 'Waiting: B-16-05 (B) Revenue and O2');
  assert.equal(waitingText([{ label: 'F-02', stages: ['income', 'additional', 'o2'] }], 2), 'Waiting: F-02 Revenue, Add. ded. and O2');
  assert.equal(waitingText([{ label: 'X', stages: ['income'] }, { label: 'Y', stages: ['o2'] }, { label: 'Z', stages: ['o2'] }], 5),
    'Waiting: X Revenue; Y O2; 1 more unit');
  assert.equal(waitingText([{ label: 'X', stages: ['income'] }, { label: 'Y', stages: ['o2'] }, { label: 'Z', stages: ['o2'] }, { label: 'W', stages: ['o2'] }], 5),
    'Waiting: X Revenue; Y O2; 2 more units');
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
  assert.equal(lateText('utilities', 'Skyline D-49-03A', 'October 2026'), 'Late change to Skyline D-49-03A utilities for October 2026 (utilities locked)');
  assert.equal(lateText('additional', 'Skyline D-49-03A', 'October 2026'), 'Late change to Skyline D-49-03A other deductions for October 2026 (other deductions locked)');
  assert.equal(lateText('misc', 'Skyline D-49-03A', 'October 2026'), 'Late change to Skyline D-49-03A misc for October 2026 (misc locked)');
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

test('who each category can lock: everything but O2 on a share contract only, O2 on any unit', () => {
  for (const s of ['income', 'cleaning', 'utilities', 'additional', 'misc']) {
    assert.equal(lockable(s, 'share'), true, s);
    assert.equal(lockable(s, 'fixed_rent'), false, s);
    assert.equal(lockable(s, 'none'), false, s);
  }
  assert.equal(lockable('o2', 'none'), true);
  assert.equal(lockable('o2', 'fixed_rent'), true);
});

// Part 2b (plan docs/superpowers/plans/2026-11-12-owner-report-locks-part2b-company-share.md).

test("the company's figure of a unit-month: what is left of the gross after the deductions and the owner", () => {
  assert.equal(companyFigure({ gross: 10000, deductions: 2000, payoutBeforeAdjustments: 6000 }), 2000);
  // An owner due more than the unit made (a guarantee): the company carries the loss.
  assert.equal(companyFigure({ gross: 120000, deductions: 30000, payoutBeforeAdjustments: 150000 }), -60000);
  // The company's share of a late change splits between the locks the same way the owner's does.
  const statement = companyFigure({ gross: 100000, deductions: 10000, payoutBeforeAdjustments: 72000 });
  const revenueLive = companyFigure({ gross: 110000, deductions: 10000, payoutBeforeAdjustments: 80000 });
  const utilitiesLive = companyFigure({ gross: 110000, deductions: 11000, payoutBeforeAdjustments: 79200 });
  assert.deepEqual(lateShares(statement, [revenueLive, utilitiesLive]), [2000, -200]);
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

test('a late change named by its month and category where the unit is already on screen (the company views)', () => {
  assert.equal(lateLabel('Late change to Vista Jaya One #A-12-03 income for October 2026 (income locked)'), 'October 2026 income');
  assert.equal(lateLabel(lateText('additional', 'Vista 22-04', 'October 2026')), 'October 2026 other deductions');
  assert.equal(lateLabel(lateText('cleaning', 'Vista 22-04', 'October 2026')), 'October 2026 cleaning');
  // The deductions lock's wording before 13 Nov 2026 still reads.
  assert.equal(lateLabel('Late change to Vista 22-04 deductions for October 2026 (deductions locked)'), 'October 2026 deductions');
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

test("a late difference is shared out between the locks in the late update's order: each run turns one more category live", () => {
  // Statement 1,000.00; revenue live +5.00; cleaning live no change; utilities live -6.00; other deductions no change; misc -1.00.
  assert.deepEqual(lateShares(100000, [100500, 100500, 99900, 99900, 99800]), [500, 0, -600, 0, -100]);
  assert.deepEqual(lateShares(75000, [81000]), [6000]);
  assert.deepEqual(lateShares(75000, []), []);
});

test('what people are told when a month is locked or final', () => {
  assert.equal(lockedText('income', 'Vista 22-04', 'October 2026'), 'October 2026 income is locked for Vista 22-04.');
  assert.equal(lockedText('cleaning', 'Vista 22-04', 'October 2026'), 'October 2026 cleaning is locked for Vista 22-04.');
  assert.equal(lockedText('utilities', 'Vista 22-04', 'October 2026'), 'October 2026 utilities are locked for Vista 22-04.');
  assert.equal(lockedText('additional', 'Vista 22-04', 'October 2026'), 'October 2026 other deductions are locked for Vista 22-04.');
  assert.equal(lockedText('misc', 'Vista 22-04', 'October 2026'), 'October 2026 misc is locked for Vista 22-04.');
  assert.equal(lockedText('o2', 'Vista 22-04', 'October 2026'), 'October 2026 O2 is locked for Vista 22-04.');
  assert.equal(rolledText('Vista 22-04', 'October 2026', 'November 2026', 'locked', 'utilities'),
    'October 2026 utilities are locked for Vista 22-04. This cost goes on the November 2026 statement.');
  assert.equal(rolledText('Vista 22-04', 'October 2026', 'November 2026', 'locked', 'cleaning'),
    'October 2026 cleaning is locked for Vista 22-04. This cost goes on the November 2026 statement.');
  assert.equal(rolledText('Vista 22-04', 'October 2026', 'December 2026', 'final', 'additional'),
    'The October 2026 statement is final for Vista 22-04. This cost goes on the December 2026 statement.');
  assert.equal(editedText('Vista 22-04', 'October 2026', 'additional'),
    'October 2026 other deductions are locked for Vista 22-04. The October 2026 statement keeps the old amount; the difference goes to the next open month as an owner adjustment.');
  assert.equal(refusedText('utilities', 'Vista 22-04', 'October 2026'), 'October 2026 utilities are locked for Vista 22-04. Ask someone who can unlock a step to unlock them first.');
  assert.equal(refusedText('cleaning', 'Vista 22-04', 'October 2026'), 'October 2026 cleaning is locked for Vista 22-04. Ask someone who can unlock a step to unlock it first.');
  assert.equal(refusedText('o2', 'Vista 22-04', 'October 2026'), 'October 2026 O2 is locked for Vista 22-04. Ask someone who can unlock a step to unlock it first.');
  assert.equal(movedO2Text('Vista 22-04', 'October 2026', 'November 2026'), 'October 2026 O2 is locked for Vista 22-04. This owner adjustment is dated November 2026.');
});

test('cleaning and utilities: what to look at before locking (a hint, never a block)', () => {
  assert.deepEqual(cleaningChecks({ checkouts: 9, cleaning: 0 }), ['9 check-outs, no cleaning charged']);
  assert.deepEqual(cleaningChecks({ checkouts: 1, cleaning: 0 }), ['1 check-out, no cleaning charged']);
  assert.deepEqual(cleaningChecks({ checkouts: 3, cleaning: 6500 }), []);
  assert.deepEqual(utilitiesChecks({ utilities: 31424, contractEnd: '2026-10-15', monthEnd: '2026-10-31' }), ['Contract ended 15 Oct: check the bills']);
  assert.deepEqual(utilitiesChecks({ utilities: 100, contractEnd: '2026-09-30', monthEnd: '2026-10-31' }), ['Contract ended 30 Sep: check the bills']);
  assert.deepEqual(utilitiesChecks({ utilities: 31424, contractEnd: '2026-11-15', monthEnd: '2026-10-31' }), []);
  assert.deepEqual(utilitiesChecks({ utilities: 0, contractEnd: '2026-10-15', monthEnd: '2026-10-31' }), []);
});

test('O2: what to look at before locking', () => {
  assert.deepEqual(o2Checks({ held: -354192, repeats: 1, prevMonth: 'September' }), ['Held debt RM 3,541.92 not released', 'Repeats one from September']);
  assert.deepEqual(o2Checks({ held: 0, repeats: 2, prevMonth: 'September' }), ['Repeats 2 from September']);
  assert.deepEqual(o2Checks({ held: 0, repeats: 0, prevMonth: 'September' }), []);
});
