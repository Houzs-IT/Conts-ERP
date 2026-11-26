/* Outside cleaning jobs billed and paid from Property OS (chew, 26 Nov 2026). Pinned:
     · an invoice is issued at once on 300-C002 CLEANING CUSTOMER with the client's own name, one line per job, and
       posts Dr 300-C002 / Cr 570-0000 (the CLEANING group's income), as AutoCount booked these clients;
     · the same jobs sent again answer with the invoice already made; field staff are refused; without finance's set-up
       nothing is made;
     · a payment waits for finance: it is recorded with a draft receipt and posts nothing; a transfer needs its slip;
       no payment takes more than the invoice has open (one customer holds every client). */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { myClaimsRouter } from './my-claims-routes';
import { cleaningLines } from './cleaning-billing';
import type { Staff } from './staff-identity';
/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they test */

const CO = 1;
const YJ: Staff = { userId: '0b6c2c9e-1111-4a1a-9a1a-000000000001', name: 'YJ', email: 'yj@x', departmentId: 'clean', side: 'conts', role: 'operations_staff', field: false };
const CLEANER: Staff = { userId: '0b6c2c9e-1111-4a1a-9a1a-000000000002', name: 'Siti', email: 's@x', departmentId: 'clean', side: 'conts', role: 'housekeeper', field: true };
const acct = (code: string, type: string, special: string | null = null): Row => ({
  company_id: CO, account_code: code, account_name: code, account_type: type, parent_code: null, is_active: true, special_type: special,
});
const world = (over: Record<string, Row[]> = {}) => fakeSb({
  accounts: [acct('300-0000', 'ASSET', 'SDC'), acct('310-0010', 'ASSET'), acct('570-0000', 'INCOME'), acct('670-0000', 'EXPENSE'), acct('510-0000', 'INCOME'), acct('690-0010', 'EXPENSE')],
  companies: [{ id: CO, code: 'HOUZS', name: 'THE CONTS' }],
  acc_account_roles: [], acc_acquirers: [], acc_company_settings: [], acc_bank_letters: [], acc_numbering: [],
  acc_item_group_accounts: [{ company_id: CO, group_code: 'CLEANING', sales_account: '570-0000', purchase_account: '670-0000', sales_return_account: '510-0000', purchase_return_account: '690-0010' }],
  debtors: [{ id: 'd-c002', company_id: CO, code: '300-C002', name: 'CLEANING CUSTOMER', control_account: '300-0000', is_active: true }],
  mfg_sales_orders: [], sales_invoices: [], sales_invoice_items: [], sales_invoice_payments: [], acc_official_receipts: [],
  journal_entries: [], journal_entry_lines: [], customer_credits: [], customer_credit_applications: [],
  ...over,
}, {}, [], ['journal_entry_lines']);

const bucket = () => { const m = new Map<string, ArrayBuffer>(); return { m, put: async (k: string, v: ArrayBuffer) => { m.set(k, v); }, get: async (k: string) => (m.has(k) ? { body: m.get(k) } : null) }; };
const appFor = (sb: ReturnType<typeof world>, staff: Staff) => {
  const a = new Hono<{ Variables: Record<string, unknown> }>();
  a.use('*', async (c, next) => { c.set('supabase', sb); c.set('companyId', CO); c.set('companyCode', 'HOUZS'); c.set('staff', staff); await next(); });
  a.route('/', myClaimsRouter('forward'));
  return a;
};
const call = (a: Hono<any>, method: string, path: string, body?: unknown) =>
  a.request(path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }, { SLIPS: bucket() });

const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const BILL = {
  key: 'cln-abcdef123456', customerName: 'MS WONG', phone: '0123456789', address: 'No 5, Jalan Ampang', invoiceDate: today,
  lines: [
    { taskId: 't-1', day: today, description: 'Deep clean, No 5 Jalan Ampang', amountSen: 35_000 },
    { taskId: 't-2', day: today, description: 'Basic clean, No 5 Jalan Ampang', amountSen: 13_000 },
  ],
};
const lines = (sb: ReturnType<typeof world>) => (sb.tables.journal_entry_lines as Row[]).map((l) => ({ code: l.account_code, dr: Number(l.debit_sen), cr: Number(l.credit_sen) }));

describe('billing outside cleaning jobs', () => {
  test('one invoice on 300-C002 with the client\'s name, a line per job, posting Dr 300-C002 / Cr 570-0000', async () => {
    const sb = world();
    const r = await call(appFor(sb, YJ), 'POST', '/cleaning-invoices', BILL);
    expect(r.status).toBe(201);
    const { invoice } = await r.json() as any;
    expect(invoice).toMatchObject({ customerName: 'MS WONG', totalSen: 48_000, outstandingSen: 48_000, status: 'SENT' });
    expect(invoice.invoiceNo).toMatch(/SI-\d{4}-\d{3}$/);
    expect(invoice.lines.map((l: any) => [l.taskIds, l.amountSen])).toEqual([[['t-1'], 35_000], [['t-2'], 13_000]]);
    expect(invoice.lump).toBe(false);
    expect((sb.tables.sales_invoices as Row[])[0]).toMatchObject({ debtor_code: '300-C002', ref: 'CLEANING', created_by: YJ.userId });
    expect(lines(sb).sort((a, b) => a.code.localeCompare(b.code))).toEqual([{ code: '300-0000', dr: 48_000, cr: 0 }, { code: '570-0000', dr: 0, cr: 48_000 }]);
  });

  test('the same jobs sent again answer with that invoice; field staff are refused', async () => {
    const sb = world();
    await call(appFor(sb, YJ), 'POST', '/cleaning-invoices', BILL);
    const again = await call(appFor(sb, YJ), 'POST', '/cleaning-invoices', BILL);
    expect(again.status).toBe(200);
    expect((sb.tables.sales_invoices as Row[]).length).toBe(1);
    expect((await call(appFor(sb, CLEANER), 'POST', '/cleaning-invoices', { ...BILL, key: 'cln-other-0000001' })).status).toBe(403);
  });

  test('without the CLEANING income account nothing is made', async () => {
    const sb = world({ acc_item_group_accounts: [] });
    const r = await call(appFor(sb, YJ), 'POST', '/cleaning-invoices', BILL);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'not_set_up' });
    expect((sb.tables.sales_invoices as Row[]).length).toBe(0);
  });

  test('lines: a job twice, no amount or no day are refused', () => {
    expect(cleaningLines([]).ok).toBe(false);
    expect(cleaningLines([BILL.lines[0], BILL.lines[0]])).toMatchObject({ ok: false, message: 'A job is on the invoice twice.' });
    expect(cleaningLines([{ ...BILL.lines[0], amountSen: 0 }]).ok).toBe(false);
    expect(cleaningLines([{ ...BILL.lines[0], day: '' }]).ok).toBe(false);
  });
});

