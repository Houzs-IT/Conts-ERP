// Every customer payment not matched yet, on one list (ported from Houzs, cut to Conts).
//
// Pinned here:
//   • a payment waits while finance has not confirmed it (its receipt is a DRAFT): cash and transfers
//     wait for finance, a card waits for its merchant report line — claimed or not yet;
//   • a confirmed payment is matched once a POSTED bank line claims its live entry (a match row or the
//     line's own posted_je_no); a match row on an OPEN line is not; a confirmed card whose report line is
//     confirmed is matched;
//   • a confirmed payment with no live entry, or one booked on the CASH account, is said apart;
//   • converted money, payments before the ledger start date, cancelled orders and the other company's
//     payments are not on it;
//   • the door answers 403 without the reconciliation key.

import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { classifyUnmatched, type MatchFacts, type PaymentFact } from '../src/acc/unmatched-payments';
import { unmatchedPaymentsHandler } from '../src/scm/routes/accounting-unmatched-payments';

const CO = 2;
const GL_PERM = 'scm.payment_voucher.post';
const BANK = '310-0020';

/* ── The decision, without a database ─────────────────────────────────────── */

const fact = (over: Partial<PaymentFact> = {}): PaymentFact => ({
  source: 'SOPAY', id: 'p1', docNo: 'SO-1', customerName: 'Kim', salespersonName: null,
  paidOn: '2026-09-20', method: 'transfer', merchantProvider: null, onlineType: 'Bank Transfer',
  amountSen: 166800, approvalCode: 'REF1', ...over,
});
const facts = (over: Partial<MatchFacts> = {}): MatchFacts => ({
  confirmed: new Set(), receiptNo: new Map(), merchantClaims: new Map(),
  entries: new Map(), onTheBank: new Set(), statementUpTo: new Map(), cashAccount: '300-0000', ...over,
});

describe('classifyUnmatched', () => {
  test('a payment finance has not confirmed waits: cash and transfers for finance, a card for its report', () => {
    const rows = classifyUnmatched([
      fact({ id: 'tr' }),
      fact({ id: 'cash', method: 'cash', onlineType: null }),
      fact({ id: 'card-linked', method: 'merchant', merchantProvider: 'MBB' }),
      fact({ id: 'card-new', method: 'merchant', merchantProvider: 'MBB' }),
    ], facts({
      receiptNo: new Map([['SOPAY:tr', 'CODraftOR-2609-001']]),
      merchantClaims: new Map([['SOPAY:card-linked', { confirmed: false }]]),
    }), '2026-09-30');
    const byId = Object.fromEntries(rows.map((r) => [r.paymentId, r]));
    expect(byId.tr).toMatchObject({ state: 'WAITING_CONFIRMATION', kind: 'transfer', channel: 'Bank Transfer', orNumber: 'CODraftOR-2609-001', ageDays: 10 });
    expect(byId.cash).toMatchObject({ state: 'WAITING_CONFIRMATION', kind: 'cash' });
    expect(byId['card-linked']).toMatchObject({ state: 'CARD_TO_CONFIRM', kind: 'card', channel: 'MBB' });
    expect(byId['card-new']).toMatchObject({ state: 'CARD_NOT_REPORTED' });
  });

  test('a confirmed payment: not booked, not matched, or its statement not uploaded yet', () => {
    const rows = classifyUnmatched([
      fact({ id: 'unbooked', paidOn: '2026-09-10' }),
      fact({ id: 'on-bank', paidOn: '2026-09-10' }),
      fact({ id: 'same-day', paidOn: '2026-09-28' }),
      fact({ id: 'after', paidOn: '2026-09-29' }),
      fact({ id: 'on-cash', paidOn: '2026-09-12', method: 'cash' }),
    ], facts({
      confirmed: new Set(['SOPAY:unbooked', 'SOPAY:on-bank', 'SOPAY:same-day', 'SOPAY:after', 'SOPAY:on-cash']),
      entries: new Map([
        ['SOPAY:on-bank', { jeNo: 'JE-1', accountCode: BANK }],
        ['SOPAY:same-day', { jeNo: 'JE-2', accountCode: BANK }],
        ['SOPAY:after', { jeNo: 'JE-3', accountCode: BANK }],
        ['SOPAY:on-cash', { jeNo: 'JE-4', accountCode: '300-0000' }],
      ]),
      onTheBank: new Set(['JE-1']),
      statementUpTo: new Map([[BANK, '2026-09-28']]),
    }), '2026-09-30');
    const byId = Object.fromEntries(rows.map((r) => [r.paymentId, r]));
    expect(Object.keys(byId).sort()).toEqual(['after', 'same-day', 'unbooked']);
    expect(byId.unbooked).toMatchObject({ state: 'CONFIRMED_NOT_POSTED', bankAccountCode: null, jeNo: null });
    expect(byId['same-day']).toMatchObject({ state: 'NOT_MATCHED', bankAccountCode: BANK, statementUpTo: '2026-09-28', jeNo: 'JE-2' });
    expect(byId.after).toMatchObject({ state: 'NO_STATEMENT', statementUpTo: '2026-09-28' });
    /* Oldest first. */
    expect(rows.map((r) => r.paymentId)).toEqual(['unbooked', 'same-day', 'after']);
  });

  test('a card its merchant report confirmed is matched; money that is not a customer\'s is never listed', () => {
    const rows = classifyUnmatched([
      fact({ id: 'card-done', method: 'merchant', merchantProvider: 'MBB' }),
      fact({ id: 'moved', method: 'converted' }),
      fact({ id: 'credit', method: 'credit' }),
      fact({ id: 'zero', amountSen: 0 }),
    ], facts({
      confirmed: new Set(['SOPAY:card-done']),
      merchantClaims: new Map([['SOPAY:card-done', { confirmed: true }]]),
    }), '2026-09-30');
    expect(rows).toEqual([]);
  });
});

