import { describe, expect, test } from 'vitest';
import {
  docTotals,
  formatMeasure,
  formatRm,
  instalmentPctError,
  instalmentPreview,
  lineAmounts,
  lineCostSen,
  nextInstalmentAmount,
  parseMeasureMilli,
  poInstalmentAmounts,
  qtyLabel,
  roundDiv,
  soMirrorRow,
  type MoneyLine,
} from './renovation-money';

const line = (p: Partial<MoneyLine>): MoneyLine => ({
  kind: 'ITEM', qty: 1, measureMilli: null, measureUom: null, uom: 'UNIT',
  unitPriceSen: 0, discountBp: 0, amountOverrideSen: null, isFoc: false, ...p,
});
const RM = (n: number) => Math.round(n * 100);

describe('rounding and measures', () => {
  test('roundDiv rounds half away from zero', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(268646.4 * 10, 10)).toBe(268646);
  });

  test('parseMeasureMilli keeps three decimals exactly', () => {
    expect(parseMeasureMilli('42.6')).toBe(42600);
    expect(parseMeasureMilli('10.38')).toBe(10380);
    expect(parseMeasureMilli(' 20 ')).toBe(20000);
    expect(parseMeasureMilli('0.001')).toBe(1);
    expect(parseMeasureMilli('')).toBeNull();
    expect(parseMeasureMilli(null)).toBeNull();
    expect(parseMeasureMilli('1.2345')).toBeNaN();
    expect(parseMeasureMilli('-3')).toBeNaN();
    expect(parseMeasureMilli('3ft')).toBeNaN();
  });

  test('formatMeasure trims trailing zeros', () => {
    expect(formatMeasure(42600)).toBe('42.6');
    expect(formatMeasure(20000)).toBe('20');
    expect(formatMeasure(10380)).toBe('10.38');
  });

  test('formatRm', () => {
    expect(formatRm(14910000)).toBe('149,100.00');
    expect(formatRm(-4000)).toBe('-40.00');
    expect(formatRm(605750, { trimZeros: true })).toBe('6,057.50');
    expect(formatRm(1141800, { trimZeros: true, grouping: false })).toBe('11418');
  });
});

describe('line amounts', () => {
  test('qty x rate', () => {
    expect(lineAmounts(line({ qty: 4, unitPriceSen: RM(90) }))).toMatchObject({ baseSen: RM(360), netSen: RM(360), discountSen: 0 });
  });

  test('measure x rate wins over qty (20FT @ 15 = 300)', () => {
    expect(lineAmounts(line({ qty: 1, measureMilli: 20000, measureUom: 'FT', unitPriceSen: RM(15) })).netSen).toBe(RM(300));
    expect(lineAmounts(line({ qty: 9, measureMilli: 42600, measureUom: 'FT', unitPriceSen: RM(35) })).netSen).toBe(RM(1491));
  });

  test('line discount rounds per line to the sen (D\'Clover wall cabinet)', () => {
    const a = lineAmounts(line({ unitPriceSen: RM(4477.44), discountBp: 4000 }));
    expect(a.baseSen).toBe(447744);
    expect(a.netSen).toBe(268646); // 2686.464 -> 2686.46
    expect(a.discountSen).toBe(447744 - 268646);
  });

  test('FOC charges nothing but keeps its list amount', () => {
    expect(lineAmounts(line({ unitPriceSen: RM(550), isFoc: true }))).toMatchObject({ baseSen: RM(550), netSen: 0, discountSen: RM(550) });
  });

  test('typed override replaces the net and is flagged; an equal override is not', () => {
    const a = lineAmounts(line({ measureMilli: 42600, measureUom: 'FT', unitPriceSen: RM(35), amountOverrideSen: RM(1065) }));
    expect(a).toMatchObject({ baseSen: RM(1491), netSen: RM(1065), overridden: true });
    expect(lineAmounts(line({ unitPriceSen: RM(10), amountOverrideSen: RM(10) })).overridden).toBe(false);
  });

  test('waived line is a negative rate', () => {
    expect(lineAmounts(line({ unitPriceSen: RM(-550) })).netSen).toBe(RM(-550));
  });

  test('DETAIL and TEXT lines are never priced', () => {
    expect(lineAmounts(line({ kind: 'DETAIL', unitPriceSen: RM(100) }))).toMatchObject({ netSen: 0, priced: false });
    expect(lineAmounts(line({ kind: 'TEXT', unitPriceSen: RM(100) })).netSen).toBe(0);
  });
});

