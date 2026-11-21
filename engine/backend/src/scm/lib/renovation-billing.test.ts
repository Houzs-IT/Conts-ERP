/* An earlier instalment billed again after its invoice was cancelled, with a later one still live, comes to what the screen
   previews, and the schedule still adds up to the contract. */
import { describe, expect, it } from 'vitest';
import { assembleView, billedBeforeInstalment, type BillingInstalment } from './renovation-billing';
import { instalmentPreview, nextInstalmentAmount } from '../shared/renovation-money';

const schedule = [{ seq: 1, pctBp: 3000 }, { seq: 2, pctBp: 4000 }, { seq: 3, pctBp: 3000 }];
const row = (seq: number, billedSen: number | null) => ({ seq, bill: billedSen === null ? null : { amountSen: billedSen } }) as unknown as BillingInstalment;

describe('billedBeforeInstalment', () => {
  it('leaves out later bills: #1 cancelled with #2 billed bills 30k, as the preview says', () => {
    const view = { billedSen: 40_000_00, instalments: [row(1, null), row(2, 40_000_00), row(3, null)] };
    const before = billedBeforeInstalment(view, 1);
    expect(before).toBe(0);
    const n = nextInstalmentAmount({ instalments: schedule, seq: 1, revisedContractSen: 100_000_00, billedSen: before });
    expect(n.amountSen).toBe(30_000_00);
    const preview = instalmentPreview(schedule, 100_000_00, new Map([[2, 40_000_00]]));
    expect(preview.find((p) => p.seq === 1)?.amountSen).toBe(n.amountSen);
    expect(preview.reduce((s, p) => s + p.amountSen, 0)).toBe(100_000_00);
  });
  it('keeps earlier bills, credits and all', () => {
    const view = { billedSen: 25_000_00, instalments: [row(1, 30_000_00), row(2, null), row(3, null)] };
    expect(billedBeforeInstalment(view, 2)).toBe(25_000_00);
  });
});

/* Click sweep F6 (21 Nov 2026): TC-SO-2611-915's instalment 1 read "Not paid" while its invoice was PAID by the
   deposit taken on the order. The bill now carries what settles its invoice. */
describe('assembleView: what settles each bill', () => {
  const insts = [1, 2, 3, 4].map((seq) => ({ id: `i${seq}`, seq, label: `${seq}`, pctBp: [3000, 3000, 3500, 500][seq - 1]!, description: '', stageCode: null, trigger: 'manual' }));
  const bill = (seq: number, siId: string, amount: number, paid = 0) => ({
    instalment_id: `i${seq}`, seq, kind: 'INVOICE' as const, amount_sen: amount, invoice_date: '2026-11-07', invoice_number: `SI-${seq}`,
    sales_invoice_id: siId, note_number: null, credit_note_id: null, paid_sen: paid, si_status: 'PAID', cn_status: null,
  });
  const inv = (id: string, n: string, total: number, own = 0) => ({ id, invoiceNumber: n, invoiceDate: '2026-11-07', status: 'SENT', totalSen: total, ownPaidSen: own, creditedSen: 0 });

  it('the order deposit settles instalment 1, and the rest of it stays unapplied', () => {
    const v = assembleView('SO', 'RENO_CONFIRMED', null, 1_722_000, insts, [bill(1, 'si-9', 250_800)], 1_000, [], 0, 835_000,
      [inv('si-9', 'TC-SI-2611-009', 250_800)]);
    expect(v.instalments[0]!.bill!.paidSen).toBe(250_800);
    expect(v.instalments[0]!.bill!.receiptsSen).toBe(0);
    expect(v.receivedSen).toBe(835_000);
    expect(v.unappliedSen).toBe(835_000 - 250_800);
  });

  it('a receipt on instalment 2 counts on top of the deposit on instalment 1 (F31)', () => {
    const v = assembleView('SO', 'RENO_CONFIRMED', null, 80_000, insts, [bill(1, 'a', 24_000), bill(2, 'b', 24_000, 10_000)], 0, [], 0, 24_000,
      [inv('a', 'TC-SI-2611-007', 24_000), inv('b', 'TC-SI-2611-008', 24_000, 10_000)]);
    expect(v.instalments.map((i) => i.bill?.paidSen ?? 0)).toEqual([24_000, 10_000, 0, 0]);
    expect(v.receivedSen).toBe(34_000);
    expect(v.unappliedSen).toBe(0);
  });
});
