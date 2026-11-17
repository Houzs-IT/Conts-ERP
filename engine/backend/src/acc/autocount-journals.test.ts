/* The books kept in AutoCount after the ledger start, as journals (chew, 17 Nov 2026). */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { importAutocountJournals } from './autocount-journals';

const CO = 1;
const acct = (code: string, type: string): Row => ({ account_code: code, account_name: code, account_type: type, parent_code: null, is_active: true, company_id: CO });
const world = () => fakeSb({
  accounts: [acct('310-0010', 'ASSET'), acct('301-0000', 'ASSET'), acct('302-0000', 'ASSET'), acct('400-0000', 'LIABILITY'), acct('405-0000', 'LIABILITY'),
    acct('405-0001', 'LIABILITY'), acct('601-0010', 'EXPENSE'), acct('550-0010', 'INCOME')],
  acc_account_roles: [], journal_entries: [], journal_entry_lines: [],
  acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-09-01', fiscal_year_end_month: 8 }],
  debtors: [{ code: '301-M144', name: 'MR WAYNE', control_account: '301-0000', company_id: CO }],
  suppliers: [{ id: 'S1', code: '400-H006', name: 'HOOKKA', control_account: '405-0000', company_id: CO }, { id: 'S2', code: '400-C011', name: 'CRAFT KITCHEN', control_account: null, company_id: CO }],
});
const lines = (sb: ReturnType<typeof world>) => sb.tables.journal_entry_lines.map((l) => [l.account_code, l.debit_sen, l.credit_sen, l.party_code ?? null, l.department ?? null]);

describe('AutoCount documents as journals', () => {
  test("a receipt: the customer's account becomes their control, the customer kept on the line; dated as AutoCount", async () => {
    const sb = world();
    const r = await importAutocountJournals(sb, CO, [{ docNo: 'OR-004352', date: '2026-10-06', kind: 'BANK', narration: 'MR WAYNE', lines: [
      { accountCode: '310-0010', debitSen: 1_500_000, creditSen: 0 }, { accountCode: '301-M144', debitSen: 0, creditSen: 1_500_000 },
    ] }]);
    expect(r).toEqual({ posted: 1, already: 0, errors: [] });
    expect(sb.tables.journal_entries[0]).toMatchObject({ source_type: 'ACJ', source_doc_no: 'OR-004352', entry_date: '2026-10-06' });
    expect(lines(sb)).toEqual([['310-0010', 1_500_000, 0, null, 'shared'], ['301-0000', 0, 1_500_000, '301-M144', 'shared']]);
  });
  test("a bill: the supplier's own control (405 here), the trade creditors when it names none; department and unit kept", async () => {
    const sb = world();
    await importAutocountJournals(sb, CO, [
      { docNo: 'PI-002800', date: '2026-11-02', lines: [{ accountCode: '601-0010', debitSen: 61_600, creditSen: 0, department: 'supply', projectId: 6 }, { accountCode: '400-H006', debitSen: 0, creditSen: 61_600 }] },
      { docNo: 'PI-002801', date: '2026-11-03', lines: [{ accountCode: '601-0010', debitSen: 10_000, creditSen: 0, department: 'rental', unitId: 'U1' }, { accountCode: '400-C011', debitSen: 0, creditSen: 10_000 }] },
    ]);
    expect(lines(sb)).toEqual([['601-0010', 61_600, 0, null, 'supply'], ['405-0000', 0, 61_600, '400-H006', 'shared'], ['601-0010', 10_000, 0, null, 'rental'], ['400-0000', 0, 10_000, '400-C011', 'shared']]);
    expect(sb.tables.journal_entry_lines[0]).toMatchObject({ project_id: 6 });
    expect(sb.tables.journal_entry_lines[2]).toMatchObject({ unit_id: 'U1' });
  });
  test('a code the chart has is the account, not a party; the same document twice is booked once', async () => {
    const sb = world();
    const doc = { docNo: 'JV-2610-001', date: '2026-10-31', lines: [{ accountCode: '405-0001', debitSen: 20_000, creditSen: 0 }, { accountCode: '310-0010', debitSen: 0, creditSen: 20_000 }] };
    await importAutocountJournals(sb, CO, [doc]);
    expect(await importAutocountJournals(sb, CO, [doc])).toEqual({ posted: 0, already: 1, errors: [] });
    expect(sb.tables.journal_entries).toHaveLength(1);
    expect(lines(sb)[0]).toEqual(['405-0001', 20_000, 0, null, 'shared']);
  });
  test('refused one by one: an unknown code, an unbalanced document, a date before the books start', async () => {
    const sb = world();
    const r = await importAutocountJournals(sb, CO, [
      { docNo: 'X1', date: '2026-10-01', lines: [{ accountCode: '999-9999', debitSen: 100, creditSen: 0 }, { accountCode: '310-0010', debitSen: 0, creditSen: 100 }] },
      { docNo: 'X2', date: '2026-10-01', lines: [{ accountCode: '601-0010', debitSen: 100, creditSen: 0 }, { accountCode: '310-0010', debitSen: 0, creditSen: 90 }] },
      { docNo: 'X3', date: '2026-08-31', lines: [{ accountCode: '601-0010', debitSen: 100, creditSen: 0 }, { accountCode: '310-0010', debitSen: 0, creditSen: 100 }] },
      { docNo: 'OK', date: '2026-10-01', lines: [{ accountCode: '601-0010', debitSen: 100, creditSen: 0 }, { accountCode: '310-0010', debitSen: 0, creditSen: 100 }] },
    ]);
    expect(r.posted).toBe(1);
    expect(r.errors.map((e) => e.docNo)).toEqual(['X1', 'X2', 'X3']);
    expect(r.errors[0]!.error).toContain('999-9999');
  });
});
