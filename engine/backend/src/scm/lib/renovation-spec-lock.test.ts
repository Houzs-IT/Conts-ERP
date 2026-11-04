import { describe, expect, it } from 'vitest';
import { receivedSpecRefusal, specMoved } from './renovation-spec-lock';

const cur = { itemCode: 'BED-1', group: 'bedframe', variants: { divanHeight: '5"', legHeight: '1"' } };

describe('specMoved', () => {
  it('a new SKU moves the spec', () => expect(specMoved(cur, { itemCode: 'BED-2' })).toBe(true));
  it('new options move the spec', () => expect(specMoved(cur, { variants: { divanHeight: '4"', legHeight: '1"' } })).toBe(true));
  it('the same options in another key order do not', () => expect(specMoved(cur, { variants: { legHeight: '1"', divanHeight: '5"' } })).toBe(false));
  it('a remark inside the options does not', () => expect(specMoved(cur, { variants: { divanHeight: '5"', legHeight: '1"', remark: 'x' } })).toBe(false));
  it('nothing sent does not', () => expect(specMoved(cur, { itemCode: 'BED-1' })).toBe(false));
});

function fakeSb(rows: { received: unknown[]; pos: unknown[]; items: unknown[] }) {
  const tables: Record<string, unknown[]> = { purchase_order_items: rows.received, purchase_orders: rows.pos, mfg_sales_order_items: rows.items };
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'in', 'gt', 'neq', 'eq']) q[m] = () => q;
      q.then = (ok: (r: unknown) => unknown) => ok({ data: tables[t], error: null });
      return q;
    },
  };
}

describe('receivedSpecRefusal', () => {
  const received = [{ so_item_id: 'I1', purchase_order_id: 'P1' }];
  const pos = [{ id: 'P1', po_number: 'TC-PO-1' }];
  const items = [{ id: 'I1', item_code: 'BED-1', item_group: 'bedframe', variants: cur.variants }];
  const moved = { salesOrderItemId: 'I1', changeType: 'SPEC', newItemCode: 'BED-1', newVariants: { divanHeight: '4"', legHeight: '1"' } };

  it('refuses new options on a received line', async () => {
    expect(await receivedSpecRefusal(fakeSb({ received, pos, items }), 'SO-1', [moved])).toEqual({ itemCode: 'BED-1', poNumber: 'TC-PO-1' });
  });
  it('lets a price change through: the options did not move', async () => {
    expect(await receivedSpecRefusal(fakeSb({ received, pos, items }), 'SO-1', [{ ...moved, newVariants: cur.variants }])).toBeNull();
  });
  it('lets a qty change through', async () => {
    expect(await receivedSpecRefusal(fakeSb({ received, pos, items }), 'SO-1', [{ ...moved, changeType: 'QTY' }])).toBeNull();
  });
  it('a cancelled PO does not lock', async () => {
    expect(await receivedSpecRefusal(fakeSb({ received, pos: [], items }), 'SO-1', [moved])).toBeNull();
  });
  it('nothing received does not lock', async () => {
    expect(await receivedSpecRefusal(fakeSb({ received: [], pos, items }), 'SO-1', [moved])).toBeNull();
  });
});
