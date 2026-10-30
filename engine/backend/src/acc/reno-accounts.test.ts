// Renovation line accounts (spec 2.4): a line books to its sub-category's account, falling back to its category
// group's; a group with neither refuses by name — never a silent default (the group_unbound rule).

import { describe, expect, test } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import { resolveLineAccounts } from './reno-accounts';

const groupRow = (group: string, sales: string, purchase: string, company = 2) => ({
  company_id: company, group_code: group,
  sales_account: sales, purchase_account: purchase,
  sales_return_account: '510-0000', purchase_return_account: '612-0000',
});

describe('resolveLineAccounts', () => {
  test('a sub-category binding wins over its group', async () => {
    const sb = fakeSb({
      acc_item_group_accounts: [groupRow('BUILTIN', '502-0050', '602-0050')],
      acc_sub_category_accounts: [
        { company_id: 2, sub_category_code: 'TV_CABINET', sales_account: '502-0010', purchase_account: '602-0010' },
        /* Another company's binding never leaks in. */
        { company_id: 1, sub_category_code: 'STUDY_TABLE', sales_account: '999-0001', purchase_account: '999-0002' },
      ],
    });
    const r = await resolveLineAccounts(sb, 2, [
      { group: 'BUILTIN', subCategory: 'TV_CABINET' },
      { group: 'BUILTIN', subCategory: 'STUDY_TABLE' },
      { group: 'builtin', subCategory: null },
    ], 'sales_account');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accountOf({ group: 'BUILTIN', subCategory: 'TV_CABINET' })).toBe('502-0010');
    expect(r.accountOf({ group: 'BUILTIN', subCategory: 'STUDY_TABLE' })).toBe('502-0050');
    expect(r.accountOf({ group: 'builtin', subCategory: null })).toBe('502-0050');

    const p = await resolveLineAccounts(sb, 2, [{ group: 'BUILTIN', subCategory: 'TV_CABINET' }], 'purchase_account');
    expect(p.ok && p.accountOf({ group: 'BUILTIN', subCategory: 'TV_CABINET' })).toBe('602-0010');
  });

  test('a sub-category with only the other side bound falls back to the group for this side', async () => {
    const sb = fakeSb({
      acc_item_group_accounts: [groupRow('BUILTIN', '502-0050', '602-0050')],
      acc_sub_category_accounts: [
        { company_id: 2, sub_category_code: 'TV_CABINET', sales_account: '502-0010', purchase_account: null },
      ],
    });
    const r = await resolveLineAccounts(sb, 2, [{ group: 'BUILTIN', subCategory: 'TV_CABINET' }], 'purchase_account');
    expect(r.ok && r.accountOf({ group: 'BUILTIN', subCategory: 'TV_CABINET' })).toBe('602-0050');
  });

  test('a group with neither binding refuses by name', async () => {
    const sb = fakeSb({
      acc_item_group_accounts: [groupRow('SERVICE', '505-0000', '605-0000')],
      acc_sub_category_accounts: [],
    });
    const r = await resolveLineAccounts(sb, 2, [
      { group: 'SERVICE', subCategory: null },
      { group: 'LIGHTING', subCategory: 'DOWNLIGHT' },
    ], 'sales_account');
    expect(r).toMatchObject({ ok: false, status: 'group_unbound' });
    if (r.ok) return;
    expect(r.reason).toContain('LIGHTING');
    expect(r.reason).toContain('DOWNLIGHT');
    expect(r.reason).not.toContain('SERVICE');
  });

  test('a sub-category bound on its own is enough, even with its group unbound', async () => {
    const sb = fakeSb({
      acc_item_group_accounts: [],
      acc_sub_category_accounts: [
        { company_id: 2, sub_category_code: 'DOWNLIGHT', sales_account: '501-0040', purchase_account: '601-0040' },
      ],
    });
    const r = await resolveLineAccounts(sb, 2, [{ group: 'LIGHTING', subCategory: 'DOWNLIGHT' }], 'sales_account');
    expect(r.ok && r.accountOf({ group: 'LIGHTING', subCategory: 'DOWNLIGHT' })).toBe('501-0040');
  });
});
