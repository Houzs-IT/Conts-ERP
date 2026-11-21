/* The formal AR / AP aging from the books (ported from Houzs tests/accountingAging.test.ts on 21 Nov 2026, adapted to
   Conts), on the real handlers over fake PostgREST. Pinned:
     AR  an order's money pays the order's own invoices; a deposit on an order not invoiced yet is 未冲, not spent on
         another order's bill; a deposit invoice and the credit note that closes it net away; money moved off a
         cancelled order lands on the order it went to; a refund nets with the payment it gives back; an Other Debtor
         receipt knocks off the bill it is allocated to and the rest is 未冲; a line coded with an order's customer id
         is the debtor carrying that id; the rows add up to every customer control (SDC);
     Conts  the OPENING journal is replaced by the opening invoices and credits it stands for, and what they do not
         explain stays one unsplit line; a renovation contract and its change belong to the contract's order; a note
         joins the order its header names; a line no paper names pays its party's other unnamed lines; one control,
         trade / other, one department;
     AP  a voucher's ticks knock off the bills they name; an advance applied later counts from that day; a supplier
         credit note joins the bill it names; a voucher applied to nothing is 未冲; a foreign bill's tick turns into
         ringgit at its rate; an opening bill and an opening advance stand in for the OPENING line; the rows add up
         to every supplier control (SCC); migrated bills are counted apart;
     both: lines after the as-at date are not there; by due date; by days. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { apAgingHandler, arAgingHandler } from '../src/conts/aging-routes';

const CO = 2;
let seq = 0;
const gl = (code: string, type: string, doc: string, date: string, dr: number, cr: number, party: string | null = null, over: Row = {}): Row => ({
  line_id: ++seq, je_no: `JE-${seq}`, entry_date: date, source_type: type, source_doc_no: doc, account_code: code,
  party_type: party ? 'CUSTOMER' : null, party_code: party, party_name: party, debit_sen: dr, credit_sen: cr,
  posted: true, reversed: false, reversed_by_je: null, company_id: CO, department: 'supply', ...over,
});

function app(tables: Record<string, Row[]>) {
  const sb = fakeSb({ acc_account_roles: [], ...tables });
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('user' as never, { id: 'u1' } as never);
    await next();
  });
  a.get('/ar-aging', arAgingHandler as never);
  a.get('/ap-aging', apAgingHandler as never);
  return a;
}

const account = (code: string, name: string, special: 'SDC' | 'SCC'): Row => ({ company_id: CO, account_code: code, account_name: name, special_type: special });

/* ── AR ─────────────────────────────────────────────────────────────────── */
const AR = (): Record<string, Row[]> => ({
  accounts: [
    account('300-0000', 'TRADE DEBTORS', 'SDC'), account('301-0000', 'RENOVATION CUSTOMER', 'SDC'), account('305-0000', 'OTHER DEBTORS', 'SDC'),
  ],
  debtors: [
    { id: 'dc-1', company_id: CO, code: 'C-1', name: 'ALI', customer_id: 'cust-1', control_account: '300-0000' },
    { id: 'dc-2', company_id: CO, code: '301-B001', name: 'BEE', customer_id: 'cust-2', control_account: '301-0000' },
  ],
  v_gl_entries: [
    /* SO-A: deposit 500, invoice 1,200 in August, balance 300 — owes 400. */
    gl('300-0000', 'SOPAY', 'pay-a1', '2026-07-05', 0, 500, 'C-1'),
    gl('300-0000', 'SI', 'SI-A1', '2026-08-10', 1_200, 0, 'C-1'),
    gl('300-0000', 'SOPAY', 'pay-a2', '2026-08-20', 0, 300, 'C-1'),
    /* SO-B: a deposit on an order not invoiced yet, plus 200 moved in from SO-D. */
    gl('300-0000', 'SOPAY', 'pay-b1', '2026-09-15', 0, 1_000, 'C-1'),
    gl('300-0000', 'SOPAY', 'pay-d1', '2026-07-01', 0, 200, 'C-1'),
    gl('300-0000', 'SOCONV', 'pay-b2', '2026-07-15', 200, 0, 'C-1'),
    gl('300-0000', 'SOCONV', 'pay-b2', '2026-07-15', 0, 200, 'C-1'),
    /* SO-C (deposit invoices): DI + payment, the final invoice, the CN closing the DI — coded with the customer id. */
    gl('301-0000', 'DI', 'DI-C1', '2026-06-01', 300, 0, 'cust-2'),
    gl('301-0000', 'SOPAY', 'pay-c1', '2026-06-01', 0, 300, 'cust-2'),
    gl('301-0000', 'SI', 'SI-C1', '2026-06-20', 900, 0, 'cust-2'),
    gl('301-0000', 'CN', 'CN-C1', '2026-06-20', 0, 300, 'cust-2'),
    /* SO-E: paid, then refunded. */
    gl('301-0000', 'SOPAY', 'pay-e1', '2026-08-01', 0, 400, '301-B001'),
    gl('301-0000', 'PV', 'HRF-1', '2026-08-05', 400, 0, '301-B001'),
    /* After the as-at date. */
    gl('300-0000', 'SI', 'SI-F', '2026-10-05', 777, 0, 'C-1'),
    /* A reversed pair counts nowhere; a draft is not in the books. */
    gl('300-0000', 'SI', 'SI-X', '2026-09-01', 999, 0, 'C-1', { reversed: true }),
    gl('300-0000', 'SI', 'SI-Y', '2026-09-01', 555, 0, 'C-1', { posted: false }),
    /* Other debtors: a bill, a receipt part-allocated to it — no party on the lines. */
    gl('305-0000', 'ODB', 'ODB-1', '2026-09-01', 5_000, 0, null),
    gl('305-0000', 'ODR', 'ODR-1', '2026-09-10', 0, 3_000, null),
  ],
  mfg_sales_order_payments: [
    { id: 'pay-a1', company_id: CO, so_doc_no: 'SO-A' }, { id: 'pay-a2', company_id: CO, so_doc_no: 'SO-A' },
    { id: 'pay-b1', company_id: CO, so_doc_no: 'SO-B' }, { id: 'pay-d1', company_id: CO, so_doc_no: 'SO-D' },
    { id: 'pay-b2', company_id: CO, so_doc_no: 'SO-B', converted_from_so_doc_no: 'SO-D' },
    { id: 'pay-c1', company_id: CO, so_doc_no: 'SO-C' }, { id: 'pay-e1', company_id: CO, so_doc_no: 'SO-E' },
  ],
  sales_invoice_payments: [],
  sales_invoices: [
    { id: 'si-a1', company_id: CO, invoice_number: 'SI-A1', so_doc_no: 'SO-A', due_date: null, debtor_code: 'C-1', debtor_name: 'ALI', status: 'SENT', total_sen: 1_200, paid_sen: 0, migrated_no_stock: false },
    { id: 'si-c1', company_id: CO, invoice_number: 'SI-C1', so_doc_no: 'SO-C', due_date: '2026-07-20', debtor_code: null, debtor_name: 'BEE', status: 'SENT', total_sen: 900, paid_sen: 0, migrated_no_stock: false },
    { id: 'si-old', company_id: CO, invoice_number: 'SI-OLD', so_doc_no: 'SO-OLD', due_date: null, debtor_code: 'C-9', debtor_name: 'OLD', status: 'SENT', total_sen: 5_000, paid_sen: 1_000, migrated_no_stock: true },
  ],
  acc_deposit_invoices: [{ di_number: 'DI-C1', company_id: CO, so_doc_no: 'SO-C' }],
  acc_credit_notes: [{ id: 'n-c1', note_number: 'CN-C1', company_id: CO, kind: 'CN', so_doc_no: 'SO-C', sales_invoice_id: 'si-c1' }],
  payment_vouchers: [{ pv_number: 'HRF-1', company_id: CO, refund_source_type: 'SO', refund_source_doc_no: 'SO-E' }],
  acc_debtor_bills: [{ id: 'b-1', company_id: CO, bill_number: 'ODB-1', debtor_id: 'd-1' }],
  acc_debtor_receipts: [{ id: 'r-1', company_id: CO, receipt_number: 'ODR-1', debtor_id: 'd-1' }],
  acc_debtor_receipt_allocations: [{ id: 'ra-1', company_id: CO, receipt_id: 'r-1', bill_id: 'b-1', amount_sen: 2_000 }],
  acc_debtors: [{ id: 'd-1', company_id: CO, name: 'LANDLORD CO' }],
  customer_credits: [],
  mfg_sales_orders: [
    { doc_no: 'SO-A', company_id: CO, debtor_code: 'C-1', debtor_name: 'ALI', customer_id: 'cust-1' },
    { doc_no: 'SO-B', company_id: CO, debtor_code: 'C-1', debtor_name: 'ALI', customer_id: 'cust-1' },
    { doc_no: 'SO-D', company_id: CO, debtor_code: 'C-1', debtor_name: 'ALI', customer_id: 'cust-1' },
    { doc_no: 'SO-C', company_id: CO, debtor_code: null, debtor_name: 'BEE', customer_id: 'cust-2' },
    { doc_no: 'SO-E', company_id: CO, debtor_code: '301-B001', debtor_name: 'BEE', customer_id: 'cust-2' },
  ],
});

