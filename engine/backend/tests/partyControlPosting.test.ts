/* Every customer and supplier posts to its own control (Conts, finance phase 1.5; spec 2.4). A customer is a row of
   scm.debtors naming its control (301-0000 renovation, 302-0000 inhouse, 303-0000 rental); a supplier names its
   control on scm.suppliers.control_account. Pinned, one per kind of entry:
     · an invoice debits the customer's control and names the customer; its payment credits the same control;
     · an order payment, a credit note and money moved between two customers' orders use each customer's control;
     · a customer with no record is refused and stays unposted, never guessed onto the AR rule (chew, 29 Oct 2026);
     · a purchase invoice and a supplier credit note credit / debit the supplier's own control. */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { postSiRevenue } from '../src/scm/lib/post-si-revenue';
import { postSiPayment, postSoPayment } from '../src/acc/payments';
import { postCreditNote } from '../src/acc/credit-notes';
import { postPiAccounting } from '../src/scm/routes/accounting';
import { DEFAULT_ROLE_CODES } from '../src/acc/rules';

const CO = 1;
const acct = (code: string, type: string, special: string | null = null): Row => ({
  company_id: CO, account_code: code, account_name: code, account_type: type, parent_code: null, is_active: true, special_type: special,
});
const CHART: Row[] = [
  acct('300-0000', 'ASSET', 'SDC'), acct('301-0000', 'ASSET', 'SDC'), acct('302-0000', 'ASSET', 'SDC'),
  acct('310-0010', 'ASSET'), acct('320-0000', 'ASSET'), acct('400-0000', 'LIABILITY', 'SCC'), acct('405-0000', 'LIABILITY', 'SCC'),
  acct('500-0003', 'INCOME'), acct('510-0000', 'INCOME'), acct('601-0003', 'EXPENSE'), acct('612-0000', 'EXPENSE'),
];
const DEBTORS: Row[] = [
  { id: 'd1', company_id: CO, code: '301-M001', name: 'MS LEE', control_account: '301-0000', is_active: true },
  { id: 'd2', company_id: CO, code: '302-M005', name: 'MR TAN', control_account: '302-0000', is_active: true },
];
const world = (over: Record<string, Row[]> = {}) => fakeSb({
  accounts: CHART.map((r) => ({ ...r })),
  companies: [{ id: CO, code: 'HOUZS', name: 'THE CONTS' }],
  acc_account_roles: [], acc_acquirers: [], acc_company_settings: [],
  acc_item_group_accounts: [{ company_id: CO, group_code: 'SOFA', sales_account: '500-0003', purchase_account: '601-0003', sales_return_account: '510-0000', purchase_return_account: '612-0000' }],
  debtors: DEBTORS.map((r) => ({ ...r })),
  suppliers: [],
  mfg_sales_orders: [], sales_invoices: [], sales_invoice_items: [], journal_entries: [], journal_entry_lines: [],
  /* The payments posted here were confirmed by finance (SOP 4.2): an unconfirmed one waits and posts nothing. */
  acc_official_receipts: [
    { id: 1, company_id: CO, payment_source: 'SIPAY', payment_id: 'sp-1', status: 'FORMAL', channel_account_code: '310-0010' },
    { id: 2, company_id: CO, payment_source: 'SOPAY', payment_id: 'op-1', status: 'FORMAL', channel_account_code: '310-0010' },
  ],
  ...over,
}, {}, [], ['journal_entry_lines']);
const arLine = (sb: ReturnType<typeof world>) => (sb.tables.journal_entry_lines as Row[])
  .filter((l) => String(l.account_code).startsWith('30')).map((l) => ({ code: l.account_code, dr: Number(l.debit_sen), cr: Number(l.credit_sen), party: l.party_code }));
const apLine = (sb: ReturnType<typeof world>) => (sb.tables.journal_entry_lines as Row[])
  .filter((l) => String(l.account_code).startsWith('40')).map((l) => ({ code: l.account_code, dr: Number(l.debit_sen), cr: Number(l.credit_sen), party: l.party_code }));

