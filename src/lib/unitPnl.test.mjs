// node --test src/lib/unitPnl.test.mjs (npm test). The unit P&L report's rules (plan docs/superpowers/plans/2026-10-28-unit-pnl.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pnl, sumPnl, pctOfIncome, bracketMoney, spreadGuestPaid, checks, gaps } from './unitPnl.ts';
import { overallFigures } from './ownerOverall.ts';

const row = (o = {}) => ({ unitId: 'u1', month: '2026-09', contract: 'PS', guestPaid: 1_000_000, guestPaidMissing: false, gross: 850_000,
  cleaning: 100_000, electricity: 50_000, water: 10_000, internet: 10_000, sewerage: 0, other: 30_000, misc: 0,
  ownerPct: 80, ltGrr: 0, nights: 20, days: 30, ...o });

test('a profit-share unit: fees, operating profit, owner portion and what the company keeps', () => {
  const p = pnl(row());
  assert.equal(p.fees, 150_000);
  assert.equal(p.operating, 650_000);
  assert.equal(p.owner, 520_000);
  assert.equal(p.company, 130_000);
});
test('operating profit equals the statement GP (gross less deductions)', () => {
  const r = row(); const p = pnl(r);
  assert.equal(p.operating, r.gross - (r.cleaning + r.electricity + r.water + r.internet + r.sewerage + r.other + r.misc));
});
test('a fixed-rent unit whose rent is above its profit: the company keeps a loss', () => {
  const p = pnl(row({ contract: 'LT', ownerPct: 0, ltGrr: 800_000 }));
  assert.equal(p.owner, 800_000); assert.equal(p.company, -150_000);
});
test('lines add across units', () => {
  const t = sumPnl([pnl(row()), pnl(row({ unitId: 'u2' }))]);
  assert.equal(t.guestPaid, 2_000_000); assert.equal(t.company, 260_000);
});
test('percent of guest paid, empty with no income', () => {
  assert.equal(pctOfIncome(150_000, 1_000_000), 15);
  assert.equal(pctOfIncome(1, 3), 33.3);
  assert.equal(pctOfIncome(100, 0), null);
});
test('money in brackets when negative, a dash for zero', () => {
  assert.deepEqual(bracketMoney(-123456), { text: '(1,234.56)', negative: true });
  assert.deepEqual(bracketMoney(123456), { text: '1,234.56', negative: false });
  assert.deepEqual(bracketMoney(0), { text: '–', negative: false });
});
test('a stay across a month end is split by nights, and the parts add up', () => {
  const mar = spreadGuestPaid('2026-03-29', '2026-04-03', 50_001, '2026-03');
  const apr = spreadGuestPaid('2026-03-29', '2026-04-03', 50_001, '2026-04');
  assert.equal(mar, 30_001); assert.equal(apr, 20_000); assert.equal(mar + apr, 50_001);
  assert.equal(spreadGuestPaid('2026-03-29', '2026-04-03', 50_001, '2026-05'), 0);
});

const b = { u1: 'B1', u2: 'B1', u3: 'B1', u4: 'B2' };
const past = (v, extra = {}) => ['2026-06', '2026-07', '2026-08'].map(month => row({ month, electricity: v, ...extra }));
test('own past: a cost per night more than 50 % away from the previous three months', () => {
  const f = checks([...past(50_000), row({ electricity: 76_000 })], b, { lines: {} }).filter(x => x.rule === 'own_past' && x.line === 'electricity');
  assert.equal(f.length, 1); assert.equal(f[0].month, '2026-09');
  assert.equal(checks([...past(50_000), row({ electricity: 75_000 })], b, { lines: {} }).filter(x => x.rule === 'own_past' && x.line === 'electricity').length, 0);
});
test('same building: needs three units that month', () => {
  const three = [row(), row({ unitId: 'u2' }), row({ unitId: 'u3', electricity: 200_000 })];
  assert.equal(checks(three, b, { lines: {} }).filter(x => x.rule === 'building' && x.unitId === 'u3' && x.line === 'electricity').length, 1);
  assert.equal(checks(three.slice(1), b, { lines: {} }).filter(x => x.rule === 'building').length, 0);
});
test('limits are checked only when set', () => {
  assert.equal(checks([row()], b, { lines: {} }).filter(x => x.rule === 'limit').length, 0);
  const f = checks([row()], b, { lines: { cleaning: { pctMax: 5 }, electricity: { perNightMax: 1000 } }, marginMin: 70 }).filter(x => x.rule === 'limit');
  assert.deepEqual(f.map(x => x.line).sort(), ['cleaning', 'electricity', 'operating']);
});
test('no income or no nights: no per-night or percent flags', () => {
  const zero = row({ guestPaid: 0, gross: 0, nights: 0 });
  const f = checks([...past(50_000), { ...zero, electricity: 900_000 }], b, { lines: { electricity: { pctMax: 1, perNightMax: 1 } }, marginMin: 10 });
  assert.equal(f.filter(x => x.month === '2026-09').length, 0);
});
test('data gaps, each once', () => {
  const g = gaps([
    row({ cleaning: 0 }), row({ unitId: 'u2', electricity: 0 }), row({ unitId: 'u3', nights: 0, guestPaid: 0, gross: 0 }),
    row({ unitId: 'u4', guestPaidMissing: true }), row({ unitId: 'u5', gross: 1_100_000 }),
  ]);
  assert.deepEqual(g.map(x => `${x.unitId}:${x.kind}`).sort(), ['u1:no_cleaning', 'u2:no_electricity', 'u3:no_nights', 'u4:guest_paid_missing', 'u5:payout_above_guest_paid']);
});
test('the owner portion and company result agree with the Overall unit report', () => {
  for (const r of [row(), row({ contract: 'LT', ownerPct: 0, ltGrr: 800_000 }), row({ ltGrr: 900_000 }), row({ gross: 100_000, ownerPct: 85 })]) {
    const u = r.electricity + r.water + r.internet + r.sewerage;
    const f = overallFigures({ contract: r.contract, revenue: r.gross, cleaning: r.cleaning, utilities: u, additional: r.other, misc: r.misc,
      electricity: r.electricity, water: r.water, internet: r.internet, sewerage: r.sewerage, ownerPct: r.ownerPct, ltGrr: r.ltGrr, o2: 0, nights: r.nights, days: r.days });
    const p = pnl(r);
    assert.deepEqual([p.operating, p.owner, p.company], [f.gp, f.ownerBase, f.gainLoss]);
  }
});
