// Item Groups tab (GL redesign item 1). What is pinned:
//   • the table reads each bound account with its full name, and how many groups are bound;
//   • an unbound group opens PRE-FILLED with the suggested defaults and says
//     so — the sign-off flow: nothing writes until Save; a suggestion whose
//     accounts are not all in this chart is not offered;
//   • Save sends exactly the four drafted accounts for the active company;
//   • a bound, untouched group cannot be saved again;
//   • the New-group dialog refuses to create until code, name and all four
//     accounts are given (born bound), and upper-cases the code;
//   • no picker offers an account that has accounts under it (chew 10 Nov 2026).

import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ItemGroup, ItemSubCategory } from './accounting-phase1-queries';

const bindMutate = vi.fn();
const createMutate = vi.fn();
const patchMutate = vi.fn();
const subBindMutate = vi.fn();

const GROUPS: ItemGroup[] = [
  {
    code: 'SOFA', name: 'Sofa', isActive: true,
    bindings: { '2': { purchase: '601-0003', sales: '501-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' } },
  },
  { code: 'BEDLINES', name: 'Bedlines', isActive: true, bindings: {} },
  /* Its suggestion names 601-0004, which this chart does not have: no half-filled suggestion. */
  { code: 'SERVICE', name: 'Service', isActive: true, bindings: {} },
];

const SUBS: ItemSubCategory[] = [
  { code: 'SHEET', label: 'Bed sheet', groupCode: 'BEDLINES', bindings: { '2': { salesAccount: '502-0000', purchaseAccount: null } } },
  { code: 'PILLOW', label: 'Pillow', groupCode: 'BEDLINES', bindings: {} },
];

vi.mock('./accounting-phase1-queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useItemGroups: () => ({
    isLoading: false, isError: false,
    data: { companies: [{ id: 1, code: 'HOUZS' }, { id: 2, code: '2990' }], groups: GROUPS, subCategories: SUBS },
  }),
  useCreateItemGroup: () => ({ mutate: createMutate, isPending: false, isError: false, error: null }),
  useBindItemGroup: () => ({ mutate: bindMutate, isPending: false, isError: false, error: null }),
  usePatchItemGroup: () => ({ mutate: patchMutate, isPending: false, isError: false, error: null }),
  useBindSubCategory: () => ({ mutate: subBindMutate, isPending: false, isError: false, error: null }),
}));

vi.mock('../../vendor/scm/lib/accounting-queries', () => ({
  useAccountRoles: () => ({ data: { roles: { AR: '300-0000', AR_OTHER: '305-0000', AP: '400-0000', AP_OTHER: '405-0000' }, overridden: {} } }),
  useAccounts: () => ({
    data: {
      sections: [
        { section: 'CAPITAL', type: 'EQUITY' }, { section: 'CURRENT ASSETS', type: 'ASSET' },
        { section: 'SALES', type: 'INCOME' }, { section: 'SALES ADJUSTMENTS', type: 'INCOME' },
        { section: 'COST OF GOODS SOLD', type: 'EXPENSE' }, { section: 'EXPENSES', type: 'EXPENSE' },
      ],
      accounts: [
        { account_code: '601-0003', account_name: 'PURCHASE OF SOFA', account_type: 'EXPENSE', section: 'COST OF GOODS SOLD', is_active: true },
        { account_code: '602-0000', account_name: 'PURCHASES OF BEDLINES', account_type: 'EXPENSE', section: 'COST OF GOODS SOLD', is_active: true },
        { account_code: '501-0000', account_name: 'SALES OF FURNITURE', account_type: 'INCOME', section: 'SALES', is_active: true },
        { account_code: '502-0000', account_name: 'SALES OF BEDLINES', account_type: 'INCOME', section: 'SALES', is_active: true },
        { account_code: '510-0000', account_name: 'RETURN INWARDS', account_type: 'INCOME', section: 'SALES ADJUSTMENTS', is_active: true },
        { account_code: '612-0000', account_name: 'PURCHASES RETURN', account_type: 'EXPENSE', section: 'COST OF GOODS SOLD', is_active: true },
        /* Noise the picker must HIDE: neither side of trading. */
        { account_code: '100-0000', account_name: 'CAPITAL', account_type: 'EQUITY', section: 'CAPITAL', is_active: true },
        { account_code: '310-0010', account_name: 'CASH AT BANK - MAYBANK', account_type: 'ASSET', section: 'CURRENT ASSETS', is_active: true },
      ],
    },
  }),
}));

vi.mock('../../lib/activeCompany', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveCompanyId: () => 2,
}));