/* ── The door, over a fake database ───────────────────────────────────────── */

const pay = (id: string, over: Row = {}): Row => ({
  id, company_id: CO, so_doc_no: 'SO-A', paid_at: '2026-09-20T10:00:00+08:00', amount_sen: 50000,
  approval_code: null, method: 'transfer', merchant_provider: null, online_type: 'Bank Transfer', collected_by: null, ...over,
});
const je = (id: string, jeNo: string, paymentId: string, over: Row = {}): Row => ({
  id, company_id: CO, je_no: jeNo, source_type: 'SOPAY', source_doc_no: paymentId, posted: true, reversed: false, ...over,
});
const receipt = (paymentId: string, status: string, n: number, over: Row = {}): Row => ({
  id: n, company_id: CO, payment_source: 'SOPAY', payment_id: paymentId, or_number: `${status === 'FORMAL' ? 'COB' : 'CODraftOR'}-2609-00${n}`, status, ...over,
});

function harness(perms: readonly string[] = [GL_PERM]) {
  const sb = fakeSb({
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-09-01', fiscal_year_end_month: 8 }],
    acc_account_roles: [{ company_id: CO, role: 'CASH', account_code: '300-0000' }],
    mfg_sales_order_payments: [
      pay('p-wait'),
      pay('p-wait-cash', { method: 'cash', online_type: null, collected_by: 'st-2' }),
      pay('p-card-wait', { method: 'merchant', merchant_provider: 'MBB', online_type: null, approval_code: '805996' }),
      pay('p-card-done', { method: 'merchant', merchant_provider: 'MBB', online_type: null }),
      pay('p-matched'),
      pay('p-named'),
      pay('p-open-line'),
      pay('p-late', { paid_at: '2026-09-29T09:00:00+08:00' }),
      pay('p-reversed'),
      pay('p-legacy'),
      pay('p-moved', { method: 'converted' }),
      pay('p-before-start', { paid_at: '2026-08-31T09:00:00+08:00' }),
      pay('p-cancelled', { so_doc_no: 'SO-X' }),
      pay('p-other-co', { company_id: 1 }),
    ],
    sales_invoice_payments: [
      { id: 'si-pay-1', company_id: CO, sales_invoice_id: 'inv-1', paid_at: '2026-09-21T10:00:00+08:00', amount_sen: 12000, approval_code: 'IBG9', method: 'transfer', merchant_provider: null, online_type: 'Bank Transfer', collected_by: 'st-1' },
    ],
    mfg_sales_orders: [
      { company_id: CO, doc_no: 'SO-A', debtor_name: 'Chong Hui Wen', status: 'CONFIRMED', salesperson_id: 'st-1' },
      { company_id: CO, doc_no: 'SO-X', debtor_name: 'Gone', status: 'CANCELLED', salesperson_id: null },
    ],
    sales_invoices: [{ id: 'inv-1', company_id: CO, invoice_number: 'SI-2609-001', debtor_name: 'Acme' }],
    staff: [{ id: 'st-1', name: 'Nico' }, { id: 'st-2', name: 'Esther' }],
    acc_official_receipts: [
      receipt('p-wait', 'DRAFT', 1),
      receipt('p-wait-cash', 'DRAFT', 2),
      receipt('p-card-wait', 'DRAFT', 3),
      receipt('p-card-done', 'FORMAL', 4),
      receipt('p-matched', 'FORMAL', 5),
      receipt('p-named', 'FORMAL', 6),
      receipt('p-open-line', 'FORMAL', 7),
      receipt('p-late', 'FORMAL', 8),
      receipt('p-reversed', 'FORMAL', 9),
      /* p-legacy has no receipt: posted before confirmation existed, so confirmed by its live entry. */
      receipt('si-pay-1', 'DRAFT', 10, { payment_source: 'SIPAY' }),
    ],
    acc_settlement_matches: [
      { company_id: CO, payment_source: 'SOPAY', payment_id: 'p-card-wait', settlement_row_id: 2 },
      { company_id: CO, payment_source: 'SOPAY', payment_id: 'p-card-done', settlement_row_id: 1 },
    ],
    acc_settlement_rows: [
      { id: 1, company_id: CO, confirmed_at: '2026-09-25T08:41:00Z', posted_je_no: 'JE-S1' },
      { id: 2, company_id: CO, confirmed_at: null, posted_je_no: null },
    ],
    journal_entries: [
      je('je-1', 'JE-1', 'p-matched'),
      je('je-2', 'JE-2', 'p-named'),
      je('je-3', 'JE-3', 'p-open-line'),
      je('je-4', 'JE-4', 'p-late'),
      je('je-5', 'JE-5', 'p-reversed', { reversed: true }),
      je('je-6', 'JE-6', 'p-legacy'),
    ],
    journal_entry_lines: ['je-1', 'je-2', 'je-3', 'je-4', 'je-5', 'je-6'].flatMap((id) => [
      { journal_entry_id: id, account_code: BANK, debit_sen: 100, credit_sen: 0 },
      { journal_entry_id: id, account_code: '400-0000', debit_sen: 0, credit_sen: 100 },
    ]),
    acc_bank_statement_matches: [
      { company_id: CO, je_no: 'JE-1', bank_line_id: 11 },
      /* An older undo left this behind on an OPEN line — nobody's claim. */
      { company_id: CO, je_no: 'JE-3', bank_line_id: 13 },
    ],
    acc_bank_statement_lines: [
      { id: 11, company_id: CO, state: 'POSTED', posted_je_no: null },
      { id: 12, company_id: CO, state: 'POSTED', posted_je_no: 'JE-9, JE-2' },
      { id: 13, company_id: CO, state: 'OPEN', posted_je_no: null },
    ],
    acc_bank_statements: [
      { id: 1, company_id: CO, account_code: BANK, period_to: '2026-08-31' },
      { id: 2, company_id: CO, account_code: BANK, period_to: '2026-09-28' },
    ],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('houzsUser' as never, { name: 'Tester', permissions_set: perms } as never);
    c.set('allowedCompanyIds' as never, [1, 2] as never);
    await next();
  });
  app.get('/unmatched-payments', unmatchedPaymentsHandler as never);
  return { app, sb };
}

