/* Every customer and supplier control is checked (Conts, finance phase 1.5; spec 2.4). With customers on 301-0000,
   302-0000 and 303-0000 and suppliers on their own controls, the checks that knew four roles see every control:
     · a manual journal cannot name any customer or supplier control (special type SDC / SCC), not only the four roles;
     · the control self-check reports each SDC / SCC control on its own line;
     · Ledger setup marks a control that has sub-accounts (it could not be posted to). */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { postJournal } from '../src/acc/engine';
import { controlCheckHandler } from '../src/scm/routes/accounting';
import { ledgerSetupStatus } from '../src/conts/ledger-setup-status';

const CO = 1;
const acct = (code: string, type: string, special: string | null = null, over: Row = {}): Row => ({
  company_id: CO, account_code: code, account_name: code, account_type: type, parent_code: null, is_active: true, special_type: special, acc_money: false, ...over,
});
const CHART: Row[] = [
  acct('300-0000', 'ASSET', 'SDC'), acct('301-0000', 'ASSET', 'SDC'), acct('302-0000', 'ASSET', 'SDC'), acct('305-0000', 'ASSET', 'SDC'),
  acct('310-0010', 'ASSET', 'SBK', { acc_money: true }), acct('400-0000', 'LIABILITY', 'SCC'), acct('405-0000', 'LIABILITY', 'SCC'),
  acct('900-A001', 'EXPENSE'),
];

describe('a manual journal and the controls', () => {
  test('a manual journal cannot touch 301-0000 when it is a customer control', async () => {
    const sb = fakeSb({ accounts: CHART.map((r) => ({ ...r })), acc_account_roles: [], acc_company_settings: [], companies: [{ id: CO, code: 'HOUZS' }], journal_entries: [], journal_entry_lines: [] });
    const r = await postJournal(sb, {
      companyId: CO, entryDate: '2026-12-01', sourceType: 'MANUAL', sourceDocNo: null, narration: 'x',
      lines: [{ accountCode: '301-0000', debitSen: 100, creditSen: 0 }, { accountCode: '900-A001', debitSen: 0, creditSen: 100 }],
    });
    expect(r).toMatchObject({ ok: false, status: 'control_account_manual' });
  });

  test('an ordinary account still posts', async () => {
    const sb = fakeSb({ accounts: CHART.map((r) => ({ ...r })), acc_account_roles: [], acc_company_settings: [], companies: [{ id: CO, code: 'HOUZS' }], journal_entries: [], journal_entry_lines: [] });
    const r = await postJournal(sb, {
      companyId: CO, entryDate: '2026-12-01', sourceType: 'MANUAL', sourceDocNo: null, narration: 'x',
      lines: [{ accountCode: '310-0010', debitSen: 100, creditSen: 0 }, { accountCode: '900-A001', debitSen: 0, creditSen: 100 }],
    });
    expect(r).toMatchObject({ ok: true });
  });
});

describe('the control self-check', () => {
  test('reports 301-0000 and 302-0000 on lines of their own, with their balances', async () => {
    const gl = (id: number, code: string, dr: number, cr: number, src: string): Row => ({
      line_id: id, company_id: CO, je_no: `JE-${id}`, source_type: src, account_code: code, debit_sen: dr, credit_sen: cr, posted: true, reversed: false, reversed_by_je: null, entry_date: '2026-12-02',
    });
    const sb = fakeSb({
      accounts: CHART.map((r) => ({ ...r })), acc_account_roles: [],
      journal_entries: [], journal_entry_lines: [],
      v_gl_entries: [gl(1, '301-0000', 30_000, 0, 'SI'), gl(2, '302-0000', 0, 5_000, 'SIPAY'), gl(3, '302-0000', 700, 0, 'MANUAL')],
      sales_invoices: [], purchase_invoices: [], ap_invoices: [], mfg_sales_order_payments: [], sales_invoice_payments: [],
    });
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('supabase' as never, sb as never);
      c.set('companyId' as never, CO as never);
      c.set('houzsUser' as never, { name: 'T', permissions_set: ['scm.payment_voucher.post'] } as never);
      await next();
    });
    app.get('/control-check', controlCheckHandler as never);
    const body = await (await app.request('/control-check')).json() as { checks: Array<{ role: string; accountCode: string; glBalanceSen: number; foreignLines: Array<{ jeNo: string }> }> };
    const byCode = new Map(body.checks.map((x) => [x.accountCode, x]));
    expect(byCode.get('301-0000')).toMatchObject({ role: 'AR', glBalanceSen: 30_000, foreignLines: [] });
    expect(byCode.get('302-0000')).toMatchObject({ role: 'AR', glBalanceSen: -4_300 });
    expect(byCode.get('302-0000')?.foreignLines.map((l) => l.jeNo)).toEqual(['JE-3']);
    expect(body.checks.filter((x) => x.accountCode === '300-0000')).toHaveLength(1);
  });

  test('a supplier bill out of step is reported once, on the trade creditors line, not again on every supplier control', async () => {
    const sb = fakeSb({
      accounts: [...CHART.map((r) => ({ ...r })), acct('406-0000', 'LIABILITY', 'SCC')], acc_account_roles: [],
      journal_entries: [], journal_entry_lines: [], v_gl_entries: [],
      sales_invoices: [], purchase_invoices: [], mfg_sales_order_payments: [], sales_invoice_payments: [],
      ap_invoices: [{ company_id: CO, invoice_number: 'API-1', total_sen: 5_000, status: 'POSTED' }],
    });
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('supabase' as never, sb as never);
      c.set('companyId' as never, CO as never);
      c.set('houzsUser' as never, { name: 'T', permissions_set: ['scm.payment_voucher.post'] } as never);
      await next();
    });
    app.get('/control-check', controlCheckHandler as never);
    const body = await (await app.request('/control-check')).json() as { checks: Array<{ accountCode: string; driftDocs?: Array<{ docNo: string }> }> };
    const flagged = body.checks.filter((x) => (x.driftDocs ?? []).some((d) => d.docNo === 'API-1')).map((x) => x.accountCode);
    expect(flagged).toEqual(['400-0000']);
  });
});

describe('Ledger setup and the controls', () => {
  test('a control with sub-accounts is marked and keeps the ledger from Ready', async () => {
    const sb = fakeSb({
      accounts: [...CHART.map((r) => ({ ...r })), acct('301-M001', 'ASSET', null, { parent_code: '301-0000' })],
      acc_account_roles: [], acc_item_groups: [], acc_item_group_accounts: [], acc_bank_letters: [{ company_id: CO, account_code: '310-0010', letter: 'H' }],
      acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8 }],
    });
    const s = await ledgerSetupStatus(sb, CO);
    expect(s.controlsWithChildren).toEqual(['301-0000']);
    expect(s.ready).toBe(false);
  });
});
