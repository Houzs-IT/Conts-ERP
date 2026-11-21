// The bank statement lines nothing in the books is matched to yet — the second list on Unmatched payments
// (ported from Houzs, cut to Conts: no DuitNow QR, and money out is listed too).
//
// Pinned here:
//   • a line is listed while it is OPEN and dated in the window; a POSTED or IGNORED line, one before the
//     ledger start date, and the other company's are not;
//   • what each one is comes from Bank recon's own decider — an acquirer's payout is CARD with the
//     matcher's clue; other money in is IN and money out is OUT, each with the same-amount entries no bank
//     line holds yet (none = nothing in the books);
//   • the door answers 403 without the reconciliation key.

import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { entryWords, unmatchedBankLinesOf, whatOf, type DecidedBankLine } from '../src/acc/unmatched-bank-lines';
import { unmatchedBankLinesHandler } from '../src/scm/routes/accounting-unmatched-payments';

const CO = 2;
const GL_PERM = 'scm.payment_voucher.post';

/* ── The words, without a database ────────────────────────────────────────── */

describe('what a bank line is', () => {
  test('a payout of any kind is card money, other money in is IN, money out is OUT', () => {
    expect(['PAYOUT', 'PAYOUT_SPLIT', 'PAYOUT_UNSURE', 'PAYOUT_NO_BATCH'].map((k) => whatOf(k, 100))).toEqual(['CARD', 'CARD', 'CARD', 'CARD']);
    expect(whatOf('OTHER', 100)).toBe('IN');
    expect(whatOf('OTHER', -100)).toBe('OUT');
  });

  test('no entry of its amount asks for the receipt or the payment to be recorded', () => {
    expect(entryWords([], 'IN')).toBe('No entry of this amount in the books within 7 days of it — record the receipt first.');
    expect(entryWords([], 'OUT')).toBe('No entry of this amount in the books within 7 days of it — record the payment first.');
  });

  test('a line carries its entries, at most three named; the oldest line comes first', () => {
    const line = (id: number, bookedOn: string, kind: string, amountSen = 50000): DecidedBankLine => ({
      id, statementId: 1, accountCode: '310-0010', bookedOn, description: 'IBG', reference: null, amountSen, kind, acquirerCode: null, note: null,
    });
    const offer = (n: number) => ({ jeNo: `JE-${n}`, entryDate: '2026-09-04', doc: `SO-${n}`, who: 'Kim', daysApart: 1 });
    const rows = unmatchedBankLinesOf(
      [line(1, '2026-09-20', 'OTHER'), line(2, '2026-09-01', 'PAYOUT_NO_BATCH'), line(3, '2026-09-10', 'OTHER', -2000)],
      (l) => (l.id === 1 ? [1, 2, 3, 4].map(offer) : []),
      () => 'Maybank 5123',
      '2026-09-30',
    );
    expect(rows.map((r) => [r.lineId, r.what, r.ageDays])).toEqual([[2, 'CARD', 29], [3, 'OUT', 20], [1, 'IN', 10]]);
    const one = rows.find((r) => r.lineId === 1)!;
    expect(one).toMatchObject({ entryCount: 4, month: '2026-09', bankName: 'Maybank 5123' });
    expect(one.entries.map((e) => e.jeNo)).toEqual(['JE-1', 'JE-2', 'JE-3']);
    expect(rows.find((r) => r.lineId === 2)).toMatchObject({ entryCount: 0, entries: [] });
  });
});

/* ── The door, over a fake database ───────────────────────────────────────── */

const line = (id: number, over: Row): Row => ({
  id, company_id: CO, statement_id: 1, line_no: id, booked_on: '2026-09-05', description: 'IBG CREDIT', reference: null,
  amount_sen: 50000, charge_sen: 0, kind: 'OTHER', state: 'OPEN', posted_je_no: null, note: null,
  acquirer_code: null, trading_date: null, merchant_no: null, matched_batch_id: null, split: null, ...over,
});
const gl = (jeNo: string, account: string, entryDate: string, debitSen: number, over: Row = {}): Row => ({
  company_id: CO, account_code: account, je_no: jeNo, entry_date: entryDate, source_type: 'SOPAY', source_doc_no: `pay-${jeNo}`,
  debit_sen: Math.max(0, debitSen), credit_sen: Math.max(0, -debitSen), notes: null, party_name: null, reversed: false, reversed_by_je: null, line_id: jeNo, ...over,
});