describe('GET /unmatched-payments', () => {
  test('without the reconciliation key it is 403', async () => {
    const { app } = harness([]);
    expect((await app.request('/unmatched-payments')).status).toBe(403);
  });

  test('a From after the To is refused in words', async () => {
    const { app } = harness();
    const res = await app.request('/unmatched-payments?from=2026-09-30&to=2026-09-01');
    expect(res.status).toBe(400);
    expect((await res.json() as { message: string }).message).toBe('The From date is after the To date.');
  });

  test('lists what is not matched, where each is stuck, and whose sale it was', async () => {
    const { app } = harness();
    const res = await app.request('/unmatched-payments?from=2026-08-01&to=2026-09-30');
    expect(res.status).toBe(200);
    const body = await res.json() as { from: string; rows: Array<Record<string, any>> };
    expect(body).toMatchObject({ from: '2026-08-01' });
    const byId = Object.fromEntries(body.rows.map((r) => [r.paymentId, r]));
    expect(Object.keys(byId).sort()).toEqual([
      'p-card-wait', 'p-late', 'p-legacy', 'p-open-line', 'p-reversed', 'p-wait', 'p-wait-cash', 'si-pay-1',
    ]);
    expect(byId['p-wait']).toMatchObject({
      state: 'WAITING_CONFIRMATION', kind: 'transfer', docNo: 'SO-A', customerName: 'Chong Hui Wen', salespersonName: 'Nico',
      orNumber: 'CODraftOR-2609-001', amountSen: 50000,
    });
    expect(byId['p-wait-cash']).toMatchObject({ state: 'WAITING_CONFIRMATION', kind: 'cash', collectedByName: 'Esther' });
    expect(byId['p-card-wait']).toMatchObject({ state: 'CARD_TO_CONFIRM', kind: 'card', channel: 'MBB', reference: '805996' });
    /* A match row on an OPEN line claims nothing; the statement reaches its day. */
    expect(byId['p-open-line']).toMatchObject({ state: 'NOT_MATCHED', bankAccountCode: BANK, statementUpTo: '2026-09-28', jeNo: 'JE-3' });
    /* No receipt, but posted before confirmation existed: confirmed by its live entry, and not on the bank yet. */
    expect(byId['p-legacy']).toMatchObject({ state: 'NOT_MATCHED', orNumber: null, jeNo: 'JE-6' });
    expect(byId['p-late']).toMatchObject({ state: 'NO_STATEMENT', statementUpTo: '2026-09-28' });
    /* Its only entry was reversed: confirmed, nothing live in the books. */
    expect(byId['p-reversed']).toMatchObject({ state: 'CONFIRMED_NOT_POSTED' });
    expect(byId['si-pay-1']).toMatchObject({ source: 'SIPAY', docNo: 'SI-2609-001', customerName: 'Acme', collectedByName: 'Nico', state: 'WAITING_CONFIRMATION' });
  });
});
