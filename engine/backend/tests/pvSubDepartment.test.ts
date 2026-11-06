/* A payment voucher line's sub-department (SOP 1.1; chew 4 Nov 2026; plan 2026-11-04-sub-departments Task 4). Pinned:
     · a sub-department sets the line's department; a renovation one needs no project (the brand's own cost);
     · a project on a renovation line must be that brand's; on a Rental line an internal Rental project; on Company none;
     · a unit only goes with a Rental sub-department;
     · an older voucher saved without sub-departments keeps its lines exactly (null sub-department, same department). */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly, type Row } from '../src/scm/lib/fake-postgrest';
import { updatePaymentVoucherHandler } from '../src/scm/routes/payment-vouchers';

const CO = 2;
const DRAFT: Row = {
  id: 'pv-1', pv_number: '2990-Draft-2611-001', company_id: CO, voucher_date: '2026-11-03',
  payee_name: 'Hardware', credit_account_code: '310-0010', total_sen: 35_000, currency: 'MYR', exchange_rate: 1,
  status: 'DRAFT', purpose: 'GENERAL_EXPENSE', supplier_id: null, notes: null,
  submitted_at: null, submitted_by: null, checked_at: null, checked_by: null, approved_at: null, approved_by: null,
};
const sub = (id: string, department: string, name: string, fixed_key: string | null = null, active = true) =>
  ({ id, company_id: CO, department, name, fixed_key, staff_department_id: null, active, sort: 0 });
