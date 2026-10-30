// node --test src/lib/yearlyReport.test.mjs (npm test). The yearly unit report's pivot (PLAN-yearly-report.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figures, pivot, rowTotal, BLOCKS, REPORT_RULES } from './yearlyReport.ts';
import { overallFigures } from './ownerOverall.ts';

const row = (o = {}) => ({ unitId: 'u1', month: '2026-01', contract: 'PS', revenue: 1_000_000, cleaning: 100_000, electricity: 50_000, water: 10_000,
  internet: 10_000, sewerage: 5_000, additional: 30_000, misc: 0, ownerPct: 80, ltGrr: 0, o2: 20_000, nights: 20, days: 31, cleanerCost: 60_000, ...o });
const months = ['2026-01', '2026-02', '2026-03'];

test('revenue, gross profit, payout and company equal the Overall unit report figures', () => {
  const r = row();
  const f = figures(r);
  const o = overallFigures({ ...r, utilities: 75_000 });
  assert.equal(f.revenue, r.revenue);
  assert.equal(f.gp, o.gp);
  assert.equal(f.payout, o.payout);
  assert.equal(f.company, o.gainLoss);
});

test('cleaning: what we earn is the owner charge less the cleaner cost', () => {
  const f = figures(row());
  assert.equal(f.cleanerCost, 60_000);
  assert.equal(f.cleaningOwner, 100_000);
  assert.equal(f.cleaningEarned, 40_000);
});

test('a fixed-rent unit is charged nothing for cleaning, so the company eats the cleaner cost', () => {
  const f = figures(row({ contract: 'LT', ownerPct: 0, ltGrr: 500_000 }));
  assert.equal(f.cleaningOwner, 0);
  assert.equal(f.cleaningEarned, -60_000);
  assert.equal(figures(row({ contract: 'LT', ownerPct: 0, ltGrr: 500_000 }), { ...REPORT_RULES, ltOwnerPaysCleaning: true }).cleaningOwner, 100_000);
});

test('owner payout can leave out the owner credits and charges', () => {
  const r = row();
  assert.equal(figures(r).payout - figures(r, { ...REPORT_RULES, ownerPayoutIncludesO2: false }).payout, 20_000);
});

test('pivot: months with no row are null, others fill in, totals add up across units', () => {
  const rows = [row({ month: '2026-01' }), row({ month: '2026-03', revenue: 200_000 }), row({ unitId: 'u2', month: '2026-01', revenue: 300_000 })];
  const grids = pivot(rows, months);
  const rev = grids.find(g => g.key === 'revenue');
  assert.deepEqual(rev.units.u1, [1_000_000, null, 200_000]);
  assert.deepEqual(rev.units.u2, [300_000, null, null]);
  assert.deepEqual(rev.totals, [1_300_000, null, 200_000]);
  assert.equal(rowTotal(rev.units.u1), 1_200_000);
  assert.equal(rowTotal([null, null]), null);
});

test('pivot: one grid per block, in the sheet order; rows outside the months are ignored', () => {
  const grids = pivot([row({ month: '2025-12' })], months);
  assert.deepEqual(grids.map(g => g.key), BLOCKS.map(b => b.key));
  assert.deepEqual(grids[0].units, {});
});

test('pivot: the difference block equals owner charge minus cleaner cost in every cell and total', () => {
  const rows = [row(), row({ unitId: 'u2', month: '2026-02', cleaning: 20_000, cleanerCost: 50_000 }), row({ unitId: 'u3', contract: 'LT', ownerPct: 0, ltGrr: 1 })];
  const by = Object.fromEntries(pivot(rows, months).map(g => [g.key, g]));
  for (const u of Object.keys(by.cleaningEarned.units)) {
    by.cleaningEarned.units[u].forEach((v, i) => assert.equal(v, v === null ? null : by.cleaningOwner.units[u][i] - by.cleanerCost.units[u][i]));
  }
  by.cleaningEarned.totals.forEach((v, i) => assert.equal(v, v === null ? null : by.cleaningOwner.totals[i] - by.cleanerCost.totals[i]));
});
