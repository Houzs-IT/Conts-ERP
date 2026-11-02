/* Each payment voucher line says what it is for (chew 2 Nov 2026; plan docs/superpowers/plans/2026-11-02-voucher-line-
   purpose.md Task 1). Pinned:
     · a line names a unit (Rental), a project (its department follows the project) or neither (the department sent);
     · lines of one plain voucher may name different projects, and each keeps its own on create and on edit;
     · a unit and a project on one line, or another company's project, are refused;
     · a voucher made from a payment request keeps its lines' projects when its header changes;
     · a voucher paying bills still pays one project. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly, type Row } from '../src/scm/lib/fake-postgrest';
import { buildLines, createPaymentVoucherHandler, submitPaymentVoucherHandler, updatePaymentVoucherHandler } from '../src/scm/routes/payment-vouchers';
import { lineDepartmentOfProject } from '../src/conts/project-limit';

const CO = 2;
const DRAFT: Row = {
  id: 'pv-1', pv_number: '2990-Draft-2612-001', company_id: CO, voucher_date: '2026-12-03',
  payee_name: 'Carpenter', credit_account_code: '310-0010', total_sen: 30_000, currency: 'MYR', exchange_rate: 1,
  status: 'DRAFT', purpose: 'GENERAL_EXPENSE', supplier_id: null, notes: null, payment_request_id: null, staff_receipt_id: null, petty_cash_float_id: null,
  submitted_at: null, submitted_by: null, checked_at: null, checked_by: null, approved_at: null, approved_by: null,
};
const PROJECTS: Row[] = [
  { id: 7, company_id: CO, name: 'SKYLINE A-12-06', funding: 'customer', internal_department: null, limit_pct_bp: null, budget_sen: null },
  { id: 8, company_id: CO, name: 'C15-13 OWN RENO', funding: 'internal', internal_department: 'rental', limit_pct_bp: null, budget_sen: 1_000_000 },
  { id: 9, company_id: CO, name: 'SHOWROOM', funding: 'internal', internal_department: 'supply', limit_pct_bp: null, budget_sen: 1_000_000 },
  { id: 99, company_id: 5, name: 'OTHER CO', funding: 'customer', internal_department: null, limit_pct_bp: null, budget_sen: null },
];
function harness(lines: Row[] = [], pv: Row = DRAFT) {
  const sb = publicTablesOnly(fakeSb({
    accounts: [
      { company_id: CO, account_code: '310-0010', account_name: 'MAYBANK', parent_code: null, is_active: true, acc_money: true, everyday_expense: false },
      { company_id: CO, account_code: '601-0001', account_name: 'RENOVATION COST', parent_code: null, is_active: true, acc_money: false, everyday_expense: false },
      { company_id: CO, account_code: '620-0010', account_name: 'REPAIRS', parent_code: null, is_active: true, acc_money: false, everyday_expense: false },
    ],
    acc_account_roles: [], acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8, project_limit_pct_bp: 7000 }],
    acc_numbering: [], companies: [{ id: CO, code: '2990' }], entity_audit_log: [], journal_entries: [], journal_entry_lines: [],
    projects: PROJECTS, project_limit_requests: [], purchase_invoices: [], purchase_orders: [], ap_invoice_lines: [], pv_allocations: [],
    conts_units: [{ id: 'u-a31', building: 'ASTER HILL', unit_number: 'A-3-1' }],
    payment_voucher_lines: lines,
    payment_vouchers: [{ ...pv }],
  }, {}, [{ table: 'payment_vouchers', column: 'pv_number', name: 'payment_vouchers_pv_number_key' }]), ['projects', 'project_brands', 'conts_units']);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { id: 9, name: 'Chew', permissions_set: new Set(['*']) } as never);
    c.set('allowedCompanyIds' as never, [CO] as never);
    c.set('companies' as never, [{ id: CO, code: '2990' }] as never);
    c.set('companyCode' as never, '2990' as never);
    await next();
  });
  app.post('/payment-vouchers', createPaymentVoucherHandler as never);
  app.patch('/payment-vouchers/:id', updatePaymentVoucherHandler as never);
  app.post('/payment-vouchers/:id/submit', submitPaymentVoucherHandler as never);
  return { app, sb };
}
const send = (app: Hono, method: 'POST' | 'PATCH', path: string, body: unknown) => app.request(path, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const create = (app: Hono, lines: unknown[], over: Record<string, unknown> = {}) =>
  send(app, 'POST', '/payment-vouchers', { payeeName: 'Carpenter', creditAccountCode: '310-0010', voucherDate: '2026-12-03', lines, ...over });
const line = (over: Row = {}) => ({ debitAccountCode: '601-0001', description: 'Work', amountSen: 10_000, ...over });

describe('lineDepartmentOfProject', () => {
  test('a customer project is Renovation; an internal one follows its own department', () => {
    expect(lineDepartmentOfProject({ funding: 'customer', internal_department: null })).toBe('supply');
    expect(lineDepartmentOfProject({ funding: 'internal', internal_department: 'rental' })).toBe('rental');
    expect(lineDepartmentOfProject({ funding: 'internal', internal_department: 'supply' })).toBe('supply');
    expect(lineDepartmentOfProject({ funding: 'internal', internal_department: null })).toBe('supply');
  });
});

describe('buildLines', () => {
  test('a unit makes the line Rental; a unit and a project together are refused', () => {
    const ok = buildLines([line({ department: 'shared', unitId: 'u-a31' })]);
    expect('rows' in ok && ok.rows.map((r) => [r.department, r.unit_id])).toEqual([['rental', 'u-a31']]);
    expect(buildLines([line({ unitId: 'u-a31', projectId: 7 })])).toEqual({ error: 'unit_and_project' });
  });
});

describe('creating a plain voucher', () => {
  test('lines on two projects, a unit and the company each keep their own; departments follow', async () => {
    const { app, sb } = harness();
    const res = await create(app, [
      line({ projectId: 7, department: 'shared' }),
      line({ projectId: 8 }),
      line({ debitAccountCode: '620-0010', unitId: 'u-a31' }),
      line({ debitAccountCode: '620-0010', department: 'shared' }),
    ]);
    expect(res.status, await res.clone().text()).toBe(201);
    expect(sb.tables.payment_voucher_lines.map((l) => [l.department, l.project_id ?? null, l.unit_id ?? null])).toEqual([
      ['supply', 7, null], ['rental', 8, null], ['rental', null, 'u-a31'], ['shared', null, null],
    ]);
  });
  test("another company's project is refused", async () => {
    const { app, sb } = harness();
    const res = await create(app, [line({ projectId: 99 })]);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'project_invalid' });
    expect(sb.tables.payment_voucher_lines).toHaveLength(0);
  });
  test('an older caller naming one project in the header still has it on the lines that name nothing', async () => {
    const { app, sb } = harness();
    expect((await create(app, [line(), line({ debitAccountCode: '620-0010', unitId: 'u-a31' })], { projectId: 9 })).status).toBe(201);
    expect(sb.tables.payment_voucher_lines.map((l) => l.project_id ?? null)).toEqual([9, null]);
  });
});

describe('editing a plain voucher', () => {
  const two: Row[] = [
    { id: 'l1', pv_id: 'pv-1', company_id: CO, line_no: 1, description: 'A', debit_account_code: '601-0001', amount_sen: 10_000, department: 'supply', unit_id: null, project_id: 7 },
    { id: 'l2', pv_id: 'pv-1', company_id: CO, line_no: 2, description: 'B', debit_account_code: '601-0001', amount_sen: 20_000, department: 'rental', unit_id: null, project_id: 8 },
  ];
  test('lines that do not name a project keep their own (no one project stamped on all)', async () => {
    const { app, sb } = harness(two);
    const res = await send(app, 'PATCH', '/payment-vouchers/pv-1', { lines: [line({ description: 'A2', department: 'supply' }), line({ description: 'B2', amountSen: 20_000, department: 'rental' })] });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(sb.tables.payment_voucher_lines.map((l) => [l.description, l.project_id])).toEqual([['A2', 7], ['B2', 8]]);
  });
  test('a line can move to another project', async () => {
    const { app, sb } = harness(two);
    expect((await send(app, 'PATCH', '/payment-vouchers/pv-1', { lines: [line({ projectId: 9 }), line({ amountSen: 20_000, projectId: 8 })] })).status).toBe(200);
    expect(sb.tables.payment_voucher_lines.map((l) => [l.project_id, l.department])).toEqual([[9, 'supply'], [8, 'rental']]);
  });
  test('a voucher made from a payment request keeps its lines’ projects when only the header changes', async () => {
    const { app, sb } = harness(two, { ...DRAFT, payment_request_id: 'pr-1' });
    expect((await send(app, 'PATCH', '/payment-vouchers/pv-1', { payeeName: 'Carpenter Sdn Bhd', projectId: null })).status).toBe(200);
    expect(sb.tables.payment_voucher_lines.map((l) => l.project_id)).toEqual([7, 8]);
  });
});

describe('the project limit on a voucher with two projects', () => {
  test('each line counts against its own project: the one over its budget is named', async () => {
    const lines: Row[] = [
      { id: 'l1', pv_id: 'pv-1', company_id: CO, line_no: 1, description: 'Showroom', debit_account_code: '601-0001', amount_sen: 100_000, department: 'supply', unit_id: null, project_id: 9 },
      { id: 'l2', pv_id: 'pv-1', company_id: CO, line_no: 2, description: 'Own unit', debit_account_code: '601-0001', amount_sen: 1_200_000, department: 'rental', unit_id: null, project_id: 8 },
    ];
    const { app } = harness(lines, { ...DRAFT, total_sen: 1_300_000 });
    const res = await app.request('/payment-vouchers/pv-1/submit', { method: 'POST' });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; over: Array<{ projectId: number }> };
    expect(body.error).toBe('over_project_limit');
    expect(body.over.map((o) => o.projectId)).toEqual([8]);
  });
});