describe('line cost', () => {
  test('qty x cost, measure x cost, nothing for description lines', () => {
    expect(lineCostSen({ kind: 'ITEM', qty: 3, measureMilli: null, unitCostSen: 1000 })).toBe(3000);
    expect(lineCostSen({ kind: 'CHILD', qty: 1, measureMilli: 42600, unitCostSen: 2000 })).toBe(85200);
    expect(lineCostSen({ kind: 'DETAIL', qty: 1, measureMilli: null, unitCostSen: 1000 })).toBe(0);
  });
});

describe('SO mirror row', () => {
  const invariant = (r: { qty: number; unit_price_sen: number; discount_sen: number; total_sen: number }) =>
    expect(r.qty * r.unit_price_sen - r.discount_sen).toBe(r.total_sen);

  test('plain line', () => {
    const r = soMirrorRow(line({ qty: 3, unitPriceSen: RM(90) }));
    expect(r).toMatchObject({ qty: 3, unit_price_sen: RM(90), discount_sen: 0, total_sen: RM(270), description2: null });
    invariant(r);
  });

  test('measured line becomes qty 1 at the computed amount with a description', () => {
    const r = soMirrorRow(line({ measureMilli: 42600, measureUom: 'FT', unitPriceSen: RM(35) }));
    expect(r).toMatchObject({ qty: 1, unit_price_sen: RM(1491), total_sen: RM(1491), description2: '42.6 FT @ RM35.00', uom: 'FT' });
    invariant(r);
  });

  test('discounted, FOC, override and waived lines keep the invariant', () => {
    for (const l of [
      line({ qty: 2, unitPriceSen: RM(522), discountBp: 4000 }),
      line({ qty: 1, unitPriceSen: RM(550), isFoc: true }),
      line({ measureMilli: 42600, measureUom: 'FT', unitPriceSen: RM(35), amountOverrideSen: RM(1065) }),
      line({ qty: 1, unitPriceSen: RM(-550) }),
      line({ qty: 1, unitPriceSen: RM(100), amountOverrideSen: RM(120) }),
    ]) invariant(soMirrorRow(l));
  });

  test('a line inside a lump-sum section carries no price', () => {
    expect(soMirrorRow(line({ qty: 1, unitPriceSen: RM(900) }), { inLumpSum: true })).toMatchObject({ unit_price_sen: 0, total_sen: 0, discount_sen: 0 });
  });
});

describe('qty labels for print', () => {
  test.each([
    [{ qty: 1, measureMilli: 42600, measureUom: 'FT' }, '42.6FT'],
    [{ qty: 1, measureMilli: 20000, measureUom: 'FT' }, '20FT'],
    [{ qty: 1, measureMilli: null, measureUom: null, uom: 'LOT' }, 'LS'],
    [{ qty: 1, measureMilli: null, measureUom: null, uom: 'SET' }, '1 SET'],
    [{ qty: 1, measureMilli: null, measureUom: null, uom: 'FULL' }, 'FULL UNIT'],
    [{ qty: 27, measureMilli: null, measureUom: null, uom: 'POINT' }, '27'],
  ])('%o -> %s', (l, label) => expect(qtyLabel(l as never)).toBe(label));
});