import { ItemGroupsTab, accountsForBinding, accountsForSubCategory } from './ItemGroups';

beforeEach(() => {
  bindMutate.mockClear();
  createMutate.mockClear();
  patchMutate.mockClear();
  subBindMutate.mockClear();
});

const rowOf = (code: string): HTMLElement => {
  const cell = screen.getAllByText(code).find((el) => el.closest('tr'));
  return cell!.closest('tr') as HTMLElement;
};
const openGroup = (verb: 'Bind' | 'Edit', code: string): HTMLElement => {
  fireEvent.click(screen.getByRole('button', { name: `${verb} ${code}` }));
  return screen.getByRole('dialog');
};

describe('the table', () => {
  test('each bound account reads with its full name; the count says how many groups are bound', () => {
    render(<ItemGroupsTab />);
    expect(screen.getByTestId('groups-bound').textContent).toBe('1 of 3 groups bound');
    const sofa = rowOf('SOFA');
    expect(sofa.textContent).toContain('601-0003');
    expect(sofa.textContent).toContain('PURCHASE OF SOFA');
    expect(sofa.textContent).toContain('RETURN INWARDS');
    expect(sofa.textContent).toContain('Bound');
    expect(rowOf('BEDLINES').textContent).toContain('Not bound');
    expect(rowOf('BEDLINES').textContent).toContain('2 sub-categories · 1 with own accounts');
  });
});

