/* Review of #856: a completion receipt left as a draft, whose PO line was then received by hand, was refused by the
   PO -> GRN cap (migration 0272) on every retry of Complete. It is now dropped and re-raised for what is still open. */
import { describe, expect, it } from 'vitest';
import { staleCompletionDraft } from './production-orders';

describe('staleCompletionDraft', () => {
  it('a draft the cap refuses is stale', () => {
    expect(staleCompletionDraft('DRAFT', 'qty_exceeds_remaining')).toBe(true);
  });
  it('any other failure, or a receipt already posted, is reported as before', () => {
    expect(staleCompletionDraft('DRAFT', 'zero_cost_receipt')).toBe(false);
    expect(staleCompletionDraft('POSTED', 'qty_exceeds_remaining')).toBe(false);
    expect(staleCompletionDraft(undefined, 'qty_exceeds_remaining')).toBe(false);
  });
});
