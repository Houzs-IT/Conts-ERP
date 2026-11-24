import { describe, expect, it } from 'vitest';
import { paymentsOf } from './beta';
import { assembleView } from '../../scm/lib/renovation-billing';

/* Click sweep F6 / F31 (21 Nov 2026): the project page read "0 of 4 received" and "Instalment 1 is billed, not paid"
   while instalment 1's invoice was PAID by the deposit, and the four instalments added up to RM 10 more than the order
   because the contract credit note was not taken off. */
const insts = [1, 2, 3, 4].map((seq) => ({ id: `i${seq}`, seq, label: `${seq}`, pctBp: [3000, 3000, 3500, 500][seq - 1]!, description: '', stageCode: null, trigger: 'manual' }));

describe('paymentsOf on a renovation contract', () => {
  it('shows instalment 1 paid by the deposit, and the credit note brings what is left to the order balance', () => {
    const view = assembleView('TC-SO-2611-915', 'RENO_CONFIRMED', null, 1_722_000, insts, [{
      instalment_id: 'i1', seq: 1, kind: 'INVOICE', amount_sen: 250_800, invoice_date: '2026-11-07', invoice_number: 'TC-SI-2611-009',
      sales_invoice_id: 'si-9', note_number: null, credit_note_id: null, paid_sen: 0, si_status: 'PAID', cn_status: null,
    }], 1_000, [], 0, 835_000);
    const p = paymentsOf(view, { docNo: 'TC-SO-2611-915', totalSen: 1_722_000, receipts: [
      { paidOn: '2026-11-07', amountSen: 250_800, method: 'transfer' }, { paidOn: '2026-11-07', amountSen: 584_200, method: 'cash' },
    ] });
    if (p.state !== 'ok') throw new Error('expected ok');
    expect(p.instalments[0]!.status).toBe('paid');
    expect(p.receivedSen).toBe(835_000);
    const scheduled = p.instalments.reduce((s, i) => s + i.amountSen, 0);
    const toCollect = p.instalments.reduce((s, i) => s + Math.max(0, i.amountSen - i.paidSen), 0);
    // what is left to collect on the schedule is exactly the order's balance
    expect(toCollect).toBe(1_722_000 - 835_000);
    expect(scheduled - 1_000).toBe(1_722_000);
  });

  it('counts a receipt on instalment 2 without taking the deposit off instalment 1', () => {
    const view = assembleView('TC-SO-2611-913', 'RENO_CONFIRMED', null, 80_000, insts, [1, 2].map((seq) => ({
      instalment_id: `i${seq}`, seq, kind: 'INVOICE' as const, amount_sen: 24_000, invoice_date: '2026-11-07', invoice_number: `SI-${seq}`,
      sales_invoice_id: `si-${seq}`, note_number: null, credit_note_id: null, paid_sen: seq === 2 ? 10_000 : 0, si_status: 'SENT', cn_status: null,
    })), 0, [], 0, 24_000);
    const p = paymentsOf(view, { docNo: 'TC-SO-2611-913', totalSen: 80_000, receipts: [{ paidOn: '2026-11-07', amountSen: 24_000, method: 'cash' }] });
    if (p.state !== 'ok') throw new Error('expected ok');
    expect(p.instalments.map((i) => i.paidSen)).toEqual([24_000, 10_000, 0, 0]);
    expect(p.instalments[0]!.status).toBe('paid');
    expect(p.receivedSen).toBe(34_000);
  });
});
