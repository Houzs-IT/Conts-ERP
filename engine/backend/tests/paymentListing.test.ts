// The Payment listing (ported from Houzs): the vouchers to pay, a line each, with what each is for and the
// bank it pays into.
//
// Pinned here:
//   • by default Prepared and Checked, dated up to the day asked, oldest first; the stages and From narrow it;
//   • the Description is what the bills say is paid for, else the voucher's own lines less the system's,
//     else its remark; the departments and projects of its lines ride along;
//   • the bank is the supplier's, else the claim's or the person's saved one;
//   • the other company's vouchers are not on it, and a bad stage or range is refused in words.

import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { describeOne, paymentListingHandler, stageOf } from '../src/scm/routes/payment-vouchers-listing';

const CO = 2;

describe('what a voucher is for', () => {
  test('the bills first, then its own lines less the system\'s, then its remark', () => {
    expect(describeOne({ billItems: ['Cement', 'Cement', ' Sand  bags '], ownLines: ['Settle 2 invoice(s)'], notes: 'x' })).toBe('Cement; Sand bags');
    expect(describeOne({ billItems: [], ownLines: ['Settle 1 invoice(s)', 'Internal transfer', 'Aircon service'], notes: 'x' })).toBe('Aircon service');
    expect(describeOne({ billItems: [], ownLines: ['Prepay 1,000.00'], notes: 'Deposit for tiles' })).toBe('Deposit for tiles');
    expect(describeOne({ billItems: [], ownLines: [], notes: null })).toBe('');
  });

  test('the four layers as one word', () => {
    expect(stageOf({ status: 'DRAFT' })).toBe('DRAFT');
    expect(stageOf({ status: 'DRAFT', submitted_at: 't' })).toBe('PREPARED');
    expect(stageOf({ status: 'DRAFT', submitted_at: 't', checked_at: 't' })).toBe('CHECKED');
    expect(stageOf({ status: 'POSTED', checked_at: 't' })).toBe('POSTED');
  });
});

const pv = (id: string, over: Row = {}): Row => ({
  id, company_id: CO, pv_number: `CODraft-2611-00${id.slice(-1)}`, voucher_date: '2026-11-20', payee_name: 'Acme', supplier_id: null,
  credit_account_code: '310-0010', currency: 'MYR', exchange_rate: 1, purpose: 'OTHER', notes: null, total_sen: 10000,
  status: 'DRAFT', posted_at: null, submitted_at: '2026-11-20T01:00:00Z', checked_at: null, approved_at: null, supplier: null, ...over,
});

function harness() {
  const sb = fakeSb({
    payment_vouchers: [
      pv('pv1', { supplier: { id: 's1', code: 'S1', name: 'Acme', bank_name: 'Maybank', bank_account_no: '5123', bank_account_name: 'ACME SDN BHD' } }),
      pv('pv2', { voucher_date: '2026-11-18', checked_at: '2026-11-19T00:00:00Z', payee_name: 'Siti', notes: 'Claim payback' }),
      pv('pv3', { submitted_at: null }),
      pv('pv4', { status: 'POSTED', voucher_date: '2026-11-10' }),
      pv('pv5', { voucher_date: '2026-11-25' }),
      pv('pv6', { company_id: 1 }),
    ],
    payment_voucher_lines: [
      { company_id: CO, pv_id: 'pv1', line_no: 1, description: 'Settle 1 invoice(s)', department: 'supply', project_id: 7 },
      { company_id: CO, pv_id: 'pv2', line_no: 1, description: 'Grab to site', department: 'rental', project_id: null },
      { company_id: CO, pv_id: 'pv2', line_no: 2, description: 'Parking', department: 'shared', project_id: null },
    ],
    pv_allocations: [{ company_id: CO, pv_id: 'pv1', ap_invoice_id: 'ap1', pi_id: null, created_at: '2026-11-20T01:00:00Z' }],
    ap_invoice_lines: [
      { company_id: CO, invoice_id: 'ap1', line_no: 2, description: 'Tiles' },
      { company_id: CO, invoice_id: 'ap1', line_no: 1, description: 'Cement' },
    ],
    purchase_invoice_items: [],
    projects: [{ id: 7, company_id: CO, name: 'Taman Melati renovation' }],
    staff_receipts: [{ company_id: CO, payback_pv_id: 'pv2', submitter_user_id: 'u-siti', payee_bank_name: 'CIMB', payee_account_no: '7001', payee_account_name: 'SITI' }],
    staff_bank_details: [],
    conts_employee_bank: [],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('allowedCompanyIds' as never, [1, 2] as never);
    await next();
  });
  app.get('/listing', paymentListingHandler as never);
  return app;
}

type Body = { from: string | null; to: string; stages: string[]; vouchers: Array<Record<string, any>> };

describe('GET /payment-vouchers/listing', () => {
  test('Prepared and Checked up to the day asked, oldest first, each with its purpose and bank', async () => {
    const res = await harness().request('/listing?to=2026-11-21');
    expect(res.status).toBe(200);
    const body = await res.json() as Body;
    expect(body).toMatchObject({ from: null, to: '2026-11-21', stages: ['PREPARED', 'CHECKED'] });
    expect(body.vouchers.map((v) => v.id)).toEqual(['pv2', 'pv1']);
    expect(body.vouchers[1]).toMatchObject({
      stage: 'PREPARED', description_text: 'Cement; Tiles', departments: ['supply'], projects: ['Taman Melati renovation'],
      pay_bank: 'Maybank', pay_account_no: '5123', pay_account_name: 'ACME SDN BHD',
    });
    /* A claim paid back: the bank given on the claim. */
    expect(body.vouchers[0]).toMatchObject({
      stage: 'CHECKED', description_text: 'Grab to site; Parking', departments: ['rental', 'shared'], projects: [],
      pay_bank: 'CIMB', pay_account_no: '7001', pay_account_name: 'SITI',
    });
  });

  test('the stages and From narrow it', async () => {
    const body = await (await harness().request('/listing?from=2026-11-01&to=2026-11-30&stages=draft,posted')).json() as Body;
    expect(body.stages).toEqual(['DRAFT', 'POSTED']);
    expect(body.vouchers.map((v) => [v.id, v.stage])).toEqual([['pv4', 'POSTED'], ['pv3', 'DRAFT']]);
  });

  test('a bad stage or range is refused in words', async () => {
    const app = harness();
    const bad = await app.request('/listing?stages=PAID');
    expect(bad.status).toBe(400);
    expect((await bad.json() as { message: string }).message).toBe('No such stage: PAID.');
    const back = await app.request('/listing?from=2026-11-30&to=2026-11-01');
    expect(back.status).toBe(400);
  });
});
