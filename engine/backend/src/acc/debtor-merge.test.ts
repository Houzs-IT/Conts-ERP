/* One customer under two codes, merged into one (chew, 17 Nov 2026). */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { mergeDebtors } from './debtor-merge';

const CO = 1;
const acct = (code: string, type: string, special: string | null = null): Row => ({ account_code: code, account_name: code, account_type: type, parent_code: null, is_active: true, company_id: CO, special_type: special });
const world = () => fakeSb({
  accounts: [acct('301-0000', 'ASSET', 'SDC'), acct('310-0010', 'ASSET')],
  acc_account_roles: [], journal_entries: [], journal_entry_lines: [],
  acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-09-01', fiscal_year_end_month: 8 }],
  debtors: [
    { id: 'd1', code: '301-M144', name: 'MR WAYNE (LEGACY OUG A26-03)', control_account: '301-0000', is_active: true, company_id: CO },
    { id: 'd2', code: '301-M299', name: 'MR WAYNE', control_account: '301-0000', is_active: true, company_id: CO },
  ],
  v_gl_entries: [{ line_id: 1, company_id: CO, party_code: '301-M299', account_code: '301-0000', debit_sen: 0, credit_sen: 1_972_400 }],
  mfg_sales_orders: [{ doc_no: 'TC-SO-2608-003', company_id: CO, debtor_code: '301-M299', debtor_name: 'MR WAYNE' }],
  sales_invoices: [], customer_credits: [],
});

describe('merging a customer filed under two codes', () => {
  test('a dry run says what would move and changes nothing', async () => {
    const sb = world();
    const r = await mergeDebtors(sb, CO, '301-M299', '301-M144', '2026-11-17', true);
    expect(r).toEqual({ ok: true, merge: { from: '301-M299', to: '301-M144', date: '2026-11-17', moves: [{ accountCode: '301-0000', balanceSen: -1_972_400 }],
      orders: ['TC-SO-2608-003'], invoices: [], credits: 0, done: false } });
    expect(sb.tables.journal_entries).toHaveLength(0);
    expect(sb.tables.mfg_sales_orders[0]!.debtor_code).toBe('301-M299');
  });
  test('the balance moves party on the same control, the order follows, the old code is switched off', async () => {
    const sb = world();
    const r = await mergeDebtors(sb, CO, '301-M299', '301-M144', '2026-11-17', false);
    expect(r.ok && r.merge.done).toBe(true);
    expect(sb.tables.journal_entries[0]).toMatchObject({ source_type: 'DMERGE', source_doc_no: '301-M299>301-M144', entry_date: '2026-11-17' });
    expect(sb.tables.journal_entry_lines.map((l) => [l.account_code, l.debit_sen, l.credit_sen, l.party_code])).toEqual([
      ['301-0000', 1_972_400, 0, '301-M299'], ['301-0000', 0, 1_972_400, '301-M144'],
    ]);
    expect(sb.tables.mfg_sales_orders[0]).toMatchObject({ debtor_code: '301-M144', debtor_name: 'MR WAYNE (LEGACY OUG A26-03)' });
    expect(sb.tables.debtors.find((d) => d.code === '301-M299')).toMatchObject({ is_active: false });
  });
  test('the same code twice, or a code that is not a customer, is refused', async () => {
    expect(await mergeDebtors(world(), CO, '301-M144', '301-M144', '2026-11-17', true)).toMatchObject({ ok: false, status: 400 });
    expect(await mergeDebtors(world(), CO, '301-X999', '301-M144', '2026-11-17', true)).toMatchObject({ ok: false, status: 404 });
  });
});
