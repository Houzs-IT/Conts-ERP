/* The ledger start date at the doors a person uses (Conts, finance 2026-10-21):
   a payment voucher, a manual journal, posting a journal draft, and re-posting
   a sales invoice, each dated before the books start, answer 409 with a
   sentence naming the start date and write nothing. Documents dated on or
   after the start post as before.

   Bare Hono + fakeSb, mounting the exported handlers (the supabaseAuth bridge
   cannot run here) — the pvCustomerRefund.test.ts harness. */

import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { postPaymentVoucherHandler } from '../src/scm/routes/payment-vouchers';
import { journalEntryCreateHandler, journalEntryReverseHandler, postJournalEntryHandler, postPiHandler, postSiHandler } from '../src/scm/routes/accounting';

const CO = 2;
const START = '2026-12-01';
const REFUSAL = { error: `This date is before the books start on ${START}.` };

const CHART: Row[] = [
  { company_id: CO, account_code: '300-0000', account_name: 'TRADE DEBTORS', parent_code: null, is_active: true, acc_money: false },
  { company_id: CO, account_code: '310-0010', account_name: 'MAYBANK', parent_code: null, is_active: true, acc_money: true },
  { company_id: CO, account_code: '500-0003', account_name: 'SALES SOFA', parent_code: null, is_active: true, acc_money: false },
  { company_id: CO, account_code: '900-0000', account_name: 'RENT', parent_code: null, is_active: true, acc_money: false },
];

const pv = (date: string): Row => ({
  id: 'pv-1', pv_number: `2990-PV-M-${date.slice(2, 4)}${date.slice(5, 7)}-001`, company_id: CO, voucher_date: date,
  payee_name: 'Landlord', credit_account_code: '310-0010', total_sen: 10000, currency: 'MYR', exchange_rate: 1,
  status: 'DRAFT', purpose: 'GENERAL_EXPENSE', supplier_id: null,
  submitted_at: '2026-12-01T00:00:00Z', checked_at: '2026-12-01T00:00:00Z', approved_at: '2026-12-01T00:00:00Z',
  prepared_by: 'Chew', checked_by: 'Chew', approved_by: 'Chew',
});

function harness(tables: Record<string, Row[]> = {}) {
  const sb = fakeSb({
    accounts: CHART.map((r) => ({ ...r })),
    acc_account_roles: [],
    acc_company_settings: [{ company_id: CO, ledger_start_date: START, fiscal_year_end_month: 8 }],
    acc_item_group_accounts: [{ company_id: CO, group_code: 'SOFA', sales_account: '500-0003' }],
    companies: [{ id: CO, code: '2990' }],
    entity_audit_log: [],
    journal_entries: [],
    journal_entry_lines: [],
    payment_voucher_lines: [{ pv_id: 'pv-1', line_no: 1, description: 'Rent', debit_account_code: '900-0000', amount_sen: 10000 }],
    payment_vouchers: [],
    pv_allocations: [],
    sales_invoices: [],
    sales_invoice_items: [],
    ...tables,
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { name: 'Chew', permissions_set: ['*'] } as never);
    c.set('allowedCompanyIds' as never, [CO] as never);
    c.set('companies' as never, [{ id: CO, code: '2990' }] as never);
    c.set('companyCode' as never, '2990' as never);
    await next();
  });
  app.post('/payment-vouchers/:id/post', postPaymentVoucherHandler as never);
  app.post('/journal-entries', journalEntryCreateHandler as never);
  app.post('/journal-entries/:id/post', postJournalEntryHandler as never);
  app.post('/post/si/:invoiceNumber', postSiHandler as never);
  return { app, sb };
}

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const manual = (entryDate: string) => json({
  entryDate, narration: 'Rent',
  lines: [{ accountCode: '900-0000', debitSen: 100, creditSen: 0 }, { accountCode: '310-0010', debitSen: 0, creditSen: 100 }],
});

describe('a payment voucher dated before the books start', () => {
  test('is refused by name and writes no journal', async () => {
    const { app, sb } = harness({ payment_vouchers: [pv('2026-11-28')] });
    const res = await app.request('/payment-vouchers/pv-1/post', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(REFUSAL);
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  test('on the start date it posts', async () => {
    const { app, sb } = harness({ payment_vouchers: [pv(START)] });
    const res = await app.request('/payment-vouchers/pv-1/post', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(sb.tables.journal_entries).toHaveLength(1);
  });
});

describe('a manual journal dated before the books start', () => {
  test('is refused by name and no draft is written', async () => {
    const { app, sb } = harness();
    const res = await app.request('/journal-entries', manual('2026-11-30'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(REFUSAL);
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  test('on the start date the draft is written', async () => {
    const { app } = harness();
    expect((await app.request('/journal-entries', manual(START))).status).toBe(201);
  });

  /* A draft saved before the start was set, dated before it, must not reach
     the books through the separate post step. */
  test('an existing pre-start draft cannot be posted', async () => {
    const { app, sb } = harness({
      journal_entries: [{ id: 'je-d', je_no: '2990-JE-2611-0001', company_id: CO, entry_date: '2026-11-20', posted: false, reversed: false, source_type: 'MANUAL' }],
    });
    const res = await app.request('/journal-entries/je-d/post', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(REFUSAL);
    expect(sb.tables.journal_entries[0].posted).toBe(false);
  });

  test('a draft dated on the start posts', async () => {
    const { app, sb } = harness({
      journal_entries: [{ id: 'je-d', je_no: '2990-JE-2612-0001', company_id: CO, entry_date: START, posted: false, reversed: false, source_type: 'MANUAL' }],
    });
    expect((await app.request('/journal-entries/je-d/post', { method: 'POST' })).status).toBe(200);
    expect(sb.tables.journal_entries[0].posted).toBe(true);
  });
});

describe('re-posting a sales invoice dated before the books start', () => {
  test('is refused by name', async () => {
    const { app, sb } = harness({
      sales_invoices: [{ id: 'si-1', invoice_number: '2990-SI-2611-001', invoice_date: '2026-11-10', debtor_name: 'Ah Meng', total_sen: 100, company_id: CO, status: 'SENT' }],
      sales_invoice_items: [{ sales_invoice_id: 'si-1', item_group: 'SOFA', line_total_sen: 100 }],
    });
    const res = await app.request('/post/si/2990-SI-2611-001', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(REFUSAL);
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
});

describe('re-posting a purchase invoice dated before the books start', () => {
  test('is refused by name', async () => {
    const { app, sb } = harness({
      purchase_invoices: [{ id: 'pi-1', invoice_number: '2990-PI-2611-001', invoice_date: '2026-11-10', supplier_id: null, total_sen: 100, currency: 'MYR', exchange_rate: 1, company_id: CO, status: 'POSTED', migrated_no_stock: false, suppliers: null }],
    });
    app.post('/post/pi/:invoiceNumber', postPiHandler as never);
    const res = await app.request('/post/pi/2990-PI-2611-001', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(REFUSAL);
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
});

describe('reversing a manual journal dated before the books start', () => {
  test('is refused by name, not answered as done', async () => {
    const { app, sb } = harness({
      journal_entries: [{ id: 'je-m', je_no: '2990-JE-2611-0002', company_id: CO, entry_date: '2026-11-20', posted: true, reversed: false, source_type: 'MANUAL', total_debit_sen: 100, total_credit_sen: 100 }],
    });
    app.post('/journal-entries/:id/reverse', journalEntryReverseHandler as never);
    const res = await app.request('/journal-entries/je-m/reverse', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(REFUSAL);
    expect(sb.tables.journal_entries).toHaveLength(1);
  });
});
