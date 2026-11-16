/* A payment request paid through an AP invoice (chew, 15 Nov 2026; spec 2026-11-15-request-to-ap-invoice-design.md).
   Pinned:
     · a request linked to a bill follows the bill: paid when the bill is paid, whether the bill came to more or less
       than asked; a deposit still by its own amount; a cancelled bill hands the request back to its own vouchers;
     · the request the bill was made from takes the bill's lines and total, keeping what was first asked;
     · finance makes the bill once per request; the request is then refused withdraw, reject and Make voucher;
     · the requester asks for a paid deposit's balance with nothing filled in again: what the bill still owes, spread
       over its lines, one open balance at a time;
     · a voucher made on the Payment voucher page against the bill takes over the request's project reservation. */
import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { linkedRequestStatus, spreadSen } from './payment-requests';
import { settleRequest } from './claims-voucher-hooks';
import { afterBillSavedBestEffort, releaseRequestsOfBillBestEffort } from './request-ap-invoice';
import { myClaimsRouter } from './my-claims-routes';
import { makeRequestApInvoiceHandler, rejectRequestHandler, requestVoucherHandler } from './payment-request-routes';
import { EDIT_KEY, FULL_KEY } from './petty-cash-routes';
import { projectLimit } from './project-limit';
import type { Staff } from './staff-identity';
/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they test */

/* The bill itself is raised by the AP invoice route (tested with it); here it is a row the fake writes. */
vi.mock('../scm/routes/ap-invoices', () => ({
  createApInvoiceCore: async (c: any, body: any, from: { paymentRequestId?: string }) => {
    const sb = c.get('supabase');
    const id = `API-${sb.tables.ap_invoices.length + 1}`;
    if (sb.tables.ap_invoices.some((b: any) => b.payment_request_id === from.paymentRequestId && b.status !== 'CANCELLED')) {
      return c.json({ error: 'bill_exists' }, 409);
    }
    const total = body.lines.reduce((n: number, l: any) => n + l.amountSen, 0);
    sb.tables.ap_invoices.push({ id, company_id: 1, invoice_number: `HCAPI-2611-00${sb.tables.ap_invoices.length + 1}`, status: 'DRAFT', total_sen: total, paid_sen: 0,
      provisional: body.provisional === true, payment_request_id: from.paymentRequestId, supplier_id: body.supplierId, due_date: body.dueDate ?? null });
    body.lines.forEach((l: any, i: number) => sb.tables.ap_invoice_lines.push({ id: `${id}-L${i + 1}`, invoice_id: id, line_no: i + 1, description: l.description,
      debit_account_code: l.debitAccountCode, amount_sen: l.amountSen, department: l.department, project_id: l.projectId ?? null, sub_department_id: l.subDepartmentId ?? null,
      unit_id: l.unitId ?? null, source_request_line_id: l.sourceRequestLineId ?? null }));
    return c.json({ ok: true, invoice: { id, invoice_number: sb.tables.ap_invoices.at(-1).invoice_number }, body }, 201);
  },
}));

const CO = 1;
const OPS: Staff = { userId: 'u-ops', name: 'Wei Wen', email: 'o@x', departmentId: 'ops', side: 'both', role: 'operations_staff', field: false };

