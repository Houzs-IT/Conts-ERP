// node --test src/lib/ownerOverall.test.mjs (npm test). Rows from the owner workbook's September 2026 overall report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overallFigures, overallTotals } from './ownerOverall.ts';

const row = (contract, revenue, cleaning, utilities, additional, misc, ownerPct, ltGrr, o2, nights = 0, days = 30) =>
  overallFigures({ contract, revenue, cleaning, utilities, additional, misc, ownerPct, ltGrr, o2, nights, days });

test('LT: owner base is the fixed rent, owner % unused', () => {
  // AGILE-C1313A
  const r = row('LT', 431413, 72000, 44705, 0, 0, 0, 500000, 0, 22);
  assert.equal(r.deductions, 116705);
  assert.equal(r.gp, 314708);
  assert.equal(r.o1, 0);
  assert.equal(r.ownerBase, 500000);
  assert.equal(r.payout, 500000);
  assert.equal(r.gainLoss, -185292);
  assert.equal(r.breakEven, 616705);
});

test('PS where O1 is above GRR: owner base is O1', () => {
  // SKYLINE-A2513
  const r = row('PS', 617807, 85800, 72643, 0, 0, 80, 310000, 0);
  assert.equal(r.gp, 459364);
  assert.equal(r.o1, 367491);
  assert.equal(r.ownerBase, 367491);
  assert.equal(r.payout, 367491);
  assert.equal(r.gainLoss, 91873);
});

test('PS where GRR is above O1: owner base is GRR', () => {
  // ARTE-MK20915
  const r = row('PS', 340953, 69800, 47545, 0, 7667, 80, 220000, 0);
  assert.equal(r.deductions, 125012);
  assert.equal(r.gp, 215941);
  assert.equal(r.o1, 172753);
  assert.equal(r.ownerBase, 220000);
  assert.equal(r.payout, 220000);
  assert.equal(r.gainLoss, -4059);
});

test('O2 changes the payout but not gain/loss', () => {
  // TRION-B1311
  const r = row('PS', 517726, 24000, 65375, 0, 0, 70, 250000, 65375);
  assert.equal(r.o1, 299846);
  assert.equal(r.ownerBase, 299846);
  assert.equal(r.payout, 365221);
  assert.equal(r.gainLoss, 128505);
});

test('nights, rev/night, margin, and empty months', () => {
  const r = row('PS', 600000, 100000, 0, 0, 0, 70, 0, 0, 15, 30);
  assert.equal(r.occupancy, 50);
  assert.equal(r.revPerNight, 40000);
  assert.equal(r.margin, (500000 / 600000) * 100);
  const vacant = row('LT', 0, 0, 18590, 0, 0, 0, 290000, 0, 0, 30);
  assert.equal(vacant.revPerNight, 0);
  assert.equal(vacant.margin, 0);
  assert.equal(vacant.gainLoss, -308590);
});

test('totals add up and weight occupancy by nights', () => {
  const a = row('PS', 100000, 0, 0, 0, 0, 50, 0, 1000, 30, 30);
  const b = row('LT', 0, 0, 5000, 0, 0, 0, 20000, 0, 0, 30);
  const t = overallTotals([a, b]);
  assert.equal(t.revenue, 100000);
  assert.equal(t.payout, 50000 + 1000 + 20000);
  assert.equal(t.gainLoss, 50000 - 25000);
  assert.equal(t.losing, 1);
  assert.equal(t.occupancy, 50);
  assert.equal(overallTotals([]).occupancy, 0);
});
