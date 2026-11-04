import { describe, test, expect } from 'vitest';
import { groupByModel, groupByVariant, groupEarliestDate } from './mrp-model-pipeline';
import type { ModelGroup } from './mrp-model-pipeline';
import type { MrpLine, MrpSku } from '../../vendor/scm/lib/mrp-queries';

/* The three MRP date columns (Processing / SO / Delivery) read a Model row's
   EARLIEST line date on each basis. A Model can pool several SO lines, so the
   aggregation — not the per-line lookup — is the part worth pinning. */

const line = (d: Partial<MrpLine>): MrpLine => ({
  soItemId: 'si', soDocNo: 'HC-SO-1', debtorName: null, customerState: null,
  soDate: null, deliveryDate: null, processingDate: null, orderByDate: null,
  qty: 1, source: 'shortage', poNumber: null, poEta: null, shortageQty: 1,
  poSupplierId: null, poSupplierName: null,
  ...d,
});

const sku = (lines: MrpLine[]): MrpSku => ({
  warehouseId: null, warehouseCode: null, warehouseName: null,
  itemCode: 'X', variantKey: '', variantLabel: null, description: null, category: null,
  qtyNeeded: 0, stock: 0, poOutstanding: 0, shortage: 0,
  mainSupplierCode: null, mainSupplierName: null, suppliers: [], lines,
});

const group = (variants: MrpSku[]): ModelGroup => ({
  groupKey: 'g', warehouseId: null, warehouseCode: null, warehouseName: null,
  itemCode: 'X', description: null, category: null,
  variants, qtyNeeded: 0, stock: 0, poOutstanding: 0, shortage: 0,
});

describe('the table opens in delivery order (owner, 4 Nov 2026)', () => {
  const row = (itemCode: string, deliveryDate: string | null, shortage: number): MrpSku =>
    ({ ...sku([line({ deliveryDate })]), itemCode, shortage });

  test('earliest delivery first and undated last, whatever is short', () => {
    const skus = [row('C', null, 1), row('A', '2026-12-01', 1), row('B', '2026-11-13', 0)];
    expect(groupByModel(skus).map((g) => g.itemCode)).toEqual(['B', 'A', 'C']);
    expect(groupByVariant(skus).map((g) => g.itemCode)).toEqual(['B', 'A', 'C']);
  });

  test('within one delivery date the shortages stay on top', () => {
    const skus = [row('A', '2026-11-13', 0), row('B', '2026-11-13', 1)];
    expect(groupByModel(skus).map((g) => g.itemCode)).toEqual(['B', 'A']);
  });

  test('the drilldown lists its variants in delivery order', () => {
    const late = { ...row('X', '2026-12-01', 1), variantLabel: 'A late', variantKey: 'a' };
    const early = { ...row('X', '2026-11-13', 1), variantLabel: 'B early', variantKey: 'b' };
    expect(groupByModel([late, early])[0]!.variants.map((v) => v.variantLabel)).toEqual(['B early', 'A late']);
  });
});

describe('groupEarliestDate', () => {
  test('takes the earliest line date across the whole group', () => {
    const g = group([
      sku([line({ deliveryDate: '2026-09-20' }), line({ deliveryDate: '2026-09-14' })]),
      sku([line({ deliveryDate: '2026-09-17' })]),
    ]);
    expect(groupEarliestDate(g, 'delivery')).toBe('2026-09-14');
  });

  test('each basis reads its own date field', () => {
    const g = group([sku([line({
      soDate: '2026-01-05', processingDate: '2026-03-10', deliveryDate: '2026-06-30',
    })])]);
    expect(groupEarliestDate(g, 'soDate')).toBe('2026-01-05');
    expect(groupEarliestDate(g, 'processing')).toBe('2026-03-10');
    expect(groupEarliestDate(g, 'delivery')).toBe('2026-06-30');
  });

  test('null lines are skipped, not treated as earliest', () => {
    const g = group([sku([
      line({ processingDate: null }),
      line({ processingDate: '2026-09-18' }),
    ])]);
    expect(groupEarliestDate(g, 'processing')).toBe('2026-09-18');
  });

  test('returns null when no line carries that date (column renders a dash)', () => {
    const g = group([sku([line({ soDate: null }), line({ soDate: null })])]);
    expect(groupEarliestDate(g, 'soDate')).toBeNull();
  });
});
