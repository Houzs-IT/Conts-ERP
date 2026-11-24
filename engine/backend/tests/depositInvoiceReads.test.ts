/* D18 (save-integrity, 22 Nov 2026): the deposit-invoice reads.
     • the backlog read every payment, not the first 1000 (it asked for
       .limit(2000) under a 1000-row ceiling, and read the standing invoices
       with no paging at all);
     • a payment hook on a company with the switch off stops at the switch
       instead of reading the receipt first. */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { issueDepositInvoice, missingDepositInvoices } from '../src/acc/deposit-invoices';

const CO = 2;
const ON = { company_id: CO, deposit_invoice_enabled: true, deposit_invoice_from: '2026-09-01' };
const ORDER = { doc_no: '2990-SO-2609-001', company_id: CO, debtor_code: null, debtor_name: 'Larding Chen', customer_id: 'cust-larding', status: 'CONFIRMED' };

function world(payments: Row[], settings: Row[], receipts: Row[]) {
  return fakeSb({
    companies: [{ id: CO, code: '2990', name: '2990' }],
    mfg_sales_orders: [{ ...ORDER }],
    mfg_sales_order_payments: payments,
    sales_invoices: [],
    acc_company_settings: settings,
    acc_deposit_invoices: [],
    acc_credit_notes: [],
    acc_official_receipts: receipts,
    journal_entries: [], journal_entry_lines: [],
  }, {}, [], ['journal_entry_lines'], 1000);
}

const pay = (n: number): Row => ({
  id: `p-${String(n).padStart(4, '0')}`, so_doc_no: ORDER.doc_no, paid_at: '2026-09-05', method: 'cash', amount_sen: 10_000, created_by: 'u-1', company_id: CO,
});
const formal = (id: string): Row => ({ id: `or-${id}`, company_id: CO, payment_source: 'SOPAY', payment_id: id, status: 'FORMAL', channel_account_code: '310-0010' });

describe('deposit invoice reads', () => {
  test('the backlog lists every payment owed an invoice, past the 1000-row ceiling', async () => {
    const payments = Array.from({ length: 1200 }, (_, i) => pay(i + 1));
    const sb = world(payments, [{ ...ON }], payments.map((p) => formal(String(p.id))));
    const r = await missingDepositInvoices(sb as never, CO);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payments).toHaveLength(1200);
  });

  test('switch off: the hook stops at the switch, without reading the receipt', async () => {
    const sb = world([pay(1)], [{ ...ON, deposit_invoice_enabled: false }], [formal('p-0001')]);
    const read: string[] = [];
    const counted = { ...sb, from: (t: string) => { read.push(t); return sb.from(t); } };
    const r = await issueDepositInvoice(counted as never, { paymentId: 'p-0001', soDocNo: ORDER.doc_no, paidAt: '2026-09-05', amountSen: 10_000, method: 'cash' });
    expect(r).toMatchObject({ ok: true, status: 'not_due', why: 'switched_off' });
    expect(read).not.toContain('acc_official_receipts');
    expect(read.length).toBeLessThanOrEqual(3);
  });
});
