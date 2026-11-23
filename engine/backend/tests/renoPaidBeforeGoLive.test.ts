// Paid before go-live (chew, 23 Nov 2026): a renovation contract AutoCount invoiced and was paid on before go-live
// reads as paid, not "0 of 4 paid, RM 43,508.20 to collect" (TC-SO-2603-004).
import { describe, expect, test } from 'vitest';
import { allocatePaidBeforeGoLive } from '../src/acc/reno-paid-before-golive';
import { assembleView, paidBeforeGoLiveOfRows } from '../src/scm/lib/renovation-billing';
import { paymentsOf } from '../src/services/renovation/beta';
import { paymentLabel } from '../src/services/renovation/betaBoard';
import { billingFactsOf } from '../src/services/renovation/load';

const quarter = [1, 2, 3, 4].map((seq) => ({ id: `i${seq}`, seq, label: `${seq}`, pctBp: 2500, description: '', stageCode: null, trigger: 'manual' }));
const split = [3000, 2000, 3000, 2000].map((pctBp, n) => ({ id: `i${n + 1}`, seq: n + 1, label: `${n + 1}`, pctBp, description: '', stageCode: null, trigger: 'manual' }));

describe('allocatePaidBeforeGoLive', () => {
  const one = (billed: number, owed: number) =>
    allocatePaidBeforeGoLive([{ soDocNo: 'A', debtorCode: '301-M263', soDate: '2026-03-10', billedBeforeGoLiveSen: billed }], new Map([['301-M263', owed]])).get('A');

  test('nothing owed at go-live: paid in full', () => expect(one(4_350_820, 0)).toBe(4_350_820));
  test('part still owed: paid the rest', () => expect(one(3_000_000, 1_000_000)).toBe(2_000_000));
  test('never below 0 nor above what was invoiced (paid ahead is a negative owed)', () => {
    expect(one(3_000_000, 5_000_000)).toBe(0);
    expect(one(3_000_000, -200_000)).toBe(3_000_000);
  });
  test('no customer code, or no opening row for it: no code owes all, no row owes nothing', () => {
    expect(allocatePaidBeforeGoLive([{ soDocNo: 'A', debtorCode: '', soDate: null, billedBeforeGoLiveSen: 100 }], new Map()).get('A')).toBe(0);
    expect(allocatePaidBeforeGoLive([{ soDocNo: 'A', debtorCode: 'X', soDate: null, billedBeforeGoLiveSen: 100 }], new Map()).get('A')).toBe(100);
  });

  test('two contracts of one customer: what it owed lies on the oldest first', () => {
    const contracts = [
      { soDocNo: 'TC-SO-2606-001', debtorCode: 'D', soDate: '2026-06-01', billedBeforeGoLiveSen: 2_000_000 },
      { soDocNo: 'TC-SO-2603-001', debtorCode: 'D', soDate: '2026-03-01', billedBeforeGoLiveSen: 5_000_000 },
    ];
    const at = (owed: number) => Object.fromEntries(allocatePaidBeforeGoLive(contracts, new Map([['D', owed]])));
    expect(at(3_000_000)).toEqual({ 'TC-SO-2603-001': 2_000_000, 'TC-SO-2606-001': 2_000_000 });
    expect(at(6_000_000)).toEqual({ 'TC-SO-2603-001': 0, 'TC-SO-2606-001': 1_000_000 });
    expect(at(0)).toEqual({ 'TC-SO-2603-001': 5_000_000, 'TC-SO-2606-001': 2_000_000 });
  });

  test("billingViews' read: a customer is its company and code", () => {
    const m = paidBeforeGoLiveOfRows([
      { kind: 'C', company_id: 1, debtor_code: 'D', doc_no: 'A', so_date: '2026-03-01', sen: 1_000 },
      { kind: 'C', company_id: 2, debtor_code: 'D', doc_no: 'B', so_date: '2026-03-01', sen: 1_000 },
      { kind: 'O', company_id: 1, debtor_code: 'D', doc_no: null, so_date: null, sen: 400 },
      { kind: 'O', company_id: 2, debtor_code: 'D', doc_no: null, so_date: null, sen: '0' },
    ]);
    expect(Object.fromEntries(m)).toEqual({ A: 600, B: 1_000 });
  });
});