type Body = { rows: Row[]; totals: Row; controls: Row[]; differenceSen: number; outside: Row; opening: Row; accounts: Row[]; asOf: string };
const rowOf = (b: Body, name: string) => b.rows.find((r) => r.name === name)!;
const items = (r: Row) => (r.items as Row[]).map((i) => [i.docNo, i.openSen]);

describe('AR aging', () => {
  test('orders pay their own invoices; deposits on orders not invoiced are 未冲; it adds up to every customer control', async () => {
    const res = await app(AR()).request('/ar-aging?asOf=2026-09-30');
    expect(res.status).toBe(200);
    const b = await res.json() as Body;
    expect(rowOf(b, 'ALI')).toMatchObject({ key: 'C-1', code: 'C-1', balanceSen: -800, unappliedSen: -1_200, cells: [0, 400, 0, 0, 0] });
    expect(items(rowOf(b, 'ALI'))).toEqual([['SI-A1', 400]]);
    /* Lines coded with the order's customer id are the debtor that carries it. */
    expect(rowOf(b, 'BEE')).toMatchObject({ key: '301-B001', code: '301-B001', balanceSen: 600, unappliedSen: 0, cells: [0, 0, 0, 600, 0] });
    expect(rowOf(b, 'LANDLORD CO')).toMatchObject({ key: 'DEBTOR:d-1', balanceSen: 2_000, unappliedSen: -1_000, cells: [3_000, 0, 0, 0, 0] });
    expect(b.totals).toMatchObject({ balanceSen: 1_800 });
    expect(b.controls).toEqual([{ code: '300-0000', balanceSen: -800 }, { code: '301-0000', balanceSen: 600 }, { code: '305-0000', balanceSen: 2_000 }]);
    expect(b.differenceSen).toBe(0);
    expect(b.outside).toEqual({ count: 1, sen: 4_000 });
    expect(b.accounts.map((a) => [a.code, a.other])).toEqual([['300-0000', false], ['301-0000', false], ['305-0000', true]]);
  });

  test('the OPENING line is replaced by the opening invoices and credits; what they do not explain stays unsplit', async () => {
    const t = AR();
    t.v_gl_entries!.push(
      gl('300-0000', 'OPENING', 'OPENING', '2026-05-31', 7_000, 0, null),
      gl('300-0000', 'SIPAY', 'sip-1', '2026-09-05', 0, 2_000, 'C-1'),
    );
    t.sales_invoices!.push({ id: 'si-ob1', company_id: CO, invoice_number: 'AC-IV-1', so_doc_no: null, invoice_date: '2026-03-15', due_date: '2026-04-14',
      debtor_code: 'C-1', debtor_name: 'ALI', status: 'SENT', total_sen: 5_000, paid_sen: 2_000, opening_balance: true });
    t.sales_invoice_payments = [{ id: 'sip-1', company_id: CO, sales_invoice_id: 'si-ob1' }];
    t.customer_credits = [{ id: 'cc-1', company_id: CO, debtor_code: 'C-1', debtor_name: 'ALI', entry_date: '2026-04-01', amount_sen: 1_000, source_type: 'OPENING', source_doc_no: 'AC-CN-9' }];
    const b = await (await app(t).request('/ar-aging?asOf=2026-09-30')).json() as Body;
    /* AC-IV-1 owed 5,000, 2,000 paid in September: 3,000 from March, four months and more. */
    expect(items(rowOf(b, 'ALI'))).toEqual([['AC-IV-1', 3_000], ['SI-A1', 400]]);
    expect(rowOf(b, 'ALI')).toMatchObject({ balanceSen: 1_200, unappliedSen: -2_200, cells: [0, 400, 0, 0, 3_000] });
    expect((rowOf(b, 'ALI').unapplied as Row[]).find((u) => u.docNo === 'AC-CN-9')).toMatchObject({ kind: 'Opening credit', amountSen: -1_000 });
    expect(rowOf(b, 'Opening balance not split')).toMatchObject({ balanceSen: 3_000, cells: [0, 0, 0, 0, 3_000] });
    expect(b.opening).toEqual({ splitSen: 4_000, unsplitSen: 3_000 });
    expect(b.differenceSen).toBe(0);
    /* Before the opening day there is no OPENING line, and so no opening documents either. */
    const may = await (await app(t).request('/ar-aging?asOf=2026-05-30')).json() as Body;
    expect(may.rows).toEqual([]);
    expect(may.differenceSen).toBe(0);
  });

  test('a renovation contract and its change belong to the contract order, with its payments', async () => {
    const t = AR();
    t.v_gl_entries!.push(
      gl('301-0000', 'RCON', 'SO-R', '2026-07-01', 10_000, 0, '301-B001'),
      gl('301-0000', 'RVO', 'SO-R-2', '2026-08-01', 1_000, 0, '301-B001'),
      gl('301-0000', 'SOPAY', 'pay-r1', '2026-08-15', 0, 4_000, '301-B001'),
    );
    t.mfg_sales_order_payments!.push({ id: 'pay-r1', company_id: CO, so_doc_no: 'SO-R' });
    t.mfg_sales_orders!.push({ doc_no: 'SO-R', company_id: CO, debtor_code: '301-B001', debtor_name: 'BEE', customer_id: 'cust-2' });
    const b = await (await app(t).request('/ar-aging?asOf=2026-09-30&control=301-0000')).json() as Body;
    expect(items(rowOf(b, 'BEE'))).toEqual([['SI-C1', 600], ['SO-R', 6_000], ['SO-R-2', 1_000]]);
    expect((rowOf(b, 'BEE').items as Row[]).map((i) => [i.kind, i.group])).toEqual([['Invoice', 'SO:SO-C'], ['Contract', 'SO:SO-R'], ['Contract change', 'SO:SO-R']]);
    expect(b.controls).toEqual([{ code: '301-0000', balanceSen: 7_600 }]);
    expect(b.differenceSen).toBe(0);
  });

  test("a credit note joins the order its header names; one naming nothing waits in the customer's pool", async () => {
    const t = AR();
    t.v_gl_entries!.push(
      gl('300-0000', 'CN', 'CN-A8', '2026-09-12', 0, 100, 'C-1'),
      gl('300-0000', 'CN', 'CN-A9', '2026-09-12', 0, 50, 'C-1'),
    );
    t.acc_credit_notes!.push(
      { id: 'n-a8', company_id: CO, note_number: 'CN-A8', kind: 'CN', so_doc_no: 'SO-A', sales_invoice_id: null },
      { id: 'n-a9', company_id: CO, note_number: 'CN-A9', kind: 'CN', so_doc_no: null, sales_invoice_id: null },
    );
    const b = await (await app(t).request('/ar-aging?asOf=2026-09-30')).json() as Body;
    expect(items(rowOf(b, 'ALI'))).toEqual([['SI-A1', 300]]);
    expect((rowOf(b, 'ALI').unapplied as Row[]).find((u) => u.docNo === 'CN-A9')).toMatchObject({ kind: 'Credit note', amountSen: -50 });
    expect(b.differenceSen).toBe(0);
  });

  test('by due date, by days, one control, trade or other, one department, an earlier as-at day', async () => {
    const a = app(AR());
    const due = await (await a.request('/ar-aging?asOf=2026-09-30&basis=due')).json() as Body;
    expect(rowOf(due, 'BEE').cells).toEqual([0, 0, 600, 0, 0]);
    const days = await (await a.request('/ar-aging?asOf=2026-09-30&buckets=day')).json() as Body;
    expect(rowOf(days, 'ALI').cells).toEqual([0, 400, 0, 0, 0]);
    const other = await (await a.request('/ar-aging?asOf=2026-09-30&control=other')).json() as Body;
    expect(other.rows.map((r) => r.name)).toEqual(['LANDLORD CO']);
    expect(other.controls).toEqual([{ code: '305-0000', balanceSen: 2_000 }]);
    const trade = await (await a.request('/ar-aging?asOf=2026-09-30&control=trade')).json() as Body;
    expect(trade.controls.map((k) => k.code)).toEqual(['300-0000', '301-0000']);
    /* 31 August: SO-B's deposit and the bill were not there yet. */
    const aug = await (await a.request('/ar-aging?asOf=2026-08-31&control=300-0000')).json() as Body;
    expect(rowOf(aug, 'ALI')).toMatchObject({ balanceSen: 200, unappliedSen: -200, cells: [400, 0, 0, 0, 0] });
    expect(aug.differenceSen).toBe(0);
    const rental = await (await a.request('/ar-aging?asOf=2026-09-30&department=rental')).json() as Body;
    expect(rental.rows).toEqual([]);
    expect((await a.request('/ar-aging?asOf=31-08-2026')).status).toBe(400);
    expect((await a.request('/ar-aging?department=sales')).status).toBe(400);
    expect((await a.request('/ar-aging?control=400-0000')).status).toBe(400);
  });
});