function harness(perms: readonly string[] = [GL_PERM]) {
  const sb = fakeSb({
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-09-01', fiscal_year_end_month: 8 }],
    acc_bank_statements: [
      { id: 1, company_id: CO, account_code: '310-0010', period_from: '2026-08-25', period_to: '2026-09-30' },
      { id: 2, company_id: CO, account_code: '310-0020', period_from: '2026-09-01', period_to: '2026-09-30' },
      { id: 3, company_id: 1, account_code: '310-0010', period_from: '2026-09-01', period_to: '2026-09-30' },
    ],
    accounts: [
      { company_id: CO, account_code: '310-0010', account_name: 'Maybank 5123' },
      { company_id: CO, account_code: '310-0020', account_name: 'Hong Leong 0042' },
    ],
    acc_bank_statement_lines: [
      /* A customer's transfer, and the one entry of its amount in the books. */
      line(101, { description: 'TRANSFER FROM CHONG HUI WEN' }),
      /* Money nobody has recorded. */
      line(102, { amount_sen: 77700, booked_on: '2026-09-06', description: 'IBG FROM UNKNOWN' }),
      /* Maybank's payout, and no reconciled report waiting for it. */
      line(103, { amount_sen: 100000, booked_on: '2026-09-07', description: 'MBB MERCHANT SETTLEMENT' }),
      /* Money out: a supplier paid, and its voucher in the books. */
      line(105, { amount_sen: -20000, description: 'IBG TO ACME' }),
      /* Not listed: matched, set aside, before the ledger start, outside the window. */
      line(104, { amount_sen: 30000, state: 'POSTED', posted_je_no: 'JE-X' }),
      line(106, { state: 'IGNORED' }),
      line(107, { booked_on: '2026-08-28' }),
      line(111, { booked_on: '2026-10-02' }),
      /* On the other account: its only same-amount entry is held by a POSTED line. */
      line(108, { statement_id: 2, amount_sen: 25000, booked_on: '2026-09-10' }),
      line(109, { statement_id: 2, amount_sen: 25000, booked_on: '2026-09-09', state: 'POSTED', posted_je_no: 'JE-T2' }),
      /* The other company's line. */
      line(110, { statement_id: 3, company_id: 1 }),
    ],
    acc_bank_recognition_rules: [
      { acquirer_code: 'MBB', pattern: 'MERCHANT SETTLEMENT', match_field: 'both', trading_date_pattern: null, merchant_pattern: null, sort_order: 1, is_active: true },
    ],
    v_gl_entries: [
      gl('JE-T1', '310-0010', '2026-09-04', 50000, { party_name: 'Chong Hui Wen' }),
      gl('JE-P1', '310-0010', '2026-09-05', -20000, { source_type: 'PV', party_name: 'Acme' }),
      gl('JE-T2', '310-0020', '2026-09-09', 25000),
      /* Same amount, but out of the window. */
      gl('JE-T9', '310-0010', '2026-08-26', 50000),
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
  app.get('/unmatched-bank-lines', unmatchedBankLinesHandler as never);
  return { app, sb };
}

describe('GET /unmatched-bank-lines', () => {
  test('without the reconciliation key it is 403', async () => {
    const { app } = harness([]);
    expect((await app.request('/unmatched-bank-lines')).status).toBe(403);
  });

  test('a From after the To is refused in words', async () => {
    const { app } = harness();
    const res = await app.request('/unmatched-bank-lines?from=2026-09-30&to=2026-09-01');
    expect(res.status).toBe(400);
    expect((await res.json() as { message: string }).message).toBe('The From date is after the To date.');
  });

  test('lists the open lines, what each one is, and the entries it could be', async () => {
    const { app } = harness();
    const res = await app.request('/unmatched-bank-lines?from=2026-08-01&to=2026-09-30');
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: Array<Record<string, any>> };
    const byId = Object.fromEntries(body.rows.map((r) => [r.lineId, r]));
    expect(Object.keys(byId).map(Number).sort((a, b) => a - b)).toEqual([101, 102, 103, 105, 108]);

    expect(byId[101]).toMatchObject({
      what: 'IN', accountCode: '310-0010', bankName: 'Maybank 5123', amountSen: 50000, month: '2026-09',
      entryCount: 1, entries: [{ jeNo: 'JE-T1', entryDate: '2026-09-04', daysApart: 1 }],
    });
    expect(byId[101]!.note).toMatch(/^One entry of this amount: .*, 04\/09\/2026 — match it on Bank recon\.$/);
    expect(byId[102]).toMatchObject({ what: 'IN', entryCount: 0, entries: [] });
    expect(byId[103]).toMatchObject({ what: 'CARD', kind: 'PAYOUT_NO_BATCH', acquirerCode: 'MBB' });
    expect(byId[105]).toMatchObject({ what: 'OUT', amountSen: -20000, entryCount: 1, entries: [{ jeNo: 'JE-P1' }] });
    /* The entry of its amount is already a POSTED line's: nothing to offer. */
    expect(byId[108]).toMatchObject({ what: 'IN', accountCode: '310-0020', bankName: 'Hong Leong 0042', entryCount: 0 });
  });
});
