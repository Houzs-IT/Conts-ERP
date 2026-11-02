/* Rental costs by unit (chew 2 Nov 2026, answer A: finance only, never charged to the owner; plan 2026-11-02-voucher-
   purpose Task 4). Pinned: Rental expense lines in the range, by unit and account; a reversal pair counts as nothing;
   other departments and non-expense accounts are left out; Rental expense with no unit is its own figure. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { rentalUnitCostsHandler } from './rental-unit-costs';

const CO = 2;
const je = (id: string, date: string, over = {}) => ({ id, company_id: CO, entry_date: date, posted: true, ...over });
const ln = (id: string, jeId: string, account: string, debit: number, credit: number, department: string, unit: string | null) =>
  ({ id, company_id: CO, journal_entry_id: jeId, account_code: account, debit_sen: debit, credit_sen: credit, department, unit_id: unit });
const world = () => publicTablesOnly(fakeSb({
  accounts: [
    { company_id: CO, account_code: '620-0010', account_name: 'REPAIRS', account_type: 'EXPENSE' },
    { company_id: CO, account_code: '620-0020', account_name: 'INTERNET', account_type: 'EXPENSE' },
    { company_id: CO, account_code: '310-0010', account_name: 'MAYBANK', account_type: 'ASSET' },
  ],
  journal_entries: [
    je('j1', '2026-11-03'), je('j2', '2026-11-10'),
    je('j3', '2026-11-12', { reversed: true, reversed_by_je: 'j4' }), je('j4', '2026-11-13', { reversed_by_je: 'j3' }),
    je('j5', '2026-10-30'), je('j6', '2026-11-15'),
  ],
  journal_entry_lines: [
    ln('a', 'j1', '620-0010', 35_000, 0, 'rental', 'u-a31'), ln('b', 'j1', '310-0010', 0, 35_000, 'rental', null),
    ln('c', 'j2', '620-0020', 9_900, 0, 'rental', 'u-a31'), ln('d', 'j2', '620-0010', 20_000, 0, 'rental', null),
    ln('e', 'j3', '620-0010', 50_000, 0, 'rental', 'u-b22'), ln('f', 'j4', '620-0010', 0, 50_000, 'rental', 'u-b22'),
    ln('g', 'j5', '620-0010', 70_000, 0, 'rental', 'u-a31'),
    ln('h', 'j6', '620-0010', 12_000, 0, 'shared', null),
  ],
  conts_units: [{ id: 'u-a31', building: 'ASTER HILL', unit_number: 'A-3-1' }, { id: 'u-b22', building: 'ASTER HILL', unit_number: 'B-2-2' }],
}), ['conts_units']);
const app = () => {
  const a = new Hono();
  a.use('*', async (c, next) => { c.set('supabase' as never, world() as never); c.set('companyId' as never, CO as never); await next(); });
  a.get('/rental-unit-costs', rentalUnitCostsHandler as never);
  return a;
};

describe('rental costs by unit', () => {
  test('November: by unit and account, the no-unit figure apart', async () => {
    const r = await (await app().request('/rental-unit-costs?from=2026-11-01&to=2026-11-30')).json() as Record<string, unknown>;
    expect(r).toEqual({
      from: '2026-11-01', to: '2026-11-30',
      rows: [{ unitId: 'u-a31', building: 'ASTER HILL', unitNumber: 'A-3-1', byAccount: { '620-0010': 35_000, '620-0020': 9_900 }, totalSen: 44_900 }],
      noUnitSen: 20_000,
      noUnitByAccount: { '620-0010': 20_000 },
      accounts: [{ code: '620-0010', name: 'REPAIRS' }, { code: '620-0020', name: 'INTERNET' }],
    });
  });

  test('a bad date is refused', async () => {
    expect((await app().request('/rental-unit-costs?from=2026-11&to=2026-11-30')).status).toBe(400);
  });
});
