/* Complete on an order whose line was already delivered raises no second DO, yet the DO is still the order's: without the
   link its photos and POD never reached that delivery. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./delivery-orders-mfg', async (original) => ({
  ...(await original<typeof import('./delivery-orders-mfg')>()),
  soDeliverableRemaining: async () => new Map([['so1', { remaining: 0 }]]),
}));

import { completeDoStep, deliveryOfDeliveredLines, mergedPhotos } from './production-orders';

function fakeSb(tables: Record<string, unknown[]>) {
  const updates: Array<[string, unknown]> = [];
  const query = (table: string) => {
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, in: () => q, not: () => q, neq: () => q,
      update: (row: unknown) => { updates.push([table, row]); return q; },
      maybeSingle: async () => ({ data: null }),
      then: (ok: (v: unknown) => unknown) => ok({ data: tables[table] ?? [], error: null }),
    };
    return q;
  };
  return { sb: { from: query }, updates };
}

const order = { id: 'o1', po_number: 'TC-PRO-1', status: 'SUBMITTED', on_hold: false, source_po_id: 'p1', purchase_location_id: null, completion_grn_id: null, completion_do_id: null, completion_step: 'grn', actual_start_at: 'x' };

describe('Complete with the line already delivered', () => {
  it('links the delivery that carried it and raises nothing', async () => {
    const { sb, updates } = fakeSb({
      production_order_items: [{ so_item_id: 'so1', qty: 1 }],
      mfg_sales_order_items: [{ id: 'so1', doc_no: 'SO-1' }],
      delivery_order_items: [{ delivery_order_id: 'do9', dord: { status: 'DELIVERED' } }],
    });
    expect(await completeDoStep({} as never, sb, order as never)).toBeNull();
    expect(updates).toEqual([['production_orders', { completion_do_id: 'do9' }]]);
  });
  it('prefers a live delivery to a draft', () => {
    expect(deliveryOfDeliveredLines([{ delivery_order_id: 'draft', dord: { status: 'DRAFT' } }, { delivery_order_id: 'live', dord: { status: 'DELIVERED' } }])).toBe('live');
    expect(deliveryOfDeliveredLines([{ delivery_order_id: 'draft', dord: { status: 'DRAFT' } }])).toBe('draft');
    expect(deliveryOfDeliveredLines([])).toBeNull();
  });
});

describe('line photos on Complete', () => {
  it('adds the order line photos without repeating what the DO line has', () => {
    expect(mergedPhotos(['a'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(mergedPhotos(null, null)).toEqual([]);
  });
});
