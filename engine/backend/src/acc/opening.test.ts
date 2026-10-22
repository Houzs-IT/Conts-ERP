/* Opening balances (Conts, finance phase 1, spec 3.8): the one OPENING journal from AutoCount's trial balance, the
   invoices and bills still open on the day before the books start, and the check that the two agree. */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import {
  importOpeningJournal, importOpeningPayables, importOpeningReceivables, openingCheck, reverseOpeningJournal,
} from './opening';

const CO = 1;
const ACTOR = '00000000-0000-0000-0000-00000000000a';
const acct = (code: string, type: string, money = false): Row => ({
  account_code: code, account_name: `Acct ${code}`, account_type: type, parent_code: null, is_active: true,
  company_id: CO, acc_money: money, section: null,
});
const CHART: Row[] = [
  acct('300-0000', 'ASSET'), acct('310-0001', 'ASSET', true), acct('400-0000', 'LIABILITY'),
  acct('150-0000', 'EQUITY'), acct('500-0000', 'INCOME'), acct('601-0000', 'EXPENSE'),
];

function world(over: Record<string, Row[]> = {}, start: string | null = '2026-12-01') {
  return fakeSb({
    accounts: CHART.map((a) => ({ ...a })), acc_account_roles: [], journal_entries: [], journal_entry_lines: [],
    acc_company_settings: start ? [{ company_id: CO, ledger_start_date: start, fiscal_year_end_month: 8 }] : [],
    sales_invoices: [], purchase_invoices: [],
    suppliers: [{ id: 'sup-1', code: '400-T001', name: 'TODERN', company_id: CO }],
    ...over,
  });
}

const BALANCED = [
  { accountCode: '310-0001', debitSen: 100_000, creditSen: 0 },
  { accountCode: '300-0000', debitSen: 50_000, creditSen: 0 },
  { accountCode: '400-0000', debitSen: 0, creditSen: 30_000 },
  { accountCode: '150-0000', debitSen: 0, creditSen: 120_000 },
];