/* ── AP ─────────────────────────────────────────────────────────────────── */
const SUP: Row = { party_type: 'SUPPLIER' };
const AP = (): Record<string, Row[]> => ({
  accounts: [account('400-0000', 'TRADE CREDITORS', 'SCC'), account('405-0000', 'OTHER CREDITORS', 'SCC')],
  v_gl_entries: [
    gl('400-0000', 'PI', 'PI-1', '2026-07-10', 0, 10_000, '400-B001', SUP),
    gl('400-0000', 'PV', 'PV-1', '2026-08-01', 6_000, 0, '400-B001', SUP),
    gl('400-0000', 'PI', 'PI-2', '2026-09-05', 0, 3_000, '400-B001', SUP),
    gl('400-0000', 'SCN', 'SCN-1', '2026-09-25', 500, 0, '400-B001', SUP),
    gl('405-0000', 'API', 'API-1', '2026-08-15', 0, 2_000, '405-H001', SUP),
    gl('405-0000', 'PV', 'PV-2', '2026-08-20', 2_000, 0, '405-H001', SUP),
    gl('400-0000', 'PI', 'PI-F', '2026-06-15', 0, 6_200, '400-F001', SUP),
    gl('400-0000', 'PV', 'PV-3', '2026-07-01', 3_100, 0, '400-F001', SUP),
    gl('400-0000', 'PI', 'PI-LATE', '2026-10-02', 0, 999, '400-B001', SUP),
  ],
  purchase_invoices: [
    { id: 'pi-1', company_id: CO, invoice_number: 'PI-1', due_date: '2026-08-09', exchange_rate: 1, status: 'PARTIALLY_PAID', total_sen: 10_000, paid_sen: 4_000, migrated_no_stock: false },
    { id: 'pi-2', company_id: CO, invoice_number: 'PI-2', due_date: null, exchange_rate: 1, status: 'PARTIALLY_PAID', total_sen: 3_000, paid_sen: 2_000, migrated_no_stock: false },
    { id: 'pi-f', company_id: CO, invoice_number: 'PI-F', due_date: null, exchange_rate: 0.62, status: 'PARTIALLY_PAID', total_sen: 10_000, paid_sen: 5_000, migrated_no_stock: false },
    { id: 'pi-old', company_id: CO, invoice_number: 'PI-OLD', due_date: null, exchange_rate: 1, status: 'POSTED', total_sen: 7_000, paid_sen: 0, migrated_no_stock: true },
  ],
  ap_invoices: [{ id: 'api-1', company_id: CO, invoice_number: 'API-1', due_date: null }],
  payment_vouchers: [
    { id: 'pv-1', company_id: CO, pv_number: 'PV-1', voucher_date: '2026-08-01' },
    { id: 'pv-2', company_id: CO, pv_number: 'PV-2', voucher_date: '2026-08-20' },
    { id: 'pv-3', company_id: CO, pv_number: 'PV-3', voucher_date: '2026-07-01' },
  ],
  pv_allocations: [
    /* Conts writes a voucher's own tick as amount_sen, an advance applied as applied_sen. */
    { id: 'a-1', company_id: CO, pv_id: 'pv-1', pi_id: 'pi-1', ap_invoice_id: null, amount_sen: 4_000, applied_sen: 0, from_advance: false, created_at: '2026-08-01T02:00:00Z' },
    /* The rest of PV-1 was an advance, applied to PI-2 on 20 September. */
    { id: 'a-2', company_id: CO, pv_id: 'pv-1', pi_id: 'pi-2', ap_invoice_id: null, amount_sen: 1_500, applied_sen: 1_500, from_advance: true, created_at: '2026-09-20T02:00:00Z' },
    /* 5,000.00 RMB at 0.62 = 3,100.00 ringgit. */
    { id: 'a-3', company_id: CO, pv_id: 'pv-3', pi_id: 'pi-f', ap_invoice_id: null, amount_sen: 5_000, applied_sen: 0, from_advance: false, created_at: '2026-07-01T02:00:00Z' },
  ],
  acc_credit_notes: [{ id: 'cn-1', company_id: CO, note_number: 'SCN-1', purchase_invoice_id: 'pi-2', ap_invoice_id: null }],
  suppliers: [
    { id: 's-1', company_id: CO, code: '400-B001', name: 'BEST BED', control_account: '400-0000' },
    { id: 's-2', company_id: CO, code: '405-H001', name: 'HOLDING CO', control_account: '405-0000' },
    { id: 's-3', company_id: CO, code: '400-F001', name: 'FOSHAN CO', control_account: '400-0000' },
  ],
});

