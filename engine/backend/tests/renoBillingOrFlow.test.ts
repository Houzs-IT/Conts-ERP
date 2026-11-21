/* The renovation billing -> payment -> Official Receipt flow (chew, 21 Nov 2026). Pinned:
     • a renovation payment's receipt names the oldest live instalment invoice that earlier CONFIRMED money does not
       cover (unconfirmed money covers nothing; cancelled invoices are skipped); none billed -> the order alone; a
       non-renovation order's receipt is never linked; the link is worked out again at the confirm;
     • received is confirmed money only: unconfirmed order and invoice money is waitingSen, never receivedSen;
     • a renovation contract is never due a deposit invoice, even with the company switch on;
     • an instalment invoice carries the customer header (debtor code fallback, due date from the order's term);
     • every salesperson (Sales at edit) holds scm.renovation.bill_own, and nothing else billing opens. */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { linkReceiptInvoice, pickInvoiceForPayment, renoInvoiceForPayment } from '../src/acc/receipt-invoice';
import { assembleView, billInstalment, dueDateOf } from '../src/scm/lib/renovation-billing';
import { issueDepositInvoice, missingDepositInvoices } from '../src/acc/deposit-invoices';
import { CONTS_AREAS, contsPermissions, parseContsAccess } from '../src/conts/access';
import type { RenoDb } from '../src/scm/lib/renovation-db';

const CO = 2;
const SO = '2990-SO-2611-001';

function sbWith(over: Record<string, Row[]> = {}) {
  return fakeSb({
    mfg_sales_orders: [
      { doc_no: SO, company_id: CO, so_kind: 'RENOVATION', status: 'RENO_IN_PROGRESS', debtor_name: 'MS LEE', debtor_code: '301-M002', customer_id: 'c-1' },
      { doc_no: 'SO-PLAIN', company_id: CO, so_kind: null, status: 'CONFIRMED', debtor_name: 'MR TAN', debtor_code: '301-T001', customer_id: 'c-2' },
    ],
    reno_instalment_bills: [
      { so_doc_no: SO, seq: 1, kind: 'INVOICE', sales_invoice_id: 'si-1', invoice_number: '2990SI-2611-001' },
      { so_doc_no: SO, seq: 2, kind: 'INVOICE', sales_invoice_id: 'si-2', invoice_number: '2990SI-2611-002' },
    ],
    sales_invoices: [
      { id: 'si-1', company_id: CO, invoice_number: '2990SI-2611-001', total_sen: 150_000, status: 'SENT', so_doc_no: SO },
      { id: 'si-2', company_id: CO, invoice_number: '2990SI-2611-002', total_sen: 500_000, status: 'SENT', so_doc_no: SO },
    ],
    sales_invoice_payments: [],
    mfg_sales_order_payments: [],
    acc_official_receipts: [],
    journal_entries: [],
    acc_company_settings: [],
    acc_deposit_invoices: [],
    ...over,
  });
}
const pay = (id: string, amount: number, so = SO): Row => ({ id, company_id: CO, so_doc_no: so, method: 'transfer', amount_sen: amount, paid_at: '2026-11-20' });
const receipt = (id: number, paymentId: string, status: 'DRAFT' | 'FORMAL', doc = SO): Row => ({
  id, company_id: CO, or_number: `OR-${id}`, status, payment_source: 'SOPAY', payment_id: paymentId, doc_no: doc, sales_invoice_id: null, invoice_no: null,
});

