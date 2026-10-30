/* Purchases by sub-category (spec 2026-10-30-renovation-revenue-einvoice-design.md 2.4; plan
   2026-10-30-renovation-revenue-ledger.md Task 9). A purchase line carrying a product books to its product's
   sub-category purchase account, else its product's group's; a line without a product keeps its own item_group. */
import { describe, expect, test } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import { splitByItemGroup } from './item-group-split';

const CO = 2;
const world = () => fakeSb({
  mfg_products: [
    { code: 'RN-TVC-01', company_id: CO, category_group: 'BUILTIN', sub_category: 'TV_CABINET', status: 'ACTIVE' },
    { code: 'RN-WARD-01', company_id: CO, category_group: 'BUILTIN', sub_category: 'WARDROBE', status: 'ACTIVE' },
    { code: 'RN-ODD-01', company_id: CO, category_group: 'SOFT', sub_category: 'CURTAIN', status: 'ACTIVE' },
  ],
  acc_item_group_accounts: [
    { company_id: CO, group_code: 'BUILTIN', purchase_account: '602-0000', sales_account: '502-0000' },
    { company_id: CO, group_code: 'WORKS', purchase_account: '601-0000', sales_account: '501-0000' },
  ],
  acc_sub_category_accounts: [
    { company_id: CO, sub_category_code: 'TV_CABINET', purchase_account: '602-0010', sales_account: '502-0010' },
  ],
});

const split = (sb: ReturnType<typeof world>, items: Array<{ item_group: string | null; item_code?: string | null; line_total_sen: number }>) =>
  splitByItemGroup(sb, {
    companyId: CO, docNo: 'PI-1', items, account: 'purchase_account', myrSen: (s) => s,
    totalSen: items.reduce((s, i) => s + i.line_total_sen, 0),
  });

describe('purchases by sub-category', () => {
  test('a renovation supplier line books to its sub-category purchase account', async () => {
    const r = await split(world(), [{ item_group: 'RENOVATION', item_code: 'RN-TVC-01', line_total_sen: 120_000 }]);
    expect(r).toEqual({ ok: true, groups: [{ groupCode: 'BUILTIN / TV_CABINET', accountCode: '602-0010', myrSen: 120_000 }] });
  });

  test("a sub-category with no binding of its own uses its product's group; a line with no product keeps its item_group", async () => {
    const r = await split(world(), [
      { item_group: 'RENOVATION', item_code: 'RN-WARD-01', line_total_sen: 50_000 },
      { item_group: 'WORKS', item_code: null, line_total_sen: 30_000 },
      { item_group: 'WORKS', item_code: 'NOT-A-PRODUCT', line_total_sen: 20_000 },
    ]);
    expect(r).toEqual({ ok: true, groups: [
      { groupCode: 'BUILTIN / WARDROBE', accountCode: '602-0000', myrSen: 50_000 },
      { groupCode: 'WORKS', accountCode: '601-0000', myrSen: 50_000 },
    ] });
  });

  test('a product whose sub-category and group have no purchase account refuses by name', async () => {
    const r = await split(world(), [{ item_group: 'RENOVATION', item_code: 'RN-ODD-01', line_total_sen: 10_000 }]);
    expect(r).toMatchObject({ ok: false, status: 'group_unbound' });
    expect((r as { reason: string }).reason).toContain('SOFT / CURTAIN');
  });

  test('the sales side is unchanged: it reads the line group only', async () => {
    const r = await splitByItemGroup(world(), {
      companyId: CO, docNo: 'SI-1', items: [{ item_group: 'BUILTIN', item_code: 'RN-TVC-01', line_total_sen: 10_000 }],
      account: 'sales_account', myrSen: (s) => s, totalSen: 10_000,
    });
    expect(r).toEqual({ ok: true, groups: [{ groupCode: 'BUILTIN', accountCode: '502-0000', myrSen: 10_000 }] });
  });
});
