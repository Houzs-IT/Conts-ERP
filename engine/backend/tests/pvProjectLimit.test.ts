/* A payment voucher for a project stays within the project's limit (Conts, finance phase 1.5; SOP 3.4). Pinned:
     · submitting a voucher over the limit is refused with what is left and how much over, and nothing is stamped;
     · within the limit it is submitted (and so reserved);
     · Post now goes through the same submit door, so it is refused over the limit too;
     · editing a voucher names its project on every line. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { submitPaymentVoucherHandler, updatePaymentVoucherHandler } from '../src/scm/routes/payment-vouchers';
import { postNowHandler } from '../src/conts/pv-post-now';

const CO = 2;
const DRAFT: Row = {
  id: 'pv-1', pv_number: '2990-Draft-2612-001', company_id: CO, voucher_date: '2026-12-03',
  payee_name: 'Carpenter', credit_account_code: '310-0010', total_sen: 800_000, currency: 'MYR', exchange_rate: 1,
  status: 'DRAFT', purpose: 'GENERAL_EXPENSE', supplier_id: null, notes: null,
  submitted_at: null, submitted_by: null, checked_at: null, checked_by: null, approved_at: null, approved_by: null,
};
function harness(sen: number) {
  const sb = fakeSb({
    accounts: [
      { company_id: CO, account_code: '310-0010', account_name: 'MAYBANK', parent_code: null, is_active: true, acc_money: true, everyday_expense: false },
      { company_id: CO, account_code: '601-0001', account_name: 'RENOVATION COST', parent_code: null, is_active: true, acc_money: false, everyday_expense: false },
    ],
    acc_account_roles: [], acc_bank_letters: [{ company_id: CO, account_code: '310-0010', letter: 'M' }],
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8, project_limit_pct_bp: 7000 }],
    acc_numbering: [], companies: [{ id: CO, code: '2990' }], entity_audit_log: [], journal_entries: [], journal_entry_lines: [],
    projects: [{ id: 7, company_id: CO, name: 'SKYLINE A-12-06', funding: 'customer', limit_pct_bp: null, budget_sen: null }],
    mfg_sales_orders: [{ doc_no: 'SO-1', company_id: CO, project_id: 7, status: 'RENO_IN_PROGRESS' }],
    mfg_sales_order_payments: [{ id: 'p1', company_id: CO, so_doc_no: 'SO-1', amount_sen: 1_000_000, method: 'transfer' }],
    sales_invoices: [], sales_invoice_payments: [], project_limit_requests: [],
    purchase_invoices: [], purchase_orders: [], ap_invoice_lines: [],
    payment_voucher_lines: [{ id: 'l1', pv_id: 'pv-1', company_id: CO, line_no: 1, description: 'Carpentry', debit_account_code: '601-0001', amount_sen: sen, project_id: 7 }],
    payment_vouchers: [{ ...DRAFT, total_sen: sen }],
    pv_allocations: [],
  }, {}, [{ table: 'payment_vouchers', column: 'pv_number', name: 'payment_vouchers_pv_number_key' }]);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { name: 'Chew', permissions_set: ['scm.payment_voucher.write', 'scm.payment_voucher.check', 'scm.payment_voucher.approve'] } as never);
    c.set('allowedCompanyIds' as never, [CO] as never);
    c.set('companies' as never, [{ id: CO, code: '2990' }] as never);
    c.set('companyCode' as never, '2990' as never);
    await next();
  });
  app.post('/payment-vouchers/:id/submit', submitPaymentVoucherHandler as never);
  app.post('/payment-vouchers/:id/post-now', postNowHandler as never);
  app.patch('/payment-vouchers/:id', updatePaymentVoucherHandler as never);
  return { app, sb };
}

describe('a voucher and its project’s limit', () => {
  test('over the limit: refused with what is left and how much over; nothing stamped', async () => {
    const { app, sb } = harness(800_000);
    const res = await app.request('/payment-vouchers/pv-1/submit', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'over_project_limit', projectId: 7, leftSen: 700_000, overSen: 100_000 });
    expect(sb.tables.payment_vouchers[0].submitted_at).toBeNull();
  });

  test('within the limit: submitted', async () => {
    const { app, sb } = harness(600_000);
    const res = await app.request('/payment-vouchers/pv-1/submit', { method: 'POST' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(sb.tables.payment_vouchers[0].submitted_at).not.toBeNull();
  });

  test('Post now is refused over the limit too', async () => {
    const { app, sb } = harness(800_000);
    const res = await app.request('/payment-vouchers/pv-1/post-now', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(sb.tables.payment_vouchers[0].status).toBe('DRAFT');
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  test('editing the voucher names its project on every line', async () => {
    const { app, sb } = harness(100_000);
    sb.tables.payment_voucher_lines[0].project_id = null;
    const res = await app.request('/payment-vouchers/pv-1', { method: 'PATCH', body: JSON.stringify({ projectId: 7 }), headers: { 'content-type': 'application/json' } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(sb.tables.payment_voucher_lines[0].project_id).toBe(7);
  });
});
