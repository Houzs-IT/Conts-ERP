/* Sub-departments (Conts; SOP 1.1, chew 4 Nov 2026). Pinned:
     · a line with no sub-department reads as its department's built-in row, and keeps department as sent;
     · a sub-department decides the line's department; an unknown one is refused;
     · a retired one is refused on a new line, kept on a line that already had it;
     · a project's brand is its own kind, else its brand's, else Dream Crafter (renovation);
     · a staff department nobody mapped falls back to the department's built-in row. */
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { defaultSubDepartment, loadSubDepartments, projectRenoKind, resolveLineSub, subForStaffDepartment, type SubDepartment } from './sub-departments';

const CO = 1;
const row = (id: string, department: string, name: string, over: Record<string, unknown> = {}) =>
  ({ id, company_id: CO, department, name, fixed_key: null, staff_department_id: null, active: true, sort: 0, ...over });
const ROWS = [
  row('s-cln', 'rental', 'Cleaning', { staff_department_id: 'dept-cln', sort: 30 }),
  row('s-gen', 'rental', 'Rental (general)', { fixed_key: 'rental_general', sort: 10 }),
  row('s-dc', 'supply', 'Renovation (Dream Crafter)', { fixed_key: 'dreamcrafter', sort: 10 }),
  row('s-tc', 'supply', 'In-house Reno (The Conts)', { fixed_key: 'theconts', sort: 20, staff_department_id: 'dept-inh' }),
  row('s-co', 'shared', 'Company', { fixed_key: 'company', sort: 10 }),
  row('s-old', 'rental', 'Laundry', { active: false, sort: 40 }),
  row('s-other', 'rental', 'Not ours', { company_id: 2 }),
];
const world = () => publicTablesOnly(fakeSb({
  acc_sub_departments: ROWS.map((r) => ({ ...r })),
  projects: [
    { id: 7, company_id: CO, finance_kind: 'INHOUSE_RENOVATION', brand: 'Dream Crafter' },
    { id: 8, company_id: CO, finance_kind: null, brand: 'The Conts' },
    { id: 9, company_id: CO, finance_kind: null, brand: null },
  ],
  project_brands: [
    { id: 1, company_id: CO, name: 'The Conts', finance_kind: 'INHOUSE_RENOVATION' },
    { id: 2, company_id: CO, name: 'Dream Crafter', finance_kind: 'RENOVATION' },
  ],
}), ['projects', 'project_brands']);

async function list(): Promise<SubDepartment[]> {
  const r = await loadSubDepartments(world(), CO);
  if (!r.ok) throw new Error(r.error);
  return r.list;
}

describe('sub-departments', () => {
  test('the company’s list, by department then order; retired ones included', async () => {
    expect((await list()).map((s) => s.name)).toEqual([
      'Rental (general)', 'Cleaning', 'Laundry', 'Renovation (Dream Crafter)', 'In-house Reno (The Conts)', 'Company',
    ]);
  });

  test('each department’s built-in row', async () => {
    const l = await list();
    expect(defaultSubDepartment(l, 'rental').fixedKey).toBe('rental_general');
    expect(defaultSubDepartment(l, 'supply').fixedKey).toBe('dreamcrafter');
    expect(defaultSubDepartment(l, 'shared').fixedKey).toBe('company');
  });

  test('no sub-department reads as the department default', async () => {
    expect(resolveLineSub(await list(), { department: 'rental' })).toEqual({ ok: true, department: 'rental', subDepartmentId: null });
  });

  test('a sub-department sets its department', async () => {
    expect(resolveLineSub(await list(), { department: 'supply', subDepartmentId: 's-cln' })).toEqual({ ok: true, department: 'rental', subDepartmentId: 's-cln' });
  });

  test('an unknown sub-department, or another company’s, is refused', async () => {
    const l = await list();
    expect(resolveLineSub(l, { subDepartmentId: 'nope' })).toMatchObject({ ok: false, error: 'sub_department_invalid' });
    expect(resolveLineSub(l, { subDepartmentId: 's-other' })).toMatchObject({ ok: false, error: 'sub_department_invalid' });
  });

  test('an unknown department with no sub-department is refused', async () => {
    expect(resolveLineSub(await list(), { department: 'warehouse' })).toMatchObject({ ok: false, error: 'sub_department_invalid' });
  });

  test('a retired sub-department is refused on a new line, kept on a line that already had it', async () => {
    const l = await list();
    expect(resolveLineSub(l, { subDepartmentId: 's-old' })).toMatchObject({ ok: false, error: 'sub_department_invalid' });
    expect(resolveLineSub(l, { subDepartmentId: 's-old' }, { saved: 's-old' })).toEqual({ ok: true, department: 'rental', subDepartmentId: 's-old' });
  });

  test('projectRenoKind: own kind, else brand, else renovation', async () => {
    const m = await projectRenoKind(world(), CO, [7, 8, 9]);
    expect(Object.fromEntries(m)).toEqual({ 7: 'INHOUSE_RENOVATION', 8: 'INHOUSE_RENOVATION', 9: 'RENOVATION' });
  });

  test('a mapped staff department gives its sub-department; one nobody mapped falls back to the department default', async () => {
    const l = await list();
    expect(subForStaffDepartment(l, 'dept-cln', 'rental').name).toBe('Cleaning');
    expect(subForStaffDepartment(l, 'dept-inh', 'shared').fixedKey).toBe('theconts');
    expect(subForStaffDepartment(l, 'dept-unmapped', 'rental').fixedKey).toBe('rental_general');
    expect(subForStaffDepartment(l, null, 'supply').fixedKey).toBe('dreamcrafter');
  });
});