describe('which invoice a renovation payment is for', () => {
  test('the first invoice, by instalment, that confirmed money does not cover', () => {
    const inv = [
      { id: 'si-2', invoiceNo: 'SI-2', seq: 2, totalSen: 500_000, ownConfirmedSen: 0 },
      { id: 'si-1', invoiceNo: 'SI-1', seq: 1, totalSen: 150_000, ownConfirmedSen: 0 },
    ];
    expect(pickInvoiceForPayment(inv, 0)?.invoiceNo).toBe('SI-1');
    expect(pickInvoiceForPayment(inv, 149_999)?.invoiceNo).toBe('SI-1');
    expect(pickInvoiceForPayment(inv, 150_000)?.invoiceNo).toBe('SI-2');
    expect(pickInvoiceForPayment([{ ...inv[1], ownConfirmedSen: 150_000 }, inv[0]], 0)?.invoiceNo).toBe('SI-2');
    expect(pickInvoiceForPayment(inv, 650_000)).toBeNull();
    expect(pickInvoiceForPayment([], 0)).toBeNull();
  });

  test('confirmed money covers the first invoice; unconfirmed money covers nothing', async () => {
    const sb = sbWith({
      mfg_sales_order_payments: [pay('p-1', 150_000), pay('p-2', 100_000), pay('p-3', 200_000)],
      acc_official_receipts: [receipt(1, 'p-1', 'FORMAL'), receipt(2, 'p-2', 'DRAFT'), receipt(3, 'p-3', 'DRAFT')],
    });
    /* p-1 confirmed pays SI-1: p-3 is for SI-2. */
    expect(await renoInvoiceForPayment(sb, CO, SO, 'p-3')).toEqual({ ok: true, renovation: true, invoice: { salesInvoiceId: 'si-2', invoiceNo: '2990SI-2611-002' } });
    /* Were p-1 still a draft, the money would not count yet: p-3 would be for SI-1. */
    sb.tables.acc_official_receipts[0].status = 'DRAFT';
    expect(await renoInvoiceForPayment(sb, CO, SO, 'p-3')).toMatchObject({ invoice: { invoiceNo: '2990SI-2611-001' } });
  });

  test('a cancelled invoice is skipped, and with nothing billed the receipt is on the order alone', async () => {
    const sb = sbWith({ mfg_sales_order_payments: [pay('p-1', 10_000)] });
    sb.tables.sales_invoices[0].status = 'CANCELLED';
    expect(await renoInvoiceForPayment(sb, CO, SO, 'p-1')).toMatchObject({ invoice: { invoiceNo: '2990SI-2611-002' } });
    const none = sbWith({ reno_instalment_bills: [], mfg_sales_order_payments: [pay('p-1', 10_000)] });
    expect(await renoInvoiceForPayment(none, CO, SO, 'p-1')).toEqual({ ok: true, renovation: true, invoice: null });
  });

  test('the receipt stores the link; a non-renovation receipt is left as it was', async () => {
    const sb = sbWith({
      mfg_sales_order_payments: [pay('p-1', 10_000), pay('p-9', 10_000, 'SO-PLAIN')],
      acc_official_receipts: [receipt(1, 'p-1', 'DRAFT'), receipt(9, 'p-9', 'DRAFT', 'SO-PLAIN')],
    });
    expect(await linkReceiptInvoice(sb, 1)).toMatchObject({ ok: true, linked: true });
    expect(sb.tables.acc_official_receipts[0]).toMatchObject({ sales_invoice_id: 'si-1', invoice_no: '2990SI-2611-001' });
    expect(await linkReceiptInvoice(sb, 9)).toMatchObject({ ok: true, linked: false });
    expect(sb.tables.acc_official_receipts[1]).toMatchObject({ sales_invoice_id: null, invoice_no: null });
  });

  test('a formal receipt keeps its invoice, unless the confirm itself relinks it (an invoice issued meanwhile)', async () => {
    const sb = sbWith({ reno_instalment_bills: [], mfg_sales_order_payments: [pay('p-1', 10_000)], acc_official_receipts: [receipt(1, 'p-1', 'DRAFT')] });
    await linkReceiptInvoice(sb, 1);
    expect(sb.tables.acc_official_receipts[0].invoice_no).toBeNull();
    sb.tables.reno_instalment_bills.push({ so_doc_no: SO, seq: 1, kind: 'INVOICE', sales_invoice_id: 'si-1', invoice_number: '2990SI-2611-001' });
    sb.tables.acc_official_receipts[0].status = 'FORMAL';
    expect(await linkReceiptInvoice(sb, 1)).toMatchObject({ linked: false });
    expect(await linkReceiptInvoice(sb, 1, { includeFormal: true })).toMatchObject({ linked: true });
    expect(sb.tables.acc_official_receipts[0].invoice_no).toBe('2990SI-2611-001');
  });
});

describe('received is confirmed money only', () => {
  const inst = [
    { id: 'a', seq: 1, label: '1ST', pctBp: 1500, description: '', stageCode: null, trigger: 'so_confirmed' },
    { id: 'b', seq: 2, label: '2ND', pctBp: 8500, description: '', stageCode: null, trigger: 'stage_start' },
  ];
  const bill = { instalment_id: 'a', seq: 1, kind: 'INVOICE' as const, amount_sen: 150_000, invoice_date: '2026-11-05', invoice_number: 'SI-1',
    sales_invoice_id: 'si-1', note_number: null, credit_note_id: null, paid_sen: 150_000, waiting_sen: 50_000, si_status: 'SENT', cn_status: null };

  test('unconfirmed order and invoice money is waiting, never received', () => {
    const v = assembleView(SO, 'RENO_IN_PROGRESS', 1_000_000, 1_000_000, inst, [bill], 0, [], 0, 200_000, 300_000);
    expect(v.receivedSen).toBe(100_000 + 200_000);
    expect(v.orderPaidSen).toBe(200_000);
    expect(v.waitingSen).toBe(50_000 + 300_000);
    expect(v.orderWaitingSen).toBe(300_000);
    expect(v.instalments[0].bill).toMatchObject({ paidSen: 100_000, waitingSen: 50_000 });
  });
});

