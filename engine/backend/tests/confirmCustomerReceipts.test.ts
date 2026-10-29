/* Finance confirms every customer payment before it counts (chew, 29 Oct 2026; SOP 4.2/4.5): "Salesperson 在系统更新收款
   → 财务核对银行确实收到 → 才算已收，项目额度才增加". Confirmation = the payment's official receipt turning FORMAL. Pinned:
     · a recorded payment — transfer or cash — keeps a DRAFT receipt, posts nothing, issues no deposit invoice and adds
       nothing to the project limit; editing it before confirmation posts nothing either;
     · finance confirms onto the bank it chose: the receipt takes that bank's number, the payment posts Dr that bank /
       Cr the customer's control, the deposit invoice follows and the project limit grows;
     · cash is confirmed onto a bank like a transfer, never the CASH account;
     · only scm.payment_voucher.post confirms; the CASH account, a petty cash float's account, a retired account and a
       non-money account are refused, with nothing written;
     · a card settlement that formalises a receipt posts its payment (still Dr the card clearing account). */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { afterSoPaymentRemoved, bookSoPaymentBestEffort, repostSoPaymentBestEffort } from '../src/scm/lib/so-payment-row';
import { postSiPayment, postSoPayment } from '../src/acc/payments';
import { formaliseReceipt, receiptConfirmation } from '../src/acc/receipts';
import { issueDepositInvoice } from '../src/acc/deposit-invoices';
import { receiptConfirmBanks, receiptFormalise } from '../src/scm/routes/accounting-receipts';
import { projectLimit } from '../src/conts/project-limit';
import { confirmSettlementRow } from '../src/acc/settlement';

const CO = 2;
const SO = '2990-SO-2610-001';
const acct = (code: string, name: string, type: string, over: Row = {}): Row => ({
  company_id: CO, account_code: code, account_name: name, account_type: type, parent_code: null, is_active: true, special_type: null, acc_money: false, ...over,
});
const world = (over: Record<string, Row[]> = {}) => fakeSb(
  {
    accounts: [
      acct('300-0000', 'ACCOUNT RECEIVABLE', 'ASSET', { special_type: 'SDC' }),
      acct('310-0010', 'CASH AT BANK - HONG LEONG', 'ASSET', { acc_money: true }),
      acct('310-0020', 'CASH AT BANK - MAYBANK', 'ASSET', { acc_money: true }),
      acct('310-0030', 'CASH AT BANK - CLOSED', 'ASSET', { acc_money: true, is_active: false }),
      acct('320-0000', 'CASH IN HAND', 'ASSET', { acc_money: true }),
      acct('320-0100', 'PETTY CASH - SALES', 'ASSET', { acc_money: true, special_type: 'SCH' }),
      acct('326-0000', 'CARD MACHINE CLEARING (EDC)', 'ASSET'),
      acct('509-0000', 'DEPOSIT PAY BY CUSTOMER', 'INCOME'),
      acct('601-0001', 'RENOVATION COST', 'EXPENSE'),
      acct('930-0000', 'CARD FEES', 'EXPENSE'),
    ],
    companies: [{ id: CO, code: '2990', name: '2990' }],
    projects: [{ id: 7, company_id: CO, name: 'SKYLINE A-12-06', funding: 'customer', limit_pct_bp: null, budget_sen: null }],
    mfg_sales_orders: [{ doc_no: SO, company_id: CO, debtor_code: null, debtor_name: 'MS LEE', customer_id: 'cust-1', status: 'CONFIRMED', project_id: 7 }],
    mfg_sales_order_payments: [
      { id: 'p-tr', so_doc_no: SO, paid_at: '2026-10-20', method: 'transfer', merchant_provider: null, amount_sen: 100_000, company_id: CO, created_by: 'sales-1' },
      { id: 'p-cash', so_doc_no: SO, paid_at: '2026-10-21', method: 'cash', merchant_provider: null, amount_sen: 50_000, company_id: CO, created_by: 'sales-1' },
    ],
    sales_invoices: [], sales_invoice_payments: [],
    debtors: [{ company_id: CO, code: 'cust-1', name: 'MS LEE', control_account: '300-0000', is_active: true }],
    petty_cash_floats: [{ id: 'f1', company_id: CO, account_code: '320-0100', active: true }],
    acc_account_roles: [],
    acc_company_settings: [{ company_id: CO, deposit_invoice_enabled: true, deposit_invoice_from: '2026-10-01', project_limit_pct_bp: 7000 }],
    acc_deposit_invoices: [],
    acc_official_receipts: [],
    acc_bank_letters: [{ company_id: CO, account_code: '310-0010', letter: 'H' }, { company_id: CO, account_code: '310-0020', letter: 'M' }],
    acc_numbering: [],
    acc_acquirers: [],
    payment_vouchers: [], payment_voucher_lines: [], project_limit_requests: [],
    journal_entries: [], journal_entry_lines: [],
    ...over,
  },
  {},
  [
    { table: 'acc_official_receipts', column: 'or_number', name: 'acc_official_receipts_or_number_key' },
    { table: 'acc_official_receipts', column: 'payment_id', name: 'acc_official_receipts_payment_once' },
  ],
  ['journal_entry_lines', 'acc_official_receipts'],
);
type World = ReturnType<typeof world>;

