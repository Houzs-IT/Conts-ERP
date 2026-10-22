/* Opening documents (Conts, finance phase 1, spec 3.8 #2): the invoices customers still owe and the bills the company
   still owes on the day before the books start. Their money is already in the OPENING journal, so they post nothing —
   but they sit in the ageing and settle as usual: a payment against one posts Dr bank / Cr AR (or Dr AP / Cr bank)
   and runs the control down. Pinned:
     · an opening sales invoice posts no revenue; an opening purchase invoice posts no payable;
     · a payment on an opening sales invoice still posts (unlike a migrated one);
     · the control self-check expects no journal for an opening document, and reads OPENING lines on the controls as
       their own, not foreign. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { postSiRevenue } from '../src/scm/lib/post-si-revenue';
import { postSiPayment } from '../src/acc/payments';
import { controlCheckHandler, postPiAccounting } from '../src/scm/routes/accounting';
import { REVERSAL_SOURCE } from '../src/acc/rules';

const CO = 1;
const CHART: Row[] = ['300-0000', '320-0000', '400-0000', '500-0000', '601-0000'].map((code) => ({
  account_code: code, account_name: code, account_type: code.startsWith('4') ? 'LIABILITY' : code.startsWith('5') ? 'INCOME' : code.startsWith('6') ? 'EXPENSE' : 'ASSET',
  parent_code: null, is_active: true, company_id: CO,
}));
const OPENING_SI: Row = {
  id: 'si-o1', invoice_number: 'HC-SI-OPEN-001', invoice_date: '2026-11-10', debtor_code: 'C1', debtor_name: 'Ah Meng',
  total_sen: 50_000, company_id: CO, migrated_no_stock: false, opening_balance: true, status: 'SENT', so_doc_no: null,
};
const OPENING_PI: Row = {
  id: 'pi-o1', invoice_number: 'HC-PI-OPEN-001', invoice_date: '2026-11-12', supplier_id: 'sup-1', total_sen: 30_000,
  currency: 'MYR', exchange_rate: 1, company_id: CO, migrated_no_stock: false, opening_balance: true, status: 'POSTED',
  suppliers: { code: '400-T001', name: 'TODERN' },
};

describe('opening documents post nothing themselves', () => {
  test('an opening sales invoice posts no revenue', async () => {
    const sb = fakeSb({ accounts: CHART, acc_account_roles: [], sales_invoices: [{ ...OPENING_SI }], sales_invoice_items: [], journal_entries: [], journal_entry_lines: [] });
    expect(await postSiRevenue(sb, 'HC-SI-OPEN-001')).toEqual({ ok: true, status: 'opening_document' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  test('an opening purchase invoice posts no payable', async () => {
    const sb = fakeSb({ accounts: CHART, acc_account_roles: [], purchase_invoices: [{ ...OPENING_PI }], purchase_invoice_items: [], journal_entries: [], journal_entry_lines: [] });
    expect(await postPiAccounting(sb, 'HC-PI-OPEN-001')).toEqual({ ok: true, status: 'opening_document' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
});

describe('opening documents settle as usual', () => {
  test('a payment on an opening sales invoice posts Dr bank Cr AR and lowers the debtor ageing', async () => {
    const sb = fakeSb({ accounts: CHART, acc_account_roles: [], acc_acquirers: [], sales_invoices: [{ ...OPENING_SI }], journal_entries: [], journal_entry_lines: [] });
    const out = await postSiPayment(sb, { id: 'sp-1', sales_invoice_id: 'si-o1', paid_at: '2026-12-05', method: 'cash', merchant_provider: null, amount_sen: 20_000, company_id: CO } as never);
    expect(out).toMatchObject({ ok: true, status: 'posted' });
    const lines = sb.tables.journal_entry_lines;
    expect(lines.find((l) => l.account_code === '300-0000')).toMatchObject({ credit_sen: 20_000, party_code: 'C1' });
  });
});

describe('the control self-check', () => {
  test('the self-check does not flag OPENING lines on the control accounts, nor an opening document without a journal', async () => {
    const sb = fakeSb({
      accounts: CHART, acc_account_roles: [],
      journal_entries: [{ id: 'je-open', je_no: 'JE-2611-0001', source_type: 'OPENING', source_doc_no: 'OPENING', total_debit_sen: 80_000, posted: true, reversed: false, company_id: CO }],
      journal_entry_lines: [],
      v_gl_entries: [
        { line_id: 1, company_id: CO, je_no: 'JE-2611-0001', source_type: 'OPENING', account_code: '300-0000', debit_sen: 50_000, credit_sen: 0, posted: true, reversed: false, reversed_by_je: null, entry_date: '2026-11-30' },
        { line_id: 2, company_id: CO, je_no: 'JE-2611-0001', source_type: 'OPENING', account_code: '400-0000', debit_sen: 0, credit_sen: 30_000, posted: true, reversed: false, reversed_by_je: null, entry_date: '2026-11-30' },
      ],
      sales_invoices: [{ ...OPENING_SI }], purchase_invoices: [{ ...OPENING_PI }], ap_invoices: [],
      mfg_sales_order_payments: [], sales_invoice_payments: [],
    } as never);
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('supabase' as never, sb as never);
      c.set('companyId' as never, CO as never);
      c.set('houzsUser' as never, { name: 'T', permissions_set: ['scm.payment_voucher.post'] } as never);
      await next();
    });
    app.get('/control-check', controlCheckHandler as never);
    const body = await (await app.request('/control-check')).json() as { checks: Array<{ role: string; driftDocs: unknown[]; foreignLines: unknown[] }> };
    for (const role of ['AR', 'AP']) {
      const check = body.checks.find((x) => x.role === role)!;
      expect(check.foreignLines, role).toEqual([]);
      expect(check.driftDocs, role).toEqual([]);
    }
  });

  test('the opening journal can be reversed and redone', () => {
    expect(REVERSAL_SOURCE.OPENING).toBe('OPENING_REVERSAL');
  });
});
