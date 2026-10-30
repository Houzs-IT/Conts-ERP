/* Renovation project status rows (SOP 4.2.3; plan 2026-10-31-renovation-completion-dashboard.md Task 6). Pinned: the
   example contract's money, work, cost and margins; work ahead of money at 20 points; the gaps between instalments by
   invoice and by payment; the old-contract flag passes through; another company's contracts never show. */
import { describe, expect, it } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { renoProjectRows } from './reno-projects';

const CO = 2;
const SO = 'SO-2611-001';
function world(over: Record<string, Row[]> = {}) {
  return fakeSb({
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01' }],
    accounts: [{ company_id: CO, account_code: '620-0010', account_type: 'EXPENSE' }],
    reno_so_contracts: [{ so_doc_no: SO, company_id: CO, project_id: 7, doc_date: '2026-11-03', billed_before_golive_sen: 0, golive_cost_sen: null,
      original_contract_sen: 10_000_000, advance_account_code: '481-S012', customer_name: 'MS LEE' }],
    mfg_sales_orders: [{ doc_no: SO, company_id: CO, status: 'RENO_IN_PROGRESS', project_id: 7, debtor_code: '301-M002', debtor_name: 'MS LEE', agent: 'ALEX' }],
    mfg_sales_order_items: [
      { id: 'a', doc_no: SO, company_id: CO, item_code: 'RN-X', total_sen: 10_000_000, line_cost_sen: 6_500_000, cancelled: false, created_at: '2026-11-03T03:00:00Z' },
      { id: 'vo', doc_no: SO, company_id: CO, item_code: 'RN-VO', total_sen: 1_000_000, line_cost_sen: 600_000, cancelled: false, created_at: '2026-11-20T03:00:00Z' },
    ],
    projects: [{ id: 7, company_id: CO, code: 'P7', name: 'SKYLINE D-25-13', reno_stage: 'CARPENTRY', planned_handover_date: '2026-11-25', salesperson_name: 'ALEX' }],
    journal_entries: [{ id: 'je1', company_id: CO, entry_date: '2026-11-10', posted: true }],
    journal_entry_lines: [{ id: 'l1', company_id: CO, journal_entry_id: 'je1', account_code: '620-0010', debit_sen: 5_550_000, credit_sen: 0, project_id: 7 }],
    reno_doc_instalments: [
      { so_doc_no: SO, seq: 1, label: 'Deposit', pct_bp: 1000, trigger: 'manual' },
      { so_doc_no: SO, seq: 2, label: 'Carpentry', pct_bp: 4000, trigger: 'manual' },
      { so_doc_no: SO, seq: 3, label: 'Handover', pct_bp: 5000, trigger: 'manual' },
    ],
    reno_instalment_bills: [
      { so_doc_no: SO, seq: 1, kind: 'INVOICE', amount_sen: 1_000_000, invoice_date: '2026-11-03' },
      { so_doc_no: SO, seq: 2, kind: 'INVOICE', amount_sen: 4_000_000, invoice_date: '2026-11-13' },
    ],
    sales_invoices: [
      { id: 'si1', company_id: CO, so_doc_no: SO, invoice_date: '2026-11-03', total_sen: 1_000_000, status: 'SENT' },
      { id: 'si2', company_id: CO, so_doc_no: SO, invoice_date: '2026-11-13', total_sen: 4_000_000, status: 'SENT' },
    ],
    mfg_sales_order_payments: [],
    sales_invoice_payments: [
      { id: 'p1', company_id: CO, sales_invoice_id: 'si1', paid_at: '2026-11-05T02:00:00Z', amount_sen: 1_000_000 },
      { id: 'p2', company_id: CO, sales_invoice_id: 'si2', paid_at: '2026-11-25T02:00:00Z', amount_sen: 1_000_000 },
      { id: 'p3', company_id: CO, sales_invoice_id: 'si2', paid_at: '2026-11-28T02:00:00Z', amount_sen: 500_000 }, // not confirmed
    ],
    acc_official_receipts: [
      { company_id: CO, payment_source: 'SIPAY', payment_id: 'p1', status: 'FORMAL' },
      { company_id: CO, payment_source: 'SIPAY', payment_id: 'p2', status: 'FORMAL' },
    ],
    purchase_orders: [{ id: 'po1', company_id: CO, project_id: 7, status: 'SUBMITTED', total_sen: 3_000_000 }],
    purchase_invoices: [{ id: 'pi1', company_id: CO, purchase_order_id: 'po1', status: 'POSTED', total_sen: 2_000_000, paid_sen: 500_000 }],
    ap_invoice_lines: [{ company_id: CO, invoice_id: 'ap1', project_id: 7, amount_sen: 400_000 }, { company_id: CO, invoice_id: 'ap1', project_id: 9, amount_sen: 600_000 }],
    ap_invoices: [{ id: 'ap1', company_id: CO, status: 'POSTED', total_sen: 1_000_000, paid_sen: 0 }],
    reno_contract_credits: [], acc_credit_notes: [],
    ...over,
  });
}