const world = () => publicTablesOnly(fakeSb({
  payment_requests: [
    { id: 'Q1', company_id: CO, request_no: 'PRQ-2611-001', type: 'PAYMENT', requester_user_id: 'u-ops', supplier_id: 'S1', payee_name: 'ACE', payee_to_check: false,
      purchase_order_id: null, wanted_on: '2026-11-30', owes_formal_invoice: false, note: null, amount_sen: 10_000, status: 'SUBMITTED', ap_invoice_id: null, ap_paid_before_sen: 0, asked_lines: null },
    { id: 'D1', company_id: CO, request_no: 'PRQ-2611-002', type: 'DEPOSIT', requester_user_id: 'u-ops', supplier_id: 'S1', payee_name: 'ACE', payee_to_check: false,
      purchase_order_id: null, wanted_on: null, owes_formal_invoice: true, note: null, amount_sen: 3_000, status: 'PAID', ap_invoice_id: null, ap_paid_before_sen: 0, asked_lines: null },
  ],
  payment_request_lines: [
    { id: 'L1', request_id: 'Q1', department: 'supply', sub_department_id: null, unit_id: 'UNIT-A01', maintenance_issue_id: null, project_id: 7, account_code: null, amount_sen: 6_000, description: 'Tiles', sort: 0 },
    { id: 'L2', request_id: 'Q1', department: 'supply', sub_department_id: null, unit_id: null, maintenance_issue_id: null, project_id: 7, account_code: '601-0001', amount_sen: 4_000, description: 'Labour', sort: 1 },
    { id: 'L3', request_id: 'D1', department: 'supply', sub_department_id: null, unit_id: null, maintenance_issue_id: null, project_id: 7, account_code: null, amount_sen: 3_000, description: 'Deposit', sort: 0 },
  ],
  payment_request_files: [],
  /* The deposit was paid by its own voucher, as before (Make voucher on the request). */
  payment_vouchers: [{ id: 'PVD', company_id: CO, status: 'POSTED', submitted_at: '2026-11-02T00:00:00Z', payment_request_id: 'D1' }],
  payment_voucher_lines: [{ pv_id: 'PVD', company_id: CO, project_id: 7, amount_sen: 3_000, debit_account_code: '400-0000' }],
  pv_allocations: [],
  petty_cash_floats: [], petty_cash_overrides: [], petty_cash_events: [], staff_receipt_files: [], staff_bank_details: [], conts_employee_bank: [],
  conts_maintenance_jobs: [], conts_units: [], purchase_orders: [],
  ap_invoices: [], ap_invoice_lines: [], acc_ap_invoice_files: [],
  suppliers: [{ id: 'S1', company_id: CO, code: '400-A001', name: 'ACE', control_account: null }],
  conts_staff: [{ id: 'u-ops', full_name: 'Wei Wen' }],
  projects: [{ id: 7, company_id: CO, name: 'SHOWROOM', funding: 'internal', limit_pct_bp: null, budget_sen: 100_000 }],
  project_limit_requests: [], acc_company_settings: [{ company_id: CO, project_limit_pct_bp: 7000 }],
  staff_receipts: [], staff_receipt_lines: [], accounts: [],
}), ['conts_maintenance_jobs', 'conts_units', 'conts_staff', 'projects', 'conts_employee_bank']);
type W = ReturnType<typeof world>;

const env = { SLIPS: { put: async () => {}, get: async () => null, delete: async () => {} } };
const post = (a: Hono<any>, path: string, body: unknown) => a.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, env);
const finance = (sb: W) => {
  const fin = new Hono<{ Variables: Record<string, unknown> }>();
  fin.use('*', async (c, next) => { c.set('supabase', sb); c.set('companyId', CO); c.set('user', { id: 'u-chew' }); c.set('houzsUser', { name: 'Chew', permissions_set: new Set([FULL_KEY, EDIT_KEY, 'scm.payment_voucher.create']) }); await next(); });
  fin.post('/r/:id/ap-invoice', makeRequestApInvoiceHandler);
  fin.post('/r/:id/voucher', requestVoucherHandler);
  fin.post('/r/:id/reject', rejectRequestHandler);
  return fin;
};
const staffApp = (sb: W) => {
  const a = new Hono<{ Variables: Record<string, unknown> }>();
  a.use('*', async (c, next) => { c.set('supabase', sb); c.set('companyId', CO); c.set('staff', OPS); await next(); });
  a.route('/', myClaimsRouter('session'));
  return a;
};
const req = (sb: W, id: string) => sb.tables.payment_requests.find(r => r.id === id)!;

describe('the rules', () => {
  test('a linked request is paid when its bill is, more or less than asked; a deposit by its own amount', () => {
    const base = { type: 'PAYMENT', amountSen: 10_000, current: 'SUBMITTED', ownPaidSen: 0, apPaidBeforeSen: 0 };
    expect(linkedRequestStatus({ ...base, ap: { status: 'POSTED', paidSen: 0 } })).toBe('SUBMITTED');
    expect(linkedRequestStatus({ ...base, ap: { status: 'PARTIALLY_PAID', paidSen: 4_000 } })).toBe('PART_PAID');
    /* The formal invoice came to 9,500: paid in full at 9,500. */
    expect(linkedRequestStatus({ ...base, ap: { status: 'PAID', paidSen: 9_500 } })).toBe('PAID');
    /* It came to 10,500: 10,000 paid is not yet paid. */
    expect(linkedRequestStatus({ ...base, ap: { status: 'PARTIALLY_PAID', paidSen: 10_000 } })).toBe('PART_PAID');
    /* A balance linked when the deposit's 3,000 was already paid: nothing of its own yet. */
    expect(linkedRequestStatus({ ...base, apPaidBeforeSen: 3_000, ap: { status: 'PARTIALLY_PAID', paidSen: 3_000 } })).toBe('SUBMITTED');
    expect(linkedRequestStatus({ ...base, type: 'DEPOSIT', amountSen: 3_000, ap: { status: 'PARTIALLY_PAID', paidSen: 3_000 } })).toBe('PAID');
    expect(linkedRequestStatus({ ...base, current: 'CLOSED', ap: { status: 'PAID', paidSen: 10_000 } })).toBe('CLOSED');
    expect(linkedRequestStatus({ ...base, ownPaidSen: 10_000, ap: null })).toBe('PAID');
  });
  test('a balance spreads over the lines in whole sen, adding up exactly', () => {
    expect(spreadSen([{ amountSen: 6_000 }, { amountSen: 4_000 }], 7_001).map(l => l.amountSen)).toEqual([4_200, 2_801]);
    expect(spreadSen([{ amountSen: 1 }, { amountSen: 9_999 }], 10).map(l => l.amountSen)).toEqual([10]);
    expect(spreadSen([], 100)).toEqual([]);
  });
});

