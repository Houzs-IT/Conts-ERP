// The posting gate itself. Every auto-posting document type runs THROUGH this
// code, so these tests are the floor under all of them: shape, balance, chart,
// idempotency, numbering, reversal. Each case asserts a DECISION the
// requirements brief names (§2.1 one gate, §2.2 computed state, §2.9 parent
// block, §2.12 concurrency, §2.14 fail loud), and each has been inverted in
// the source once to confirm it fails.

import { describe, it, expect } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { postJournal, reverseJournal } from './engine';
import { DEFAULT_ROLE_CODES, resolveRoles, siLines } from './rules';

const CHART_C1: Row[] = [
  { account_code: '300-0000', account_name: 'Accounts Receivable', account_type: 'ASSET', parent_code: null, is_active: true, company_id: 1 },
  { account_code: '500-0000', account_name: 'Sales Revenue', account_type: 'INCOME', parent_code: null, is_active: true, company_id: 1 },
  { account_code: '900-0000', account_name: 'Operating Expense', account_type: 'EXPENSE', parent_code: null, is_active: true, company_id: 1 },
  { account_code: '905-0000', account_name: 'Rental Expense', account_type: 'EXPENSE', parent_code: '900-0000', is_active: true, company_id: 1 },
  { account_code: '9000', account_name: 'Dead Account', account_type: 'EXPENSE', parent_code: null, is_active: false, company_id: 1 },
];

const world = (over: { accounts?: Row[]; jes?: Row[]; jeLines?: Row[]; missing?: Record<string, string[]> } = {}) =>
  fakeSb(
    {
      accounts: over.accounts ?? CHART_C1,
      journal_entries: over.jes ?? [],
      journal_entry_lines: over.jeLines ?? [],
      acc_account_roles: [],
    },
    over.missing ?? {},
  );

const drCr = (dr: number, cr: number) => [
  { accountCode: '300-0000', debitSen: dr, creditSen: 0 },
  { accountCode: '500-0000', debitSen: 0, creditSen: cr },
];

const base = {
  companyId: 1,
  entryDate: '2026-08-01',
  sourceType: 'SI',
  sourceDocNo: 'HC-SI-2608-001',
  narration: 'test',
};