describe('the billing view of a contract paid before go-live', () => {
  test('TC-SO-2603-004: invoiced and paid in full in AutoCount reads fully paid, nothing to collect, nothing to bill', () => {
    const v = assembleView('TC-SO-2603-004', 'RENO_IN_PROGRESS', 4_350_820, 4_350_820, quarter, [], 0, [], 4_350_820, 0, 0, 4_350_820);
    expect(v.receivedSen).toBe(4_350_820);
    expect(v.paidBeforeGoLiveSen).toBe(4_350_820);
    expect(v.nextSeq).toBeNull();
    expect(v.instalments.map((i) => [i.billedBeforeGoLive, i.beforeGoLiveSen, i.paidBeforeGoLiveSen, i.paidBeforeGoLive])).toEqual([
      [true, 1_087_705, 1_087_705, true], [true, 1_087_705, 1_087_705, true], [true, 1_087_705, 1_087_705, true], [true, 1_087_705, 1_087_705, true],
    ]);
    const p = paymentsOf(v, { docNo: 'TC-SO-2603-004', totalSen: 4_350_820, receipts: [] });
    if (p.state !== 'ok') throw new Error('expected ok');
    expect(p.instalments.map((i) => [i.status, i.amountSen, i.paidSen, i.paidBeforeGoLive])).toEqual(
      Array.from({ length: 4 }, () => ['paid', 1_087_705, 1_087_705, true]));
    expect(paymentLabel(p)).toMatchObject({ label: 'Fully paid', outstandingSen: 0, paid: 4 });
    /* The stage prompts never ask to bill them, and the board counts them received. */
    const f = billingFactsOf(v);
    expect(f.instalments.every((i) => i.billed && i.receivedSen === i.dueSen)).toBe(true);
    expect(f.receivedTotalSen).toBe(4_350_820);
  });

  test('part paid before go-live fills the covered instalments oldest first; the rest is billed, waiting for money', () => {
    /* 100k on 30/20/30/20, AutoCount invoiced 50k (instalments 1 and 2), the customer still owed 10k: paid 40k. */
    const v = assembleView('SO', 'RENO_IN_PROGRESS', 10_000_000, 10_000_000, split, [], 0, [], 5_000_000, 0, 0, 4_000_000);
    expect(v.receivedSen).toBe(4_000_000);
    expect(v.nextSeq).toBe(3);
    expect(v.instalments.map((i) => [i.seq, i.beforeGoLiveSen, i.paidBeforeGoLiveSen, i.paidBeforeGoLive])).toEqual([
      [1, 3_000_000, 3_000_000, true], [2, 2_000_000, 1_000_000, false], [3, 0, 0, false], [4, 0, 0, false],
    ]);
    const p = paymentsOf(v, { docNo: 'SO', totalSen: 10_000_000, receipts: [] });
    if (p.state !== 'ok') throw new Error('expected ok');
    expect(p.instalments.map((i) => [i.status, i.amountSen, i.paidSen])).toEqual([
      ['paid', 3_000_000, 3_000_000], ['billed', 2_000_000, 1_000_000], ['not_billed', 3_000_000, 0], ['not_billed', 2_000_000, 0],
    ]);
    expect(paymentLabel(p)).toMatchObject({ label: 'Pending 2nd payment', outstandingSen: 6_000_000, paid: 1 });
  });

  test('a payment recorded on the order before go-live is inside what AutoCount was paid, never counted twice', () => {
    const v = assembleView('SO', 'RENO_IN_PROGRESS', 10_000_000, 10_000_000, split, [], 0, [], 5_000_000, 1_000_000, 0, 3_000_000, 1_000_000);
    expect(v.receivedSen).toBe(3_000_000);
    expect(v.orderPoolSen).toBe(0);
    const p = paymentsOf(v, { docNo: 'SO', totalSen: 10_000_000, receipts: [{ paidOn: '2026-05-01', amountSen: 1_000_000, method: 'imported' }] });
    if (p.state !== 'ok') throw new Error('expected ok');
    expect(p.receivedSen).toBe(3_000_000);
    expect(p.instalments.map((i) => i.paidSen)).toEqual([3_000_000, 0, 0, 0]);
  });

  test('money recorded after go-live fills after what was paid before it', () => {
    const v = assembleView('SO', 'RENO_IN_PROGRESS', 10_000_000, 10_000_000, split, [], 0, [], 5_000_000, 1_500_000, 0, 4_000_000);
    expect(v.receivedSen).toBe(5_500_000);
    const p = paymentsOf(v, { docNo: 'SO', totalSen: 10_000_000, receipts: [{ paidOn: '2026-11-10', amountSen: 1_500_000, method: 'transfer' }] });
    if (p.state !== 'ok') throw new Error('expected ok');
    expect(p.instalments.map((i) => i.paidSen)).toEqual([3_000_000, 2_000_000, 500_000, 0]);
    expect(p.instalments[1]!.paidOn).toBe('2026-11-10');
    expect(p.receivedSen).toBe(5_500_000);
  });

  test('a contract AutoCount never carried is unchanged', () => {
    const v = assembleView('SO', 'RENO_CONFIRMED', 1_000_000, 1_000_000, split, [], 0, [], 0, 250_000, 0, 999_999);
    expect(v.receivedSen).toBe(250_000);
    expect(v.paidBeforeGoLiveSen).toBe(0);
    expect(v.instalments.every((i) => !i.billedBeforeGoLive && i.paidBeforeGoLiveSen === 0)).toBe(true);
  });
});

