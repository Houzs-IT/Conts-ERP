import { describe, expect, it } from 'vitest';
import { postGrnAndRollup } from '../routes/grns';
import { fakeSb } from './fake-postgrest';

/* Two confirms of one draft: the second read DRAFT in the handler, then the first finished, so the status read inside
   the post now says POSTED. The swap must be made against what the second caller saw, or both book the stock. */
describe('GRN confirm race', () => {
  const posted = () => fakeSb({
    grns: [{ id: 'g1', grn_number: 'GRN-1', warehouse_id: 'w1', company_id: 1, status: 'POSTED', posted_at: '2026-11-06T00:00:00Z' }],
    grn_items: [{ id: 'i1', grn_id: 'g1', purchase_order_item_id: null, qty_accepted: 3, item_code: 'X', unit_price_sen: 100, line_total_sen: 300, zero_cost_ack: false }],
    inventory_movements: [],
  });
  it('the loser of the race is refused and writes no stock', async () => {
    const sb = posted();
    const out = await postGrnAndRollup(sb, 'g1', 'u1', 1, 'DRAFT');
    expect(out).toMatchObject({ ok: false, reason: 'already_posting', status: 409 });
    const { data } = await sb.from('inventory_movements').select('id');
    expect(data).toEqual([]);
  });
});

/* A failed line read is not "no lines": taken as empty it skipped the zero-cost gate and flipped the draft to POSTED
   with no stock in, and every re-post then returned early on POSTED. */
describe('GRN post with an unreadable line list', () => {
  it('refuses before the flip and writes nothing', async () => {
    const sb = fakeSb({
      grns: [{ id: 'g1', grn_number: 'GRN-1', warehouse_id: 'w1', company_id: 1, status: 'DRAFT', posted_at: null }],
      grn_items: [{ id: 'i1', grn_id: 'g1', purchase_order_item_id: null, qty_accepted: 3, item_code: 'X', unit_price_sen: 100, line_total_sen: 300, zero_cost_ack: false }],
      inventory_movements: [],
    }, { grn_items: ['zero_cost_ack'] });
    const out = await postGrnAndRollup(sb, 'g1', 'u1', 1, 'DRAFT');
    expect(out).toMatchObject({ ok: false, status: 503 });
    const { data: grn } = await sb.from('grns').select('status').eq('id', 'g1').maybeSingle();
    expect((grn as { status: string }).status).toBe('DRAFT');
  });
});