describe('recording what the client paid', () => {
  const billed = async () => {
    const sb = world();
    const a = appFor(sb, YJ);
    const { invoice } = await (await call(a, 'POST', '/cleaning-invoices', BILL)).json() as any;
    return { sb, a, id: invoice.id as string };
  };

  test('a cash payment waits for finance: a draft receipt, nothing posted', async () => {
    const { sb, a, id } = await billed();
    const before = (sb.tables.journal_entry_lines as Row[]).length;
    const r = await call(a, 'POST', `/cleaning-invoices/${id}/payments`, { paidAt: today, method: 'cash', amountSen: 20_000 });
    expect(r.status).toBe(201);
    const { invoice } = await r.json() as any;
    expect(invoice).toMatchObject({ recordedSen: 20_000, confirmedSen: 0, outstandingSen: 28_000 });
    expect(invoice.payments[0]).toMatchObject({ method: 'cash', amountSen: 20_000, confirmed: false });
    expect((sb.tables.journal_entry_lines as Row[]).length).toBe(before);
  });

  test('a transfer needs its slip; more than is open is refused', async () => {
    const { a, id } = await billed();
    expect((await call(a, 'POST', `/cleaning-invoices/${id}/payments`, { paidAt: today, method: 'transfer', amountSen: 1_000 })).status).toBe(422);
    const over = await call(a, 'POST', `/cleaning-invoices/${id}/payments`, { paidAt: today, method: 'cash', amountSen: 48_001 });
    expect(over.status).toBe(409);
    const ok = await call(a, 'POST', `/cleaning-invoices/${id}/payments`, { paidAt: today, method: 'transfer', amountSen: 48_000, slip: { name: 's.png', mime: 'image/png', dataBase64: btoa('png') } });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as any).invoice.payments[0]).toMatchObject({ hasSlip: true, amountSen: 48_000 });
  });
});

describe('a package and an invoice that follows its jobs (chew, 27 Nov 2026)', () => {
  const made = async (body: Record<string, unknown> = BILL) => {
    const sb = world();
    const a = appFor(sb, YJ);
    const { invoice } = await (await call(a, 'POST', '/cleaning-invoices', body)).json() as any;
    return { sb, a, invoice };
  };
  const ar = (sb: ReturnType<typeof world>) => (sb.tables.journal_entry_lines as Row[]).filter((l) => l.account_code === '300-0000')
    .reduce((n, l) => n + Number(l.debit_sen) - Number(l.credit_sen), 0);

  test('a lump sum is one line for every job, booked at its total', async () => {
    const { sb, invoice } = await made({ ...BILL, key: 'cln-lump-000000001', lump: true,
      lines: [{ taskIds: ['t-1', 't-2', 't-3'], day: today, description: 'Cleaning services, 3 jobs', amountSen: 120_000 }] });
    expect(invoice).toMatchObject({ lump: true, totalSen: 120_000 });
    expect(invoice.lines).toEqual([expect.objectContaining({ taskIds: ['t-1', 't-2', 't-3'], amountSen: 120_000 })]);
    expect(ar(sb)).toBe(120_000);
  });

  test('a job added raises the invoice and the books follow, same number', async () => {
    const { sb, a, invoice } = await made();
    const r = await call(a, 'POST', `/cleaning-invoices/${invoice.id}/revise`, { lines: [...BILL.lines, { taskId: 't-3', day: today, description: 'Basic clean', amountSen: 13_000 }] });
    expect(r.status).toBe(200);
    const after = ((await r.json()) as any).invoice;
    expect(after).toMatchObject({ invoiceNo: invoice.invoiceNo, totalSen: 61_000 });
    expect(ar(sb)).toBe(61_000);
  });

  test('never below what is paid; with no job left it is cancelled, unless it has payments', async () => {
    const { sb, a, invoice } = await made();
    await call(a, 'POST', `/cleaning-invoices/${invoice.id}/payments`, { paidAt: today, method: 'cash', amountSen: 40_000 });
    const low = await call(a, 'POST', `/cleaning-invoices/${invoice.id}/revise`, { lines: [BILL.lines[0]] });
    expect(low.status).toBe(409);
    expect((await call(a, 'POST', `/cleaning-invoices/${invoice.id}/revise`, { lines: [] })).status).toBe(409);

    const other = await made({ ...BILL, key: 'cln-other-0000002' });
    const gone = await call(other.a, 'POST', `/cleaning-invoices/${other.invoice.id}/revise`, { lines: [] });
    expect(((await gone.json()) as any).invoice.status).toBe('CANCELLED');
    expect(ar(other.sb)).toBe(0);
    expect(ar(sb)).toBe(48_000);
  });
});
