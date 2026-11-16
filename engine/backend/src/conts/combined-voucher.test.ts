/* One voucher for several payment requests and staff claims (chew, 16 Nov 2026). Pinned:
     · ticked requests to different payees and a claim become one ordinary voucher ("Various"), each line on the account
       finance chose and naming what it pays; the bank on the claim goes into the notes;
     · posting settles each by its own lines (a part paid one, the rest later); cancelling puts them back;
     · a request already on a draft, or paid through an AP invoice, is refused by name and nothing is made. */
import { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { combinedVoucherHandler } from './combined-voucher';
import { afterVoucherCancelledBestEffort, afterVoucherPostedBestEffort } from './claims-voucher-hooks';
import { claimsDeps, FULL_KEY } from './petty-cash-routes';
/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they test */

const CO = 1;
const req = (id: string, no: string, payee: string, amount: number) => ({ id, company_id: CO, request_no: no, type: 'PAYMENT', requester_user_id: 'u1', supplier_id: null, payee_name: payee,
  payee_to_check: true, note: null, amount_sen: amount, status: 'SUBMITTED', ap_invoice_id: null, ap_paid_before_sen: 0 });
const line = (id: string, requestId: string, amount: number, extra: Record<string, unknown> = {}) => ({ id, request_id: requestId, department: 'rental', unit_id: null, maintenance_issue_id: null,
  project_id: null, account_code: null, amount_sen: amount, description: `Line ${id}`, sort: 0, ...extra });

const world = () => publicTablesOnly(fakeSb({
  payment_requests: [req('Q1', 'PRQ-2611-001', 'Ah Seng Plumbing', 3_000), req('Q2', 'PRQ-2611-002', 'Kedai Lim', 2_000)],
  payment_request_lines: [line('L1', 'Q1', 3_000, { unit_id: 'UNIT-A01' }), line('L2', 'Q2', 2_000)],
  staff_receipts: [{ id: 'R1', company_id: CO, receipt_no: 'RC-2611-001', submitter_user_id: 'u-siti', float_id: null, status: 'CHECKED', payback_pv_id: null,
    payee_bank_name: 'Maybank', payee_account_no: '1234567890', payee_account_name: 'SITI' }],
  staff_receipt_lines: [{ id: 'RL1', receipt_id: 'R1', department: 'rental', unit_id: null, maintenance_issue_id: null, project_id: null, account_code: '601-0002', amount_sen: 1_500, description: 'Detergent', sort: 0 }],
  staff_bank_details: [], conts_employee_bank: [], conts_staff: [{ id: 'u-siti', full_name: 'Siti' }],
  payment_vouchers: [], payment_voucher_lines: [], petty_cash_floats: [], ap_invoices: [], pv_allocations: [],
}), ['conts_staff', 'conts_employee_bank']);

const finance = (sb: ReturnType<typeof world>) => {
  const a = new Hono<{ Variables: Record<string, unknown> }>();
  a.use('*', async (c, next) => { c.set('supabase', sb); c.set('companyId', CO); c.set('houzsUser', { name: 'Chew', permissions_set: new Set([FULL_KEY]) }); await next(); });
  a.post('/v', combinedVoucherHandler);
  return a;
};
const post = (a: Hono<any>, body: unknown) => a.request('/v', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const realCreate = claimsDeps.createVoucher;
afterEach(() => { claimsDeps.createVoucher = realCreate; });
const capture = (sb: ReturnType<typeof world>) => {
  const bodies: Array<Record<string, any>> = [];
  claimsDeps.createVoucher = async (_c, b) => {
    bodies.push(b);
    const id = `PV${bodies.length}`;
    sb.tables.payment_vouchers.push({ id, company_id: CO, pv_number: id, status: 'DRAFT', submitted_at: null, payment_request_id: null, staff_receipt_id: null, voucher_date: '2026-11-16', petty_cash_float_id: null });
    (b.lines as Array<{ debitAccountCode: string; amountSen: number }>).forEach((l, i) => sb.tables.payment_voucher_lines.push({ id: `${id}-${i + 1}`, pv_id: id, company_id: CO, line_no: i + 1, debit_account_code: l.debitAccountCode, amount_sen: l.amountSen }));
    return { ok: true, id, pvNumber: id };
  };
  return bodies;
};

describe('one voucher for what was ticked', () => {
  test('different payees and a claim: one ordinary voucher, each line naming what it pays', async () => {
    const sb = world();
    const bodies = capture(sb);
    /* No account on L2: refused by name, nothing made. */
    const missing = await post(finance(sb), { requestIds: ['Q1', 'Q2'], receiptIds: ['R1'], bankAccountCode: '310-0010', accounts: { L1: '601-0001' } });
    expect(missing.status).toBe(409);
    expect((await missing.json() as { message: string }).message).toContain('PRQ-2611-002');
    expect(bodies).toHaveLength(0);
    const res = await post(finance(sb), { requestIds: ['Q1', 'Q2'], receiptIds: ['R1'], bankAccountCode: '310-0010', accounts: { L1: '601-0001', L2: '601-0003' } });
    expect(res.status).toBe(201);
    expect(bodies[0]).toMatchObject({ purpose: 'OTHER', payeeName: 'Various (3)', creditAccountCode: '310-0010' });
    expect(bodies[0]!.lines.map((l: { debitAccountCode: string; amountSen: number }) => [l.debitAccountCode, l.amountSen])).toEqual([['601-0001', 3_000], ['601-0003', 2_000], ['601-0002', 1_500]]);
    expect(String(bodies[0]!.notes)).toContain('Maybank 1234567890');
    expect(sb.tables.payment_voucher_lines.map(l => [l.payment_request_id, l.staff_receipt_id, l.unit_id])).toEqual([['Q1', null, 'UNIT-A01'], ['Q2', null, null], [null, 'R1', null]]);
    expect(sb.tables.payment_vouchers[0]).toMatchObject({ payment_request_id: null, staff_receipt_id: null });
    expect(sb.tables.staff_receipts[0].payback_pv_id).toBe('PV1');
    /* Ticked again while on the draft: refused, the same money is never on two vouchers. */
    expect((await post(finance(sb), { requestIds: ['Q1'], bankAccountCode: '310-0010', accounts: { L1: '601-0001' } })).status).toBe(409);

    sb.tables.payment_vouchers[0]!.status = 'POSTED';
    await afterVoucherPostedBestEffort(sb, 'PV1');
    expect(sb.tables.payment_requests.map(q => q.status)).toEqual(['PAID', 'PAID']);
    expect(sb.tables.staff_receipts[0].status).toBe('PAID_BACK');
    sb.tables.payment_vouchers[0]!.status = 'CANCELLED';
    await afterVoucherCancelledBestEffort(sb, 'PV1');
    expect(sb.tables.payment_requests.map(q => q.status)).toEqual(['SUBMITTED', 'SUBMITTED']);
    expect(sb.tables.staff_receipts[0]).toMatchObject({ status: 'CHECKED', payback_pv_id: null });
  });

  test('one request alone is also named on the voucher; one paid through an AP invoice is refused', async () => {
    const sb = world();
    capture(sb);
    expect((await post(finance(sb), { requestIds: ['Q1'], bankAccountCode: '310-0010', accounts: { L1: '601-0001' } })).status).toBe(201);
    expect(sb.tables.payment_vouchers[0]).toMatchObject({ payment_request_id: 'Q1' });
    sb.tables.ap_invoices.push({ id: 'API-1', invoice_number: 'HCAPI-2611-001', status: 'POSTED' });
    sb.tables.payment_requests[1]!.ap_invoice_id = 'API-1';
    const res = await post(finance(sb), { requestIds: ['Q2'], bankAccountCode: '310-0010', accounts: { L2: '601-0003' } });
    expect(res.status).toBe(409);
    expect((await res.json() as { message: string }).message).toContain('HCAPI-2611-001');
  });
});
