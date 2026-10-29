/* The project limit (Conts, finance phase 1.5; SOP 3.4). Pinned with the SOP's own example — limit RM 7,000:
   A asks RM 3,000 → 4,000 left; B asks RM 2,500 → 1,500 left; C asks RM 2,000 → over by RM 500, refused; B is
   rejected → 4,000 left; C asks again → 2,000 left. And:
     · a customer project's limit is 70% (the company's share, or the project's own) of what the customer paid;
     · an approved extra amount adds to it; an internal project spends against its budget;
     · lines on an everyday-expense account (rent, utilities) do not count;
     · a voucher paying one project's bills names that project; one paying two projects' bills is refused. */
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly, type Row } from '../scm/lib/fake-postgrest';
import { checkVoucherLimit, projectLimit, projectOfBills } from './project-limit';

const CO = 1;
const pv = (id: string, sen: number, over: Row = {}): Row[] => [
  { id, company_id: CO, status: 'DRAFT', submitted_at: null, total_sen: sen, ...over },
];
const line = (pvId: string, sen: number, project: number | null = 7, account = '601-0001'): Row => ({ id: `${pvId}-l`, pv_id: pvId, company_id: CO, project_id: project, amount_sen: sen, debit_account_code: account });
const world = (over: Record<string, Row[]> = {}) => publicTablesOnly(fakeSb({
  projects: [
    { id: 7, company_id: CO, name: 'SKYLINE A-12-06', funding: 'customer', limit_pct_bp: null, budget_sen: null },
    { id: 8, company_id: CO, name: 'SHOWROOM', funding: 'internal', limit_pct_bp: null, budget_sen: 500_000 },
  ],
  acc_company_settings: [{ company_id: CO, project_limit_pct_bp: 7000 }],
  accounts: [
    { company_id: CO, account_code: '601-0001', everyday_expense: false },
    { company_id: CO, account_code: '903-0001', everyday_expense: true },
  ],
  mfg_sales_orders: [{ doc_no: 'SO-1', company_id: CO, project_id: 7, status: 'RENO_IN_PROGRESS' }],
  mfg_sales_order_payments: [{ id: 'p1', company_id: CO, so_doc_no: 'SO-1', amount_sen: 1_000_000, method: 'transfer' }],
  sales_invoices: [], sales_invoice_payments: [],
  payment_vouchers: [], payment_voucher_lines: [],
  project_limit_requests: [],
  purchase_invoices: [], purchase_orders: [], ap_invoice_lines: [],
  ...over,
}), ['projects', 'project_brands']);

describe('a project’s limit', () => {
  test('70% of what the customer paid', async () => {
    expect(await projectLimit(world(), CO, 7)).toMatchObject({ ok: true, funding: 'customer', pctBp: 7000, limitSen: 700_000, usedSen: 0, reservedSen: 0, leftSen: 700_000 });
  });

  test('the SOP’s example: reserved on submit, refused when over, given back on reject', async () => {
    const sb = world({
      payment_vouchers: [...pv('A', 300_000, { submitted_at: '2026-11-01T00:00:00Z' }), ...pv('B', 250_000, { submitted_at: '2026-11-02T00:00:00Z' }), ...pv('C', 200_000)],
      payment_voucher_lines: [line('A', 300_000), line('B', 250_000), line('C', 200_000)],
    });
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ reservedSen: 550_000, leftSen: 150_000 });
    expect(await checkVoucherLimit(sb, CO, 'C')).toEqual({ ok: false, over: [{ projectId: 7, projectName: 'SKYLINE A-12-06', leftSen: 150_000, overSen: 50_000 }] });
    sb.tables.payment_vouchers.find((v) => v.id === 'B')!.submitted_at = null;
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ leftSen: 400_000 });
    expect(await checkVoucherLimit(sb, CO, 'C')).toEqual({ ok: true });
  });

  test('a voucher already submitted is not counted against itself; a posted one is used, a cancelled one nothing', async () => {
    const sb = world({
      payment_vouchers: [...pv('A', 600_000, { submitted_at: '2026-11-01T00:00:00Z' }), ...pv('P', 50_000, { status: 'POSTED' }), ...pv('X', 900_000, { status: 'CANCELLED', submitted_at: '2026-11-01T00:00:00Z' })],
      payment_voucher_lines: [line('A', 600_000), line('P', 50_000), line('X', 900_000)],
    });
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ usedSen: 50_000, reservedSen: 600_000, leftSen: 50_000 });
    expect(await checkVoucherLimit(sb, CO, 'A')).toEqual({ ok: true });
  });

  test('an approved extra amount adds to the limit; a pending one does not', async () => {
    const sb = world({ project_limit_requests: [
      { id: 'r1', company_id: CO, project_id: 7, kind: 'amount', amount_sen: 100_000, status: 'APPROVED' },
      { id: 'r2', company_id: CO, project_id: 7, kind: 'amount', amount_sen: 900_000, status: 'PENDING' },
    ] });
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ limitSen: 800_000 });
  });

  test('a project’s own share replaces the company’s', async () => {
    const sb = world();
    sb.tables.projects[0].limit_pct_bp = 8000;
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ pctBp: 8000, limitSen: 800_000 });
  });

  test('an internal project spends against its budget; everyday expense lines are not counted', async () => {
    const sb = world({
      payment_vouchers: [...pv('R', 400_000, { status: 'POSTED' })],
      payment_voucher_lines: [line('R', 300_000, 8, '903-0001'), { ...line('R', 100_000, 8), id: 'R-2' }],
      project_limit_requests: [{ id: 'r1', company_id: CO, project_id: 8, kind: 'budget', amount_sen: 200_000, status: 'APPROVED' }],
    });
    expect(await projectLimit(sb, CO, 8)).toMatchObject({ funding: 'internal', limitSen: 700_000, usedSen: 100_000, leftSen: 600_000 });
  });
});