describe('the sign-off flow', () => {
  test('an unbound group opens pre-filled with the suggestion, marked as not saved', () => {
    render(<ItemGroupsTab />);
    const dialog = openGroup('Bind', 'BEDLINES');
    expect(within(dialog).getByText(/Suggested accounts/)).toBeTruthy();
    const purchase = screen.getByLabelText('BEDLINES Purchase account') as HTMLInputElement;
    expect(purchase.value).toContain('602-0000');
  });

  test('Save on the suggestion sends the four drafted accounts for the active company', () => {
    render(<ItemGroupsTab />);
    const dialog = openGroup('Bind', 'BEDLINES');
    const save = within(dialog).getAllByRole('button', { name: 'Save' })[0];
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    expect(bindMutate).toHaveBeenCalledTimes(1);
    expect(bindMutate.mock.calls[0][0]).toEqual({
      code: 'BEDLINES',
      companyId: 2,
      accounts: { purchase: '602-0000', sales: '502-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
    });
  });

  test('a suggestion whose accounts are not all in this chart is not offered', () => {
    render(<ItemGroupsTab />);
    const dialog = openGroup('Bind', 'SERVICE');
    expect(within(dialog).queryByText(/Suggested accounts/)).toBeNull();
    expect((screen.getByLabelText('SERVICE Sales account') as HTMLInputElement).value).toBe('');
    expect(within(dialog).getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  test('a bound, untouched group cannot be saved again', () => {
    render(<ItemGroupsTab />);
    const dialog = openGroup('Edit', 'SOFA');
    expect(within(dialog).getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  test('turning a group off goes through the patch, bindings untouched', () => {
    render(<ItemGroupsTab />);
    const dialog = openGroup('Edit', 'SOFA');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    expect(patchMutate).toHaveBeenCalledWith({ code: 'SOFA', isActive: false });
    expect(bindMutate).not.toHaveBeenCalled();
  });

  test('the picker offers only its ledger side, under section headers (owner 2026-09-05)', () => {
    render(<ItemGroupsTab />);
    openGroup('Bind', 'BEDLINES');
    const purchase = screen.getByLabelText('BEDLINES Purchase account');
    fireEvent.focus(purchase);
    /* EXPENSE list: the chart's cost section heads it (read off the account
       rows, never decided here); equity/bank/income never show. (The table
       behind the dialog names SOFA's accounts, so look inside the list only.) */
    let list = within(screen.getByRole('listbox'));
    expect(list.getByText('COST OF GOODS SOLD')).toBeTruthy();
    expect(list.queryByText(/^CAPITAL/)).toBeNull();
    expect(list.queryByText(/CASH AT BANK/)).toBeNull();
    expect(list.queryByText(/SALES OF FURNITURE/)).toBeNull();
    fireEvent.blur(purchase);
    const sales = screen.getByLabelText('BEDLINES Sales Return account');
    fireEvent.focus(sales);
    /* INCOME list: 510 files under SALES ADJUSTMENTS; expense rows stay out. */
    list = within(screen.getByRole('listbox'));
    expect(list.getByText('SALES ADJUSTMENTS')).toBeTruthy();
    expect(list.queryByText(/PURCHASE OF SOFA/)).toBeNull();
  });
});

describe('new group — born bound', () => {
  test('Create stays disabled until code, name and all four accounts are given, then upper-cases the code', () => {
    render(<ItemGroupsTab />);
    fireEvent.click(screen.getByText('New group'));
    const dialog = screen.getByRole('dialog');
    const createBtn = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Create')!;
    expect(createBtn.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Group code'), { target: { value: 'curtain' } });
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Curtain' } });
    expect(createBtn.hasAttribute('disabled')).toBe(true); // accounts still missing

    for (const [slot, code] of [
      ['Purchase', '601-0003'], ['Sales', '501-0000'], ['Sales Return', '510-0000'], ['Purchase Return', '612-0000'],
    ] as const) {
      const input = screen.getByLabelText(`New group ${slot} account`);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: code } });
      // The combo picks on MOUSEDOWN (click fires after blur closes the list).
      fireEvent.mouseDown(screen.getAllByText(new RegExp(`^${code} — `))[0]);
    }
    expect(createBtn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(createBtn);
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toMatchObject({
      code: 'CURTAIN', name: 'Curtain', companyId: 2,
      accounts: { purchase: '601-0003', sales: '501-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
    });
  });
});

/* Renovation billing books to the advance (a liability) until the work is done (Conts, finance phase 1, spec 3.4,
   SOP 4.2.1 method B): RENOVATION's sales and sales-return slots may pick a liability account; nothing else changes. */
describe('which accounts a binding offers', () => {
  const chart = [
    { account_code: '500-0000', account_name: 'SALES', account_type: 'INCOME', is_active: true },
    { account_code: '404-0000', account_name: 'ADVANCE BILLING', account_type: 'LIABILITY', is_active: true },
    { account_code: '601-0000', account_name: 'PURCHASES', account_type: 'EXPENSE', is_active: true },
    { account_code: '599-0000', account_name: 'OLD SALES', account_type: 'INCOME', is_active: false },
  ];
  const codes = (xs: Array<{ account_code: string }>) => xs.map((a) => a.account_code);

  test('RENOVATION sales can pick a liability account', () => {
    expect(codes(accountsForBinding('RENOVATION', 'sales_account', chart))).toEqual(['500-0000', '404-0000']);
    expect(codes(accountsForBinding('renovation', 'sales_return_account', chart))).toEqual(['500-0000', '404-0000']);
    expect(codes(accountsForBinding('RENOVATION', 'purchase_account', chart))).toEqual(['601-0000']);
  });

  test('the advance never offers a control account or a header', () => {
    const more = [
      ...chart,
      { account_code: '400-0000', account_name: 'ACCOUNT PAYABLE', account_type: 'LIABILITY', is_active: true },
      { account_code: '450-0000', account_name: 'ACCRUALS', account_type: 'LIABILITY', is_active: true },
      { account_code: '450-0001', account_name: 'ACCRUED RENT', account_type: 'LIABILITY', is_active: true, parent_code: '450-0000' },
    ];
    expect(codes(accountsForBinding('RENOVATION', 'sales_account', more, new Set(['400-0000'])))).toEqual(['500-0000', '404-0000', '450-0001']);
  });

  test('other groups still list income accounts only', () => {
    expect(codes(accountsForBinding('SOFA', 'sales_account', chart))).toEqual(['500-0000']);
    expect(codes(accountsForBinding('SOFA', 'purchase_return_account', chart))).toEqual(['601-0000']);
  });

  /* chew 10 Nov 2026: 有子科目的就直接让父账户不显示 — posting refuses a header, so only the accounts under it show. */
  test('no slot offers an account that has accounts under it', () => {
    const tree = [
      { account_code: '500-0000', account_name: 'SALES', account_type: 'INCOME', is_active: true },
      { account_code: '500-0010', account_name: 'SALES - RENO ITEMS', account_type: 'INCOME', is_active: true, parent_code: '500-0000' },
      { account_code: '620-0000', account_name: 'COST OF SALES', account_type: 'EXPENSE', is_active: true },
      { account_code: '602-0000', account_name: 'CARPENTRY COSTS', account_type: 'EXPENSE', is_active: true, parent_code: '620-0000' },
    ];
    expect(codes(accountsForBinding('BUILTIN', 'sales_account', tree))).toEqual(['500-0010']);
    expect(codes(accountsForBinding('BUILTIN', 'purchase_return_account', tree))).toEqual(['602-0000']);
    expect(codes(accountsForBinding('RENOVATION', 'sales_account', tree))).toEqual(['500-0010']);
  });
});

/* Renovation revenue (spec 2.4, plan Task 1): a group's dialog lists its sub-categories, each with its own sales and
   purchase account; an empty side uses the group's account. */
describe('sub-category accounts', () => {
  const openBedlines = () => {
    render(<ItemGroupsTab />);
    expect(screen.queryByLabelText('PILLOW Sales account')).toBeNull();
    openGroup('Bind', 'BEDLINES');
  };

  test("a group's sub-categories show in its dialog; an unbound side says it uses the group's account", () => {
    openBedlines();
    const sales = screen.getByLabelText('PILLOW Sales account') as HTMLInputElement;
    expect(sales.value).toBe('');
    expect(sales.placeholder).toBe("Uses the group's account");
    expect((screen.getByLabelText('SHEET Sales account') as HTMLInputElement).value).toContain('502-0000');
  });

  test('a group with none shows no sub-category list', () => {
    render(<ItemGroupsTab />);
    const dialog = openGroup('Edit', 'SOFA');
    expect(within(dialog).queryByRole('region', { name: 'Sub-categories' })).toBeNull();
  });

  test('Save sends this sub-category\'s two sides for the active company, the empty one as null', () => {
    openBedlines();
    const purchase = screen.getByLabelText('PILLOW Purchase account');
    fireEvent.focus(purchase);
    fireEvent.change(purchase, { target: { value: '602-0000' } });
    fireEvent.mouseDown(screen.getAllByText(/^602-0000 — /)[0]);
    const row = screen.getByText('Pillow').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(subBindMutate).toHaveBeenCalledTimes(1);
    expect(subBindMutate.mock.calls[0][0]).toEqual({ code: 'PILLOW', companyId: 2, salesAccount: null, purchaseAccount: '602-0000' });
  });

  test('a refused save keeps the picks; a saved one drops the draft', () => {
    openBedlines();
    const purchase = screen.getByLabelText('PILLOW Purchase account') as HTMLInputElement;
    fireEvent.focus(purchase);
    fireEvent.change(purchase, { target: { value: '602-0000' } });
    fireEvent.mouseDown(screen.getAllByText(/^602-0000 — /)[0]);
    fireEvent.blur(purchase);
    const row = screen.getByText('Pillow').closest('tr') as HTMLElement;
    const save = () => fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    /* The server refuses: mutate never calls onSuccess. */
    save();
    expect((screen.getByLabelText('PILLOW Purchase account') as HTMLInputElement).value).toContain('602-0000');
    /* Accepted: onSuccess runs, the draft goes and the row shows what the server holds (still nothing here). */
    subBindMutate.mockImplementationOnce((_body: unknown, opts?: { onSuccess?: () => void }) => { opts?.onSuccess?.(); });
    save();
    expect((screen.getByLabelText('PILLOW Purchase account') as HTMLInputElement).value).toBe('');
  });

  test("'Use group' clears both sides of a bound sub-category", () => {
    openBedlines();
    const row = screen.getByText('Bed sheet').closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(row).getByRole('button', { name: 'Use group' }));
    expect(subBindMutate.mock.calls[0][0]).toEqual({ code: 'SHEET', companyId: 2, salesAccount: null, purchaseAccount: null });
  });

  test('the picker never offers a parent account, only its own ledger side', () => {
    const chart = [
      { account_code: '500-0000', account_name: 'SALES', account_type: 'INCOME', is_active: true },
      { account_code: '500-0001', account_name: 'SALES - X', account_type: 'INCOME', is_active: true, parent_code: '500-0000' },
      { account_code: '599-0000', account_name: 'OLD SALES', account_type: 'INCOME', is_active: false },
      { account_code: '601-0000', account_name: 'PURCHASES', account_type: 'EXPENSE', is_active: true },
    ];
    expect(accountsForSubCategory('sales_account', chart).map((a) => a.account_code)).toEqual(['500-0001']);
    expect(accountsForSubCategory('purchase_account', chart).map((a) => a.account_code)).toEqual(['601-0000']);
  });

  test('the picker never offers a control account (the server refuses one too)', () => {
    const chart = [
      { account_code: '500-0001', account_name: 'SALES - X', account_type: 'INCOME', is_active: true },
      { account_code: '505-0000', account_name: 'CONTROL-LIKE INCOME', account_type: 'INCOME', is_active: true },
    ];
    expect(accountsForSubCategory('sales_account', chart, new Set(['505-0000'])).map((a) => a.account_code)).toEqual(['500-0001']);
  });
});
