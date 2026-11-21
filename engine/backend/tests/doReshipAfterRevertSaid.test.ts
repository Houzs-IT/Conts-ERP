/* PR #1126 deferred D6 (still open): shipping a DO again after a revert to Draft cannot re-deduct its stock yet. Until
   it can, the ship must SAY so - before, it returned no error and the stock silently stayed too high. Fails before. */
import { describe, expect, test, vi } from 'vitest';
import { fakeSb } from '../src/scm/lib/fake-postgrest';

vi.mock('../src/scm/lib/so-stock-allocation', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  recomputeSoStockAllocation: async () => ({ ok: true }),
}));

const { deductInventoryForDo } = await import('../src/scm/routes/delivery-orders-mfg');

const movements = (withReversal: boolean) => [
  { id: 'm1', source_doc_type: 'DO', source_doc_id: 'do-1', movement_type: 'OUT', item_code: 'BED-A', qty: 2 },
  ...(withReversal ? [{ id: 'm2', source_doc_type: 'ADJUSTMENT', source_doc_id: 'do-1', movement_type: 'ADJUSTMENT', item_code: 'BED-A', qty: 2 }] : []),
];

describe('D6: a DO shipped again after a revert to Draft', () => {
  test('says the stock was not taken out again', async () => {
    const sb = fakeSb({ inventory_movements: movements(true), delivery_orders: [{ id: 'do-1', do_number: 'DO-1' }] });
    const errs = await deductInventoryForDo(sb, 'do-1', 'u1');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/NOT taken out again/);
  });

  test('a DO already shipped and never reverted stays a quiet no-op', async () => {
    const sb = fakeSb({ inventory_movements: movements(false), delivery_orders: [{ id: 'do-1', do_number: 'DO-1' }] });
    expect(await deductInventoryForDo(sb, 'do-1', 'u1')).toEqual([]);
  });
});
