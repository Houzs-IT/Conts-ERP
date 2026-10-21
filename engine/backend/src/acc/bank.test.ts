/* Bank reconciliation reads the account's whole ledger (finance phase 1, gap G13). PostgREST hands back at most
   its max-rows per response and drops the rest WITHOUT an error, so a bank account with more posted lines than
   that lost its oldest movements from the reconciliation. Pinned against fakeSb's own ceiling. */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { loadAccountLedger, loadClaimedElsewhere } from './bank';

const CO = 2;

const lines = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({
  line_id: `l-${String(i + 1).padStart(5, '0')}`, je_no: `JE-${String(i + 1).padStart(5, '0')}`,
  entry_date: '2026-12-05', source_type: 'PV', source_doc_no: `PV-${i + 1}`,
  debit_sen: 0, credit_sen: 100, notes: null, party_name: null, reversed: false, reversed_by_je: null,
  company_id: CO, account_code: '310-0010',
}));

describe('loadAccountLedger', () => {
  test('loads every ledger line past 1,000', async () => {
    const sb = fakeSb({ v_gl_entries: lines(2500) }, {}, [], [], 1000);
    const res = await loadAccountLedger(sb, CO, '310-0010', '2026-12-31');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.movements).toHaveLength(2500);
    expect(new Set(res.movements.map((m) => m.jeNo)).size).toBe(2500);
  });
});

/* What earlier statements already reconciled: a busy account passes 1,000 statement lines within months, and an
   entry dropped here comes back as "still waiting" on the next statement. */
describe('loadClaimedElsewhere', () => {
  test('reads every reconciled line and match past 1,000', async () => {
    const statementLines = Array.from({ length: 1500 }, (_, i) => ({
      id: i + 1, company_id: CO, statement_id: 1, state: 'POSTED', posted_je_no: `JE-P${i + 1}`,
    }));
    const matches = Array.from({ length: 1500 }, (_, i) => ({ company_id: CO, bank_line_id: i + 1, je_no: `JE-M${i + 1}` }));
    const sb = fakeSb({
      acc_bank_statements: [{ id: 1, company_id: CO, account_code: '310-0010', period_from: '2026-01-01' }],
      acc_bank_statement_lines: statementLines,
      acc_bank_statement_matches: matches,
    }, {}, [], [], 1000);
    const res = await loadClaimedElsewhere(sb, CO, '310-0010', null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.claimed.size).toBe(3000);
  });
});
