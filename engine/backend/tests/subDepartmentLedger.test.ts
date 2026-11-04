/* The ledger keeps each line's sub-department (SOP 1.1; chew 4 Nov 2026; plan 2026-11-04-sub-departments Task 3).
   Pinned:
     · a voucher's or AP invoice's cost lines carry their sub-department; the bank and AP control legs carry none;
     · posting writes it to journal_entry_lines; a reversal copies it onto the contra line, so it nets to nothing;
     · a petty cash receipt's journal lines carry the line's sub-department and its unit. */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { apInvoiceLines, DEFAULT_ROLE_CODES, pvLines } from '../src/acc/rules';
import { postJournal, reverseJournal } from '../src/acc/engine';
import { postReceiptJournal } from '../src/conts/petty-cash-ledger';

const CLEANING = 'sub-cleaning';
const CHART: Row[] = [
  { account_code: '310-0010', account_name: 'Bank', account_type: 'ASSET', parent_code: null, is_active: true, company_id: 1 },
  { account_code: '315-0040', account_name: 'PETTY CASH - YJ', account_type: 'ASSET', parent_code: null, is_active: true, company_id: 1 },
  { account_code: '906-0000', account_name: 'Cleaning supplies', account_type: 'EXPENSE', parent_code: null, is_active: true, company_id: 1 },
];
const world = (jes: Row[] = [], lines: Row[] = []) => fakeSb({
  accounts: CHART, journal_entries: jes, journal_entry_lines: lines, acc_account_roles: [],
  acc_company_settings: [{ company_id: 1, ledger_start_date: null, fiscal_year_end_month: 8 }],
});

describe('builders', () => {
  test('pvLines: the cost line carries its sub-department; the bank leg none', () => {
    const lines = pvLines({ pv_number: 'PV-1', payee_name: 'Shop', credit_account_code: '310-0010' },
      [{ description: 'Mops', debit_account_code: '906-0000', myrSen: 5000, department: 'rental', unit_id: 'u-a1206', sub_department_id: CLEANING }],
      { code: null, name: null });
    expect(lines[0]).toMatchObject({ department: 'rental', subDepartmentId: CLEANING, unitId: 'u-a1206' });
    expect(lines[1]!.subDepartmentId ?? null).toBeNull();
  });

  test('pvLines: a leg settling bills on the AP control carries none', () => {
    const lines = pvLines({ pv_number: 'PV-2', payee_name: 'Shop', credit_account_code: '310-0010' },
      [{ description: 'Bills', debit_account_code: '400-S001', myrSen: 5000, department: 'rental', sub_department_id: CLEANING }],
      { code: '400-S001', name: 'Shop' }, '400-S001');
    expect(lines[0]!.subDepartmentId ?? null).toBeNull();
  });

  test('apInvoiceLines: the cost line carries its sub-department; the AP control none', () => {
    const lines = apInvoiceLines(DEFAULT_ROLE_CODES, { invoice_number: 'INV-1' }, { code: '400-S001', name: 'Shop' },
      [{ accountCode: '906-0000', myrSen: 5000, description: 'Mops', department: 'rental', subDepartmentId: CLEANING }]);
    expect(lines[0]).toMatchObject({ subDepartmentId: CLEANING });
    expect(lines[1]!.subDepartmentId ?? null).toBeNull();
  });
});

describe('posting and reversing', () => {
  test('posting writes the sub-department; a line without one writes null', async () => {
    const sb = world();
    const out = await postJournal(sb, { companyId: 1, entryDate: '2026-11-03', sourceType: 'PV', sourceDocNo: 'PV-1', narration: 't', lines: [
      { accountCode: '906-0000', debitSen: 5000, creditSen: 0, department: 'rental', subDepartmentId: CLEANING },
      { accountCode: '310-0010', debitSen: 0, creditSen: 5000, department: 'rental' },
    ] });
    expect(out).toMatchObject({ ok: true, status: 'posted' });
    expect(sb.tables.journal_entry_lines.map((l) => l.sub_department_id ?? null)).toEqual([CLEANING, null]);
  });

  test('the contra keeps the sub-department, so it nets to nothing', async () => {
    const sb = world(
      [{ id: 'je-1', je_no: 'JE-1', entry_date: '2026-11-03', source_type: 'PV', source_doc_no: 'PV-1', company_id: 1, posted: true, reversed: false, total_debit_sen: 5000, total_credit_sen: 5000 }],
      [
        { journal_entry_id: 'je-1', line_no: 1, account_code: '906-0000', debit_sen: 5000, credit_sen: 0, department: 'rental', sub_department_id: CLEANING, company_id: 1 },
        { journal_entry_id: 'je-1', line_no: 2, account_code: '310-0010', debit_sen: 0, credit_sen: 5000, department: 'rental', sub_department_id: null, company_id: 1 },
      ],
    );
    const out = await reverseJournal(sb, { sourceType: 'PV', sourceDocNo: 'PV-1', narration: (o: { je_no: string }) => `Reversal of ${o.je_no}` });
    expect(out).toMatchObject({ ok: true, status: 'reversed' });
    const rev = sb.tables.journal_entry_lines.filter((l) => l.journal_entry_id !== 'je-1');
    expect(rev.map((l) => [l.account_code, l.sub_department_id ?? null])).toEqual([['906-0000', CLEANING], ['310-0010', null]]);
  });
});

describe('petty cash', () => {
  test('a receipt’s journal line carries its sub-department and its unit', async () => {
    const sb = world();
    const out = await postReceiptJournal(sb, 1, { receiptNo: 'CLM-1', spendDate: '2026-11-03', floatAccountCode: '315-0040', lines: [
      { accountCode: '906-0000', amountSen: 5000, department: 'rental', subDepartmentId: CLEANING, unitId: 'u-a1206' },
    ] });
    expect(out).toMatchObject({ ok: true });
    expect(sb.tables.journal_entry_lines[0]).toMatchObject({ sub_department_id: CLEANING, unit_id: 'u-a1206' });
  });
});