describe('the opening journal', () => {
  test('posts one OPENING journal the day before the ledger start', async () => {
    const sb = world();
    const r = await importOpeningJournal(sb, CO, BALANCED, ACTOR);
    expect(r.ok).toBe(true);
    const [je] = sb.tables.journal_entries;
    expect(je).toMatchObject({ source_type: 'OPENING', entry_date: '2026-11-30', posted: true, total_debit_sen: 150_000 });
  });

  test('the opening journal may touch AR and AP', async () => {
    const sb = world();
    await importOpeningJournal(sb, CO, BALANCED, ACTOR);
    const codes = sb.tables.journal_entry_lines.map((l) => l.account_code);
    expect(codes).toEqual(expect.arrayContaining(['300-0000', '400-0000']));
  });

  test('refuses a second opening journal while one is active', async () => {
    const sb = world();
    expect((await importOpeningJournal(sb, CO, BALANCED, ACTOR)).ok).toBe(true);
    const again = await importOpeningJournal(sb, CO, BALANCED, ACTOR);
    expect(again).toMatchObject({ ok: false });
    expect(sb.tables.journal_entries).toHaveLength(1);
  });

  test('a reversed opening journal can be redone', async () => {
    const sb = world();
    await importOpeningJournal(sb, CO, BALANCED, ACTOR);
    const rev = await reverseOpeningJournal(sb, CO);
    expect(rev).toMatchObject({ ok: true });
    const contra = sb.tables.journal_entries.find((j) => j.source_type === 'OPENING_REVERSAL');
    expect(contra).toMatchObject({ entry_date: '2026-11-30' });
    expect((await importOpeningJournal(sb, CO, BALANCED, ACTOR)).ok).toBe(true);
  });

  test('refuses an unbalanced opening journal', async () => {
    const sb = world();
    const r = await importOpeningJournal(sb, CO, [BALANCED[0], { ...BALANCED[3], creditSen: 90_000 }], ACTOR);
    expect(r).toMatchObject({ ok: false });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  test('refuses when the ledger start is not set', async () => {
    const sb = world({}, null);
    const r = await importOpeningJournal(sb, CO, BALANCED, ACTOR);
    expect(r).toMatchObject({ ok: false });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
});

describe('opening receivables and payables', () => {
  const AR_ROW = { docNo: 'IV-00123', debtorName: 'Ah Meng', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 50_000 };

  test('imports receivables once and skips the same docNo the second time', async () => {
    const sb = world();
    expect(await importOpeningReceivables(sb, CO, [AR_ROW], ACTOR)).toEqual({ created: 1, skipped: 0, errors: [] });
    expect(sb.tables.sales_invoices[0]).toMatchObject({
      invoice_number: 'IV-00123', linked_ac_docno: 'IV-00123', opening_balance: true, status: 'SENT',
      total_sen: 50_000, debtor_name: 'Ah Meng', due_date: '2026-11-04', company_id: CO, created_by: ACTOR,
    });
    expect(await importOpeningReceivables(sb, CO, [AR_ROW], ACTOR)).toEqual({ created: 0, skipped: 1, errors: [] });
    expect(sb.tables.sales_invoices).toHaveLength(1);
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  test('a row dated on or after the start of the books is an error', async () => {
    const sb = world();
    const r = await importOpeningReceivables(sb, CO, [{ ...AR_ROW, invoiceDate: '2026-12-01' }], ACTOR);
    expect(r.created).toBe(0);
    expect(r.errors[0]).toMatchObject({ docNo: 'IV-00123' });
  });

  test('reports an unknown supplier code as a row error', async () => {
    const sb = world();
    const r = await importOpeningPayables(sb, CO, [
      { docNo: 'PI-001', supplierCode: '400-T001', invoiceDate: '2026-10-01', dueDate: '2026-10-31', outstandingSen: 30_000 },
      { docNo: 'PI-002', supplierCode: '400-NOPE', invoiceDate: '2026-10-01', dueDate: '2026-10-31', outstandingSen: 1_000 },
    ], ACTOR);
    expect(r.created).toBe(1);
    expect(r.errors).toEqual([{ docNo: 'PI-002', error: expect.stringContaining('400-NOPE') }]);
    expect(sb.tables.purchase_invoices[0]).toMatchObject({
      invoice_number: 'PI-001', supplier_id: 'sup-1', opening_balance: true, status: 'POSTED', total_sen: 30_000,
    });
  });
});

describe('the opening check', () => {
  test('the check matches the AR control to the opening documents', async () => {
    const sb = world();
    await importOpeningJournal(sb, CO, BALANCED, ACTOR);
    // The journal's lines reach the check through v_gl_entries, the view every balance reads.
    const je = sb.tables.journal_entries[0];
    sb.tables.v_gl_entries = sb.tables.journal_entry_lines.map((l) => ({
      ...l, company_id: CO, entry_date: je.entry_date, posted: true, reversed: false, reversed_by_je: null,
      account_name: l.account_code, account_type: CHART.find((a) => a.account_code === l.account_code)!.account_type,
    }));
    await importOpeningReceivables(sb, CO, [{ docNo: 'IV-1', debtorName: 'A', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 50_000 }], ACTOR);
    await importOpeningPayables(sb, CO, [{ docNo: 'PI-1', supplierCode: '400-T001', invoiceDate: '2026-10-01', dueDate: '2026-10-31', outstandingSen: 20_000 }], ACTOR);

    const r = await openingCheck(sb, CO);
    expect(r).toMatchObject({
      ok: true, openingDay: '2026-11-30', arControlSen: 50_000, arDocumentsSen: 50_000,
      apControlSen: 30_000, apDocumentsSen: 20_000, trialDebitSen: 150_000, trialCreditSen: 150_000, balanced: false,
    });
    expect(r.ok && r.banks).toEqual([{ accountCode: '310-0001', name: 'Acct 310-0001', balanceSen: 100_000 }]);

    await importOpeningPayables(sb, CO, [{ docNo: 'PI-2', supplierCode: '400-T001', invoiceDate: '2026-10-02', dueDate: '2026-11-01', outstandingSen: 10_000 }], ACTOR);
    expect(await openingCheck(sb, CO)).toMatchObject({ apDocumentsSen: 30_000, balanced: true });
  });
});

describe('the opening routes', () => {
  async function call(perms: string[], path: string, body?: unknown) {
    const { Hono } = await import('hono');
    const routes = await import('../scm/routes/accounting');
    const sb = world();
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('supabase' as never, sb as never);
      c.set('companyId' as never, CO as never);
      c.set('user' as never, { id: ACTOR } as never);
      c.set('houzsUser' as never, { name: 'Finance', permissions_set: perms } as never);
      await next();
    });
    app.post('/opening/journal', routes.openingJournalHandler as never);
    app.post('/opening/receivables', routes.openingReceivablesHandler as never);
    app.get('/opening/check', routes.openingCheckHandler as never);
    const res = await app.request(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    return { status: res.status, body: await res.json() as Record<string, unknown>, sb };
  }

  test('writing or reading the opening balances needs the ledger post key', async () => {
    expect((await call([], '/opening/journal', { lines: BALANCED })).status).toBe(403);
    expect((await call([], '/opening/receivables', { rows: [] })).status).toBe(403);
    expect((await call([], '/opening/check')).status).toBe(403);
  });

  test('the receivables route records who imported them', async () => {
    const r = await call(['scm.payment_voucher.post'], '/opening/receivables', {
      rows: [{ docNo: 'IV-9', debtorName: 'A', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 1_000 }],
    });
    expect(r.body).toEqual({ created: 1, skipped: 0, errors: [] });
    expect(r.sb.tables.sales_invoices[0]).toMatchObject({ created_by: ACTOR });
  });
});
