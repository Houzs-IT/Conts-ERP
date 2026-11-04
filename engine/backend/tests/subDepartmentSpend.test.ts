/* Spending by sub-department (SOP 1.1; chew 4 Nov 2026; plan 2026-11-04-sub-departments Task 8). Pinned:
     · each department shows its sub-departments, which add up to its total; the company total counts a line once;
     · a line with no sub-department counts under its department's built-in row (Rental (general)…);
     · the previous period of the same length comes beside it;
     · Maintenance and Cleaning lines with no unit are listed; a Rental (general) one is not;
     · the money counts once: a Cleaning RM 50 with a unit is RM 50 under Cleaning, and RM 50 under its unit. */
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly, type Row } from '../src/scm/lib/fake-postgrest';
import { noUnitCosts, subDepartmentSpend } from '../src/acc/sub-department-spend';
import { rentalUnitCosts } from '../src/acc/rental-unit-costs';

const CO = 1;
const sub = (id: string, department: string, name: string, fixed_key: string | null, sort: number) => ({ id, company_id: CO, department, name, fixed_key, staff_department_id: null, active: true, sort });
const je = (id: string, date: string, over: Row = {}): Row => ({ id, company_id: CO, je_no: `JE-${id}`, entry_date: date, source_type: 'PV', source_doc_no: `PV-${id}`, posted: true, reversed: false, reversed_by_je: null, ...over });
const ln = (je_id: string, account_code: string, dr: number, cr: number, department: string, sub_department_id: string | null = null, unit_id: string | null = null): Row =>
  ({ id: `${je_id}-${account_code}-${dr}-${cr}`, company_id: CO, journal_entry_id: je_id, account_code, debit_sen: dr, credit_sen: cr, department, sub_department_id, unit_id, notes: null });
const world = () => publicTablesOnly(fakeSb({
  acc_sub_departments: [
    sub('s-gen', 'rental', 'Rental (general)', 'rental_general', 10), sub('s-cln', 'rental', 'Cleaning', null, 20), sub('s-mnt', 'rental', 'Maintenance', null, 30),
    sub('s-dc', 'supply', 'Renovation (Dream Crafter)', 'dreamcrafter', 10), sub('s-tc', 'supply', 'In-house Reno (The Conts)', 'theconts', 20),
    sub('s-co', 'shared', 'Company', 'company', 10),
  ],
  accounts: [
    { company_id: CO, account_code: '906-0000', account_name: 'Cleaning supplies', account_type: 'EXPENSE' },
    { company_id: CO, account_code: '905-0000', account_name: 'Repairs', account_type: 'EXPENSE' },
    { company_id: CO, account_code: '500-0000', account_name: 'Rental income', account_type: 'INCOME' },
    { company_id: CO, account_code: '310-0010', account_name: 'Bank', account_type: 'ASSET' },
  ],
  journal_entries: [
    je('1', '2026-11-03'), je('2', '2026-11-04'), je('3', '2026-11-05'), je('4', '2026-10-20'),
    je('5', '2026-11-06', { reversed: true }),
  ],
  journal_entry_lines: [
    ln('1', '906-0000', 5000, 0, 'rental', 's-cln', 'u-a1206'), ln('1', '310-0010', 0, 5000, 'rental'),
    ln('2', '905-0000', 3000, 0, 'rental', 's-mnt'), ln('2', '906-0000', 2000, 0, 'rental'), ln('2', '310-0010', 0, 5000, 'rental'),
    ln('3', '500-0000', 0, 90000, 'rental'), ln('3', '905-0000', 7000, 0, 'supply', 's-tc'), ln('3', '310-0010', 83000, 0, 'rental'),
    ln('4', '906-0000', 1000, 0, 'rental', 's-cln', 'u-a1206'), ln('4', '310-0010', 0, 1000, 'rental'),
    ln('5', '906-0000', 99999, 0, 'rental', 's-cln'), ln('5', '310-0010', 0, 99999, 'rental'),
  ],
  conts_units: [{ id: 'u-a1206', building: 'SKYLINE', unit_number: 'A-12-06' }],
}), ['conts_units']);

describe('spending by sub-department', () => {
  test('each department’s sub-departments add up to it; a line with none is the built-in row; reversed entries do not count', async () => {
    const r = await subDepartmentSpend(world(), CO, '2026-11-01', '2026-11-30');
    const rental = r.departments.find((d) => d.department === 'rental')!;
    expect(rental.rows.map((x) => [x.name, x.costSen, x.incomeSen])).toEqual([
      ['Rental (general)', 2000, 90000], ['Cleaning', 5000, 0], ['Maintenance', 3000, 0],
    ]);
    expect(rental).toMatchObject({ costSen: 10000, incomeSen: 90000 });
    const reno = r.departments.find((d) => d.department === 'supply')!;
    expect(reno.rows.map((x) => [x.name, x.costSen])).toEqual([['Renovation (Dream Crafter)', 0], ['In-house Reno (The Conts)', 7000]]);
    expect(r.totals).toMatchObject({ costSen: 17000, incomeSen: 90000 });
  });

  test('the previous period of the same length comes beside it', async () => {
    const r = await subDepartmentSpend(world(), CO, '2026-11-01', '2026-11-30');
    expect(r.previous).toMatchObject({ from: '2026-10-02', to: '2026-10-31' });
    const cln = r.departments.find((d) => d.department === 'rental')!.rows.find((x) => x.name === 'Cleaning')!;
    expect(cln.previousCostSen).toBe(1000);
  });

  test('Maintenance and Cleaning lines with no unit are listed; Rental (general) is not', async () => {
    const r = await noUnitCosts(world(), CO, '2026-11-01', '2026-11-30');
    expect(r.rows.map((x) => [x.jeNo, x.subDepartment, x.accountCode, x.amountSen])).toEqual([['JE-2', 'Maintenance', '905-0000', 3000]]);
  });

  test('the money counts once: RM 50 under Cleaning, and RM 50 under its unit, labelled Cleaning', async () => {
    const units = await rentalUnitCosts(world(), CO, '2026-11-01', '2026-11-30');
    const a1206 = units.rows.find((u) => u.unitNumber === 'A-12-06')!;
    expect(a1206.totalSen).toBe(5000);
    expect(a1206.subDepartments).toEqual(['Cleaning']);
  });
});

describe('who reads it', () => {
  test('the spending report needs the ledger post key, as the statements do', async () => {
    const { Hono } = await import('hono');
    const { subDepartmentSpendHandler } = await import('../src/acc/sub-department-spend');
    const appWith = (perms: string[]) => {
      const a = new Hono();
      a.use('*', async (c, next) => { c.set('supabase' as never, world() as never); c.set('companyId' as never, CO as never); c.set('houzsUser' as never, { name: 'x', permissions_set: new Set(perms) } as never); await next(); });
      a.get('/r', subDepartmentSpendHandler as never);
      return a;
    };
    expect((await appWith([]).request('/r?from=2026-11-01&to=2026-11-30')).status).toBe(403);
    expect((await appWith(['scm.payment_voucher.post']).request('/r?from=2026-11-01&to=2026-11-30')).status).toBe(200);
  });
});