describe('document totals', () => {
  test('list, net, document discount, final', () => {
    const t = docTotals([
      { lumpSumSen: null, lines: [line({ unitPriceSen: RM(1935), discountBp: 4000 }), line({ unitPriceSen: RM(150), discountBp: 4000 }), line({ kind: 'DETAIL' })] },
      { lumpSumSen: RM(3231), lines: [line({ unitPriceSen: RM(999) })] },
    ], RM(100));
    expect(t.listSen).toBe(RM(1935 + 150 + 3231));
    expect(t.netSen).toBe(RM(1161 + 90 + 3231));
    expect(t.finalSen).toBe(RM(1161 + 90 + 3231 - 100));
    expect(t.totalDiscountSen).toBe(t.listSen - t.finalSen);
  });

  test('counts overridden lines for the on-screen flag', () => {
    expect(docTotals([{ lumpSumSen: null, lines: [line({ unitPriceSen: 100, amountOverrideSen: 90 })] }]).overriddenLines).toBe(1);
  });
});

describe('progress billing', () => {
  const sched = [{ seq: 1, pctBp: 1500 }, { seq: 2, pctBp: 5000 }, { seq: 3, pctBp: 3000 }, { seq: 4, pctBp: 500 }];

  test('100k on 15/50/30/5 with VO +10k after #2: #3 = 39,500 and #4 = 5,500', () => {
    const n1 = nextInstalmentAmount({ instalments: sched, seq: 1, revisedContractSen: RM(100000), billedSen: 0 });
    expect(n1.amountSen).toBe(RM(15000));
    const n2 = nextInstalmentAmount({ instalments: sched, seq: 2, revisedContractSen: RM(100000), billedSen: RM(15000) });
    expect(n2.amountSen).toBe(RM(50000));
    const n3 = nextInstalmentAmount({ instalments: sched, seq: 3, revisedContractSen: RM(110000), billedSen: RM(65000) });
    expect(n3).toMatchObject({ amountSen: RM(39500), cumBp: 9500, isLast: false });
    const n4 = nextInstalmentAmount({ instalments: sched, seq: 4, revisedContractSen: RM(110000), billedSen: RM(104500) });
    expect(n4).toMatchObject({ amountSen: RM(5500), isLast: true });
  });

  test('VO -20k after #3 makes #4 a credit note of 15,000', () => {
    const n3 = nextInstalmentAmount({ instalments: sched, seq: 3, revisedContractSen: RM(100000), billedSen: RM(65000) });
    expect(n3.amountSen).toBe(RM(30000));
    const n4 = nextInstalmentAmount({ instalments: sched, seq: 4, revisedContractSen: RM(80000), billedSen: RM(95000) });
    expect(n4.amountSen).toBe(RM(-15000));
  });

  test('last instalment absorbs rounding', () => {
    const thirds = [{ seq: 1, pctBp: 3333 }, { seq: 2, pctBp: 3333 }, { seq: 3, pctBp: 3334 }];
    const p = instalmentPreview(thirds, 100001, new Map());
    expect(p.map((r) => r.amountSen).reduce((a, b) => a + b, 0)).toBe(100001);
  });

  test('preview keeps billed amounts and spreads the rest', () => {
    const p = instalmentPreview(sched, RM(110000), new Map([[1, RM(15000)], [2, RM(50000)]]));
    expect(p.map((r) => r.amountSen)).toEqual([RM(15000), RM(50000), RM(39500), RM(5500)]);
  });

  test('schedules must add up to 100%', () => {
    expect(instalmentPctError(sched)).toBeNull();
    expect(instalmentPctError([{ seq: 1, pctBp: 3000 }])).toMatch(/30%/);
    expect(instalmentPctError([])).toMatch(/at least one/);
    expect(instalmentPctError([{ seq: 1, pctBp: 5000 }, { seq: 1, pctBp: 5000 }])).toMatch(/share/);
  });

  test('unknown seq throws', () => {
    expect(() => nextInstalmentAmount({ instalments: sched, seq: 9, revisedContractSen: 1, billedSen: 0 })).toThrow();
  });
});

describe('PO instalments', () => {
  test('30/65/5 of 1,000.01 adds back to the total', () => {
    const a = poInstalmentAmounts([3000, 6500, 500], 100001);
    expect(a).toEqual([30000, 65001, 5000]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(100001);
  });
});
