/* The AR / AP aging from the books (ported from Houzs on 21 Nov 2026, drawn with the Conts Accounting parts). Pinned:
   one row per customer with its balance; the tiles are the five columns, Unapplied and Total, and a tile filters the
   rows; a row opens its bills and its unapplied money; the choices (accounts, department, basis) ask the server again;
   the By bill view lists each open bill with its days overdue; the foot prints the books' figure and the difference,
   the opening balance not split and the migrated bills apart; a failed read says so instead of showing nothing. */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AgingReportData } from '../../../vendor/scm/lib/aging-queries';

const state = vi.hoisted(() => ({ fail: false }));
let data: AgingReportData;
const asked: Array<Record<string, string>> = [];
vi.mock('../../../vendor/scm/lib/aging-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../vendor/scm/lib/aging-queries')>()),
  useAging: (_side: string, p: Record<string, string>) => {
    asked.push(p);
    return state.fail
      ? { data: undefined, isLoading: false, isError: true, error: new Error('the aging read failed') }
      : { data, isLoading: false, isError: false, error: null };
  },
}));

import { AgingReport } from './AgingReport';

beforeEach(() => {
  asked.length = 0;
  state.fail = false;
  data = {
    asOf: '2026-09-30', basis: 'invoice', buckets: 'month', control: 'all', department: null,
    accounts: [
      { code: '300-0000', name: 'TRADE DEBTORS', other: false },
      { code: '301-0000', name: 'RENOVATION CUSTOMER', other: false },
      { code: '305-0000', name: 'OTHER DEBTORS', other: true },
    ],
    rows: [
      {
        key: 'C-1', code: 'C-1', name: 'ALI', balanceSen: -80_000, cells: [0, 40_000, 0, 0, 0], unappliedSen: -120_000,
        items: [{ group: 'SO:SO-A', docNo: 'SI-A1', kind: 'Invoice', date: '2026-08-10', dueDate: null, amountSen: 120_000, openSen: 40_000, column: 1 }],
        unapplied: [{ docNo: 'SO-B', kind: 'Payment', date: '2026-09-15', amountSen: -120_000 }],
      },
      {
        key: '301-B001', code: '301-B001', name: 'BEE', balanceSen: 60_000, cells: [0, 0, 0, 60_000, 0], unappliedSen: 0,
        items: [{ group: 'SO:SO-C', docNo: 'SI-C1', kind: 'Invoice', date: '2026-06-20', dueDate: '2026-07-20', amountSen: 90_000, openSen: 60_000, column: 3 }],
        unapplied: [],
      },
    ],
    totals: { balanceSen: -20_000, cells: [0, 40_000, 0, 60_000, 0], unappliedSen: -120_000 },
    controls: [{ code: '300-0000', balanceSen: -80_000 }, { code: '301-0000', balanceSen: 60_000 }, { code: '305-0000', balanceSen: 0 }],
    differenceSen: 0,
    outside: { count: 2, sen: 400_000 },
    opening: { splitSen: 500_000, unsplitSen: 300_000 },
  };
});

const draw = (side: 'ar' | 'ap' = 'ar') => render(<MemoryRouter><AgingReport side={side} /></MemoryRouter>);
const tiles = () => within(screen.getByRole('region', { name: 'AR aging figures' }));

describe('AR / AP aging', () => {
  test('a row per customer, the tiles, and the foot that ties to the books', () => {
    draw();
    expect(asked.at(-1)).toMatchObject({ basis: 'invoice', buckets: 'month', control: 'all', department: '' });
    expect(screen.getAllByText('ALI').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BEE').length).toBeGreaterThan(0);
    expect(tiles().getByRole('button', { name: /Total/ }).textContent).toContain('(200.00)');
    expect(tiles().getByRole('button', { name: /Unapplied/ }).textContent).toContain('1 customer');
    const notes = within(screen.getByRole('list', { name: 'Aging notes' }));
    expect(notes.getByText(/In the books \(300-0000 \+ 301-0000 \+ 305-0000\).*difference 0\.00/)).toBeTruthy();
    expect(notes.getByText(/3,000\.00 of the opening balance is not explained/)).toBeTruthy();
    expect(notes.getByText(/2 migrated customer invoice\(s\) are open for 4,000\.00/)).toBeTruthy();
  });

  test('a tile filters the rows; a row opens its bills and its unapplied money', () => {
    draw();
    fireEvent.click(tiles().getByRole('button', { name: /3 months/ }));
    expect(screen.queryAllByText('ALI')).toHaveLength(0);
    fireEvent.click(tiles().getByRole('button', { name: /3 months/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    const bills = within(screen.getByRole('table', { name: "ALI's bills" }));
    expect(bills.getByRole('link', { name: 'SI-A1' }).getAttribute('href')).toBe('/scm/sales-orders/SO-A');
    expect(bills.getByText('SO-B')).toBeTruthy();
  });

  test('the choices ask the server again: one control, one department, by due date', () => {
    draw();
    expect(within(screen.getByRole('combobox', { name: 'Accounts' })).getByRole('option', { name: /All but Other Debtors/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Accounts' }), { target: { value: '301-0000' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'AR aging department' }), { target: { value: 'rental' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Age by' }), { target: { value: 'due' } });
    expect(asked.at(-1)).toMatchObject({ control: '301-0000', department: 'rental', basis: 'due' });
  });

  test('By bill lists each open bill with its days overdue', () => {
    draw();
    fireEvent.change(screen.getByRole('combobox', { name: 'View' }), { target: { value: 'invoice' } });
    expect(screen.getAllByText('SI-C1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('72').length).toBeGreaterThan(0);
    expect(screen.getAllByText('61-90').length).toBeGreaterThan(0);
  });

  test('a failed read says so', () => {
    state.fail = true;
    draw('ap');
    expect(screen.getByRole('alert').textContent).toContain('The aging did not load');
  });
});
