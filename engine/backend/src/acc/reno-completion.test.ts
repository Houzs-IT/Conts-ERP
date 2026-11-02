/* Renovation completion % for management (plan docs/superpowers/plans/2026-10-31-renovation-completion-dashboard.md
   Task 3; SOP 4.2.1). Never posted. Pinned: the SOP's own example month by month; the 99% cap before handover; over
   budget and loss flags; a VO moves only the month it lands in; reversed cost nets out; the difference is invoiced −
   earned; an old contract without its cost before go-live is flagged. */
import { describe, expect, it } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { completionOf, contractCompletions } from './reno-completion';

describe('completionOf (pure)', () => {
  it('SOP example month by month', () => {
    const at = (cost: number, handedOver = false) => completionOf({ revisedContractSen: 10_000_000, expectedCostSen: 6_500_000, costToDateSen: cost, handedOver });
    expect([at(0), at(2_000_000), at(5_500_000), at(6_500_000, true)].map((c) => [c.pctBp, c.earnedSen]))
      .toEqual([[0, 0], [3077, 3_076_923], [8462, 8_461_538], [10000, 10_000_000]]);
  });

  it('cost over expected caps at 99 and flags over budget', () => {
    expect(completionOf({ revisedContractSen: 10_000_000, expectedCostSen: 6_500_000, costToDateSen: 7_000_000, handedOver: false }))
      .toEqual({ pctBp: 9900, earnedSen: 9_900_000, overBudget: true, lossExpected: false });
  });

  it('zero expected cost is 0 before handover and 100 at handover', () => {
    expect(completionOf({ revisedContractSen: 500_000, expectedCostSen: 0, costToDateSen: 0, handedOver: false })).toMatchObject({ pctBp: 0, earnedSen: 0 });
    expect(completionOf({ revisedContractSen: 500_000, expectedCostSen: 0, costToDateSen: 0, handedOver: true })).toMatchObject({ pctBp: 10000, earnedSen: 500_000 });
  });

  it('loss expected when expected cost exceeds the contract', () => {
    expect(completionOf({ revisedContractSen: 100, expectedCostSen: 120, costToDateSen: 0, handedOver: false }).lossExpected).toBe(true);
  });
});

const CO = 2;
const SO = 'SO-2610-001';
const item = (id: string, total: number, cost: number, created: string, over: Row = {}): Row => ({
  id, doc_no: SO, company_id: CO, item_code: 'RN-X', total_sen: total, line_cost_sen: cost, cancelled: false, created_at: `${created}T03:00:00Z`, ...over,
});
function world(over: Record<string, Row[]> = {}) {
  return fakeSb({
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01' }],
    accounts: [
      { company_id: CO, account_code: '620-0010', account_type: 'EXPENSE' },
      { company_id: CO, account_code: '405-0000', account_type: 'LIABILITY' },
      { company_id: CO, account_code: '160-0000', account_type: 'ASSET' },
    ],
    reno_so_contracts: [{ so_doc_no: SO, company_id: CO, project_id: 7, doc_date: '2026-11-03', billed_before_golive_sen: 0, golive_cost_sen: null }],
    mfg_sales_orders: [{ doc_no: SO, company_id: CO, status: 'RENO_IN_PROGRESS', project_id: 7 }],
    mfg_sales_order_items: [item('a', 10_000_000, 6_500_000, '2026-11-03')],
    journal_entries: [
      { id: 'je1', company_id: CO, entry_date: '2026-11-10', posted: true },
      // je3 reversed je2: the books count neither side (acc/reversal-pairs)
      { id: 'je2', company_id: CO, entry_date: '2026-11-20', posted: true, reversed: true, reversed_by_je: 'je3' },
      { id: 'je3', company_id: CO, entry_date: '2026-11-25', posted: true, reversed_by_je: 'je2' },
    ],
    journal_entry_lines: [
      { id: 'l1', company_id: CO, journal_entry_id: 'je1', account_code: '620-0010', debit_sen: 2_000_000, credit_sen: 0, project_id: 7 },
      { id: 'l2', company_id: CO, journal_entry_id: 'je1', account_code: '405-0000', debit_sen: 0, credit_sen: 2_000_000, project_id: null },
      { id: 'l3', company_id: CO, journal_entry_id: 'je2', account_code: '620-0010', debit_sen: 500_000, credit_sen: 0, project_id: 7 },
      { id: 'l4', company_id: CO, journal_entry_id: 'je3', account_code: '620-0010', debit_sen: 0, credit_sen: 500_000, project_id: 7 },
      // a deposit to a supplier (an asset) is not cost
      { id: 'l5', company_id: CO, journal_entry_id: 'je1', account_code: '160-0000', debit_sen: 900_000, credit_sen: 0, project_id: 7 },
    ],
    sales_invoices: [{ id: 'si1', company_id: CO, so_doc_no: SO, invoice_date: '2026-11-05', total_sen: 5_000_000, status: 'SENT' }],
    reno_contract_credits: [], reno_instalment_bills: [], acc_credit_notes: [],
    ...over,
  });
}

