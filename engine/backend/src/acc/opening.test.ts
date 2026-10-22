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
    suppliers: [{ id: 'sup-1', code: '400-T001', name: 'TODERN', company_id: CO }, { id: 'sup-2', code: '405-L001', name: 'LANDLORD', company_id: CO }],
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
  const AR_ROW = { docNo: 'IV-00123', debtorName: 'Ah Meng', debtorCode: '300-A001', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 50_000 };

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
    await importOpeningReceivables(sb, CO, [{ docNo: 'IV-1', debtorName: 'A', debtorCode: '300-A001', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 50_000 }], ACTOR);
    await importOpeningPayables(sb, CO, [{ docNo: 'PI-1', supplierCode: '400-T001', invoiceDate: '2026-10-01', dueDate: '2026-10-31', outstandingSen: 20_000 }], ACTOR);

    const r = await openingCheck(sb, CO);
    expect(r).toMatchObject({ ok: true, openingDay: '2026-11-30', trialDebitSen: 150_000, trialCreditSen: 150_000, balanced: false });
    expect(r.ok && r.controls).toEqual([
      { role: 'AR', accountCode: '300-0000', controlSen: 50_000, documentsSen: 50_000, erpDocuments: 0 },
      { role: 'AP', accountCode: '400-0000', controlSen: 30_000, documentsSen: 20_000, erpDocuments: 0 },
      { role: 'AP_OTHER', accountCode: '405-0000', controlSen: 0, documentsSen: 0, erpDocuments: 0 },
    ]);
    expect(r.ok && r.banks).toEqual([{ accountCode: '310-0001', name: 'Acct 310-0001', balanceSen: 100_000 }]);

    await importOpeningPayables(sb, CO, [{ docNo: 'PI-2', supplierCode: '400-T001', invoiceDate: '2026-10-02', dueDate: '2026-11-01', outstandingSen: 10_000 }], ACTOR);
    expect(await openingCheck(sb, CO)).toMatchObject({ balanced: true });
  });
});

describe('the opening routes', () => {
  async function call(perms: string[], path: string, body?: unknown) {
    const { Hono } = await import('hono');
    const routes = await import('../scm/routes/accounting');
    const sb = world();
    type Ctx = Parameters<typeof routes.openingCheckHandler>[0];
    const app = new Hono<{ Variables: { supabase: unknown; companyId: number; user: { id: string }; houzsUser: { name: string; permissions_set: string[] } } }>();
    app.use('*', async (c, next) => {
      c.set('supabase', sb);
      c.set('companyId', CO);
      c.set('user', { id: ACTOR });
      c.set('houzsUser', { name: 'Finance', permissions_set: perms });
      await next();
    });
    // The handlers are typed for the engine's full context; this app carries the four values they read.
    app.post('/opening/journal', (c) => routes.openingJournalHandler(c as unknown as Ctx));
    app.post('/opening/receivables', (c) => routes.openingReceivablesHandler(c as unknown as Ctx));
    app.get('/opening/check', (c) => routes.openingCheckHandler(c as unknown as Ctx));
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
      rows: [{ docNo: 'IV-9', debtorName: 'A', debtorCode: '300-A001', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 1_000 }],
    });
    expect(r.body).toEqual({ created: 1, skipped: 0, errors: [] });
    expect(r.sb.tables.sales_invoices[0]).toMatchObject({ created_by: ACTOR });
  });
});