const SI = (over: Row = {}): Row => ({
  id: 'si-1', company_id: CO, invoice_number: 'HC-SI-2612-001', invoice_date: '2026-12-02', status: 'SENT',
  debtor_code: '301-M001', debtor_name: 'MS LEE', total_sen: 30_000, paid_sen: 0, migrated_no_stock: false, so_doc_no: null, ...over,
});
const ITEM: Row = { id: 'sii-1', company_id: CO, sales_invoice_id: 'si-1', item_group: 'sofa', line_total_sen: 30_000 };

describe('receivables post to the customer\'s control', () => {
  test('an invoice for 301-M001 debits 301-0000 and names the customer', async () => {
    const sb = world({ sales_invoices: [SI()], sales_invoice_items: [{ ...ITEM }] });
    expect(await postSiRevenue(sb, 'HC-SI-2612-001')).toMatchObject({ ok: true, status: 'posted' });
    expect(arLine(sb)).toEqual([{ code: '301-0000', dr: 30_000, cr: 0, party: '301-M001' }]);
  });

  test('a payment on that invoice credits 301-0000 and names the customer', async () => {
    const sb = world({ sales_invoices: [SI()] });
    const r = await postSiPayment(sb, { id: 'sp-1', sales_invoice_id: 'si-1', paid_at: '2026-12-05', method: 'cash', merchant_provider: null, amount_sen: 9_000, company_id: CO } as never);
    expect(r).toMatchObject({ ok: true, status: 'posted' });
    expect(arLine(sb)).toEqual([{ code: '301-0000', dr: 0, cr: 9_000, party: '301-M001' }]);
  });

  test('an invoice payment with no debtor code names the order\'s customer, as the invoice did', async () => {
    const sb = world({
      sales_invoices: [SI({ debtor_code: null, so_doc_no: 'HC-SO-2612-001' })],
      mfg_sales_orders: [{ doc_no: 'HC-SO-2612-001', company_id: CO, customer_id: 'cust-9', debtor_code: null, debtor_name: 'MS LEE' }],
      /* The order's customer, keyed on its customer id, with an account of its own. */
      debtors: [{ id: 'd9', company_id: CO, code: 'cust-9', name: 'MS LEE', control_account: DEFAULT_ROLE_CODES.AR, is_active: true }],
    });
    await postSiPayment(sb, { id: 'sp-1', sales_invoice_id: 'si-1', paid_at: '2026-12-05', method: 'cash', merchant_provider: null, amount_sen: 9_000, company_id: CO } as never);
    expect(arLine(sb)).toEqual([{ code: DEFAULT_ROLE_CODES.AR, dr: 0, cr: 9_000, party: 'cust-9' }]);
  });

  test('an order payment credits the order customer\'s control', async () => {
    const sb = world({ mfg_sales_orders: [{ doc_no: 'HC-SO-2612-002', company_id: CO, customer_id: 'cust-2', debtor_code: '302-M005', debtor_name: 'MR TAN', phone: null }], mfg_sales_order_payments: [] });
    const r = await postSoPayment(sb, { id: 'op-1', so_doc_no: 'HC-SO-2612-002', paid_at: '2026-12-03', method: 'cash', merchant_provider: null, amount_sen: 5_000, company_id: CO } as never);
    expect(r).toMatchObject({ ok: true, status: 'posted' });
    expect(arLine(sb)).toEqual([{ code: '302-0000', dr: 0, cr: 5_000, party: '302-M005' }]);
  });

  test('money moved between two customers\' orders leaves one control and lands on the other', async () => {
    const sb = world({
      mfg_sales_orders: [
        { doc_no: 'HC-SO-2612-003', company_id: CO, customer_id: 'c-a', debtor_code: '301-M001', debtor_name: 'MS LEE' },
        { doc_no: 'HC-SO-2612-004', company_id: CO, customer_id: 'c-b', debtor_code: '302-M005', debtor_name: 'MR TAN' },
      ],
    });
    const r = await postSoPayment(sb, {
      id: 'op-2', so_doc_no: 'HC-SO-2612-004', converted_from_so_doc_no: 'HC-SO-2612-003', paid_at: '2026-12-03', created_at: '2026-12-04T02:00:00Z',
      method: 'converted', merchant_provider: null, amount_sen: 4_000, company_id: CO,
    } as never);
    expect(r).toMatchObject({ ok: true, status: 'posted' });
    expect(arLine(sb)).toEqual([
      { code: '301-0000', dr: 4_000, cr: 0, party: '301-M001' },
      { code: '302-0000', dr: 0, cr: 4_000, party: '302-M005' },
    ]);
  });

  test('a credit note to a customer credits that customer\'s control', async () => {
    const note: Row = { id: 'n1', company_id: CO, kind: 'CN', note_number: 'HC-CN-2612-001', note_date: '2026-12-06', status: 'DRAFT', party_type: 'CUSTOMER', party_code: '302-M005', party_name: 'MR TAN' };
    const sb = world({ acc_credit_notes: [note], acc_credit_note_lines: [{ id: 'l1', company_id: CO, note_id: 'n1', line_no: 1, description: 'Return', account_code: '510-0000', amount_sen: 2_000 }] });
    const r = await postCreditNote(sb, { companyId: CO, note, actor: 'T' });
    expect(r).toMatchObject({ ok: true });
    expect(arLine(sb)).toEqual([{ code: '302-0000', dr: 0, cr: 2_000, party: '302-M005' }]);
  });

  test('a customer with no record posts nothing and says why — never guessed onto the AR rule', async () => {
    const sb = world({ sales_invoices: [SI({ debtor_code: '300-X999' })], sales_invoice_items: [{ ...ITEM }] });
    const r = await postSiRevenue(sb, 'HC-SI-2612-001');
    expect(r).toMatchObject({ ok: false });
    expect(String((r as { reason?: string }).reason)).toContain('Customer 300-X999 has no account');
    expect(sb.tables.journal_entries).toHaveLength(0);
    expect(arLine(sb)).toEqual([]);
  });

  test('a customer whose record cannot be read posts nothing', async () => {
    const sb = fakeSb({
      accounts: CHART.map((r) => ({ ...r })), acc_account_roles: [], acc_company_settings: [],
      acc_item_group_accounts: [{ company_id: CO, group_code: 'SOFA', sales_account: '500-0003' }],
      debtors: [], sales_invoices: [SI()], sales_invoice_items: [{ ...ITEM }], journal_entries: [], journal_entry_lines: [],
    }, { debtors: ['control_account'] });
    const r = await postSiRevenue(sb, 'HC-SI-2612-001');
    expect(r.ok).toBe(false);
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
});

describe('payables post to the supplier\'s control', () => {
  test('a purchase invoice credits the supplier\'s own control', async () => {
    const sb = world({
      purchase_invoices: [{
        id: 'pi1', invoice_number: 'HC-PI-2612-001', invoice_date: '2026-12-02', supplier_id: 's1', total_sen: 10_000, currency: 'MYR', exchange_rate: 1,
        company_id: CO, migrated_no_stock: false, opening_balance: false, suppliers: { code: '400-K001', name: 'KC TAN & CO', control_account: '405-0000' },
      }],
      purchase_invoice_items: [{ purchase_invoice_id: 'pi1', item_group: 'sofa', line_total_sen: 10_000, company_id: CO }],
    });
    expect(await postPiAccounting(sb, 'HC-PI-2612-001')).toMatchObject({ ok: true, status: 'posted' });
    expect(apLine(sb)).toEqual([{ code: '405-0000', dr: 0, cr: 10_000, party: '400-K001' }]);
  });

  test('a supplier credit note debits the supplier\'s own control', async () => {
    const note: Row = { id: 'n2', company_id: CO, kind: 'SCN', note_number: 'HC-SCN-2612-001', note_date: '2026-12-06', status: 'DRAFT', party_type: 'SUPPLIER', party_code: '400-K001', party_name: 'KC TAN & CO' };
    const sb = world({
      suppliers: [{ id: 's1', company_id: CO, code: '400-K001', name: 'KC TAN & CO', control_account: '405-0000' }],
      acc_credit_notes: [note], acc_credit_note_lines: [{ id: 'l2', company_id: CO, note_id: 'n2', line_no: 1, description: 'Return', account_code: '612-0000', amount_sen: 1_500 }],
    });
    const r = await postCreditNote(sb, { companyId: CO, note, actor: 'T' });
    expect(r).toMatchObject({ ok: true });
    expect(apLine(sb)).toEqual([{ code: '405-0000', dr: 1_500, cr: 0, party: '400-K001' }]);
  });
});
