/* Opening balances (Conts, finance phase 1, spec 3.8): the one OPENING journal from AutoCount's trial balance, the
   invoices and bills still open on the day before the books start, and the check that the two agree. */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import {
  cutoverDocuments, importOpeningJournal, importOpeningPayables, importOpeningReceivables, openingCheck, reverseOpeningJournal,
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
    sales_invoices: [], purchase_invoices: [], ap_invoices: [], customer_credits: [], payment_vouchers: [], acc_supplier_advances: [],
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

describe('a minus on the ageing: money paid ahead (chew, 17 Nov 2026)', () => {
  test("a customer's minus is a credit they spend later, dated as AutoCount had it; once only", async () => {
    const sb = world();
    const rows = [
      { docNo: 'IV-1', debtorName: 'Ah Meng', debtorCode: '300-A001', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 50_000 },
      { docNo: 'OR-003163', debtorName: 'Ah Meng', debtorCode: '300-A001', invoiceDate: '2026-04-10', dueDate: '2026-04-10', outstandingSen: -58_200 },
    ];
    expect(await importOpeningReceivables(sb, CO, rows, ACTOR)).toEqual({ created: 2, skipped: 0, errors: [] });
    expect(sb.tables.sales_invoices).toHaveLength(1);
    expect(sb.tables.customer_credits).toEqual([expect.objectContaining({
      company_id: CO, debtor_code: '300-A001', amount_sen: 58_200, source_type: 'OPENING', source_doc_no: 'OR-003163', entry_date: '2026-04-10',
    })]);
    expect(await importOpeningReceivables(sb, CO, rows, ACTOR)).toEqual({ created: 0, skipped: 2, errors: [] });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
  test("a supplier's minus is an opening voucher, posting nothing, holding an advance for their later bills; once only", async () => {
    const sb = world();
    const rows = [
      { docNo: 'IN-01728', supplierCode: '400-T001', invoiceDate: '2026-08-02', dueDate: '2026-08-02', outstandingSen: 23_000 },
      { docNo: 'HPV-2507-149', supplierCode: '400-T001', invoiceDate: '2025-07-29', dueDate: '2025-07-29', outstandingSen: -413_600 },
    ];
    expect(await importOpeningPayables(sb, CO, rows, ACTOR)).toEqual({ created: 2, skipped: 0, errors: [] });
    const [pv] = sb.tables.payment_vouchers;
    expect(pv).toMatchObject({ pv_number: 'OB-HPV-2507-149', supplier_id: 'sup-1', status: 'POSTED', opening_balance: true, total_sen: 413_600,
      voucher_date: '2025-07-29', payee_name: 'TODERN', credit_account_code: '400-0000' });
    expect(sb.tables.acc_supplier_advances).toEqual([expect.objectContaining({ pv_id: pv!.id, supplier_id: 'sup-1', amount_sen: 413_600, applied_sen: 0 })]);
    expect(await importOpeningPayables(sb, CO, rows, ACTOR)).toEqual({ created: 0, skipped: 2, errors: [] });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
  test('zero is still refused', async () => {
    const sb = world();
    const r = await importOpeningPayables(sb, CO, [{ docNo: 'X', supplierCode: '400-T001', invoiceDate: '2026-08-02', dueDate: '2026-08-02', outstandingSen: 0 }], ACTOR);
    expect(r.errors[0]!.error).toContain('zero');
  });
  test('the check nets what was paid ahead off each control', async () => {
    const sb = world();
    await importOpeningJournal(sb, CO, BALANCED, ACTOR);
    const je = sb.tables.journal_entries[0];
    sb.tables.v_gl_entries = sb.tables.journal_entry_lines.map((l) => ({
      ...l, company_id: CO, entry_date: je.entry_date, posted: true, reversed: false, reversed_by_je: null,
      account_name: l.account_code, account_type: CHART.find((a) => a.account_code === l.account_code)!.account_type,
    }));
    await importOpeningReceivables(sb, CO, [
      { docNo: 'IV-1', debtorName: 'A', debtorCode: '300-A001', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 60_000 },
      { docNo: 'OR-1', debtorName: 'A', debtorCode: '300-A001', invoiceDate: '2026-10-06', dueDate: '2026-10-06', outstandingSen: -10_000 },
    ], ACTOR);
    await importOpeningPayables(sb, CO, [
      { docNo: 'PI-1', supplierCode: '400-T001', invoiceDate: '2026-10-01', dueDate: '2026-10-31', outstandingSen: 35_000 },
      { docNo: 'PV-1', supplierCode: '400-T001', invoiceDate: '2026-10-02', dueDate: '2026-10-02', outstandingSen: -5_000 },
    ], ACTOR);
    const r = await openingCheck(sb, CO);
    expect(r.ok && r.controls.slice(0, 2)).toEqual([
      { role: 'AR', accountCode: '300-0000', controlSen: 50_000, documentsSen: 50_000, erpDocuments: 0, unbilledContractsSen: 0 },
      { role: 'AP', accountCode: '400-0000', controlSen: 30_000, documentsSen: 30_000, erpDocuments: 0, unbilledContractsSen: 0 },
    ]);
    expect(r).toMatchObject({ balanced: true });
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
      { role: 'AR', accountCode: '300-0000', controlSen: 50_000, documentsSen: 50_000, erpDocuments: 0, unbilledContractsSen: 0 },
      { role: 'AP', accountCode: '400-0000', controlSen: 30_000, documentsSen: 20_000, erpDocuments: 0, unbilledContractsSen: 0 },
      { role: 'AP_OTHER', accountCode: '405-0000', controlSen: 0, documentsSen: 0, erpDocuments: 0, unbilledContractsSen: 0 },
    ]);
    expect(r.ok && r.banks).toEqual([{ accountCode: '310-0001', name: 'Acct 310-0001', balanceSen: 100_000 }]);

    await importOpeningPayables(sb, CO, [{ docNo: 'PI-2', supplierCode: '400-T001', invoiceDate: '2026-10-02', dueDate: '2026-11-01', outstandingSen: 10_000 }], ACTOR);
    expect(await openingCheck(sb, CO)).toMatchObject({ balanced: true });
  });

  test("the ERP's own bills count; an invoice settled from its deposit owes nothing; a contract's unbilled part is shown", async () => {
    const sb = world();
    await importOpeningJournal(sb, CO, BALANCED, ACTOR);
    const je = sb.tables.journal_entries[0];
    const gl = (l: Row, type = 'OPENING', doc: string | null = null) => ({ ...l, company_id: CO, entry_date: je.entry_date, posted: true, reversed: false, reversed_by_je: null, source_type: type, source_doc_no: doc });
    sb.tables.v_gl_entries = sb.tables.journal_entry_lines.map((l) => gl(l));
    // A contract signed for 80,000 on 300-0000, its deposit invoice of 10,000 settled from the deposit (10,000 received).
    sb.tables.v_gl_entries.push(gl({ account_code: '300-0000', debit_sen: 80_000, credit_sen: 0 }, 'RCON', 'SO-1'));
    sb.tables.v_gl_entries.push(gl({ account_code: '300-0000', debit_sen: 0, credit_sen: 10_000 }, 'SOPAY', 'SO-1'));
    sb.tables.sales_invoices.push({ id: 'si-1', company_id: CO, invoice_number: 'SI-1', debtor_code: '300-A001', so_doc_no: 'SO-1', invoice_date: '2026-11-20',
      total_sen: 10_000, paid_sen: 0, status: 'PAID', opening_balance: false, migrated_no_stock: false });
    sb.tables.mfg_sales_orders = [{ doc_no: 'SO-1', company_id: CO, total_revenue_sen: 80_000, deposit_sen: 10_000 }];
    sb.tables.mfg_sales_order_payments = [{ so_doc_no: 'SO-1', amount_sen: 10_000, is_deposit: true }];
    sb.tables.ap_invoices.push({ id: 'ap-1', company_id: CO, supplier_id: 'sup-1', invoice_date: '2026-11-20', total_sen: 30_000, paid_sen: 0, status: 'POSTED' });
    await importOpeningReceivables(sb, CO, [{ docNo: 'IV-1', debtorName: 'A', debtorCode: '300-A001', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 50_000 }], ACTOR);

    const r = await openingCheck(sb, CO);
    expect(r.ok && r.controls.slice(0, 2)).toEqual([
      { role: 'AR', accountCode: '300-0000', controlSen: 120_000, documentsSen: 50_000, erpDocuments: 1, unbilledContractsSen: 70_000 },
      { role: 'AP', accountCode: '400-0000', controlSen: 30_000, documentsSen: 30_000, erpDocuments: 1, unbilledContractsSen: 0 },
    ]);
    expect(r).toMatchObject({ balanced: true });
  });
});

describe('money the ERP took on orders before the cut-over (chew, 23 Nov 2026)', () => {
  test('a payment recorded on an order in the ERP counts against the documents; one that settled an ERP invoice does not twice', async () => {
    const sb = world();
    await importOpeningJournal(sb, CO, BALANCED, ACTOR);
    const je = sb.tables.journal_entries[0];
    const gl = (l: Row, type = 'OPENING', doc: string | null = null) => ({ ...l, company_id: CO, entry_date: je.entry_date, posted: true, reversed: false, reversed_by_je: null, source_type: type, source_doc_no: doc });
    sb.tables.v_gl_entries = sb.tables.journal_entry_lines.map((l) => gl(l));
    /* AutoCount's open invoice of 50,000, and 15,000 the ERP took on order SO-2 with no invoice yet. */
    sb.tables.v_gl_entries.push(gl({ account_code: '300-0000', debit_sen: 0, credit_sen: 15_000 }, 'SOPAY', 'pay-2'));
    await importOpeningReceivables(sb, CO, [{ docNo: 'IV-1', debtorName: 'A', debtorCode: '300-A001', invoiceDate: '2026-10-05', dueDate: '2026-11-04', outstandingSen: 50_000 }], ACTOR);
    const r = await openingCheck(sb, CO);
    expect(r.ok && r.controls[0]).toMatchObject({ accountCode: '300-0000', controlSen: 35_000, documentsSen: 35_000 });
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

/* Conts (finance phase 1.5): customers and suppliers on their own controls are checked control by control. */
describe('the opening check, control by control', () => {
  test('an opening invoice of a 301 customer is checked against 301-0000', async () => {
    const sb = world({
      debtors: [{ id: 'd1', company_id: CO, code: '301-M001', name: 'MS LEE', control_account: '301-0000', is_active: true }],
    });
    sb.tables.accounts.push({ ...CHART[0], account_code: '301-0000', special_type: 'SDC' });
    await importOpeningJournal(sb, CO, [
      { accountCode: '310-0001', debitSen: 0, creditSen: 50_000 }, { accountCode: '301-0000', debitSen: 50_000, creditSen: 0 },
    ], 'T');
    const je = sb.tables.journal_entries[0];
    sb.tables.v_gl_entries = sb.tables.journal_entry_lines.map((l) => ({
      ...l, company_id: CO, entry_date: je.entry_date, posted: true, reversed: false, reversed_by_je: null, account_name: l.account_code, account_type: 'ASSET',
    }));
    await importOpeningReceivables(sb, CO, [{ docNo: 'IV-9', debtorName: 'MS LEE', debtorCode: '301-M001', invoiceDate: '2026-11-01', dueDate: '2026-11-30', outstandingSen: 50_000 }], ACTOR);
    const r = await openingCheck(sb, CO);
    expect(r.ok && r.controls.find((x) => x.accountCode === '301-0000')).toMatchObject({ role: 'AR', controlSen: 50_000, documentsSen: 50_000 });
    expect(r.ok && r.controls.find((x) => x.accountCode === '300-0000')).toMatchObject({ controlSen: 0, documentsSen: 0 });
    expect(r).toMatchObject({ balanced: true });
  });
});

describe('the documents cut-over (chew, 17 Nov 2026)', () => {
  const docsWorld = () => world({ sales_invoice_payments: [], pv_allocations: [] }, '2026-09-01');
  test('a dry run says what it would do and changes nothing; the run removes the untouched opening documents and takes the new day', async () => {
    const sb = docsWorld();
    sb.tables.acc_company_settings[0]!.documents_cutover_date = null;
    await importOpeningReceivables(sb, CO, [
      { docNo: 'IV-1', debtorName: 'A', debtorCode: '300-A001', invoiceDate: '2026-08-05', dueDate: '2026-08-05', outstandingSen: 50_000 },
      { docNo: 'IV-2', debtorName: 'A', debtorCode: '300-A001', invoiceDate: '2026-08-06', dueDate: '2026-08-06', outstandingSen: 10_000 },
    ], ACTOR);
    await importOpeningPayables(sb, CO, [
      { docNo: 'PI-1', supplierCode: '400-T001', invoiceDate: '2026-08-01', dueDate: '2026-08-31', outstandingSen: 20_000 },
      { docNo: 'PV-9', supplierCode: '400-T001', invoiceDate: '2026-08-02', dueDate: '2026-08-02', outstandingSen: -5_000 },
    ], ACTOR);
    /* IV-2 was paid in the ERP: it stays. */
    const iv2 = sb.tables.sales_invoices.find((x) => x.invoice_number === 'IV-2')!;
    sb.tables.sales_invoice_payments.push({ id: 'p1', sales_invoice_id: iv2.id });
    const ar = [{ docNo: 'IV-30', debtorName: 'A', debtorCode: '300-A001', invoiceDate: '2026-10-20', dueDate: '2026-10-20', outstandingSen: 7_000 }];
    const ap = [{ docNo: 'PI-40', supplierCode: '400-T001', invoiceDate: '2026-11-10', dueDate: '2026-11-30', outstandingSen: 3_000 }];
    const dry = await cutoverDocuments(sb, CO, '2026-11-16', ar, ap, ACTOR, true);
    expect(dry).toMatchObject({ done: false, remove: { invoices: 1, credits: 0, bills: 1, advances: 1 }, kept: [{ docNo: 'IV-2' }], incoming: { receivables: 1, payables: 1 } });
    expect(sb.tables.sales_invoices).toHaveLength(2);
    const run = await cutoverDocuments(sb, CO, '2026-11-16', ar, ap, ACTOR, false);
    expect(run).toMatchObject({ done: true, receivables: { created: 1, errors: [] }, payables: { created: 1, errors: [] } });
    expect(sb.tables.sales_invoices.map((x) => x.invoice_number).sort()).toEqual(['IV-2', 'IV-30']);
    expect(sb.tables.purchase_invoices.map((x) => x.invoice_number)).toEqual(['PI-40']);
    expect(sb.tables.payment_vouchers).toHaveLength(0);
    expect(sb.tables.acc_supplier_advances).toHaveLength(0);
    expect(sb.tables.acc_company_settings[0]!.documents_cutover_date).toBe('2026-11-16');
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
  test('a cut-over not after the opening day is refused', async () => {
    const sb = docsWorld();
    expect(await cutoverDocuments(sb, CO, '2026-08-31', [], [], ACTOR, true)).toMatchObject({ ok: false });
  });
});