describe('the opening check, other cases', () => {
  function withGl(sb: ReturnType<typeof world>) {
    const byId = new Map(sb.tables.journal_entries.map((j) => [j.id, j]));
    sb.tables.v_gl_entries = sb.tables.journal_entry_lines.map((l) => {
      const je = byId.get(l.journal_entry_id)!;
      return {
        ...l, company_id: CO, entry_date: je.entry_date, posted: je.posted ?? true, reversed: je.reversed ?? false, reversed_by_je: je.reversed_by_je ?? null,
        account_name: l.account_code, account_type: 'ASSET',
      };
    });
  }

  test('a 405- supplier\'s bills are checked against the other creditors control', async () => {
    const sb = world();
    sb.tables.accounts.push({ ...CHART[2], account_code: '405-0000' });
    await importOpeningJournal(sb, CO, [
      { accountCode: '310-0001', debitSen: 10_000, creditSen: 0 }, { accountCode: '405-0000', debitSen: 0, creditSen: 10_000 },
    ], 'T');
    withGl(sb);
    await importOpeningPayables(sb, CO, [{ docNo: 'L-1', supplierCode: '405-L001', invoiceDate: '2026-11-01', dueDate: '2026-11-30', outstandingSen: 10_000 }], ACTOR);
    const r = await openingCheck(sb, CO);
    expect(r.ok && r.controls.find((c) => c.role === 'AP_OTHER')).toMatchObject({ controlSen: 10_000, documentsSen: 10_000 });
    expect(r.ok && r.controls.find((c) => c.role === 'AP')).toMatchObject({ controlSen: 0, documentsSen: 0 });
    expect(r).toMatchObject({ balanced: true });
  });

  test('an invoice raised in the ERP before the start is not imported again, and counts in the check at what is still owed', async () => {
    const sb = world({ sales_invoices: [{
      id: 'si-erp', invoice_number: 'HC-SI-2611-0001', linked_ac_docno: 'IV-77', company_id: CO, status: 'SENT',
      invoice_date: '2026-11-20', total_sen: 8_000, paid_sen: 3_000, opening_balance: false, migrated_no_stock: false,
    }] });
    const r = await importOpeningReceivables(sb, CO, [{ docNo: 'IV-77', debtorName: 'A', debtorCode: '300-A001', invoiceDate: '2026-11-20', dueDate: '2026-12-20', outstandingSen: 5_000 }], ACTOR);
    expect(r.created).toBe(0);
    expect(r.errors[0].error).toMatch(/HC-SI-2611-0001/);
    const c = await openingCheck(sb, CO);
    expect(c.ok && c.controls[0]).toMatchObject({ role: 'AR', documentsSen: 5_000, erpDocuments: 1 });
  });

  test('a customer code is required: payments name the customer by it', async () => {
    const sb = world();
    const r = await importOpeningReceivables(sb, CO, [{ docNo: 'IV-1', debtorName: 'A', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 1_000 }], ACTOR);
    expect(r.errors[0].error).toMatch(/customer code/);
  });

  test('a start date moved after the import shows: the journal is not on the opening day', async () => {
    const sb = world();
    await importOpeningJournal(sb, CO, BALANCED, 'T');
    sb.tables.acc_company_settings[0].ledger_start_date = '2027-01-01';
    const r = await openingCheck(sb, CO);
    expect(r).toMatchObject({ openingDay: '2026-12-31', openingJeDate: '2026-11-30', balanced: false });
  });

  test('every read pages past the row ceiling', async () => {
    const sups = Array.from({ length: 1_005 }, (_, i) => ({ id: `s-${i}`, code: `400-S${String(i).padStart(4, '0')}`, name: 'S', company_id: CO }));
    const tables = {
      accounts: CHART.map((a) => ({ ...a })), acc_account_roles: [], journal_entries: [], journal_entry_lines: [],
      acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8 }],
      sales_invoices: [], purchase_invoices: [], suppliers: sups,
    };
    const { fakeSb: make } = await import('../scm/lib/fake-postgrest');
    const sb = make(tables, {}, [], [], 1_000);
    const r = await importOpeningPayables(sb, CO, [{ docNo: 'B-1', supplierCode: '400-S1004', invoiceDate: '2026-11-01', dueDate: '2026-11-30', outstandingSen: 100 }], ACTOR);
    expect(r).toEqual({ created: 1, skipped: 0, errors: [] });
  });
});
