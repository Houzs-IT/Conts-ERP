/* An AP payment over an AP invoice split between projects (chew 11 Nov 2026: "我的ap invoice 已经分project和
   department了，但是ap payment 做不到"). TC-API-2611-004, Crafted Floors, RM 312.00: RM 180 + RM 90 for one project
   (175), RM 42 for another (324). Pinned:
     · the voucher saves, its AP line split by project in the invoice's proportions, to the sen;
     · paid in part, the split follows the same proportions; an advance beyond the bills names no project;
     · a project named in the header that is one of the bills' is left aside (the edit page sent the first line's);
       one that is none of the bills' is refused;
     · an edit splits it again; a voucher over one project's bills still names that one project on its line. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly, type Row } from '../src/scm/lib/fake-postgrest';
import { createPaymentVoucherHandler, updatePaymentVoucherHandler } from '../src/scm/routes/payment-vouchers';

const CO = 2;
const PROJECTS: Row[] = [
  { id: 175, company_id: CO, name: 'SKYLINE EMBASSY A-50-08', funding: 'customer', internal_department: null, limit_pct_bp: null, budget_sen: null },
  { id: 324, company_id: CO, name: 'ASTRUM R-52-29', funding: 'customer', internal_department: null, limit_pct_bp: null, budget_sen: null },
  { id: 7, company_id: CO, name: 'SOMETHING ELSE', funding: 'customer', internal_department: null, limit_pct_bp: null, budget_sen: null },
];
const SPLIT_LINES: Row[] = [
  { id: 'l1', company_id: CO, invoice_id: 'api-1', line_no: 1, debit_account_code: '601-0010', amount_sen: 18_000, project_id: 175, department: 'supply' },
  { id: 'l2', company_id: CO, invoice_id: 'api-1', line_no: 2, debit_account_code: '601-0010', amount_sen: 9_000, project_id: 175, department: 'supply' },
  { id: 'l3', company_id: CO, invoice_id: 'api-1', line_no: 3, debit_account_code: '601-0010', amount_sen: 4_200, project_id: 324, department: 'supply' },
  { id: 'l4', company_id: CO, invoice_id: 'api-2', line_no: 1, debit_account_code: '601-0010', amount_sen: 5_000, project_id: 175, department: 'supply' },
];

function harness(pv?: Row, lines: Row[] = [], allocations: Row[] = []) {
  const sb = publicTablesOnly(fakeSb({
    accounts: [
      { company_id: CO, account_code: '310-0010', account_name: 'HONG LEONG BANK', parent_code: null, is_active: true, acc_money: true, everyday_expense: false },
      { company_id: CO, account_code: '400-0000', account_name: 'ACCOUNT PAYABLE', parent_code: null, is_active: true, acc_money: false, everyday_expense: false, special_type: 'SCC' },
      { company_id: CO, account_code: '405-0000', account_name: 'OTHER CREDITORS', parent_code: null, is_active: true, acc_money: false, everyday_expense: false, special_type: 'SCC' },
    ],
    acc_account_roles: [], acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01', fiscal_year_end_month: 8, project_limit_pct_bp: 7000 }],
    acc_numbering: [], companies: [{ id: CO, code: '2990' }], entity_audit_log: [], journal_entries: [], journal_entry_lines: [],
    projects: PROJECTS, project_limit_requests: [], purchase_invoices: [], purchase_orders: [],
    suppliers: [{ id: 'sup-c', company_id: CO, code: '400-C008', name: 'CRAFTED FLOORS SDN BHD', control_account: null }],
    ap_invoices: [
      { id: 'api-1', company_id: CO, invoice_number: 'TC-API-2611-004', supplier_id: 'sup-c', total_sen: 31_200, paid_sen: 0, status: 'POSTED' },
      { id: 'api-2', company_id: CO, invoice_number: 'TC-API-2611-005', supplier_id: 'sup-c', total_sen: 5_000, paid_sen: 0, status: 'POSTED' },
    ],
    ap_invoice_lines: SPLIT_LINES.map((l) => ({ ...l })),
    pv_allocations: allocations,
    payment_voucher_lines: lines,
    payment_vouchers: pv ? [{ ...pv }] : [],
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
  return { app, sb };
}
const send = (app: Hono, method: 'POST' | 'PATCH', path: string, body: unknown) =>
  app.request(path, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const apPayment = (amountSen: number, allocations: unknown[], over: Record<string, unknown> = {}) => ({
  payeeName: 'CRAFTED FLOORS SDN BHD', purpose: 'SUPPLIER_PAYMENT', supplierId: 'sup-c', creditAccountCode: '310-0010',
  voucherDate: '2026-11-10', currency: 'MYR', exchangeRate: 1, notes: 'PAYMENT FOR INVOICE',
  lines: [{ description: 'Settle 1 invoice(s) — CRAFTED FLOORS SDN BHD', debitAccountCode: '400-0000', amountSen }],
  allocations, ...over,
});
const linesOf = (sb: ReturnType<typeof harness>['sb']) =>
  sb.tables.payment_voucher_lines.map((l) => [l.line_no, l.debit_account_code, l.project_id ?? null, l.amount_sen]);

describe('an AP payment over an invoice split between projects', () => {
  test('saves, its AP line split by project as the invoice is (RM 270 / RM 42)', async () => {
    const { app, sb } = harness();
    const res = await send(app, 'POST', '/payment-vouchers', apPayment(31_200, [{ apInvoiceId: 'api-1', amountSen: 31_200 }]));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(linesOf(sb)).toEqual([[1, '400-0000', 175, 27_000], [2, '400-0000', 324, 4_200]]);
    expect(sb.tables.payment_vouchers[0]!.total_sen).toBe(31_200);
  });

  test('paid in part, in the same proportions, to the sen', async () => {
    const { app, sb } = harness();
    const res = await send(app, 'POST', '/payment-vouchers', apPayment(15_600, [{ apInvoiceId: 'api-1', amountSen: 15_600 }]));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(linesOf(sb)).toEqual([[1, '400-0000', 175, 13_500], [2, '400-0000', 324, 2_100]]);
  });

  test('an advance paid beyond the invoice names no project', async () => {
    const { app, sb } = harness();
    const res = await send(app, 'POST', '/payment-vouchers', apPayment(41_200, [{ apInvoiceId: 'api-1', amountSen: 31_200 }]));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(linesOf(sb)).toEqual([[1, '400-0000', 175, 27_000], [2, '400-0000', 324, 4_200], [3, '400-0000', null, 10_000]]);
  });

  test("a header project that is one of the invoice's is left aside; one that is not is refused", async () => {
    const one = harness();
    const ok = await send(one.app, 'POST', '/payment-vouchers', apPayment(31_200, [{ apInvoiceId: 'api-1', amountSen: 31_200 }], { projectId: 175 }));
    expect(ok.status, await ok.clone().text()).toBe(201);
    expect(linesOf(one.sb)).toEqual([[1, '400-0000', 175, 27_000], [2, '400-0000', 324, 4_200]]);

    const other = harness();
    const bad = await send(other.app, 'POST', '/payment-vouchers', apPayment(31_200, [{ apInvoiceId: 'api-1', amountSen: 31_200 }], { projectId: 7 }));
    expect(bad.status).toBe(409);
    expect(await bad.json()).toMatchObject({ error: 'project_mismatch' });
    expect(other.sb.tables.payment_vouchers).toHaveLength(0);
  });

  test('an edit sending the first line’s project, as the edit page did, splits it again', async () => {
    const pv: Row = {
      id: 'pv-1', pv_number: '2990-Draft-2611-001', company_id: CO, voucher_date: '2026-11-10', payee_name: 'CRAFTED FLOORS SDN BHD',
      credit_account_code: '310-0010', total_sen: 31_200, currency: 'MYR', exchange_rate: 1, status: 'DRAFT', purpose: 'SUPPLIER_PAYMENT',
      supplier_id: 'sup-c', notes: null, payment_request_id: null, staff_receipt_id: null, petty_cash_float_id: null,
      submitted_at: null, submitted_by: null, checked_at: null, checked_by: null, approved_at: null, approved_by: null,
    };
    const lines: Row[] = [
      { id: 'pl1', pv_id: 'pv-1', company_id: CO, line_no: 1, description: 'Settle', debit_account_code: '400-0000', amount_sen: 27_000, department: 'supply', unit_id: null, project_id: 175 },
      { id: 'pl2', pv_id: 'pv-1', company_id: CO, line_no: 2, description: 'Settle', debit_account_code: '400-0000', amount_sen: 4_200, department: 'supply', unit_id: null, project_id: 324 },
    ];
    const allocations: Row[] = [{ id: 'al1', company_id: CO, pv_id: 'pv-1', pi_id: null, ap_invoice_id: 'api-1', amount_sen: 31_200 }];
    const { app, sb } = harness(pv, lines, allocations);
    const body = apPayment(15_600, [{ apInvoiceId: 'api-1', amountSen: 15_600 }], { projectId: 175 });
    const res = await send(app, 'PATCH', '/payment-vouchers/pv-1', body);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(linesOf(sb)).toEqual([[1, '400-0000', 175, 13_500], [2, '400-0000', 324, 2_100]]);
  });

  test('an invoice of one project still names that one project on the line', async () => {
    const { app, sb } = harness();
    const res = await send(app, 'POST', '/payment-vouchers', apPayment(5_000, [{ apInvoiceId: 'api-2', amountSen: 5_000 }]));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(linesOf(sb)).toEqual([[1, '400-0000', 175, 5_000]]);
  });
});
