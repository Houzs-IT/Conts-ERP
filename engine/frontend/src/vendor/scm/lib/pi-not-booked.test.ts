/* A purchase invoice post can answer 200 with the payables entry refused: the
   batch Confirm lists it under "Confirmed, but check" (review fix on #854). */
import { describe, expect, it } from 'vitest';
import { piNotBookedProblem } from './purchase-invoice-queries';
import { confirmInTurn } from './batch-confirm';

describe('piNotBookedProblem', () => {
  it('says the invoice is confirmed but not booked, with the reason', () => {
    expect(piNotBookedProblem({ purchaseInvoice: {}, ledger: { posted: false, status: 'group_unbound', reason: 'Item group BUILTIN has no account' } }))
      .toBe('confirmed, but not booked to payables (Item group BUILTIN has no account)');
    expect(piNotBookedProblem({ ledger: { posted: false, status: 'zero_total', reason: null } }))
      .toBe('confirmed, but not booked to payables (zero_total)');
  });

  it('is quiet when the post booked normally', () => {
    expect(piNotBookedProblem({ purchaseInvoice: {} })).toBeNull();
    expect(piNotBookedProblem(null)).toBeNull();
  });

  it('a not-booked invoice is confirmed-but-check in the batch outcome, not a failure', async () => {
    const out = await confirmInTurn(['PI-1', 'PI-2'], (r) => r, async (r) =>
      piNotBookedProblem(r === 'PI-2' ? { ledger: { posted: false, status: 'post_failed', reason: 'no AP account' } } : {}));
    expect(out.done).toEqual(['PI-1', 'PI-2']);
    expect(out.failed).toEqual([]);
    expect(out.warned).toEqual([{ doc: 'PI-2', reason: 'confirmed, but not booked to payables (no AP account)' }]);
  });
});