describe('paidBeforeGoLiveOf: a contract seeded with only the whole amount AutoCount booked (golive_contract_sen)', () => {
  test('HILLPARK E13A-01: seeded at the cut-over with no invoiced-before figure still reads as paid (chew, 23 Nov 2026)', async () => {
    const { fakeSb } = await import('../src/scm/lib/fake-postgrest');
    const { paidBeforeGoLiveOf } = await import('../src/acc/reno-paid-before-golive');
    const sb = fakeSb({
      mfg_sales_orders: [{ company_id: 1, doc_no: 'TC-SO-2607-010', debtor_code: '301-M232', so_date: '2026-07-01', status: 'CONFIRMED' }],
      reno_so_contracts: [{ so_doc_no: 'TC-SO-2607-010', billed_before_golive_sen: 0, golive_contract_sen: 3_785_500 }],
      sales_invoices: [], customer_credits: [],
    });
    expect((await paidBeforeGoLiveOf(sb, 1, ['TC-SO-2607-010'])).get('TC-SO-2607-010')).toBe(3_785_500);
  });
});

describe('paidBeforeGoLiveOf: the uploaded invoiced figure wins over the cut-over amount', () => {
  test('THE HENGE E18-01: a price cut agreed before go-live but approved after it is not read as money received (chew, 23 Nov 2026)', async () => {
    const { fakeSb } = await import('../src/scm/lib/fake-postgrest');
    const { paidBeforeGoLiveOf } = await import('../src/acc/reno-paid-before-golive');
    const sb = fakeSb({
      mfg_sales_orders: [{ company_id: 1, doc_no: 'TC-SO-2505-001', debtor_code: '301-M231', so_date: '2025-05-01', status: 'CONFIRMED' }],
      reno_so_contracts: [{ so_doc_no: 'TC-SO-2505-001', billed_before_golive_sen: 10_228_050, golive_contract_sen: 10_528_050 }],
      sales_invoices: [{ company_id: 1, debtor_code: '301-M231', total_sen: 2_437_850, status: 'SENT', opening_balance: true }],
      customer_credits: [],
    });
    expect((await paidBeforeGoLiveOf(sb, 1, ['TC-SO-2505-001'])).get('TC-SO-2505-001')).toBe(7_790_200);
  });

  test('billedBeforeGoLiveOf: the uploaded figure, else the cut-over amount, never below 0', async () => {
    const { billedBeforeGoLiveOf } = await import('../src/acc/reno-paid-before-golive');
    expect(billedBeforeGoLiveOf({ billed_before_golive_sen: 100, golive_contract_sen: 300 })).toBe(100);
    expect(billedBeforeGoLiveOf({ billed_before_golive_sen: 0, golive_contract_sen: 300 })).toBe(300);
    expect(billedBeforeGoLiveOf({ billed_before_golive_sen: null, golive_contract_sen: null })).toBe(0);
    expect(billedBeforeGoLiveOf({ billed_before_golive_sen: -5, golive_contract_sen: -5 })).toBe(0);
  });
});