describe('making the bill', () => {
  test('from the request, once: lines, unit and project kept, a missing account asked for; then paid only against the bill', async () => {
    const sb = world();
    expect((await post(finance(sb), '/r/Q1/ap-invoice', {})).status).toBe(422);
    const res = await post(finance(sb), '/r/Q1/ap-invoice', { debitAccountCode: '601-0009' });
    expect(res.status).toBe(201);
    expect(req(sb, 'Q1').ap_invoice_id).toBe('API-1');
    expect(sb.tables.ap_invoice_lines.map(l => [l.debit_account_code, l.amount_sen, l.unit_id, l.project_id, l.source_request_line_id]))
      .toEqual([['601-0009', 6_000, 'UNIT-A01', 7, 'L1'], ['601-0001', 4_000, null, 7, 'L2']]);
    expect(sb.tables.ap_invoices[0]).toMatchObject({ provisional: false, due_date: '2026-11-30' });
    expect((await post(finance(sb), '/r/Q1/ap-invoice', { debitAccountCode: '601-0009' })).status).toBe(409);
    /* Paid on the Payment voucher page now: no Make voucher, no reject, no withdraw. */
    expect((await post(finance(sb), '/r/Q1/voucher', { bankAccountCode: '310-0010' })).status).toBe(409);
    expect((await post(finance(sb), '/r/Q1/reject', { reason: 'x' })).status).toBe(409);
    expect((await post(staffApp(sb), '/requests/Q1/withdraw', {})).status).toBe(409);
    expect(req(sb, 'Q1').status).toBe('SUBMITTED');
  });
  test('a deposit\'s bill starts as the quotation; a payee not on the list is linked first', async () => {
    const sb = world();
    expect((await post(finance(sb), '/r/D1/ap-invoice', { debitAccountCode: '601-0009' })).status).toBe(201);
    expect(sb.tables.ap_invoices[0].provisional).toBe(true);
    req(sb, 'Q1').supplier_id = null;
    expect((await post(finance(sb), '/r/Q1/ap-invoice', { debitAccountCode: '601-0009' })).status).toBe(409);
  });
});

describe('the request follows its bill', () => {
  test('lines and total follow, what was asked is kept; paid when the bill is; a cancelled bill lets go', async () => {
    const sb = world();
    await post(finance(sb), '/r/Q1/ap-invoice', { debitAccountCode: '601-0009' });
    /* The formal invoice: tiles 6,500 with a new description, labour gone, a new transport line. */
    sb.tables.ap_invoice_lines = [
      { id: 'B1', invoice_id: 'API-1', line_no: 1, description: 'Tiles 60x60', debit_account_code: '601-0009', amount_sen: 6_500, department: 'supply', project_id: 7, sub_department_id: null, unit_id: 'UNIT-A01', source_request_line_id: 'L1' },
      { id: 'B2', invoice_id: 'API-1', line_no: 2, description: 'Transport', debit_account_code: '601-0001', amount_sen: 300, department: 'supply', project_id: 7, sub_department_id: null, unit_id: null, source_request_line_id: null },
    ];
    sb.tables.ap_invoices[0].total_sen = 6_800;
    await afterBillSavedBestEffort(sb, 'API-1');
    const lines = sb.tables.payment_request_lines.filter(l => l.request_id === 'Q1').sort((a, b) => a.sort - b.sort);
    expect(lines.map(l => [l.id, l.description, l.amount_sen])).toEqual([['L1', 'Tiles 60x60', 6_500], [expect.any(String), 'Transport', 300]]);
    expect(req(sb, 'Q1')).toMatchObject({ amount_sen: 6_800, asked_amount_sen: 10_000 });
    expect((req(sb, 'Q1').asked_lines as Array<{ description: string }>).map(l => l.description)).toEqual(['Tiles', 'Labour']);
    /* The new bill line now names its request line, so the next save keeps it. */
    expect(sb.tables.ap_invoice_lines[1].source_request_line_id).toBe(lines[1]!.id);
    /* Paid in full on the Payment voucher page: the request is paid. */
    Object.assign(sb.tables.ap_invoices[0], { status: 'PAID', paid_sen: 6_800 });
    await settleRequest(sb, 'Q1');
    expect(req(sb, 'Q1').status).toBe('PAID');
    /* The payment cancelled and the bill cancelled: the request is its own again. */
    Object.assign(sb.tables.ap_invoices[0], { status: 'CANCELLED', paid_sen: 0 });
    await releaseRequestsOfBillBestEffort(sb, 'API-1');
    expect(req(sb, 'Q1')).toMatchObject({ ap_invoice_id: null, status: 'SUBMITTED' });
  });
  test('a deposit request is not rewritten by its bill', async () => {
    const sb = world();
    await post(finance(sb), '/r/D1/ap-invoice', { debitAccountCode: '601-0009' });
    sb.tables.ap_invoice_lines[0].amount_sen = 10_000;
    sb.tables.ap_invoices[0].total_sen = 10_000;
    await afterBillSavedBestEffort(sb, 'API-1');
    expect(req(sb, 'D1')).toMatchObject({ amount_sen: 3_000, status: 'PAID' });
  });
});