describe('AP aging', () => {
  test('ticks knock off the bills they name; a voucher applied to nothing is 未冲; it adds up to every supplier control', async () => {
    const b = await (await app(AP()).request('/ap-aging?asOf=2026-09-30')).json() as Body;
    expect(rowOf(b, 'BEST BED')).toMatchObject({ key: '400-B001', balanceSen: 6_500, unappliedSen: -500, cells: [1_000, 0, 6_000, 0, 0] });
    expect((rowOf(b, 'BEST BED').unapplied as Row[]).map((u) => [u.docNo, u.amountSen])).toEqual([['PV-1', -500]]);
    expect(rowOf(b, 'HOLDING CO')).toMatchObject({ balanceSen: 0, unappliedSen: -2_000, cells: [0, 2_000, 0, 0, 0] });
    expect(rowOf(b, 'FOSHAN CO')).toMatchObject({ balanceSen: 3_100, cells: [0, 0, 0, 3_100, 0] });
    expect(b.controls).toEqual([{ code: '400-0000', balanceSen: 9_600 }, { code: '405-0000', balanceSen: 0 }]);
    expect(b.differenceSen).toBe(0);
    expect(b.outside).toEqual({ count: 1, sen: 7_000 });
  });

  test('as at 10 September: the advance was not applied yet and the credit note not there', async () => {
    const b = await (await app(AP()).request('/ap-aging?asOf=2026-09-10&control=trade')).json() as Body;
    expect(rowOf(b, 'BEST BED')).toMatchObject({ balanceSen: 7_000, unappliedSen: -2_000, cells: [3_000, 0, 6_000, 0, 0] });
    expect(b.rows.some((r) => r.name === 'HOLDING CO')).toBe(false);
    expect(b.differenceSen).toBe(0);
  });

  test("a line no paper names (a claim) is paid by its party's voucher with no ticks", async () => {
    const t = AP();
    t.v_gl_entries!.push(
      gl('400-0000', 'CLM', 'CLM-1', '2026-09-01', 0, 800, '400-F001', SUP),
      gl('400-0000', 'PV', 'PV-9', '2026-09-10', 500, 0, '400-F001', SUP),
    );
    t.payment_vouchers!.push({ id: 'pv-9', company_id: CO, pv_number: 'PV-9', voucher_date: '2026-09-10' });
    const b = await (await app(t).request('/ap-aging?asOf=2026-09-30')).json() as Body;
    expect(items(rowOf(b, 'FOSHAN CO'))).toEqual([['PI-F', 3_100], ['CLM-1', 300]]);
    expect(rowOf(b, 'FOSHAN CO')).toMatchObject({ balanceSen: 3_400, unappliedSen: 0 });
    expect(b.differenceSen).toBe(0);
  });

  test('an opening bill and an opening advance stand in for the OPENING line; the rest is unsplit', async () => {
    const t = AP();
    t.v_gl_entries!.push(gl('400-0000', 'OPENING', 'OPENING', '2026-05-31', 0, 9_000, null));
    t.purchase_invoices!.push({ id: 'pi-ob', company_id: CO, invoice_number: 'AC-PI-7', supplier_id: 's-3', invoice_date: '2026-01-20', due_date: '2026-02-19',
      total_sen: 6_000, paid_sen: 0, exchange_rate: 1, status: 'POSTED', opening_balance: true });
    t.payment_vouchers!.push({ id: 'pv-ob', company_id: CO, pv_number: 'OB-AC-PV-3', supplier_id: 's-1', voucher_date: '2026-05-10', total_sen: 1_000, status: 'POSTED', opening_balance: true });
    t.pv_allocations!.push({ id: 'a-9', company_id: CO, pv_id: 'pv-ob', pi_id: 'pi-1', ap_invoice_id: null, amount_sen: 400, applied_sen: 400, from_advance: true, created_at: '2026-09-02T02:00:00Z' });
    const b = await (await app(t).request('/ap-aging?asOf=2026-09-30')).json() as Body;
    expect(items(rowOf(b, 'FOSHAN CO'))).toEqual([['AC-PI-7', 6_000], ['PI-F', 3_100]]);
    /* The opening advance knocked 400 off PI-1 on 2 September; 600 of it is still 未冲. */
    expect(items(rowOf(b, 'BEST BED'))).toEqual([['PI-1', 5_600], ['PI-2', 1_000]]);
    expect((rowOf(b, 'BEST BED').unapplied as Row[]).map((u) => [u.docNo, u.amountSen])).toEqual([['OB-AC-PV-3', -600], ['PV-1', -500]]);
    expect(rowOf(b, 'Opening balance not split')).toMatchObject({ balanceSen: 4_000 });
    expect(b.opening).toEqual({ splitSen: 5_000, unsplitSen: 4_000 });
    expect(b.differenceSen).toBe(0);
  });
});
