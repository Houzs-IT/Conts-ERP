/* Staff receipts and payment requests start on a sub-department (SOP 1.1; chew 4 Nov 2026). Pinned:
     · a receipt paid from a float takes the float's department's — with no unit, still that one, never Rental (general);
     · a receipt on a maintenance job takes Maintenance; a request takes the person's own department's;
     · a staff department nobody mapped falls back to the department's built-in row, and the receipt still goes in;
     · finance's corrected lines may name a sub-department, which sets the line's department. */
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { defaultLineSubs, type LineRow } from './claims-lines';
import { parseLines } from './petty-cash-routes';

const CO = 1;
const sub = (id: string, department: string, name: string, fixed_key: string | null, staff_department_id: string | null = null) =>
  ({ id, company_id: CO, department, name, fixed_key, staff_department_id, active: true, sort: 0 });
const world = (subs = [
  sub('s-gen', 'rental', 'Rental (general)', 'rental_general'), sub('s-cln', 'rental', 'Cleaning', null, 'dept-cln'),
  sub('s-mnt', 'rental', 'Maintenance', null, 'dept-mnt'), sub('s-dc', 'supply', 'Renovation (Dream Crafter)', 'dreamcrafter'),
  sub('s-tc', 'supply', 'In-house Reno (The Conts)', 'theconts', 'dept-inh'), sub('s-co', 'shared', 'Company', 'company'),
]) => publicTablesOnly(fakeSb({
  acc_sub_departments: subs,
  petty_cash_floats: [
    { id: 'f-cln', company_id: CO, department_id: 'dept-cln', active: true },
    { id: 'f-new', company_id: CO, department_id: 'dept-new', active: true },
  ],
  conts_departments: [
    { id: 'dept-cln', name: 'Cleaning', kind: 'cleaning', side: 'conts' },
    { id: 'dept-mnt', name: 'Maintenance', kind: 'maintenance', side: 'conts' },
  ],
}), ['conts_departments']);
const line = (over: Partial<LineRow> = {}): LineRow => ({ department: 'rental', unit_id: null, maintenance_issue_id: null, project_id: null, account_code: null, amount_sen: 5000, description: null, sort: 0, ...over });

describe('the sub-department a staff document starts on', () => {
  test('a receipt from the Cleaning float with no unit is Cleaning', async () => {
    const lines = [line()];
    await defaultLineSubs(world(), CO, lines, { staffDepartmentId: 'dept-other', floatId: 'f-cln' });
    expect(lines[0]).toMatchObject({ department: 'rental', sub_department_id: 's-cln' });
  });

  test('a receipt on a maintenance job is Maintenance, whoever hands it in', async () => {
    const lines = [line({ maintenance_issue_id: 'job-1', unit_id: 'u-a31' })];
    await defaultLineSubs(world(), CO, lines, { staffDepartmentId: 'dept-cln', floatId: 'f-cln' });
    expect(lines[0]).toMatchObject({ department: 'rental', sub_department_id: 's-mnt', unit_id: 'u-a31' });
  });

  test('a request takes the person’s own department’s', async () => {
    const lines = [line({ department: 'shared' })];
    await defaultLineSubs(world(), CO, lines, { staffDepartmentId: 'dept-inh', floatId: null });
    expect(lines[0]).toMatchObject({ department: 'supply', sub_department_id: 's-tc' });
  });

  test('a float whose department nobody mapped falls back to the department’s built-in row', async () => {
    const lines = [line()];
    await defaultLineSubs(world(), CO, lines, { staffDepartmentId: null, floatId: 'f-new' });
    expect(lines[0]).toMatchObject({ department: 'rental', sub_department_id: 's-gen' });
  });

  test('with no list (not set up yet) the lines stay as they were', async () => {
    const lines = [line()];
    await defaultLineSubs(world([]), CO, lines, { staffDepartmentId: 'dept-cln', floatId: 'f-cln' });
    expect(lines[0]).toMatchObject({ department: 'rental' });
    expect(lines[0]!.sub_department_id ?? null).toBeNull();
  });
});

describe('finance’s corrected lines', () => {
  test('carry the sub-department they name', () => {
    expect(parseLines([{ department: 'rental', subDepartmentId: 's-cln', amountSen: 100, accountCode: '906-0000' }])).toEqual([
      expect.objectContaining({ department: 'rental', sub_department_id: 's-cln' }),
    ]);
  });
});