describe('postJournal — the one gate', () => {
  it('posts a balanced entry: header + both lines + posted flag + document-date numbering', async () => {
    const sb = world();
    const out = await postJournal(sb, { ...base, lines: drCr(388800, 388800) });
    expect(out).toMatchObject({ ok: true, status: 'posted', totalSen: 388800 });
    const je = sb.tables.journal_entries[0];
    // je_no derives from the DOCUMENT date (2026-08 → 2608), not today (§2.5).
    expect(je.je_no).toBe('JE-2608-0001');
    expect(je.posted).toBe(true);
    expect(je.total_debit_sen).toBe(388800);
    expect(sb.tables.journal_entry_lines).toHaveLength(2);
    expect(sb.tables.journal_entry_lines[0]).toMatchObject({ account_code: '300-0000', debit_sen: 388800, line_no: 1 });
  });

  /* The department (Conts, finance phase 1, spec 3.5): Rental, Supply chain or Shared, per line. */
  it("keeps each line's department", async () => {
    const sb = world();
    const out = await postJournal(sb, { ...base, lines: [
      { accountCode: '905-0000', debitSen: 300, creditSen: 0, department: 'rental' },
      { accountCode: '300-0000', debitSen: 200, creditSen: 0, department: 'shared' },
      { accountCode: '500-0000', debitSen: 0, creditSen: 500, department: 'supply' },
    ] });
    expect(out).toMatchObject({ ok: true, status: 'posted' });
    expect(sb.tables.journal_entry_lines.map((l) => l.department)).toEqual(['rental', 'shared', 'supply']);
  });

  it('defaults to supply when a line has none', async () => {
    const sb = world();
    await postJournal(sb, { ...base, lines: drCr(100, 100) });
    expect(sb.tables.journal_entry_lines.map((l) => l.department)).toEqual(['supply', 'supply']);
  });

  it('refuses an unknown department, before anything is written', async () => {
    const sb = world();
    const out = await postJournal(sb, { ...base, lines: [
      { accountCode: '300-0000', debitSen: 100, creditSen: 0, department: 'hq' as never },
      { accountCode: '500-0000', debitSen: 0, creditSen: 100 },
    ] });
    expect(out).toMatchObject({ ok: false, status: 'bad_line' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  it('numbers sequentially within a company month', async () => {
    const sb = world();
    await postJournal(sb, { ...base, lines: drCr(100, 100) });
    const out2 = await postJournal(sb, { ...base, sourceDocNo: 'HC-SI-2608-002', lines: drCr(200, 200) });
    expect(out2.ok && out2.status === 'posted' && out2.jeNo).toBe('JE-2608-0002');
  });

  it('refuses an unbalanced entry BEFORE anything is written', async () => {
    const sb = world();
    const out = await postJournal(sb, { ...base, lines: drCr(1000, 999) });
    expect(out).toMatchObject({ ok: false, status: 'unbalanced' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  it('refuses a line that carries both debit and credit', async () => {
    const sb = world();
    const out = await postJournal(sb, {
      ...base,
      lines: [
        { accountCode: '300-0000', debitSen: 100, creditSen: 100 },
        { accountCode: '500-0000', debitSen: 100, creditSen: 100 },
      ],
    });
    expect(out).toMatchObject({ ok: false, status: 'bad_line' });
  });

  it('refuses non-integer sen — money is integer sen, always (§2.7)', async () => {
    const sb = world();
    const out = await postJournal(sb, {
      ...base,
      lines: [
        { accountCode: '300-0000', debitSen: 100.5, creditSen: 0 },
        { accountCode: '500-0000', debitSen: 0, creditSen: 100.5 },
      ],
    });
    expect(out).toMatchObject({ ok: false, status: 'bad_line' });
  });

  it('refuses an account the company chart does not have', async () => {
    const sb = world();
    const out = await postJournal(sb, {
      ...base,
      lines: [
        { accountCode: 'NOPE', debitSen: 100, creditSen: 0 },
        { accountCode: '500-0000', debitSen: 0, creditSen: 100 },
      ],
    });
    expect(out).toMatchObject({ ok: false, status: 'account_invalid' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  it('refuses a deactivated account', async () => {
    const sb = world();
    const out = await postJournal(sb, {
      ...base,
      lines: [
        { accountCode: '9000', debitSen: 100, creditSen: 0 },
        { accountCode: '500-0000', debitSen: 0, creditSen: 100 },
      ],
    });
    expect(out).toMatchObject({ ok: false, status: 'account_invalid' });
  });

  it('refuses a PARENT header account — really blocked, not just labelled (§2.9)', async () => {
    const sb = world();
    const out = await postJournal(sb, {
      ...base,
      lines: [
        { accountCode: '900-0000', debitSen: 100, creditSen: 0 }, // has child 905-0000
        { accountCode: '500-0000', debitSen: 0, creditSen: 100 },
      ],
    });
    expect(out).toMatchObject({ ok: false, status: 'account_invalid' });
  });

  it('tolerates a company with NO chart at all (legacy mode) — posting proceeds', async () => {
    const sb = world({ accounts: [] });
    const out = await postJournal(sb, { ...base, lines: drCr(100, 100) });
    expect(out).toMatchObject({ ok: true, status: 'posted' });
  });

  it('a chart read that does not answer fails CLOSED, not open', async () => {
    const sb = world({ missing: { accounts: ['account_code'] } });
    const out = await postJournal(sb, { ...base, lines: drCr(100, 100) });
    expect(out).toMatchObject({ ok: false, status: 'account_check_failed' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  it('already_posted: an ACTIVE entry for the source no-ops, a REVERSED one does not block', async () => {
    const sb = world({
      jes: [
        { id: 'je-old', je_no: 'JE-2607-0001', source_type: 'SI', source_doc_no: base.sourceDocNo, company_id: 1, reversed: true, posted: true },
        { id: 'je-live', je_no: 'JE-2607-0002', source_type: 'SI', source_doc_no: base.sourceDocNo, company_id: 1, reversed: false, posted: true },
      ],
    });
    const out = await postJournal(sb, { ...base, lines: drCr(100, 100) });
    expect(out).toMatchObject({ ok: true, status: 'already_posted', jeNo: 'JE-2607-0002' });
    expect(sb.tables.journal_entries).toHaveLength(2); // nothing new written
  });

  it('an idempotency read that does not answer fails CLOSED — a blip must never book twice (§2.14)', async () => {
    const sb = world({ missing: { journal_entries: ['reversed'] } });
    const out = await postJournal(sb, { ...base, lines: drCr(100, 100) });
    expect(out).toMatchObject({ ok: false, status: 'idempotency_read_failed' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  it('a MANUAL journal may NOT touch a control account — documents maintain those (§2.4)', async () => {
    const sb = world();
    const out = await postJournal(sb, { ...base, sourceType: 'MANUAL', sourceDocNo: null, lines: drCr(100, 100) });
    expect(out).toMatchObject({ ok: false, status: 'control_account_manual' });
    expect(sb.tables.journal_entries).toHaveLength(0);
    // The SAME lines through a document rule are exactly how AR moves — allowed.
    const viaRule = await postJournal(sb, { ...base, lines: drCr(100, 100) });
    expect(viaRule).toMatchObject({ ok: true, status: 'posted' });
  });

  const manualLines = (dr: number, cr: number) => [
    { accountCode: '905-0000', debitSen: dr, creditSen: 0 },
    { accountCode: '500-0000', debitSen: 0, creditSen: cr },
  ];

  it('postNow:false writes a DRAFT — entry + lines exist, posted stays false', async () => {
    const sb = world();
    const out = await postJournal(sb, { ...base, sourceType: 'MANUAL', sourceDocNo: null, postNow: false, lines: manualLines(500, 500) });
    expect(out).toMatchObject({ ok: true, status: 'draft' });
    expect(sb.tables.journal_entries[0].posted).not.toBe(true);
    expect(sb.tables.journal_entry_lines).toHaveLength(2);
  });

  it('a failed lines insert deletes the orphan header (no headless entries)', async () => {
    const sb = world({ missing: { journal_entry_lines: ['account_code'] } });
    // fakeSb only fails SELECTS on missing columns, so simulate via unique
    // violation instead: a duplicate (journal_entry_id, line_no) pair.
    const sbU = fakeSb(
      { accounts: CHART_C1, journal_entries: [], journal_entry_lines: [], acc_account_roles: [] },
      {},
      [{ table: 'journal_entry_lines', column: 'line_no', covers: () => true, name: 'jel_dup' }],
    );
    sbU.tables.journal_entry_lines.push({ line_no: 1 });
    const out = await postJournal(sbU, { ...base, lines: drCr(100, 100) });
    expect(out).toMatchObject({ ok: false, status: 'lines_insert_failed' });
    expect(sbU.tables.journal_entries).toHaveLength(0);
    void sb;
  });
});

describe('reverseJournal — voiding through the same gate', () => {
  const LIVE = {
    id: 'je-1',
    je_no: 'JE-2608-0001',
    entry_date: '2026-08-01',
    source_type: 'SI',
    source_doc_no: base.sourceDocNo,
    company_id: 1,
    posted: true,
    reversed: false,
    total_debit_sen: 388800,
    total_credit_sen: 388800,
  };
  const LIVE_LINES = [
    { journal_entry_id: 'je-1', line_no: 1, account_code: '300-0000', debit_sen: 388800, credit_sen: 0, party_type: 'CUSTOMER', party_code: 'C-1', party_name: 'Ah Meng', notes: 'AR' },
    { journal_entry_id: 'je-1', line_no: 2, account_code: '500-0000', debit_sen: 0, credit_sen: 388800, party_type: null, party_code: null, party_name: null, notes: 'Rev' },
  ];
  const revInput = {
    sourceType: 'SI',
    sourceDocNo: base.sourceDocNo,
    narration: (o: { je_no: string }) => `Reversal of ${o.je_no}`,
  };

  it('writes a faithful contra (same accounts/parties, sides swapped) and flags the original', async () => {
    const sb = world({ jes: [{ ...LIVE }], jeLines: [...LIVE_LINES] });
    const out = await reverseJournal(sb, revInput);
    expect(out).toMatchObject({ ok: true, status: 'reversed' });
    const rev = sb.tables.journal_entries.find((j) => j.source_type === 'SI_REVERSAL')!;
    expect(rev.posted).toBe(true);
    expect(rev.reversed_by_je).toBe('je-1');
    const revLines = sb.tables.journal_entry_lines.filter((l) => l.journal_entry_id === rev.id);
    expect(revLines[0]).toMatchObject({ account_code: '300-0000', debit_sen: 0, credit_sen: 388800, party_code: 'C-1' });
    expect(sb.tables.journal_entries.find((j) => j.id === 'je-1')!.reversed).toBe(true);
  });

  it("the contra keeps each line's department, so a department's P&L nets to nothing", async () => {
    const lines = [{ ...LIVE_LINES[0], department: 'rental' }, { ...LIVE_LINES[1], department: 'shared' }];
    const sb = world({ jes: [{ ...LIVE }], jeLines: lines });
    await reverseJournal(sb, revInput);
    const rev = sb.tables.journal_entries.find((j) => j.source_type === 'SI_REVERSAL')!;
    const revLines = sb.tables.journal_entry_lines.filter((l) => l.journal_entry_id === rev.id);
    expect(revLines.map((l) => l.department)).toEqual(['rental', 'shared']);
  });

  it('nothing_to_reverse when no ACTIVE entry exists', async () => {
    const sb = world({ jes: [{ ...LIVE, reversed: true }] });
    const out = await reverseJournal(sb, revInput);
    expect(out).toMatchObject({ ok: true, status: 'nothing_to_reverse' });
  });

  it('already_reversed: an existing contra makes the flag stick instead of double-voiding', async () => {
    const sb = world({
      jes: [
        { ...LIVE },
        { id: 'je-rev', je_no: 'JE-2608-0002', source_type: 'SI_REVERSAL', source_doc_no: base.sourceDocNo, reversed_by_je: 'je-1', company_id: 1 },
      ],
      jeLines: [...LIVE_LINES],
    });
    const out = await reverseJournal(sb, revInput);
    expect(out).toMatchObject({ ok: true, status: 'already_reversed' });
    expect(sb.tables.journal_entries.find((j) => j.id === 'je-1')!.reversed).toBe(true);
    expect(sb.tables.journal_entries).toHaveLength(2);
  });

  it('a lookup that does not answer fails CLOSED — never reads as nothing_to_reverse', async () => {
    const sb = world({ jes: [{ ...LIVE }], missing: { journal_entries: ['reversed'] } });
    const out = await reverseJournal(sb, revInput);
    expect(out).toMatchObject({ ok: false, status: 'reversal_read_failed' });
  });

  it('a line read that does not answer aborts — a contra must mirror REAL lines, not assumed ones', async () => {
    const sb = world({ jes: [{ ...LIVE }], jeLines: [...LIVE_LINES], missing: { journal_entry_lines: ['account_code'] } });
    const out = await reverseJournal(sb, revInput);
    expect(out).toMatchObject({ ok: false, status: 'reversal_read_failed' });
    expect(sb.tables.journal_entries).toHaveLength(1);
  });

  it('reverses by journal id — the manual-JV path, which has no source document', async () => {
    const MANUAL_JE = { ...LIVE, id: 'je-m', je_no: 'JE-2608-0009', source_type: 'MANUAL', source_doc_no: null };
    const sb = world({
      jes: [{ ...MANUAL_JE }],
      jeLines: LIVE_LINES.map((l) => ({ ...l, journal_entry_id: 'je-m' })),
    });
    const out = await reverseJournal(sb, {
      sourceType: 'MANUAL',
      jeId: 'je-m',
      narration: (o) => `Reversal of ${o.je_no}`,
    });
    expect(out).toMatchObject({ ok: true, status: 'reversed' });
    const rev = sb.tables.journal_entries.find((j) => j.source_type === 'MANUAL_REVERSAL')!;
    expect(rev.reversed_by_je).toBe('je-m');
    expect(rev.source_doc_no ?? null).toBeNull();
    expect(sb.tables.journal_entries.find((j) => j.id === 'je-m')!.reversed).toBe(true);
  });

  it('refuses to reverse with neither a source document nor a journal id', async () => {
    const sb = world();
    const out = await reverseJournal(sb, { sourceType: 'MANUAL', narration: (o) => o.je_no });
    expect(out).toMatchObject({ ok: false, status: 'reversal_read_failed' });
  });
});

describe('rules — role resolution', () => {
  it('reads the per-company role mapping when present', async () => {
    const sb = fakeSb({ acc_account_roles: [{ company_id: 1, role: 'AR', account_code: '300-0000' }] });
    const roles = await resolveRoles(sb, 1);
    expect(roles.AR).toBe('300-0000');
    expect(roles.SALES).toBe(DEFAULT_ROLE_CODES.SALES);
  });

  it('falls back to the historical literals when the read fails — books like yesterday, never differently', async () => {
    const sb = fakeSb({ acc_account_roles: [{ company_id: 1, role: 'AR', account_code: '300-0000' }] }, { acc_account_roles: ['role'] });
    const roles = await resolveRoles(sb, 1);
    expect(roles.AR).toBe(DEFAULT_ROLE_CODES.AR);
  });

  it('siLines books Dr AR for the total with the customer stamped on the AR leg / Cr each product group\'s own sales account', () => {
    const lines = siLines({ ...DEFAULT_ROLE_CODES }, { invoice_number: 'X', debtor_code: 'C1', debtor_name: 'A' }, [
      { groupCode: 'SOFA', accountCode: '500-0003', myrSen: 300 },
      { groupCode: 'MATTRESS', accountCode: '500-0001', myrSen: 200 },
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ accountCode: '300-0000', debitSen: 500, creditSen: 0, partyType: 'CUSTOMER', partyCode: 'C1' });
    expect(lines[1]).toMatchObject({ accountCode: '500-0003', creditSen: 300, debitSen: 0 });
    expect(lines[2]).toMatchObject({ accountCode: '500-0001', creditSen: 200, debitSen: 0 });
  });
});

describe('the ledger start date (Conts, finance 2026-10-21)', () => {
  const settings = [{ company_id: 1, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8 }];
  const started = (missing: Record<string, string[]> = {}) => fakeSb(
    { accounts: CHART_C1, journal_entries: [], journal_entry_lines: [], acc_account_roles: [], acc_company_settings: settings.map((s) => ({ ...s })) },
    missing,
  );

  it('refuses a journal dated before the ledger start', async () => {
    const sb = started();
    const out = await postJournal(sb, { ...base, entryDate: '2026-11-30', lines: drCr(100, 100) });
    expect(out).toMatchObject({ ok: false, status: 'before_ledger_start' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  it('posts an OPENING journal dated before the ledger start', async () => {
    const sb = started();
    const out = await postJournal(sb, { ...base, sourceType: 'OPENING', sourceDocNo: 'OPENING', entryDate: '2026-11-30', lines: drCr(100, 100) });
    expect(out).toMatchObject({ ok: true, status: 'posted' });
  });

  it('posts on the ledger start date', async () => {
    const sb = started();
    const out = await postJournal(sb, { ...base, entryDate: '2026-12-01', lines: drCr(100, 100) });
    expect(out).toMatchObject({ ok: true, status: 'posted' });
  });

  it('fails closed when the settings read fails', async () => {
    const sb = started({ acc_company_settings: ['ledger_start_date'] });
    const out = await postJournal(sb, { ...base, entryDate: '2026-12-05', lines: drCr(100, 100) });
    expect(out).toMatchObject({ ok: false, status: 'ledger_settings_failed' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  it('writes no reversal for a pre-start document that was never posted', async () => {
    const sb = started();
    const out = await reverseJournal(sb, {
      sourceType: 'SI', sourceDocNo: 'X', sourceDate: '2026-11-15', narration: () => 'r',
      fallbackLines: (t) => drCr(t, t),
    });
    expect(out).toMatchObject({ ok: true, status: 'before_ledger_start' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  /* Spec 3.8 point 5: voiding or editing an old document after the books start
     writes no contra, even when the engine had booked it before the start was
     set — that entry predates the books, and a contra dated today would take a
     pre-start sale out of the new year. */
  it('writes no reversal for a pre-start document that the engine had posted', async () => {
    const sb = started();
    sb.tables.journal_entries.push({ id: 'je-0', je_no: 'JE-2611-0001', entry_date: '2026-11-15', source_type: 'SI', source_doc_no: 'X', company_id: 1, posted: true, reversed: false, total_debit_sen: 100, total_credit_sen: 100 });
    const out = await reverseJournal(sb, { sourceType: 'SI', sourceDocNo: 'X', sourceDate: '2026-11-15', narration: () => 'r' });
    expect(out).toMatchObject({ ok: true, status: 'before_ledger_start' });
    expect(sb.tables.journal_entries).toHaveLength(1);
    expect(sb.tables.journal_entries[0].reversed).toBe(false);
  });

  it('writes no contra dated before the ledger start, whatever the caller', async () => {
    const sb = started();
    sb.tables.journal_entries.push({ id: 'je-0', je_no: 'JE-2611-0001', entry_date: '2026-11-15', source_type: 'MANUAL', source_doc_no: null, company_id: 1, posted: true, reversed: false, total_debit_sen: 100, total_credit_sen: 100 });
    const out = await reverseJournal(sb, { sourceType: 'MANUAL', jeId: 'je-0', entryDate: '2026-11-15', narration: () => 'r' });
    expect(out).toMatchObject({ ok: true, status: 'before_ledger_start' });
    expect(sb.tables.journal_entries).toHaveLength(1);
  });

  it('writes no contra for an entry dated before the ledger start, even when the contra is dated after it', async () => {
    const sb = started();
    sb.tables.journal_entries.push({ id: 'je-0', je_no: 'JE-2611-0001', entry_date: '2026-11-15', source_type: 'SOPAY', source_doc_no: 'p-1', company_id: 1, posted: true, reversed: false, total_debit_sen: 100, total_credit_sen: 100 });
    const out = await reverseJournal(sb, { sourceType: 'SOPAY', sourceDocNo: 'p-1', entryDate: '2026-12-05', narration: () => 'r' });
    expect(out).toMatchObject({ ok: true, status: 'before_ledger_start' });
    expect(sb.tables.journal_entries).toHaveLength(1);
  });

  it('the OPENING journal can still be reversed on its own day, to be redone', async () => {
    const sb = started();
    sb.tables.journal_entries.push({ id: 'je-o', je_no: 'JE-2611-0009', entry_date: '2026-11-30', source_type: 'OPENING', source_doc_no: 'OPENING', company_id: 1, posted: true, reversed: false, total_debit_sen: 100, total_credit_sen: 100 });
    sb.tables.journal_entry_lines.push(
      { journal_entry_id: 'je-o', line_no: 1, account_code: '300-0000', debit_sen: 100, credit_sen: 0 },
      { journal_entry_id: 'je-o', line_no: 2, account_code: '500-0000', debit_sen: 0, credit_sen: 100 },
    );
    const out = await reverseJournal(sb, { sourceType: 'OPENING', sourceDocNo: 'OPENING', companyId: 1, entryDate: '2026-11-30', narration: () => 'r' });
    expect(out).toMatchObject({ ok: true, status: 'reversed' });
  });

  it('reverses a document dated on or after the start as before', async () => {
    const sb = started();
    sb.tables.journal_entries.push({ id: 'je-0', je_no: 'JE-2612-0001', entry_date: '2026-12-02', source_type: 'SI', source_doc_no: 'X', company_id: 1, posted: true, reversed: false, total_debit_sen: 100, total_credit_sen: 100 });
    sb.tables.journal_entry_lines.push(
      { journal_entry_id: 'je-0', line_no: 1, account_code: '300-0000', debit_sen: 100, credit_sen: 0 },
      { journal_entry_id: 'je-0', line_no: 2, account_code: '500-0000', debit_sen: 0, credit_sen: 100 },
    );
    const out = await reverseJournal(sb, { sourceType: 'SI', sourceDocNo: 'X', sourceDate: '2026-12-02', entryDate: '2026-12-03', narration: () => 'r' });
    expect(out).toMatchObject({ ok: true, status: 'reversed' });
  });
});
