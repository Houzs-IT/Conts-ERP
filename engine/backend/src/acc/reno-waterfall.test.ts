// The renovation revenue waterfall (spec 2.3, plan Task 2). What is pinned:
//   • tiers fill in order SERVICE → (WORKS, LIGHTING) → BUILTIN → (FURNITURE, APPLIANCE, SOFT) → AIRBNB, each full
//     before the next starts; within a tier, in proportion to the lines' contract amounts, largest remainder;
//   • the spec's own example, to the sen;
//   • cumulative: the next invoice's delta continues where the last stopped; a lower cumulative gives back from the
//     last tier filled (SERVICE untouched);
//   • every target sums exactly to the cumulative (the invoice total is the law), including over-billing;
//   • a negative cumulative is refused.

import { describe, expect, test } from 'vitest';
import { TIERS, allocationDelta, waterfallTarget, type RevenueLine } from './reno-waterfall';

/* Spec 2.3: Service 2,000 / Fixture 9,000 (electrical 4,000, ceiling 5,000) / Carpentry 6,000 / Furniture 13,000. */
const LINES: RevenueLine[] = [
  { key: 'FURN', group: 'FURNITURE', subCategory: 'SOFA', amountSen: 1_300_000 },
  { key: 'ELEC', group: 'WORKS', subCategory: 'ELECTRICAL', amountSen: 400_000 },
  { key: 'BUILTIN', group: 'BUILTIN', subCategory: 'TV_CABINET', amountSen: 600_000 },
  { key: 'CEIL', group: 'WORKS', subCategory: 'CEILING', amountSen: 500_000 },
  { key: 'SERVICE', group: 'SERVICE', subCategory: null, amountSen: 200_000 },
];

const asObj = (m: Map<string, number>) => Object.fromEntries([...m.entries()].filter(([, v]) => v !== 0));
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('waterfallTarget', () => {
  test('the tier order', () => {
    expect(TIERS).toEqual([['SERVICE'], ['WORKS', 'LIGHTING'], ['BUILTIN'], ['FURNITURE', 'APPLIANCE', 'SOFT'], ['AIRBNB']]);
  });

  test('invoice 1 of RM 10,000: Service full, Fixture 8,000 split 4:5 by largest remainder', () => {
    const t = waterfallTarget(LINES, 1_000_000);
    expect(asObj(t)).toEqual({ SERVICE: 200_000, ELEC: 355_556, CEIL: 444_444 });
    /* Every line has a figure, zero included. */
    expect(t.get('BUILTIN')).toBe(0);
    expect(t.get('FURN')).toBe(0);
    expect(sum(t)).toBe(1_000_000);
  });

  test('RM 20,000 cumulative: Fixture and Carpentry full, Furniture 3,000', () => {
    expect(asObj(waterfallTarget(LINES, 2_000_000))).toEqual({
      SERVICE: 200_000, ELEC: 400_000, CEIL: 500_000, BUILTIN: 600_000, FURN: 300_000,
    });
  });

  test('the whole contract fills every line exactly; nothing billed fills nothing', () => {
    expect(asObj(waterfallTarget(LINES, 3_000_000))).toEqual({
      SERVICE: 200_000, ELEC: 400_000, CEIL: 500_000, BUILTIN: 600_000, FURN: 1_300_000,
    });
    expect(asObj(waterfallTarget(LINES, 0))).toEqual({});
  });

  test('every result sums exactly to the cumulative', () => {
    for (let c = 0; c <= 3_200_000; c += 77_777) expect(sum(waterfallTarget(LINES, c))).toBe(c);
    const odd: RevenueLine[] = [
      { key: 'a', group: 'WORKS', subCategory: null, amountSen: 1 },
      { key: 'b', group: 'LIGHTING', subCategory: null, amountSen: 1 },
      { key: 'c', group: 'WORKS', subCategory: null, amountSen: 1 },
    ];
    expect(asObj(waterfallTarget(odd, 2))).toEqual({ a: 1, b: 1 });
    expect(sum(waterfallTarget(odd, 2))).toBe(2);
  });

  test('over-billing puts the excess on the last tier', () => {
    const t = waterfallTarget(LINES, 3_100_000);
    expect(t.get('FURN')).toBe(1_400_000);
    expect(t.get('SERVICE')).toBe(200_000);
    expect(sum(t)).toBe(3_100_000);
  });

  test('a group outside the tiers comes after AIRBNB, and group case does not matter', () => {
    const lines: RevenueLine[] = [
      { key: 'x', group: 'CURTAIN', subCategory: null, amountSen: 100 },
      { key: 'air', group: 'airbnb', subCategory: null, amountSen: 100 },
      { key: 'svc', group: 'service', subCategory: null, amountSen: 100 },
    ];
    expect(asObj(waterfallTarget(lines, 150))).toEqual({ svc: 100, air: 50 });
    expect(asObj(waterfallTarget(lines, 250))).toEqual({ svc: 100, air: 100, x: 50 });
  });

  test('a negative cumulative is refused', () => {
    expect(() => waterfallTarget(LINES, -1)).toThrow();
  });
});

describe('allocationDelta', () => {
  test('the second invoice posts only what it adds', () => {
    const d = allocationDelta(waterfallTarget(LINES, 2_000_000), waterfallTarget(LINES, 1_000_000));
    expect(Object.fromEntries(d)).toEqual({ ELEC: 44_444, CEIL: 55_556, BUILTIN: 600_000, FURN: 300_000 });
  });

  test('a lower cumulative takes back from Fixture only; Service unchanged', () => {
    const before = waterfallTarget(LINES, 1_000_000);
    const after = waterfallTarget(LINES, 400_000);
    const d = allocationDelta(after, before);
    expect(Object.fromEntries(d)).toEqual({ ELEC: 88_889 - 355_556, CEIL: 111_111 - 444_444 });
    expect(d.has('SERVICE')).toBe(false);
    expect(sum(d)).toBe(-600_000);
  });

  test('a key only in what was already allocated is given back whole', () => {
    expect(Object.fromEntries(allocationDelta(new Map([['a', 5]]), new Map([['a', 5], ['gone', 7]])))).toEqual({ gone: -7 });
  });
});
