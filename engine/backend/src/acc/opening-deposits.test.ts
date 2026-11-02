/* Opening deposits by project or unit (chew 2 Nov 2026; plan 2026-11-02-renovation-close-out Task 2). Pinned: the
   journal tags each row on its account and takes the same total off the account untagged, so no account's total
   moves; only 330 deposit accounts; never more than the account's opening balance; one at a time, reversible. */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { importOpeningJournal } from './opening';
import { importOpeningDeposits, reverseOpeningDeposits, type OpeningDepositRow } from './opening-deposits';

const CO = 1;
const acct = (code: string, type: string, money = false): Row => ({
  account_code: code, account_name: `Acct ${code}`, account_type: type, parent_code: null, is_active: true, company_id: CO, acc_money: money,
});
function world() {
  return fakeSb({
    accounts: [acct('330-0040', 'ASSET'), acct('330-0020', 'ASSET'), acct('310-0001', 'ASSET', true), acct('150-0000', 'EQUITY'), acct('620-0010', 'EXPENSE')],
    acc_account_roles: [], journal_entries: [], journal_entry_lines: [],
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01', fiscal_year_end_month: 8 }],
    projects: [{ id: 7, company_id: CO, code: 'RN-2607-003', name: 'ASTER HILL A-08-11' }, { id: 8, company_id: CO, code: 'RN-2608-003', name: 'BARON' }],
    conts_units: [{ id: 'u-a31', building: 'ASTER HILL', unit_number: 'A-3-1' }],
  });
}
const opening = (sb: ReturnType<typeof world>) => importOpeningJournal(sb, CO, [
  { accountCode: '330-0040', debitSen: 200_000, creditSen: 0 },
  { accountCode: '330-0020', debitSen: 30_000, creditSen: 0 },
  { accountCode: '150-0000', debitSen: 0, creditSen: 230_000 },
], 'Chew');
const ROWS: OpeningDepositRow[] = [
  { accountCode: '330-0040', projectCode: 'RN-2607-003', amountSen: 100_000, paidTo: 'SKYLINE MC' },
  { accountCode: '330-0040', projectCode: 'rn-2608-003', amountSen: 50_000, paidTo: 'BARON MC' },
  { accountCode: '330-0020', building: 'aster hill', unitNumber: 'A-3-1', amountSen: 30_000, paidTo: 'TNB' },
];
const net = (sb: ReturnType<typeof world>, code: string) =>
  (sb.tables.journal_entry_lines as Row[]).filter((l) => l.account_code === code).reduce((s, l) => s + Number(l.debit_sen) - Number(l.credit_sen), 0);

describe('opening deposits', () => {
  test('tags each row and takes the same off the account untagged: no account total moves', async () => {
    const sb = world();
    await opening(sb);
    const r = await importOpeningDeposits(sb, CO, ROWS, 'Chew');
    expect(r).toMatchObject({ ok: true });
    const je = (sb.tables.journal_entries as Row[]).find((j) => j.source_type === 'OPENING_DEPOSITS')!;
    expect(je).toMatchObject({ entry_date: '2026-10-31', posted: true });
    const lines = (sb.tables.journal_entry_lines as Row[]).filter((l) => l.journal_entry_id === je.id);
    expect(lines.filter((l) => l.debit_sen > 0).map((l) => [l.account_code, l.project_id ?? null, l.unit_id ?? null, l.debit_sen])).toEqual([
      ['330-0040', 7, null, 100_000], ['330-0040', 8, null, 50_000], ['330-0020', null, 'u-a31', 30_000],
    ]);
    expect(net(sb, '330-0040')).toBe(200_000);
    expect(net(sb, '330-0020')).toBe(30_000);
  });

  test('only a 330 deposit account; one of project or unit; never above the opening balance', async () => {
    const sb = world();
    await opening(sb);
    expect(await importOpeningDeposits(sb, CO, [{ accountCode: '620-0010', projectCode: 'RN-2607-003', amountSen: 1 }], 'Chew')).toMatchObject({ ok: false, problems: [{ row: 1 }] });
    expect(await importOpeningDeposits(sb, CO, [{ accountCode: '330-0040', amountSen: 1 }], 'Chew')).toMatchObject({ ok: false });
    expect(await importOpeningDeposits(sb, CO, [{ accountCode: '330-0040', projectCode: 'RN-2607-003', building: 'ASTER HILL', unitNumber: 'A-3-1', amountSen: 1 }], 'Chew')).toMatchObject({ ok: false });
    expect(await importOpeningDeposits(sb, CO, [{ accountCode: '330-0040', projectCode: 'NOPE', amountSen: 1 }], 'Chew')).toMatchObject({ ok: false });
    const over = await importOpeningDeposits(sb, CO, [{ accountCode: '330-0020', building: 'ASTER HILL', unitNumber: 'A-3-1', amountSen: 30_001 }], 'Chew');
    expect(over).toMatchObject({ ok: false });
    expect((sb.tables.journal_entries as Row[]).some((j) => j.source_type === 'OPENING_DEPOSITS')).toBe(false);
  });

  test('needs the opening journal first; one at a time; reverse to do it again', async () => {
    const sb = world();
    expect(await importOpeningDeposits(sb, CO, ROWS, 'Chew')).toMatchObject({ ok: false });
    await opening(sb);
    expect(await importOpeningDeposits(sb, CO, ROWS, 'Chew')).toMatchObject({ ok: true });
    expect(await importOpeningDeposits(sb, CO, ROWS, 'Chew')).toMatchObject({ ok: false });
    expect(await reverseOpeningDeposits(sb, CO)).toMatchObject({ ok: true });
    expect(await importOpeningDeposits(sb, CO, ROWS, 'Chew')).toMatchObject({ ok: true });
    expect(net(sb, '330-0040')).toBe(200_000);
  });

  test('a dry run names the problems and writes nothing', async () => {
    const sb = world();
    await opening(sb);
    const r = await importOpeningDeposits(sb, CO, ROWS, 'Chew', { dryRun: true });
    expect(r).toMatchObject({ ok: true, dryRun: true });
    expect((sb.tables.journal_entries as Row[]).some((j) => j.source_type === 'OPENING_DEPOSITS')).toBe(false);
  });
});