describe('contractCompletions', () => {
  it('reads cost, contract and invoiced as at a date', async () => {
    const [c] = await contractCompletions(world(), CO, '2026-11-30');
    expect(c).toMatchObject({
      soDocNo: SO, projectId: 7, revisedContractSen: 10_000_000, expectedCostSen: 6_500_000, costToDateSen: 2_000_000,
      pctBp: 3077, earnedSen: 3_076_923, invoicedSen: 5_000_000, differenceSen: 1_923_077, goliveCostMissing: false,
    });
  });

  it('a reversed cost does not count, on either side, at any date (as the books)', async () => {
    expect((await contractCompletions(world(), CO, '2026-11-22'))[0]!.costToDateSen).toBe(2_000_000);
    expect((await contractCompletions(world(), CO, '2026-11-30'))[0]!.costToDateSen).toBe(2_000_000);
  });

  it('handover counts from its own day: an earlier month keeps its percentage', async () => {
    const sb = world({ projects: [{ id: 7, company_id: CO, handed_over_at: '2026-12-04T03:00:00Z' }],
      mfg_sales_orders: [{ doc_no: SO, company_id: CO, status: 'RENO_COMPLETED', project_id: 7 }] });
    expect((await contractCompletions(sb, CO, '2026-11-30'))[0]).toMatchObject({ pctBp: 3077, earnedSen: 3_076_923 });
    expect((await contractCompletions(sb, CO, '2026-12-31'))[0]).toMatchObject({ pctBp: 10000, earnedSen: 10_000_000 });
  });

  it('a cancelled contract is live until its advance is cleared, then has earned what it kept', async () => {
    const sb = world({
      mfg_sales_orders: [{ doc_no: SO, company_id: CO, status: 'CANCELLED', project_id: 7 }],
      journal_entries: [...world().tables.journal_entries, { id: 'rc', company_id: CO, source_type: 'RCAN', source_doc_no: SO, entry_date: '2026-12-10', posted: true }],
    });
    expect((await contractCompletions(sb, CO, '2026-11-30'))[0]).toMatchObject({ earnedSen: 3_076_923, revisedContractSen: 10_000_000 });
    expect((await contractCompletions(sb, CO, '2026-12-31'))[0]).toMatchObject({ status: 'CANCELLED', earnedSen: 5_000_000, revisedContractSen: 5_000_000 });
  });

  it('a line counts from its line date, else the day it was keyed in Malaysia', async () => {
    const sb = world({ mfg_sales_order_items: [item('a', 10_000_000, 6_500_000, '2026-11-03'),
      { ...item('vo', 1_000_000, 600_000, '2026-11-30'), created_at: '2026-11-30T23:00:00Z' }] });
    expect((await contractCompletions(sb, CO, '2026-11-30'))[0]!.revisedContractSen).toBe(10_000_000);
    expect((await contractCompletions(sb, CO, '2026-12-01'))[0]!.revisedContractSen).toBe(11_000_000);
  });

  it('VO in the month moves earned in that month only', async () => {
    const sb = world({ mfg_sales_order_items: [item('a', 10_000_000, 6_500_000, '2026-11-03'), item('vo', 1_000_000, 600_000, '2026-12-15')] });
    const nov = (await contractCompletions(sb, CO, '2026-11-30'))[0]!;
    const dec = (await contractCompletions(sb, CO, '2026-12-31'))[0]!;
    expect([nov.revisedContractSen, nov.expectedCostSen]).toEqual([10_000_000, 6_500_000]);
    expect([dec.revisedContractSen, dec.expectedCostSen]).toEqual([11_000_000, 7_100_000]);
  });

  it('a cancelled line and a contract credit come off the contract', async () => {
    const sb = world({
      mfg_sales_order_items: [item('a', 10_000_000, 6_500_000, '2026-11-03'), item('x', 400_000, 300_000, '2026-11-03', { cancelled: true }),
        item('cc', -200_000, 0, '2026-11-12', { item_code: 'RENO-CREDIT' })],
      reno_contract_credits: [{ so_doc_no: SO, credit_note_id: 'cn1', amount_sen: 200_000 }],
      acc_credit_notes: [{ id: 'cn1', company_id: CO, note_date: '2026-11-12', status: 'POSTED' }],
    });
    const c = (await contractCompletions(sb, CO, '2026-11-30'))[0]!;
    expect([c.revisedContractSen, c.expectedCostSen, c.invoicedSen]).toEqual([9_800_000, 6_500_000, 4_800_000]);
  });

  it('old contract without baseline is flagged; with one, it adds to cost', async () => {
    const old = { so_doc_no: SO, company_id: CO, project_id: 7, doc_date: '2026-08-01', billed_before_golive_sen: 3_000_000 };
    const missing = (await contractCompletions(world({ reno_so_contracts: [{ ...old, golive_cost_sen: null }] }), CO, '2026-11-30'))[0]!;
    expect(missing).toMatchObject({ goliveCostMissing: true, invoicedSen: 8_000_000 });
    const given = (await contractCompletions(world({ reno_so_contracts: [{ ...old, golive_cost_sen: 1_500_000 }] }), CO, '2026-11-30'))[0]!;
    expect(given).toMatchObject({ goliveCostMissing: false, costToDateSen: 3_500_000 });
  });

  it('handed over is 100%; drafts, quotations and other companies are left out', async () => {
    const done = (await contractCompletions(world({ mfg_sales_orders: [{ doc_no: SO, company_id: CO, status: 'RENO_COMPLETED', project_id: 7 }] }), CO, '2026-11-30'))[0]!;
    expect(done).toMatchObject({ pctBp: 10000, earnedSen: 10_000_000 });
    expect(await contractCompletions(world({ mfg_sales_orders: [{ doc_no: SO, company_id: CO, status: 'RENO_CANCELLED', project_id: 7 }] }), CO, '2026-11-30')).toEqual([]);
    expect(await contractCompletions(world(), 9, '2026-11-30')).toEqual([]);
  });

  it('a contract signed after the date is not listed', async () => {
    expect(await contractCompletions(world(), CO, '2026-11-02')).toEqual([]);
  });
});