describe('the project a voucher pays', () => {
  const bills = () => world({
    purchase_orders: [{ id: 'po-1', company_id: CO, project_id: 7 }, { id: 'po-2', company_id: CO, project_id: 9 }],
    purchase_invoices: [{ id: 'pi-1', company_id: CO, purchase_order_id: 'po-1' }, { id: 'pi-2', company_id: CO, purchase_order_id: 'po-2' }, { id: 'pi-3', company_id: CO, purchase_order_id: null }],
    ap_invoice_lines: [{ id: 'al-1', invoice_id: 'ap-1', project_id: 7, amount_sen: 10 }],
  });

  test('bills of one project name it; bills of no project name none', async () => {
    expect(await projectOfBills(bills(), CO, { piIds: ['pi-1'], apInvoiceIds: ['ap-1'] })).toEqual({ ok: true, projectId: 7 });
    expect(await projectOfBills(bills(), CO, { piIds: ['pi-3'], apInvoiceIds: [] })).toEqual({ ok: true, projectId: null });
  });

  test('bills of two projects are refused', async () => {
    expect(await projectOfBills(bills(), CO, { piIds: ['pi-1', 'pi-2'], apInvoiceIds: [] })).toMatchObject({ ok: false, error: 'many_projects' });
  });
});

describe('a new project’s funding', () => {
  test('customer by default; internal needs its department and budget', async () => {
    const { fundingFrom } = await import('./project-limit');
    expect(fundingFrom({})).toEqual({ ok: true, funding: 'customer', department: null, budgetSen: null });
    expect(fundingFrom({ funding: 'internal', internalDepartment: 'supply', budgetSen: 5_000_000 })).toEqual({ ok: true, funding: 'internal', department: 'supply', budgetSen: 5_000_000 });
    expect(fundingFrom({ funding: 'internal', budgetSen: 5_000_000 })).toEqual({ ok: false, error: 'department_required' });
    expect(fundingFrom({ funding: 'internal', internalDepartment: 'rental' })).toEqual({ ok: false, error: 'budget_required' });
    expect(fundingFrom({ funding: 'owner' })).toEqual({ ok: false, error: 'funding_invalid' });
  });
});

/* Staff receipts and payment requests (design 2026-10-28 §4.5-4.6): a receipt counts as used from the moment it is
   handed in, until its own pay-back voucher takes over; a request reserves only what its vouchers do not yet carry. */
describe('receipts and requests', () => {
  const rc = (id: string, status: string, payback: string | null = null, floatId: string | null = 'F1'): Row => ({ id, company_id: CO, status, payback_pv_id: payback, float_id: floatId });
  const rl = (receipt: string, sen: number, account = '601-0001'): Row => ({ id: `${receipt}-l`, receipt_id: receipt, project_id: 7, amount_sen: sen, account_code: account });

  test('a receipt handed in is used at once; a replaced, repaid or written-off one is not; an everyday one never', async () => {
    const sb = world({
      staff_receipts: [rc('R1', 'HANDED_IN'), rc('R2', 'REPLACED'), rc('R3', 'REJECTED'), rc('R4', 'REPAID'), rc('R5', 'CHECKED')],
      staff_receipt_lines: [rl('R1', 5000), rl('R2', 9000), rl('R3', 1000), rl('R4', 7000), rl('R5', 2000, '903-0001')],
    });
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ usedSen: 6000, reservedSen: 0 });
  });

  test('a pay-back voucher not yet posted leaves the receipt counting, and is not counted itself', async () => {
    const sb = world({
      staff_receipts: [rc('R1', 'CHECKED', 'PB', null)],
      staff_receipt_lines: [rl('R1', 5000)],
      payment_vouchers: pv('PB', 5000, { submitted_at: '2026-11-01T00:00:00Z', staff_receipt_id: 'R1' }),
      payment_voucher_lines: [line('PB', 5000)],
    });
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ usedSen: 5000, reservedSen: 0 });
    expect(await checkVoucherLimit(sb, CO, 'PB')).toEqual({ ok: true });
  });

  test('a rejected receipt finance never paid does not count', async () => {
    const sb = world({ staff_receipts: [rc('R1', 'REJECTED', null, null)], staff_receipt_lines: [rl('R1', 5000)] });
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ usedSen: 0 });
  });

  test('once its pay-back voucher exists, that voucher counts instead, never both', async () => {
    const sb = world({
      staff_receipts: [rc('R1', 'PAID_BACK', 'PB')],
      staff_receipt_lines: [rl('R1', 5000)],
      payment_vouchers: pv('PB', 5000, { status: 'POSTED' }),
      payment_voucher_lines: [line('PB', 5000)],
    });
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ usedSen: 5000 });
  });

  test('a request reserves what its vouchers do not carry; a closed one reserves nothing', async () => {
    const sb = world({
      payment_requests: [{ id: 'Q1', company_id: CO, status: 'PART_PAID' }, { id: 'Q2', company_id: CO, status: 'CLOSED' }],
      payment_request_lines: [{ request_id: 'Q1', project_id: 7, amount_sen: 10_000, account_code: '601-0001' }, { request_id: 'Q2', project_id: 7, amount_sen: 50_000, account_code: '601-0001' }],
      payment_vouchers: pv('PQ', 4000, { status: 'POSTED', payment_request_id: 'Q1' }),
      payment_voucher_lines: [line('PQ', 4000)],
    });
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ usedSen: 4000, reservedSen: 6000 });
  });
});
