import { describe, expect, it } from 'vitest';
import { attachPoLines } from './production-line-export';

const line = { id: 'l1', production_order_id: 'o1', line_no: 1, created_at: null, item_code: 'RN-PLASTER_CEILING', qty: 120, received_qty: 0, warehouse_id: null, so_item_id: null, variants: null, item_group: 'works' };

/* Answers every read with the one line: the only read that has rows is the line read. */
function fake() {
  const q = {
    select: () => q, order: () => q, in: () => q, eq: () => q,
    range: async () => ({ data: [line], error: null }),
  };
  return { from: () => q };
}

const remaining = async (status: string) => {
  const out = await attachPoLines(fake(), { get: () => 1 } as never, [{ id: 'o1', status }]);
  return out.rows[0]?.lines[0];
};

describe('the line columns of a production order', () => {
  it('a Completed order has nothing remaining: Complete books no received_qty on its lines', async () => {
    expect(await remaining('RECEIVED')).toMatchObject({ qty: 120, received_qty: 120, remaining_qty: 0 });
  });

  it('an open order still shows what is left', async () => {
    expect(await remaining('SUBMITTED')).toMatchObject({ qty: 120, received_qty: 0, remaining_qty: 120 });
  });
});
