import { beforeEach, describe, expect, it, vi } from 'vitest';

const remainingByLine = new Map<string, number>();
vi.mock('../routes/delivery-orders-mfg', () => ({
  soDeliverableRemaining: vi.fn(async () => new Map([...remainingByLine].map(([id, remaining]) => [id, { remaining }]))),
}));

import { drCancelCapRefusal, drCancelOverDeliveries } from './dr-cancel-cap';

/* PostgREST-shaped stub: each table answers with fixed rows. */
const sbWith = (tables: Record<string, unknown[]>, failing?: string) => ({
  from: (t: string) => {
    const result = failing === t ? { data: null, error: { message: 'boom' } } : { data: tables[t] ?? [], error: null };
    const q = { select: () => q, eq: () => q, in: () => q, then: (r: (v: unknown) => unknown) => Promise.resolve(result).then(r) };
    return q;
  },
});

const tables = {
  delivery_return_items: [{ do_item_id: 'do1-l1', qty_returned: 4 }],
  delivery_order_items: [{ id: 'do1-l1', so_item_id: 'so-l1' }],
  mfg_sales_order_items: [{ doc_no: 'SO-1' }],
};

describe('drCancelOverDeliveries', () => {
  it('flags a line whose remaining would go below zero', () => {
    expect(drCancelOverDeliveries(new Map([['a', 4]]), new Map([['a', 0]]))).toEqual([{ soItemId: 'a', remaining: 0, returnedByThisDr: 4 }]);
  });
  it('passes a line with room for the units coming back', () => {
    expect(drCancelOverDeliveries(new Map([['a', 4]]), new Map([['a', 4]]))).toEqual([]);
  });
  it('skips a line the remaining read does not know (cancelled or gone)', () => {
    expect(drCancelOverDeliveries(new Map([['a', 4]]), new Map())).toEqual([]);
  });
});

describe('drCancelCapRefusal (Houzs 127f66943, HC-0004 C)', () => {
  beforeEach(() => remainingByLine.clear());

  it('qty 10, DO1 ships 10, DR returns 4, DO2 re-ships 4: cancelling the DR is refused', async () => {
    remainingByLine.set('so-l1', 0); // 10 - 14 delivered + 4 returned
    const r = await drCancelCapRefusal(sbWith(tables), 'dr-1');
    expect(r).toMatchObject({ error: 'cancel_over_delivers', lines: [{ soItemId: 'so-l1', remaining: 0, returnedByThisDr: 4 }] });
  });

  it('no re-ship yet: the cancel goes through', async () => {
    remainingByLine.set('so-l1', 4); // 10 - 10 + 4
    expect(await drCancelCapRefusal(sbWith(tables), 'dr-1')).toBeNull();
  });

  it('a failed read refuses to guess', async () => {
    expect(await drCancelCapRefusal(sbWith(tables, 'delivery_order_items'), 'dr-1')).toBe('unreadable');
  });

  it('a return with no SO-linked line needs no check', async () => {
    expect(await drCancelCapRefusal(sbWith({ ...tables, delivery_order_items: [{ id: 'do1-l1', so_item_id: null }] }), 'dr-1')).toBeNull();
  });
});