describe('renovation project status rows', () => {
  it('a row has the SOP 4.2.3 numbers for the example contract', async () => {
    const [r] = await renoProjectRows(world(), CO, '2026-11-30');
    expect(r).toMatchObject({
      soDocNo: SO, projectName: 'SKYLINE D-25-13', customerCode: '301-M002', customerName: 'MS LEE', salesperson: 'ALEX',
      brand: 'The Conts', kind: 'RENOVATION', status: 'RENO_IN_PROGRESS', stage: 'CARPENTRY', handoverDate: '2026-11-25', delayed: true,
      contractSen: 10_000_000, voSen: 1_000_000, revisedContractSen: 11_000_000,
      receivedSen: 2_000_000, outstandingSen: 9_000_000, collectedBp: 1818,
      nextInstalment: { seq: 3, label: 'Handover', amountSen: 6_000_000, trigger: 'manual' },
      invoicedSen: 5_000_000, advanceLeftSen: 6_000_000,
      expectedCostSen: 7_100_000, costSpentSen: 5_550_000, completionBp: 7817, earnedSen: 8_598_592, differenceSen: -3_598_592,
      orderedNotBilledSen: 1_000_000, remainingCostSen: 1_550_000, owedToSuppliersSen: 1_900_000,
      overBudget: false, lossExpected: false, goliveCostMissing: false,
      expectedGpBp: 3545, gpToDateBp: -1100,
    });
  });

  it('work ahead of money is flagged at 20 points', async () => {
    const [r] = await renoProjectRows(world(), CO, '2026-11-30');
    expect(r!.workAheadOfMoney).toBe(true); // 78.2% done, 18.2% collected
    const paid = world({ acc_official_receipts: [
      { company_id: CO, payment_source: 'SIPAY', payment_id: 'p1', status: 'FORMAL' }, { company_id: CO, payment_source: 'SIPAY', payment_id: 'p2', status: 'FORMAL' },
      { company_id: CO, payment_source: 'SIPAY', payment_id: 'p3', status: 'FORMAL' },
    ], sales_invoice_payments: [
      { id: 'p1', company_id: CO, sales_invoice_id: 'si1', paid_at: '2026-11-05T02:00:00Z', amount_sen: 1_000_000 },
      { id: 'p2', company_id: CO, sales_invoice_id: 'si2', paid_at: '2026-11-25T02:00:00Z', amount_sen: 4_000_000 },
      { id: 'p3', company_id: CO, sales_invoice_id: 'si2', paid_at: '2026-11-28T02:00:00Z', amount_sen: 2_000_000 },
    ] });
    expect((await renoProjectRows(paid, CO, '2026-11-30'))[0]!.workAheadOfMoney).toBe(false); // 63.6% collected
  });

  it('gaps by invoice and by payment', async () => {
    const [r] = await renoProjectRows(world(), CO, '2026-11-30');
    expect(r!.gapsByInvoiceDays).toEqual([10, null, null]);
    /* Instalment 1 was covered on 5 Nov; instalment 2 (cumulative 50,000) is not covered yet. */
    expect(r!.gapsByPaymentDays).toEqual([null, null, null]);
  });

  it('old contract without baseline is flagged', async () => {
    const old = world({ reno_so_contracts: [{ ...world().tables.reno_so_contracts[0], doc_date: '2026-08-01', golive_cost_sen: null }] });
    expect((await renoProjectRows(old, CO, '2026-11-30'))[0]!.goliveCostMissing).toBe(true);
  });

  it("another company's contracts are not listed", async () => {
    expect(await renoProjectRows(world(), 9, '2026-11-30')).toEqual([]);
  });
});

describe('GET /reno-projects', () => {
  it('answers the rows as at the date; a bad date is refused', async () => {
    const { Hono } = await import('hono');
    const { renoProjectsHandler } = await import('./reno-projects');
    const a = new Hono();
    a.use('*', async (c, next) => { c.set('supabase' as never, world() as never); c.set('companyId' as never, CO as never); await next(); });
    a.get('/reno-projects', renoProjectsHandler as never);
    const ok = await a.request('/reno-projects?asOf=2026-11-30');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ asOf: '2026-11-30', rows: [{ soDocNo: SO }] });
    expect((await a.request('/reno-projects?asOf=30/11/2026')).status).toBe(400);
  });
});