describe('asking for the balance', () => {
  test('a deposit paid as an advance, not yet knocked off against the bill, is not asked for again', async () => {
    const sb = world();
    await post(finance(sb), '/r/D1/ap-invoice', { debitAccountCode: '601-0009' });
    Object.assign(sb.tables.ap_invoices[0], { status: 'POSTED', total_sen: 10_000, paid_sen: 0 });
    sb.tables.ap_invoice_lines[0].amount_sen = 10_000;
    const made = await (await post(staffApp(sb), '/requests/D1/balance', {})).json() as { id: string; amountSen: number };
    expect(made.amountSen).toBe(7_000);
    expect(req(sb, made.id).ap_paid_before_sen).toBe(3_000);
    /* The advance knocked off later is not the balance's payment. */
    Object.assign(sb.tables.ap_invoices[0], { status: 'PARTIALLY_PAID', paid_sen: 3_000 });
    await settleRequest(sb, made.id);
    expect(req(sb, made.id).status).toBe('SUBMITTED');
  });
  test('nothing filled in again: what the bill still owes, over its lines; once at a time; paid as the bill is', async () => {
    const sb = world();
    const staff = staffApp(sb);
    expect((await post(staff, '/requests/D1/balance', {})).status).toBe(409);
    await post(finance(sb), '/r/D1/ap-invoice', { debitAccountCode: '601-0009' });
    /* The quotation booked at 10,000; the 3,000 deposit knocked off against it. */
    Object.assign(sb.tables.ap_invoices[0], { status: 'PARTIALLY_PAID', total_sen: 10_000, paid_sen: 3_000 });
    sb.tables.ap_invoice_lines[0].amount_sen = 10_000;
    const res = await post(staff, '/requests/D1/balance', {});
    expect(res.status).toBe(201);
    const made = await res.json() as { id: string; amountSen: number };
    expect(made.amountSen).toBe(7_000);
    expect(req(sb, made.id)).toMatchObject({ type: 'PAYMENT', status: 'SUBMITTED', parent_request_id: 'D1', ap_invoice_id: 'API-1', ap_paid_before_sen: 3_000, supplier_id: 'S1', owes_formal_invoice: true });
    expect(sb.tables.payment_request_lines.filter(l => l.request_id === made.id).map(l => [l.amount_sen, l.project_id])).toEqual([[7_000, 7]]);
    expect((await post(staff, '/requests/D1/balance', {})).status).toBe(409);
    Object.assign(sb.tables.ap_invoices[0], { status: 'PAID', paid_sen: 10_000 });
    await settleRequest(sb, made.id);
    expect(req(sb, made.id).status).toBe('PAID');
  });
});

describe('the project limit', () => {
  test('a voucher paying the bill takes over the request\'s reservation', async () => {
    const sb = world();
    await post(finance(sb), '/r/Q1/ap-invoice', { debitAccountCode: '601-0009' });
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ reservedSen: 10_000 });
    sb.tables.payment_vouchers.push({ id: 'PV9', company_id: CO, status: 'DRAFT', submitted_at: '2026-11-15T00:00:00Z', payment_request_id: null });
    sb.tables.pv_allocations.push({ pv_id: 'PV9', ap_invoice_id: 'API-1', amount_sen: 4_000 });
    sb.tables.payment_voucher_lines.push({ pv_id: 'PV9', company_id: CO, project_id: 7, amount_sen: 4_000, debit_account_code: '400-0000' });
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ reservedSen: 10_000 });
  });
});