describe('a renovation contract never takes deposit invoices', () => {
  const ON = { company_id: CO, deposit_invoice_enabled: true, deposit_invoice_from: '2026-09-01' };
  test('a confirmed payment on it is not due one, even with the switch on', async () => {
    const sb = sbWith({ acc_company_settings: [ON], mfg_sales_order_payments: [pay('p-1', 150_000)], acc_official_receipts: [receipt(1, 'p-1', 'FORMAL')] });
    expect(await issueDepositInvoice(sb, { paymentId: 'p-1', soDocNo: SO, paidAt: '2026-11-20', amountSen: 150_000, method: 'transfer' }))
      .toEqual({ ok: true, status: 'not_due', why: 'renovation' });
    expect(sb.tables.acc_deposit_invoices).toHaveLength(0);
  });
  test('nor is it in the backlog of payments owed one', async () => {
    const sb = sbWith({
      acc_company_settings: [ON], sales_invoices: [], reno_instalment_bills: [],
      mfg_sales_order_payments: [pay('p-1', 150_000), pay('p-9', 10_000, 'SO-PLAIN')],
      acc_official_receipts: [receipt(1, 'p-1', 'FORMAL'), receipt(9, 'p-9', 'FORMAL', 'SO-PLAIN')],
    });
    const m = await missingDepositInvoices(sb, CO);
    expect(m.ok && m.payments.map((p) => p.id)).toEqual(['p-9']);
  });
});

describe('an instalment invoice carries the customer header', () => {
  test('due on the invoice date plus the days of the order term, else on the invoice date', () => {
    expect(dueDateOf('2026-11-20', '30 Days')).toBe('2026-12-20');
    expect(dueDateOf('2026-11-20', 'Net 14')).toBe('2026-12-04');
    expect(dueDateOf('2026-11-20', 'C.O.D.')).toBe('2026-11-20');
    expect(dueDateOf('2026-11-20', null)).toBe('2026-11-20');
  });

  test('billInstalment stamps the due date, the salesperson and the debtor account fallback', async () => {
    const seen: Array<{ text: string; params: readonly unknown[] }> = [];
    const answers: Array<[RegExp, (p: readonly unknown[]) => unknown[]]> = [
      [/as revised_sen/, () => [{ doc_no: SO, status: 'RENO_IN_PROGRESS', original_contract_sen: 1_000_000, revised_sen: 1_000_000, billed_before_golive_sen: 0 }]],
      [/from scm\.mfg_sales_orders o\s+left join scm\.reno_so_contracts/, () => [{
        doc_no: SO, status: 'RENO_IN_PROGRESS', so_kind: 'RENOVATION', so_date: '2026-11-03', debtor_name: 'MS LEE', debtor_code: null, project_id: 7,
        local_total_sen: 1_000_000, paid_sen: 0, balance_sen: 0, version: 1, revision: 0, company_id: CO, branding: null, contract_version: 1,
        original_contract_sen: 1_000_000, doc_discount_sen: 0, promo_lines: [], brand_id: null,
      }]],
      [/from scm\.reno_doc_instalments/, () => [
        { id: 'a', so_doc_no: SO, seq: 1, label: '1ST', pct_bp: 1500, description: '', stage_code: null, trigger: 'so_confirmed' },
        { id: 'b', so_doc_no: SO, seq: 2, label: '2ND', pct_bp: 8500, description: '', stage_code: null, trigger: 'stage_start' },
      ]],
      [/select display_term/, () => [{ display_term: '30 Days' }]],
      [/next_doc_no_n/, () => [{ n: 1 }]],
      [/insert into scm\.sales_invoices/, () => [{ id: 'si-1' }]],
    ];
    const db: RenoDb = {
      async q<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
        seen.push({ text, params });
        for (const [re, fn] of answers) if (re.test(text)) return fn(params) as T[];
        return [] as T[];
      },
    };
    await billInstalment(db, { name: 'Sales', staffId: 'u1', companyId: CO, docPrefix: '2990' }, SO, 'a', { expectedAmountSen: 150_000, invoiceDate: '2026-11-20' });
    const ins = seen.find((s) => /insert into scm\.sales_invoices/.test(s.text))!;
    expect(ins.params[10]).toBe('2026-12-20');
    expect(ins.text).toMatch(/salesperson_id, due_date\)/);
    expect(ins.text).toMatch(/coalesce\(\$3, d\.code\)/);
    expect(ins.text).toMatch(/from scm\.debtors x/);
  });
});

describe('every salesperson bills their own contracts', () => {
  const keys = (scSales: string) => contsPermissions(parseContsAccess({ ...Object.fromEntries(CONTS_AREAS.map((k) => [k, 'none'])), scSales })!);
  test('Sales at edit holds bill_own, never the full bill key', () => {
    expect(keys('view')).not.toContain('scm.renovation.bill_own');
    expect(keys('edit')).toContain('scm.renovation.bill_own');
    expect(keys('full')).not.toContain('scm.renovation.bill');
  });
});
