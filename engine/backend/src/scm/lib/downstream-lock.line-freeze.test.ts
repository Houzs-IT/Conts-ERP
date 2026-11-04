/* readSoLineFreeze — the per-line verdict read (owner 2026-09-15). The route
   tests (tests/soLineFreezeRoutes.test.ts) cover the refusals; these pin the
   two shapes a route test does not reach. */
import { describe, expect, test } from 'vitest';
import { readSoLineFreeze, soBuildLineIds, soLineWriteRefusal } from './downstream-lock';

type Row = Record<string, unknown>;
function fakeSb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const builder: Record<string, unknown> = {
      select() { return builder; },
      range() { return builder; },
      eq(col: string, val: unknown) { filters.push((r) => String(r[col]) === String(val)); return builder; },
      in(col: string, vals: unknown[]) { const s = new Set(vals.map(String)); filters.push((r) => s.has(String(r[col]))); return builder; },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }).then(resolve);
      },
    };
    return builder;
  };
  return { from } as unknown as Parameters<typeof readSoLineFreeze>[0];
}

describe('readSoLineFreeze', () => {
  test('an instalment bill freezes nothing: it bills a share of the contract, not a line', async () => {
    const lines = [{ id: 'a', doc_no: 'SO-1', cancelled: false, variants: {} }];
    const invoice = { id: 'si-1', so_doc_no: 'SO-1', status: 'POSTED' };
    const billLine = { so_item_id: null, do_item_id: null, sales_invoice_id: 'si-1' };
    const billed = await readSoLineFreeze(fakeSb({
      mfg_sales_order_items: lines, sales_invoices: [invoice], sales_invoice_items: [billLine],
      reno_instalment_bills: [{ sales_invoice_id: 'si-1', so_doc_no: 'SO-1' }],
    }), 'SO-1');
    expect(soLineWriteRefusal(billed, ['a'])).toBeNull();
    expect(billed.ok && billed.fullyFrozen).toBe(false);

    const ordinary = await readSoLineFreeze(fakeSb({
      mfg_sales_order_items: lines, sales_invoices: [invoice], sales_invoice_items: [billLine],
    }), 'SO-1');
    expect(soLineWriteRefusal(ordinary, ['a'])?.error).toBe('so_line_frozen');
  });

  test('a delivery order raised against ANOTHER order still freezes the line it carries (a multi-order DO)', async () => {
    const sb = fakeSb({
      mfg_sales_order_items: [
        { id: 'a', doc_no: 'SO-2', cancelled: false, variants: {} },
        { id: 'b', doc_no: 'SO-2', cancelled: false, variants: {} },
      ],
      delivery_orders: [{ id: 'do-1', so_doc_no: 'SO-1', status: 'LOADED' }],
      delivery_order_items: [{ delivery_order_id: 'do-1', so_item_id: 'a' }],
    });
    const read = await readSoLineFreeze(sb, 'SO-2');
    expect(read.ok).toBe(true);
    expect(soLineWriteRefusal(read, ['a'])?.error).toBe('so_line_frozen');
    expect(soLineWriteRefusal(read, ['b'])).toBeNull();
    expect(read.ok && read.fullyFrozen).toBe(false);
  });

  test('a cancelled SO line does not keep an order open', async () => {
    const sb = fakeSb({
      mfg_sales_order_items: [
        { id: 'a', doc_no: 'SO-1', cancelled: false, variants: {} },
        { id: 'gone', doc_no: 'SO-1', cancelled: true, variants: {} },
      ],
      delivery_orders: [{ id: 'do-1', so_doc_no: 'SO-1', status: 'DELIVERED' }],
      delivery_order_items: [{ delivery_order_id: 'do-1', so_item_id: 'a' }],
    });
    const read = await readSoLineFreeze(sb, 'SO-1');
    expect(read.ok && read.fullyFrozen).toBe(true);
  });

  test('a sofa build answers for all its modules', async () => {
    const sb = fakeSb({
      mfg_sales_order_items: [
        { id: 'm1', doc_no: 'SO-1', cancelled: false, variants: { buildKey: 'build-1' } },
        { id: 'm2', doc_no: 'SO-1', cancelled: false, variants: { buildKey: 'build-1' } },
        { id: 'mattress', doc_no: 'SO-1', cancelled: false, variants: {} },
      ],
      delivery_orders: [{ id: 'do-1', so_doc_no: 'SO-1', status: 'DRAFT' }],
      delivery_order_items: [{ delivery_order_id: 'do-1', so_item_id: 'm2' }],
    });
    const read = await readSoLineFreeze(sb, 'SO-1');
    expect(soBuildLineIds(read, 'm1').sort()).toEqual(['m1', 'm2']);
    expect(soLineWriteRefusal(read, soBuildLineIds(read, 'm1'))?.error).toBe('so_line_frozen');
    expect(soBuildLineIds(read, 'mattress')).toEqual(['mattress']);
  });
});
