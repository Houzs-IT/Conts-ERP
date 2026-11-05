import { test } from 'node:test';
import assert from 'node:assert/strict';

const { standingOf, monthCellsOf } = await import('./ygrrReport.ts');

const rowOf = (overrides) => ({
  unitId: 'unit-1', building: 'A', number: '1', owner: 'Owner', ownerPct: 70,
  annual: 1_200_000, due: 1_200_000, yearFrom: '2026-08', yearTo: '2027-07', topUp: 0,
  shares: [{ month: '2026-08', ownerShare: 150_000 }, { month: '2026-09', ownerShare: 60_000 }, { month: '2026-10', ownerShare: 100_000 }],
  ...overrides,
});

test('guaranteedPerMonthIsDueSpreadOverTheContractYear', () => {
  assert.equal(standingOf(rowOf()).guaranteedPerMonth, 100_000);
});

test('eachMonthCarriesTheGapToTargetSoFar', () => {
  assert.deepEqual(monthCellsOf(rowOf()).map(({ overTargetSoFar }) => overTargetSoFar), [50_000, 10_000, 10_000]);
});

test('lastMonthGapEqualsThePace', () => {
  const row = rowOf({ due: 1_000_001, shares: [{ month: '2026-08', ownerShare: 33_333 }, { month: '2026-09', ownerShare: 91_000 }] });
  assert.equal(monthCellsOf(row).at(-1).overTargetSoFar, standingOf(row).aheadBy);
});

test('contractEndingEarlyKeepsTheSameMonthlyGuarantee', () => {
  const row = rowOf({ due: 500_000, yearTo: '2026-12' });
  assert.equal(standingOf(row).monthsInYear, 5);
  assert.equal(standingOf(row).guaranteedPerMonth, 100_000);
});
