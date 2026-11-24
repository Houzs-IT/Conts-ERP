import { describe, expect, it } from 'vitest';
import { grnReverseWouldGoNegative } from './grn-reverse-guard';

/* A PostgREST-shaped stub: every filter chains, awaiting it answers the table's rows. */
const fakeSb = (tables: Record<string, unknown[]>) => ({
  from(table: string) {
    const rows = tables[table] ?? [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'filter']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => ok({ data: rows, error: null });
    return q;
  },
});

const line = { qty_accepted: 4, item_code: 'ACC-HKA-LONGPILLOW', item_group: 'ACCESSORIES', variants: null };

describe('cancelling a GRN on a bucket that was negative before it (click sweep 2, G3)', () => {
  it('passes when the GRN own lot still holds what it received, although on-hand is lower', async () => {
    const sb = fakeSb({
      inventory_balances: [{ item_code: 'ACC-HKA-LONGPILLOW', variant_key: '', qty: 2 }],
      inventory_lots: [{ item_code: 'ACC-HKA-LONGPILLOW', variant_key: '', qty_remaining: 4 }],
    });
    expect(await grnReverseWouldGoNegative(sb, 'wh-1', [line], 'grn-1')).toBeNull();
  });

  it('still refuses when something drew on the GRN own lot', async () => {
    const sb = fakeSb({
      inventory_balances: [{ item_code: 'ACC-HKA-LONGPILLOW', variant_key: '', qty: 2 }],
      inventory_lots: [{ item_code: 'ACC-HKA-LONGPILLOW', variant_key: '', qty_remaining: 1 }],
    });
    expect(await grnReverseWouldGoNegative(sb, 'wh-1', [line], 'grn-1')).toMatchObject({ error: 'grn_consumed_downstream' });
  });

  it('a caller that names no GRN keeps the on-hand rule', async () => {
    const sb = fakeSb({
      inventory_balances: [{ item_code: 'ACC-HKA-LONGPILLOW', variant_key: '', qty: 2 }],
      inventory_lots: [{ item_code: 'ACC-HKA-LONGPILLOW', variant_key: '', qty_remaining: 4 }],
    });
    expect(await grnReverseWouldGoNegative(sb, 'wh-1', [line])).toMatchObject({ error: 'grn_consumed_downstream' });
  });
});