describe('renovationForPeriod', () => {
  it('earned and invoiced are the change over the period; cost is the period booking by account', async () => {
    const { renovationForPeriod } = await import('./reno-completion');
    const r = await renovationForPeriod(world(), CO, '2026-11-01', '2026-11-30');
    /* Nov: cost 2,000,000 to date (the 500,000 reversed within the month), earned 3,076,923; invoiced 5,000,000; signed 3 Nov. */
    expect(r).toEqual({ earnedSen: 3_076_923, invoicedSen: 5_000_000, contracts: 1, costByAccount: { '620-0010': 2_000_000 } });
    /* The months add up to the range. */
    const q = await renovationForPeriod(world(), CO, '2026-11-01', '2026-12-31');
    expect(q.earnedSen).toBe(r.earnedSen + (await renovationForPeriod(world(), CO, '2026-12-01', '2026-12-31')).earnedSen);
    const dec = await renovationForPeriod(world(), CO, '2026-12-01', '2026-12-31');
    expect(dec).toEqual({ earnedSen: 0, invoicedSen: 0, contracts: 1, costByAccount: {} });
  });
});

/* The expected-cost review (plan 2026-11-02-renovation-expected-cost-review.md Task 1; SOP 4.2.1 实际和预计有差):
   a change counts from its own day, on top of the lines, so an earlier month never moves and a later VO still adds. */
describe('expected cost changes', () => {
  /* Cost to date 5,500,000 against RM 65,000 expected: the SOP's November. */
  const reviewed = (over: Record<string, Row[]> = {}) => world({
    journal_entry_lines: [
      { id: 'l1', company_id: CO, journal_entry_id: 'je1', account_code: '620-0010', debit_sen: 5_500_000, credit_sen: 0, project_id: 7 },
    ],
    reno_expected_cost_changes: [{ id: 1, company_id: CO, so_doc_no: SO, effective_on: '2026-12-03', adjustment_sen: 1_000_000 }],
    ...over,
  });

  it('takes a change from its day on', async () => {
    const nov = (await contractCompletions(reviewed(), CO, '2026-11-30'))[0]!;
    expect(nov).toMatchObject({ expectedCostSen: 6_500_000, lineCostSen: 6_500_000, pctBp: 8462 });
    const dec = (await contractCompletions(reviewed(), CO, '2026-12-03'))[0]!;
    expect(dec).toMatchObject({ expectedCostSen: 7_500_000, lineCostSen: 6_500_000, pctBp: 7333 });
  });

  it('a VO after a change still adds its cost', async () => {
    const sb = reviewed({ mfg_sales_order_items: [item('a', 10_000_000, 6_500_000, '2026-11-03'), item('vo', 300_000, 200_000, '2026-12-10')] });
    expect((await contractCompletions(sb, CO, '2026-12-10'))[0]!.expectedCostSen).toBe(7_700_000);
  });

  it('another company\'s change does not count', async () => {
    const sb = reviewed({ reno_expected_cost_changes: [{ id: 1, company_id: 9, so_doc_no: SO, effective_on: '2026-12-03', adjustment_sen: 1_000_000 }] });
    expect((await contractCompletions(sb, CO, '2026-12-31'))[0]!.expectedCostSen).toBe(6_500_000);
  });

  it('November is unchanged by a December change', async () => {
    const { renovationForPeriod } = await import('./reno-completion');
    const without = await renovationForPeriod(reviewed({ reno_expected_cost_changes: [] }), CO, '2026-11-01', '2026-11-30');
    const withIt = await renovationForPeriod(reviewed(), CO, '2026-11-01', '2026-11-30');
    expect(withIt.earnedSen).toBe(without.earnedSen);
  });
});
