/* Bank reconciliation reads the account's whole ledger (finance phase 1, gap G13). PostgREST hands back at most
   its max-rows per response and drops the rest WITHOUT an error, so a bank account with more posted lines than
   that lost its oldest movements from the reconciliation. Pinned against fakeSb's own ceiling. */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { loadAccountLedger } from './bank';

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
