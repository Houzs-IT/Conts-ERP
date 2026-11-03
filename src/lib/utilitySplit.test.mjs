// node --test src/lib/utilitySplit.test.mjs (npm test). A bill whose printed period crosses a contract's start or end is
// split by days (FINANCE-SOP §3.10; plan 2026-11-02-utility-bill-scan Task 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractSplit, daysBetween } from './utilitySplit.ts';

const C = (startsOn, endsOn = null, ownerId = 'O1') => ({ startsOn, endsOn, ownerId });

test('days count both ends', () => {
  assert.equal(daysBetween('2026-08-15', '2026-09-14'), 31);
  assert.equal(daysBetween('2026-09-01', '2026-09-01'), 1);
});
test('the SOP example: RM 310, 15 Aug-14 Sep, contract from 11 Sep -> RM 270 owner alone, RM 40 shared', () =>
  assert.deepEqual(contractSplit({ from: '2026-08-15', to: '2026-09-14' }, 31000, [C('2026-09-11')]),
    { kind: 'split', ownerId: 'O1', insideSen: 4000, outsideSen: 27000, insideDays: 4, outsideDays: 27, totalDays: 31 }));
test('a contract ending mid-period: the days after it are the owner\'s alone', () => {
  const r = contractSplit({ from: '2026-09-01', to: '2026-09-30' }, 30000, [C('2025-01-01', '2026-09-20')]);
  assert.equal(r.kind, 'split');
  assert.deepEqual([r.insideDays, r.outsideDays, r.insideSen, r.outsideSen], [20, 10, 20000, 10000]);
});
test('a period wholly inside the contract, or with no contract at all, is not split', () => {
  assert.deepEqual(contractSplit({ from: '2026-09-01', to: '2026-09-30' }, 30000, [C('2026-01-01')]), { kind: 'none' });
  assert.deepEqual(contractSplit({ from: '2026-09-01', to: '2026-09-30' }, 30000, []), { kind: 'none' });
});
test('a period wholly before the contract is all the owner\'s', () => {
  const r = contractSplit({ from: '2026-08-01', to: '2026-08-31' }, 9000, [C('2026-09-11')]);
  assert.deepEqual([r.kind, r.insideSen, r.outsideSen, r.insideDays], ['split', 0, 9000, 0]);
});
test("a period wholly after the last contract ended is all the owner's, with that contract's owner", () => {
  const r = contractSplit({ from: '2026-10-01', to: '2026-10-31' }, 9000, [C('2025-01-01', '2026-09-20', 'O7')]);
  assert.deepEqual([r.kind, r.ownerId, r.insideSen, r.outsideSen], ['split', 'O7', 0, 9000]);
});
test('two contracts touching the period are left to split by hand', () =>
  assert.deepEqual(contractSplit({ from: '2026-09-01', to: '2026-09-30' }, 30000, [C('2025-01-01', '2026-09-10', 'O1'), C('2026-09-11', null, 'O2')]), { kind: 'two-contracts' }));
test('rounding: the owner-alone part is rounded, the shared part is the rest', () => {
  const r = contractSplit({ from: '2026-09-01', to: '2026-09-03' }, 10000, [C('2026-09-02')]);
  assert.deepEqual([r.outsideSen, r.insideSen], [3333, 6667]);
});
test('no period or a reversed one is not split', () => {
  assert.deepEqual(contractSplit({ from: null, to: '2026-09-30' }, 1000, [C('2026-09-11')]), { kind: 'none' });
  assert.deepEqual(contractSplit({ from: '2026-09-30', to: '2026-09-01' }, 1000, [C('2026-09-11')]), { kind: 'none' });
});
