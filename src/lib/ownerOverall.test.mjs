// node --test src/lib/ownerOverall.test.mjs (npm test). Rows from the owner workbook's September 2026 overall report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overallFigures, overallTotals } from './ownerOverall.ts';

const row = (contract, revenue, cleaning, utilities, additional, misc, ownerPct, ltGrr, o2, nights = 0, days = 30) =>
  overallFigures({ contract, revenue, cleaning, utilities, additional, misc, ownerPct, ltGrr, o2, nights, days });

// Part 3 (spec call 12): Gain / Loss splits into Agent and Company. Agent = GP x the contract's agent % on a share, even
// under a guarantee top-up (the owner workbook's A PAYOUT); 0 on LT; never below 0 (ruling: an agent shares profit, not a
// loss). Company = Gain / Loss - Agent, so the two always add up.
const fig = (contract, revenue, deductions, ownerPct, agentPct, ltGrr) =>
  overallFigures({ contract, revenue, cleaning: deductions, utilities: 0, additional: 0, misc: 0, electricity: 0, water: 0, internet: 0, sewerage: 0, ownerPct, agentPct, ltGrr, o2: 0, nights: 0, days: 31 });

test('agent is GP x agent % on a share, even under a guarantee top-up', () => {
  // ARTE-MK20915, October 2026: GP 1,889.39, owner 80%, GRR 2,200, agent 10% (A PAYOUT 188.94)
  const r = fig('PS', 335886, 146947, 80, 10, 220000);
  assert.equal(r.gp, 188939);
  assert.equal(r.gainLoss, -31061);
  assert.equal(r.agent, 18894);
  assert.equal(r.company, -49955);
});

test('agent is 0 on LT whatever its agent %', () => {
  const r = fig('LT', 431413, 116705, 0, 10, 500000);
  assert.equal(r.agent, 0);
  assert.equal(r.company, r.gainLoss);
});

test('agent and company on a negative GP', () => {
  const r = fig('PS', 10000, 20000, 80, 10, 0);
  assert.equal(r.gp, -10000);
  assert.equal(r.agent, 0);
  assert.equal(r.company, -10000);
  assert.equal(r.agent + r.company, r.gainLoss);
});

test('agent and company add up across units', () => {
  const t = overallTotals([fig('PS', 335886, 146947, 80, 10, 220000), fig('PS', 300000, 0, 70, 10, 0)]);
  assert.equal(t.agent, 18894 + 30000);
  assert.equal(t.agent + t.company, t.gainLoss);
});

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

test("the company's share of a late change from a locked month counts in gain/loss, not in GP or the payout (part 2b, choice A)", () => {
  const base = { contract: 'PS', revenue: 600000, cleaning: 100000, utilities: 0, additional: 0, misc: 0, electricity: 0, water: 0, internet: 0, sewerage: 0,
    ownerPct: 75, ltGrr: 0, o2: 7500, nights: 10, days: 30 };
  const a = overallFigures(base), b = overallFigures({ ...base, late: 2500 });
  assert.equal(a.late, 0);
  assert.equal(b.late, 2500);
  assert.equal(b.gainLoss - a.gainLoss, 2500);
  assert.equal(b.gp, a.gp);
  assert.equal(b.payout, a.payout);
  assert.equal(overallTotals([a, b]).late, 2500);
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