const payment = (sb: World, id: string) => (sb.tables.mfg_sales_order_payments as Row[]).find((p) => p.id === id)!;
const receiptOf = (sb: World, id: string) => (sb.tables.acc_official_receipts as Row[]).find((r) => r.payment_id === id);
const linesOf = (sb: World, sourceDocNo: string) => {
  const je = (sb.tables.journal_entries as Row[]).filter((j) => j.source_doc_no === sourceDocNo && !j.reversed && (j.source_type === 'SOPAY' || j.source_type === 'SIPAY'));
  return (sb.tables.journal_entry_lines as Row[]).filter((l) => je.some((j) => j.id === l.journal_entry_id))
    .map((l) => ({ code: l.account_code, dr: Number(l.debit_sen), cr: Number(l.credit_sen), party: l.party_code ?? null }));
};
const received = async (sb: World) => {
  const lim = await projectLimit(sb, CO, 7);
  if (!lim.ok) throw new Error(lim.error);
  return lim.receivedSen;
};

/** The confirm route as finance (or, with `perms`, anyone else) calls it. */
function harness(sb: World, perms: string[] = ['scm.payment_voucher.post']) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('houzsUser' as never, { name: 'Finance Fiona', permissions_set: perms } as never);
    c.set('allowedCompanyIds' as never, [CO] as never);
    await next();
  });
  app.get('/accounting/receipts/banks', receiptConfirmBanks as never);
  app.post('/accounting/receipts/:id/formalise', receiptFormalise as never);
  const confirm = async (receiptId: unknown, body?: Record<string, unknown>) => {
    const res = await app.request(`/accounting/receipts/${String(receiptId)}/formalise`, {
      method: 'POST', ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { app, confirm };
}

/** Record both payments the way every writer does: through the one hook. */
const recordBoth = async (sb: World) => {
  await bookSoPaymentBestEffort(sb, payment(sb, 'p-tr'), 'payment');
  await bookSoPaymentBestEffort(sb, payment(sb, 'p-cash'), 'payment');
};

describe('a recorded payment waits for finance', () => {
  test('transfer and cash alike: a DRAFT receipt, no journal, no deposit invoice, nothing on the project limit', async () => {
    const sb = world();
    await recordBoth(sb);
    expect(receiptOf(sb, 'p-tr')).toMatchObject({ status: 'DRAFT', or_number: '2990-DraftOR-2610-001' });
    /* Cash is no longer formal at recording: it is deposited in the bank, and finance confirms it there. */
    expect(receiptOf(sb, 'p-cash')).toMatchObject({ status: 'DRAFT', or_number: '2990-DraftOR-2610-002' });
    expect(receiptOf(sb, 'p-cash')!.channel_account_code ?? null).toBeNull();
    expect(sb.tables.journal_entries).toHaveLength(0);
    expect(sb.tables.acc_deposit_invoices).toHaveLength(0);
    expect(await received(sb)).toBe(0);
  });

  test('the posters answer waiting_confirmation and write nothing — the dry run too, and an invoice payment too', async () => {
    const sb = world({
      sales_invoices: [{ id: 'si-1', company_id: CO, invoice_number: '2990-SI-2610-001', debtor_code: 'cust-1', debtor_name: 'MS LEE', migrated_no_stock: false, so_doc_no: SO }],
    });
    await recordBoth(sb);
    expect(await postSoPayment(sb, payment(sb, 'p-tr') as never)).toEqual({ ok: true, status: 'waiting_confirmation' });
    expect(await postSoPayment(sb, payment(sb, 'p-cash') as never, { dryRun: true })).toEqual({ ok: true, status: 'waiting_confirmation' });
    expect(await postSiPayment(sb, { id: 'sp-1', sales_invoice_id: 'si-1', paid_at: '2026-10-22', method: 'transfer', merchant_provider: null, amount_sen: 9_000, company_id: CO }))
      .toEqual({ ok: true, status: 'waiting_confirmation' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  test('a customer credit applied to an invoice is not money arriving: nothing to confirm, it counts as it stands', async () => {
    const sb = world({
      sales_invoices: [{ id: 'si-1', company_id: CO, invoice_number: '2990-SI-2610-001', debtor_code: 'cust-1', debtor_name: 'MS LEE', migrated_no_stock: false, so_doc_no: SO, status: 'SENT' }],
      sales_invoice_payments: [{ id: 'sp-c', sales_invoice_id: 'si-1', paid_at: '2026-10-22', method: 'credit', merchant_provider: null, amount_sen: 7_000, company_id: CO }],
    });
    const r = await postSiPayment(sb, (sb.tables.sales_invoice_payments as Row[])[0] as never);
    expect(r.status).not.toBe('waiting_confirmation');
    expect(await received(sb)).toBe(7_000);
  });

  test('editing an unconfirmed payment posts nothing and issues no deposit invoice', async () => {
    const sb = world();
    await recordBoth(sb);
    const touched = await repostSoPaymentBestEffort(sb, {
      id: 'p-tr', docNo: SO, companyId: CO,
      before: { paid_at: '2026-10-20', method: 'transfer', amount_sen: 100_000, merchant_provider: null },
      next: { paid_at: '2026-10-20', method: 'transfer', amount_sen: 120_000, merchant_provider: null, installment_months: null, online_type: null, approval_code: null, account_sheet: null, collected_by: null },
    });
    expect(touched).toEqual({ originalJeNo: null, contraJeNo: null, jeNo: null });
    expect(sb.tables.journal_entries).toHaveLength(0);
    expect(sb.tables.acc_deposit_invoices).toHaveLength(0);
  });
});

describe('finance confirms against the bank statement', () => {
  test('onto the bank finance chose: the receipt takes its number, Dr that bank / Cr the customer, the deposit invoice follows, the limit grows', async () => {
    const sb = world();
    await recordBoth(sb);
    const { confirm } = harness(sb);
    const r = await confirm(receiptOf(sb, 'p-tr')!.id, { accountCode: '310-0020' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, orNumber: '2990-MOR-2610-001', posting: { status: 'posted' } });
    expect(receiptOf(sb, 'p-tr')).toMatchObject({ status: 'FORMAL', channel_account_code: '310-0020', issued_by: 'Finance Fiona' });
    expect(linesOf(sb, 'p-tr')).toEqual([
      { code: '310-0020', dr: 100_000, cr: 0, party: null },
      { code: '300-0000', dr: 0, cr: 100_000, party: 'cust-1' },
    ]);
    const je = (sb.tables.journal_entries as Row[]).find((j) => j.source_doc_no === 'p-tr')!;
    expect(r.body.posting.jeNo).toBe(je.je_no);
    expect(sb.tables.acc_deposit_invoices).toHaveLength(1);
    expect(sb.tables.acc_deposit_invoices[0]).toMatchObject({ payment_id: 'p-tr', amount_sen: 100_000 });
    /* Only the confirmed money counts: 70% of RM 1,000; the cash still waits. */
    expect(await received(sb)).toBe(100_000);
    expect((await projectLimit(sb, CO, 7) as { limitSen: number }).limitSen).toBe(70_000);
  });

  test('no bank named: the default bank (BANK_DEFAULT, Hong Leong)', async () => {
    const sb = world();
    await recordBoth(sb);
    const r = await harness(sb).confirm(receiptOf(sb, 'p-tr')!.id);
    expect(r.status).toBe(200);
    expect(r.body.orNumber).toBe('2990-HOR-2610-001');
    expect(linesOf(sb, 'p-tr')[0]).toMatchObject({ code: '310-0010', dr: 100_000 });
  });

  test('cash is confirmed onto a bank like a transfer — never the CASH account', async () => {
    const sb = world();
    await recordBoth(sb);
    const r = await harness(sb).confirm(receiptOf(sb, 'p-cash')!.id, { accountCode: '310-0010' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ orNumber: '2990-HOR-2610-001', posting: { status: 'posted' } });
    expect(linesOf(sb, 'p-cash')).toEqual([
      { code: '310-0010', dr: 50_000, cr: 0, party: null },
      { code: '300-0000', dr: 0, cr: 50_000, party: 'cust-1' },
    ]);
    expect(await received(sb)).toBe(50_000);
  });

  test('an invoice payment confirmed posts through the invoice poster', async () => {
    const sb = world({
      sales_invoices: [{ id: 'si-1', company_id: CO, invoice_number: '2990-SI-2610-001', debtor_code: 'cust-1', debtor_name: 'MS LEE', migrated_no_stock: false, so_doc_no: SO, status: 'SENT' }],
      sales_invoice_payments: [{ id: 'sp-1', sales_invoice_id: 'si-1', paid_at: '2026-10-22', method: 'transfer', merchant_provider: null, amount_sen: 9_000, company_id: CO }],
      acc_official_receipts: [{ id: 41, company_id: CO, or_number: '2990-DraftOR-2610-009', status: 'DRAFT', payment_source: 'SIPAY', payment_id: 'sp-1', amount_sen: 9_000, paid_at: '2026-10-22' }],
    });
    const r = await harness(sb).confirm(41, { accountCode: '310-0020' });
    expect(r.body).toMatchObject({ ok: true, posting: { status: 'posted' } });
    expect((sb.tables.journal_entries as Row[]).map((j) => j.source_type)).toEqual(['SIPAY']);
    expect(linesOf(sb, 'sp-1')[0]).toMatchObject({ code: '310-0020', dr: 9_000 });
    /* Invoice money counts for the limit once confirmed, too. */
    expect(await received(sb)).toBe(9_000);
  });

  test('the bank list offers the active banks only, the default first', async () => {
    const sb = world();
    const res = await harness(sb).app.request('/accounting/receipts/banks');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      defaultCode: '310-0010',
      banks: [{ code: '310-0010', name: 'CASH AT BANK - HONG LEONG' }, { code: '310-0020', name: 'CASH AT BANK - MAYBANK' }],
    });
  });
});

describe('who may confirm, and onto what', () => {
  test('a salesperson (sales_order.write) cannot confirm; nothing is written', async () => {
    const sb = world();
    await recordBoth(sb);
    const r = await harness(sb, ['scm.sales_order.write']).confirm(receiptOf(sb, 'p-tr')!.id, { accountCode: '310-0010' });
    expect(r.status).toBe(403);
    expect(receiptOf(sb, 'p-tr')).toMatchObject({ status: 'DRAFT' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  test.each([
    ['320-0000', 'the CASH account'],
    ['320-0100', 'a petty cash float'],
    ['310-0030', 'not an active'],
    ['601-0001', 'not an active'],
    ['999-9999', 'not an active'],
  ])('%s is refused (%s), nothing written', async (code, says) => {
    const sb = world();
    await recordBoth(sb);
    const r = await harness(sb).confirm(receiptOf(sb, 'p-cash')!.id, { accountCode: code });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bank_not_allowed');
    expect(String(r.body.message)).toContain(says);
    expect(receiptOf(sb, 'p-cash')).toMatchObject({ status: 'DRAFT' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
});

describe('a card settlement that formalises a receipt posts its payment', () => {
  test('the receipt goes FORMAL on the payout bank and the payment posts Dr the card clearing account / Cr the customer', async () => {
    const sb = world({
      acc_acquirers: [{
        company_id: CO, code: 'MBB', display_name: 'MBB', transit_account_code: '326-0000', fee_account_code: '930-0000', bank_account_code: '310-0020',
        statement_format: 'CSV', has_unique_ref: true, fee_method: 'stated', date_tolerance_days: 3, column_map: null, is_active: true,
      }],
      acc_settlement_batches: [{ id: 1, company_id: CO, acquirer_code: 'MBB', period_from: '2026-10-23', period_to: '2026-10-23', gross_sen: 80_000, fee_sen: 1_000, net_sen: 79_000 }],
      acc_settlement_rows: [{ id: 7, batch_id: 1, company_id: CO, acquirer_code: 'MBB', line_no: 1, txn_date: '2026-10-23', ref: 'A1', gross_sen: 80_000, fee_sen: 1_000, net_sen: 79_000, bucket: 'MATCHED', confirmed_at: null, posted_je_no: null }],
      acc_settlement_matches: [],
      mfg_so_audit_log: [],
      mfg_sales_order_payments: [{ id: 'p-card', so_doc_no: SO, paid_at: '2026-10-22', method: 'merchant', merchant_provider: 'MBB', amount_sen: 80_000, company_id: CO, created_by: 'sales-1' }],
    });
    await bookSoPaymentBestEffort(sb, payment(sb, 'p-card'), 'payment');
    expect(receiptOf(sb, 'p-card')).toMatchObject({ status: 'DRAFT' });
    expect(sb.tables.journal_entries).toHaveLength(0);

    const r = await confirmSettlementRow(sb, { companyId: CO, rowId: 7, payments: [{ source: 'SOPAY', id: 'p-card', docNo: SO, amountSen: 80_000 }], matchReason: 'ref', userName: 'Finance Fiona' });
    expect(r).toMatchObject({ ok: true, status: 'confirmed' });
    expect(receiptOf(sb, 'p-card')).toMatchObject({ status: 'FORMAL', channel_account_code: '310-0020', or_number: '2990-MOR-2610-001' });
    expect(linesOf(sb, 'p-card')).toEqual([
      { code: '326-0000', dr: 80_000, cr: 0, party: null },
      { code: '300-0000', dr: 0, cr: 80_000, party: 'cust-1' },
    ]);
    expect(await received(sb)).toBe(80_000);
  });
});

const balance = (sb: World, code: string) => (sb.tables.journal_entry_lines as Row[])
  .filter((l) => l.account_code === code).reduce((s, l) => s + Number(l.debit_sen ?? 0) - Number(l.credit_sen ?? 0), 0);
const liveSopay = (sb: World) => (sb.tables.journal_entries as Row[]).filter((j) => j.source_type === 'SOPAY' && !j.reversed);

describe('a card payment keyed with no acquirer, confirmed by a settlement', () => {
  test("its debit ends on that acquirer's own clearing account", async () => {
    const sb = world({
      accounts: [...(world().tables.accounts as Row[]), acct('326-0010', 'CLEARING - MBB', 'ASSET')],
      acc_acquirers: [{
        company_id: CO, code: 'MBB', display_name: 'MBB', transit_account_code: '326-0010', fee_account_code: '930-0000', bank_account_code: '310-0020',
        statement_format: 'CSV', has_unique_ref: true, fee_method: 'stated', date_tolerance_days: 3, column_map: null, is_active: true,
      }],
      acc_settlement_batches: [{ id: 1, company_id: CO, acquirer_code: 'MBB', period_from: '2026-10-23', period_to: '2026-10-23', gross_sen: 80_000, fee_sen: 1_000, net_sen: 79_000 }],
      acc_settlement_rows: [{ id: 7, batch_id: 1, company_id: CO, acquirer_code: 'MBB', line_no: 1, txn_date: '2026-10-23', ref: 'A1', gross_sen: 80_000, fee_sen: 1_000, net_sen: 79_000, bucket: 'MATCHED', confirmed_at: null, posted_je_no: null }],
      acc_settlement_matches: [], mfg_so_audit_log: [],
      mfg_sales_order_payments: [{ id: 'p-card', so_doc_no: SO, paid_at: '2026-10-22', method: 'merchant', merchant_provider: null, amount_sen: 80_000, company_id: CO, created_by: 'sales-1' }],
    });
    await bookSoPaymentBestEffort(sb, payment(sb, 'p-card'), 'payment');
    const r = await confirmSettlementRow(sb, { companyId: CO, rowId: 7, payments: [{ source: 'SOPAY', id: 'p-card', docNo: SO, amountSen: 80_000 }], matchReason: 'ref', userName: 'Finance Fiona' });
    expect(r).toMatchObject({ ok: true, status: 'confirmed' });
    expect(balance(sb, '326-0010')).toBe(79_000);
    expect(balance(sb, '326-0000')).toBe(0);
    expect(linesOf(sb, 'p-card')).toEqual([
      { code: '326-0010', dr: 80_000, cr: 0, party: null },
      { code: '300-0000', dr: 0, cr: 80_000, party: 'cust-1' },
    ]);
  });
});

/* Posted under the old rule (at recording), its receipt still a draft: the money is in the books, so it counts. */
describe('a payment posted before confirmation existed', () => {
  const legacy = async () => {
    const sb = world();
    await recordBoth(sb);
    /* The old rule posted at recording: the transfer onto BANK_DEFAULT. */
    const rec = receiptOf(sb, 'p-tr')!;
    rec.status = 'FORMAL';
    await postSoPayment(sb, payment(sb, 'p-tr') as never);
    rec.status = 'DRAFT';
    rec.channel_account_code = null;
    return sb;
  };

  test('counts for the project limit and is due its deposit invoice', async () => {
    const sb = await legacy();
    expect(await received(sb)).toBe(100_000);
    expect(await issueDepositInvoice(sb, { paymentId: 'p-tr', soDocNo: SO, paidAt: '2026-10-20', amountSen: 100_000, method: 'transfer' }))
      .toMatchObject({ ok: true, status: 'issued' });
  });

  test('an edit reverses and re-posts it on the account it had, never reversed and left waiting', async () => {
    const sb = await legacy();
    await repostSoPaymentBestEffort(sb, {
      id: 'p-tr', docNo: SO, companyId: CO,
      before: { paid_at: '2026-10-20', method: 'transfer', amount_sen: 100_000, merchant_provider: null },
      next: { paid_at: '2026-10-20', method: 'transfer', amount_sen: 120_000, merchant_provider: null, installment_months: null, online_type: null, approval_code: null, account_sheet: null, collected_by: null },
    });
    expect(liveSopay(sb)).toHaveLength(1);
    expect(linesOf(sb, 'p-tr')[0]).toMatchObject({ code: '310-0010', dr: 120_000 });
  });

  test('confirmed later onto another bank, its entry moves there: the old one reversed, one live entry on the chosen bank', async () => {
    const sb = await legacy();
    const r = await harness(sb).confirm(receiptOf(sb, 'p-tr')!.id, { accountCode: '310-0020' });
    expect(r.body).toMatchObject({ ok: true, posting: { status: 'posted' } });
    expect(liveSopay(sb)).toHaveLength(1);
    expect(linesOf(sb, 'p-tr')[0]).toMatchObject({ code: '310-0020', dr: 100_000 });
    expect(balance(sb, '310-0010')).toBe(0);
    expect(balance(sb, '310-0020')).toBe(100_000);
  });
});

describe('finance confirms what the payment says', () => {
  test("an edit keeps the draft receipt in step; a receipt whose amount is not the payment's is refused", async () => {
    const sb = world();
    await recordBoth(sb);
    await repostSoPaymentBestEffort(sb, {
      id: 'p-tr', docNo: SO, companyId: CO,
      before: { paid_at: '2026-10-20', method: 'transfer', amount_sen: 100_000, merchant_provider: null },
      next: { paid_at: '2026-10-21', method: 'cash', amount_sen: 90_000, merchant_provider: null, installment_months: null, online_type: null, approval_code: null, account_sheet: null, collected_by: null },
    });
    expect(receiptOf(sb, 'p-tr')).toMatchObject({ status: 'DRAFT', amount_sen: 90_000, method: 'cash', paid_at: '2026-10-21' });
    /* A payment changed behind the receipt's back: refused, nothing written. */
    payment(sb, 'p-cash').amount_sen = 55_000;
    const r = await harness(sb).confirm(receiptOf(sb, 'p-cash')!.id, { accountCode: '310-0010' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('payment_edited');
    expect(receiptOf(sb, 'p-cash')).toMatchObject({ status: 'DRAFT' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  test('a deleted payment: its draft receipt goes and confirming it is refused; a formal receipt stays on file', async () => {
    const sb = world();
    await recordBoth(sb);
    const draftId = receiptOf(sb, 'p-cash')!.id;
    await harness(sb).confirm(receiptOf(sb, 'p-tr')!.id, { accountCode: '310-0010' });
    sb.tables.mfg_sales_order_payments = [];
    const gone = await harness(sb).confirm(draftId, { accountCode: '310-0010' });
    expect(gone.status).toBe(409);
    expect(gone.body.error).toBe('payment_gone');
    await afterSoPaymentRemoved(sb, { paymentId: 'p-cash', docNo: SO, companyId: CO });
    await afterSoPaymentRemoved(sb, { paymentId: 'p-tr', docNo: SO, companyId: CO });
    expect(receiptOf(sb, 'p-cash')).toBeUndefined();
    expect(receiptOf(sb, 'p-tr')).toMatchObject({ status: 'FORMAL', or_number: '2990-HOR-2610-001' });
    expect(liveSopay(sb)).toHaveLength(0);
  });

  test('two confirms racing mint one number; the second echoes the first', async () => {
    const sb = world();
    await recordBoth(sb);
    const id = Number(receiptOf(sb, 'p-tr')!.id);
    const [a, b] = await Promise.all([
      formaliseReceipt(sb, { companyId: CO, companyCode: '2990', receiptId: id, accountCode: '310-0010', actor: 'A' }),
      formaliseReceipt(sb, { companyId: CO, companyCode: '2990', receiptId: id, accountCode: '310-0020', actor: 'B' }),
    ]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true, already: true });
    expect(b.ok && b.orNumber).toBe(a.ok && a.orNumber);
    expect(receiptOf(sb, 'p-tr')).toMatchObject({ status: 'FORMAL', channel_account_code: '310-0010', issued_by: 'A' });
  });

  test("another company's formal receipt for the same payment id is no confirmation", async () => {
    const sb = world({ acc_official_receipts: [{ id: 99, company_id: 1, payment_source: 'SOPAY', payment_id: 'p-tr', status: 'FORMAL', channel_account_code: '310-0010' }] });
    expect(await receiptConfirmation(sb, CO, 'SOPAY', 'p-tr')).toMatchObject({ ok: true, confirmed: false });
    expect(await postSoPayment(sb, payment(sb, 'p-tr') as never)).toEqual({ ok: true, status: 'waiting_confirmation' });
  });
});
