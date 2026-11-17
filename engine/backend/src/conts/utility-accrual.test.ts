import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { settleRequest } from './claims-voucher-hooks';
import { lineDate } from './utility-accrual';

const acct = (code: string, active = true): Row => ({ account_code: code, account_name: code, account_type: 'X', parent_code: null, is_active: active, company_id: 1 });
const world = (over: { start?: string | null; chart?: Row[] } = {}) => fakeSb({
  accounts: over.chart ?? ['420-0010', '420-0020', '420-0040', '650-0010', '650-0020', '310-0000', '601-0009'].map(c => acct(c)),
  journal_entries: [], journal_entry_lines: [], acc_account_roles: [],
  acc_company_settings: [{ company_id: 1, ledger_start_date: over.start ?? null, fiscal_year_end_month: 8 }],
  payment_requests: [{ id: 'Q1', company_id: 1, request_no: 'PRQ-2611-007', type: 'PAYMENT', amount_sen: 20_000, status: 'SUBMITTED', ap_invoice_id: null, ap_paid_before_sen: 0 }],
  payment_request_lines: [
    { id: 'L1', request_id: 'Q1', sort: 0, account_code: '420-0010', amount_sen: 13_118, bill_date: '2026-10-24', description: 'Electricity 2026-10 2104', unit_id: 'U1' },
    { id: 'L2', request_id: 'Q1', sort: 1, account_code: '420-0020', amount_sen: 2_000, bill_date: '2026-10-24', description: 'Water 2026-10 9', unit_id: 'U2' },
    { id: 'L3', request_id: 'Q1', sort: 2, account_code: '420-0010', amount_sen: 3_882, bill_date: null, description: 'Electricity 2026-09 2200', unit_id: 'U2' },
    { id: 'L4', request_id: 'Q1', sort: 3, account_code: '601-0009', amount_sen: 1_000, bill_date: '2026-10-24', description: 'Expensed directly', unit_id: 'U1' },
  ],
  payment_vouchers: [{ id: 'PV1', company_id: 1, status: 'POSTED', payment_request_id: 'Q1' }],
  payment_voucher_lines: [{ id: 'V1', pv_id: 'PV1', amount_sen: 20_000, payment_request_id: null, staff_receipt_id: null }],
});
const entries = (sb: ReturnType<typeof world>) => sb.tables.journal_entries.map(j => ({ doc: j.source_doc_no, date: j.entry_date, type: j.source_type, reversed: j.reversed ?? false }));
const linesOf = (sb: ReturnType<typeof world>, doc: string) => {
  const je = sb.tables.journal_entries.find(j => j.source_doc_no === doc && j.source_type === 'UTA')!;
  return sb.tables.journal_entry_lines.filter(l => l.journal_entry_id === je.id).map(l => [l.account_code, l.debit_sen, l.credit_sen, l.unit_id]);
};

describe('a utility request paid: its expense against the accrual, on the bill date (chew, 16 Nov 2026)', () => {
  test('one entry per bill date: Dr the kind\'s expense, Cr its accrual; a line on another account is left alone', async () => {
    const sb = world();
    await settleRequest(sb, 'Q1');
    expect(sb.tables.payment_requests[0].status).toBe('PAID');
    expect(entries(sb)).toEqual([
      { doc: 'PRQ-2611-007/2026-10-24', date: '2026-10-24', type: 'UTA', reversed: false },
      { doc: 'PRQ-2611-007/2026-09-30', date: '2026-09-30', type: 'UTA', reversed: false },
    ]);
    expect(linesOf(sb, 'PRQ-2611-007/2026-10-24')).toEqual([
      ['650-0020', 13_118, 0, 'U1'], ['420-0010', 0, 13_118, 'U1'], ['650-0010', 2_000, 0, 'U2'], ['420-0020', 0, 2_000, 'U2'],
    ]);
  });
  test('settled again while paid books nothing more', async () => {
    const sb = world();
    await settleRequest(sb, 'Q1');
    await settleRequest(sb, 'Q1');
    expect(sb.tables.journal_entries).toHaveLength(2);
  });
  test('not paid yet (part paid): nothing booked', async () => {
    const sb = world();
    sb.tables.payment_voucher_lines[0].amount_sen = 5_000;
    await settleRequest(sb, 'Q1');
    expect(sb.tables.payment_requests[0].status).toBe('PART_PAID');
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
  test('its voucher cancelled: the entries are reversed', async () => {
    const sb = world();
    await settleRequest(sb, 'Q1');
    sb.tables.payment_vouchers[0].status = 'CANCELLED';
    await settleRequest(sb, 'Q1');
    expect(sb.tables.payment_requests[0].status).toBe('SUBMITTED');
    const ut = sb.tables.journal_entries.filter(j => j.source_type === 'UTA');
    expect(ut.every(j => j.reversed)).toBe(true);
    expect(sb.tables.journal_entries.filter(j => j.source_type !== 'UTA')).toHaveLength(2);
  });
  test('a kind whose expense account is not on the chart yet is skipped; the rest books', async () => {
    const sb = world({ chart: ['420-0010', '420-0020', '650-0010'].map(c => acct(c)) });
    await settleRequest(sb, 'Q1');
    expect(entries(sb).map(e => e.doc)).toEqual(['PRQ-2611-007/2026-10-24']);
    expect(linesOf(sb, 'PRQ-2611-007/2026-10-24')).toEqual([['650-0010', 2_000, 0, 'U2'], ['420-0020', 0, 2_000, 'U2']]);
  });
  test("Indah Water books to 650-0130; 650-0040 is cleaning, never Indah Water's (chew, 17 Nov 2026)", async () => {
    const sb = world({ chart: ['420-0040', '650-0040'].map(c => acct(c)) });
    sb.tables.payment_request_lines = [{ id: 'L9', request_id: 'Q1', sort: 0, account_code: '420-0040', amount_sen: 20_000, bill_date: '2026-10-31', description: 'Indah Water 2026-10', unit_id: 'U1' }];
    sb.tables.payment_voucher_lines[0].amount_sen = 20_000;
    sb.tables.payment_requests[0].amount_sen = 20_000;
    await settleRequest(sb, 'Q1');
    expect(sb.tables.journal_entries).toHaveLength(0);
    sb.tables.accounts.push(acct('650-0130'));
    sb.tables.payment_requests[0].status = 'SUBMITTED';
    await settleRequest(sb, 'Q1');
    expect(linesOf(sb, 'PRQ-2611-007/2026-10-31')).toEqual([['650-0130', 20_000, 0, 'U1'], ['420-0040', 0, 20_000, 'U1']]);
  });
  test('a bill from before the books start is booked on the start date', async () => {
    const sb = world({ start: '2026-10-01' });
    await settleRequest(sb, 'Q1');
    expect(entries(sb).map(e => e.date)).toEqual(['2026-10-24', '2026-10-01']);
  });
});

test('lineDate: the bill date, else the end of the month the description names', () => {
  expect(lineDate({ bill_date: '2026-10-24', description: 'x' })).toBe('2026-10-24');
  expect(lineDate({ bill_date: null, description: 'Water 2026-02 9' })).toBe('2026-02-28');
  expect(lineDate({ bill_date: null, description: 'Water' })).toBeNull();
});
