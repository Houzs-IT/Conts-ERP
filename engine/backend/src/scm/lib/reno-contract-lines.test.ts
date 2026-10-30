/* A renovation contract's revenue lines (plan 2026-10-30-renovation-revenue-ledger.md Task 5). Pinned: the group and
   sub-category come from the product (ACTIVE first), a lump sum is spread over the lines inside its section by their
   nominal amounts, the header discount lowers every line in proportion, billing rows and cancelled rows are left out,
   and the lines always sum to the contract. */

import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from './fake-postgrest';
import { contractRevenueLines, spreadByWeight } from './reno-contract-lines';

const SO = '2990-SO-2611-001';
const item = (id: string, code: string, total: number, over: Row = {}): Row => ({
  id, doc_no: SO, company_id: 2, item_code: code, total_sen: total, cancelled: false, line_no: Number(id.replace(/\D/g, '')) || 0, ...over,
});
const product = (code: string, group: string, sub: string | null, status = 'ACTIVE'): Row => ({ company_id: 2, code, category_group: group, sub_category: sub, status });

describe('contract revenue lines', () => {
  test('lines carry their product group and sub-category; billing and cancelled rows are left out', async () => {
    const sb = fakeSb({
      mfg_sales_order_items: [
        item('i1', 'RN-ELEC', 400_000), item('i2', 'RN-CEIL', 500_000), item('i3', 'RN-OLD', 90_000, { cancelled: true }),
        item('i4', 'RENO-CREDIT', -50_000), item('i5', 'RENO-PROGRESS', 10_000),
      ],
      mfg_products: [product('RN-ELEC', 'WORKS', 'ELECTRICAL', 'INACTIVE'), product('RN-ELEC', 'WORKS', 'ELEC'), product('RN-CEIL', 'WORKS', 'CEILING')],
    });
    expect(await contractRevenueLines(sb, SO, 2)).toEqual([
      { key: 'i1', itemCode: 'RN-ELEC', group: 'WORKS', subCategory: 'ELEC', amountSen: 400_000 },
      { key: 'i2', itemCode: 'RN-CEIL', group: 'WORKS', subCategory: 'CEILING', amountSen: 500_000 },
    ]);
  });

  test('a lump sum is spread over the lines inside it', async () => {
    const sb = fakeSb({
      mfg_sales_order_items: [item('i1', 'RENO-ADJUST', 1_000_000), item('i2', 'RN-WALL', 0), item('i3', 'RN-FLOOR', 0), item('i4', 'RN-TV', 300_000)],
      mfg_products: [product('RN-WALL', 'WORKS', 'WALL'), product('RN-FLOOR', 'WORKS', 'FLOOR'), product('RN-TV', 'BUILTIN', 'TV_CABINET')],
      reno_doc_sections: [{ id: 's1', so_doc_no: SO, so_item_id: 'i1' }],
      reno_doc_lines: [
        { section_id: 's1', so_item_id: 'i2', qty: 1, measure: null, unit_price_sen: 100_000, amount_override_sen: null, is_foc: false },
        { section_id: 's1', so_item_id: 'i3', qty: 1, measure: '20.000', unit_price_sen: 10_000, amount_override_sen: null, is_foc: false },
      ],
    });
    const lines = await contractRevenueLines(sb, SO, 2);
    /* Nominal 100,000 and 200,000 (20 ft × 100.00): the lump sum goes 1:2. */
    expect(lines.map((l) => [l.key, l.amountSen])).toEqual([['i2', 333_333], ['i3', 666_667], ['i4', 300_000]]);
    expect(lines.reduce((s, l) => s + l.amountSen, 0)).toBe(1_300_000);
  });

  test('a lump sum over unpriced lines is shared equally', async () => {
    const sb = fakeSb({
      mfg_sales_order_items: [item('i1', 'RENO-ADJUST', 100_001), item('i2', 'RN-WALL', 0), item('i3', 'RN-FLOOR', 0)],
      mfg_products: [product('RN-WALL', 'WORKS', 'WALL'), product('RN-FLOOR', 'WORKS', 'FLOOR')],
      reno_doc_sections: [{ id: 's1', so_doc_no: SO, so_item_id: 'i1' }],
      reno_doc_lines: [
        { section_id: 's1', so_item_id: 'i2', qty: 1, measure: null, unit_price_sen: 0, amount_override_sen: null, is_foc: false },
        { section_id: 's1', so_item_id: 'i3', qty: 1, measure: null, unit_price_sen: 0, amount_override_sen: null, is_foc: false },
      ],
    });
    expect((await contractRevenueLines(sb, SO, 2)).map((l) => l.amountSen)).toEqual([50_001, 50_000]);
  });

  test('the header discount lowers every line in proportion', async () => {
    const sb = fakeSb({
      mfg_sales_order_items: [item('i1', 'RN-SVC', 200_000), item('i2', 'RN-ELEC', 400_000), item('i3', 'RN-TV', 400_000), item('i4', 'RENO-DISCOUNT', -100_000)],
      mfg_products: [product('RN-SVC', 'SERVICE', 'DESIGN'), product('RN-ELEC', 'WORKS', 'ELEC'), product('RN-TV', 'BUILTIN', 'TV_CABINET')],
    });
    const lines = await contractRevenueLines(sb, SO, 2);
    expect(lines.map((l) => [l.group, l.amountSen])).toEqual([['SERVICE', 180_000], ['WORKS', 360_000], ['BUILTIN', 360_000]]);
  });

  test('a product with no group comes back with an empty group, for the caller to refuse by name', async () => {
    const sb = fakeSb({ mfg_sales_order_items: [item('i1', 'RN-MYSTERY', 100)], mfg_products: [] });
    expect(await contractRevenueLines(sb, SO, 2)).toEqual([{ key: 'i1', itemCode: 'RN-MYSTERY', group: '', subCategory: null, amountSen: 100 }]);
  });

  test('spreadByWeight is exact, negative totals included', () => {
    expect(spreadByWeight(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(spreadByWeight(10, [0, 0])).toEqual([5, 5]);
    expect(spreadByWeight(7, [2, 5])).toEqual([2, 5]);
  });
});
