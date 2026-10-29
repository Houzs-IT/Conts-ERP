import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { postReceiptJournal, postWriteOffJournal } from './petty-cash-ledger';

const CHART: Row[] = [
  { account_code: '320-0000', account_name: 'CASH IN HAND', account_type: 'ASSET', parent_code: null, is_active: true, company_id: 1 },
  { account_code: '320-0100', account_name: 'PETTY CASH', account_type: 'ASSET', parent_code: null, is_active: true, company_id: 1 },
  { account_code: '905-0000', account_name: 'Repairs', account_type: 'EXPENSE', parent_code: null, is_active: true, company_id: 1 },
  { account_code: '906-0000', account_name: 'Cleaning supplies', account_type: 'EXPENSE', parent_code: null, is_active: true, company_id: 1 },
  { account_code: '305-0100', account_name: 'STAFF DEBTOR', account_type: 'ASSET', parent_code: null, is_active: true, company_id: 1 },
];
const world = (start: string | null = null) => fakeSb({
  accounts: CHART, journal_entries: [], journal_entry_lines: [],
  acc_account_roles: [{ company_id: 1, role: 'PETTY_CASH', account_code: '320-0100' }],
  acc_company_settings: [{ company_id: 1, ledger_start_date: start, fiscal_year_end_month: 8 }],
});
const receipt = {
  receiptNo: 'CLM-2611-001', spendDate: '2026-11-03',
  lines: [{ accountCode: '905-0000', amountSen: 3000, department: 'rental' }, { accountCode: '906-0000', amountSen: 1500, department: 'rental' }],
};

describe('postReceiptJournal', () => {
  test('Dr each line, Cr the petty cash account, on the spend date', async () => {
    const sb = world();
    const out = await postReceiptJournal(sb, 1, receipt);
    expect(out).toMatchObject({ ok: true, status: 'posted', totalSen: 4500 });
    const je = sb.tables.journal_entries[0];
    expect(je).toMatchObject({ source_type: 'CLM', source_doc_no: 'CLM-2611-001', entry_date: '2026-11-03' });
    const lines = sb.tables.journal_entry_lines.map(l => [l.account_code, l.debit_sen, l.credit_sen]);
    expect(lines).toEqual([['905-0000', 3000, 0], ['906-0000', 1500, 0], ['320-0100', 0, 4500]]);
  });

  test('a spend before the books start is dated on the start date', async () => {
    const sb = world('2026-12-01');
    const out = await postReceiptJournal(sb, 1, receipt);
    expect(out.ok).toBe(true);
    expect(sb.tables.journal_entries[0].entry_date).toBe('2026-12-01');
  });

  test('the same receipt twice posts once', async () => {
    const sb = world();
    await postReceiptJournal(sb, 1, receipt);
    const again = await postReceiptJournal(sb, 1, receipt);
    expect(again).toMatchObject({ ok: true, status: 'already_posted' });
    expect(sb.tables.journal_entries).toHaveLength(1);
  });
});

describe('postWriteOffJournal', () => {
  test('Dr the account finance picks, Cr petty cash', async () => {
    const sb = world();
    const out = await postWriteOffJournal(sb, 1, { receiptNo: 'CLM-2611-002', amountSen: 4500, accountCode: '305-0100', date: '2026-11-20' });
    expect(out).toMatchObject({ ok: true, status: 'posted' });
    expect(sb.tables.journal_entries[0]).toMatchObject({ source_type: 'CLW', source_doc_no: 'CLM-2611-002' });
    expect(sb.tables.journal_entry_lines.map(l => [l.account_code, l.debit_sen, l.credit_sen]))
      .toEqual([['305-0100', 4500, 0], ['320-0100', 0, 4500]]);
  });
});