function harness(lines: Row[] = [
  { id: 'l1', pv_id: 'pv-1', company_id: CO, line_no: 1, description: 'Tools', debit_account_code: '620-0010', amount_sen: 35_000, department: 'supply', unit_id: null, project_id: null },
]) {
  const sb = publicTablesOnly(fakeSb({
    accounts: [
      { company_id: CO, account_code: '310-0010', account_name: 'MAYBANK', parent_code: null, is_active: true, acc_money: true, everyday_expense: false },
      { company_id: CO, account_code: '620-0010', account_name: 'TOOLS', parent_code: null, is_active: true, acc_money: false, everyday_expense: false },
    ],
    acc_account_roles: [], acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01', fiscal_year_end_month: 8 }],
    companies: [{ id: CO, code: '2990' }], entity_audit_log: [], journal_entries: [], journal_entry_lines: [],
    acc_sub_departments: [
      sub('s-gen', 'rental', 'Rental (general)', 'rental_general'), sub('s-cln', 'rental', 'Cleaning'),
      sub('s-dc', 'supply', 'Renovation (Dream Crafter)', 'dreamcrafter'), sub('s-tc', 'supply', 'In-house Reno (The Conts)', 'theconts'),
      sub('s-co', 'shared', 'Company', 'company'), sub('s-old', 'rental', 'Laundry', null, false),
    ],
    projects: [
      { id: 7, company_id: CO, name: 'SKYLINE', funding: 'customer', internal_department: null, finance_kind: null, brand: 'Dream Crafter' },
      { id: 8, company_id: CO, name: 'TROFI', funding: 'customer', internal_department: null, finance_kind: 'INHOUSE_RENOVATION', brand: null },
      { id: 9, company_id: CO, name: 'A-3-1 FIT-OUT', funding: 'internal', internal_department: 'rental', finance_kind: null, brand: null },
    ],
    project_brands: [{ id: 1, company_id: CO, name: 'Dream Crafter', finance_kind: 'RENOVATION' }],
    project_limit_requests: [], purchase_invoices: [], purchase_orders: [], ap_invoice_lines: [], pv_allocations: [],
    conts_units: [{ id: 'u-a31', building: 'ASTER HILL', unit_number: 'A-3-1' }],
    payment_voucher_lines: lines,
    payment_vouchers: [{ ...DRAFT }],
  }), ['projects', 'project_brands', 'conts_units']);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { name: 'Chew', permissions_set: ['scm.payment_voucher.write'] } as never);
    c.set('allowedCompanyIds' as never, [CO] as never);
    c.set('companies' as never, [{ id: CO, code: '2990' }] as never);
    c.set('companyCode' as never, '2990' as never);
    await next();
  });
  app.patch('/payment-vouchers/:id', updatePaymentVoucherHandler as never);
  return { app, sb };
}
const patch = (app: Hono, body: unknown) => app.request('/payment-vouchers/pv-1', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const line = (over: Row = {}) => ({ debitAccountCode: '620-0010', description: 'Tools', amountSen: 35_000, ...over });
const saved = (sb: ReturnType<typeof harness>['sb']) => sb.tables.payment_voucher_lines.map((l) => [l.department, l.sub_department_id ?? null, l.project_id ?? null, l.unit_id ?? null]);
const message = async (r: Response) => ((await r.json()) as { message?: string; error?: string });

describe('a voucher line’s sub-department', () => {
  test('In-house Reno with no project: the brand’s own cost', async () => {
    const { app, sb } = harness();
    expect((await patch(app, { lines: [line({ subDepartmentId: 's-tc', projectId: null })] })).status).toBe(200);
    expect(saved(sb)).toEqual([['supply', 's-tc', null, null]]);
  });

  test('a sub-department decides the department over the one sent', async () => {
    const { app, sb } = harness();
    expect((await patch(app, { lines: [line({ department: 'supply', subDepartmentId: 's-cln', unitId: 'u-a31' })] })).status).toBe(200);
    expect(saved(sb)).toEqual([['rental', 's-cln', null, 'u-a31']]);
  });

  test('a project of the other brand is refused, and nothing changes', async () => {
    const { app, sb } = harness();
    const r = await patch(app, { lines: [line({ subDepartmentId: 's-tc', projectId: 7 })] });
    expect(r.status).toBe(400);
    expect((await message(r)).message).toBe('SKYLINE is a Dream Crafter project.');
    const r2 = await patch(app, { lines: [line({ subDepartmentId: 's-dc', projectId: 8 })] });
    expect((await message(r2)).message).toBe('TROFI is a The Conts project.');
    expect(saved(sb)).toEqual([['supply', null, null, null]]);
  });

  test('the brand’s own project is taken', async () => {
    const { app, sb } = harness();
    expect((await patch(app, { lines: [line({ subDepartmentId: 's-tc', projectId: 8 })] })).status).toBe(200);
    expect(saved(sb)).toEqual([['supply', 's-tc', 8, null]]);
  });

  test('a Rental line takes an internal Rental project; a renovation line does not; Company takes none', async () => {
    const { app, sb } = harness();
    expect((await patch(app, { lines: [line({ subDepartmentId: 's-gen', projectId: 9 })] })).status).toBe(200);
    expect(saved(sb)).toEqual([['rental', 's-gen', 9, null]]);
    expect((await message(await patch(app, { lines: [line({ subDepartmentId: 's-dc', projectId: 9 })] }))).message).toBe('A-3-1 FIT-OUT is a Rental project.');
    expect((await message(await patch(app, { lines: [line({ subDepartmentId: 's-gen', projectId: 7 })] }))).message).toBe('SKYLINE is a Renovation project.');
    expect((await message(await patch(app, { lines: [line({ subDepartmentId: 's-co', projectId: 7 })] }))).message).toBe('A Company line names no project.');
  });

  test('a unit only goes with a Rental sub-department', async () => {
    const { app } = harness();
    const r = await patch(app, { lines: [line({ subDepartmentId: 's-tc', unitId: 'u-a31' })] });
    expect(r.status).toBe(400);
    expect((await message(r)).error).toBe('unit_needs_rental');
  });

  test('a retired or unknown sub-department is refused on a new line, kept on its own line', async () => {
    const { app, sb } = harness([
      { id: 'l1', pv_id: 'pv-1', company_id: CO, line_no: 1, description: 'Towels', debit_account_code: '620-0010', amount_sen: 35_000, department: 'rental', sub_department_id: 's-old', unit_id: null, project_id: null },
    ]);
    expect((await patch(app, { lines: [line({ subDepartmentId: 's-old' }), line({ subDepartmentId: 's-old' })] })).status).toBe(400);
    expect((await patch(app, { lines: [line({ subDepartmentId: 'nope' })] })).status).toBe(400);
    expect((await patch(app, { lines: [line({ subDepartmentId: 's-old' })] })).status).toBe(200);
    expect(saved(sb)).toEqual([['rental', 's-old', null, null]]);
  });

  test('an older voucher saved without sub-departments keeps its lines exactly', async () => {
    const { app, sb } = harness([
      { id: 'l1', pv_id: 'pv-1', company_id: CO, line_no: 1, description: 'Tools', debit_account_code: '620-0010', amount_sen: 35_000, department: 'supply', unit_id: null, project_id: 7 },
      { id: 'l2', pv_id: 'pv-1', company_id: CO, line_no: 2, description: 'Mops', debit_account_code: '620-0010', amount_sen: 1_000, department: 'rental', sub_department_id: 's-cln', unit_id: null, project_id: null },
    ]);
    expect((await patch(app, { lines: [line({ department: 'supply' }), line({ description: 'Mops', amountSen: 1_000, department: 'rental' })] })).status).toBe(200);
    expect(saved(sb)).toEqual([['supply', null, 7, null], ['rental', 's-cln', null, null]]);
  });
});
