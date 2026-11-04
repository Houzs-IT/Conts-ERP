import { describe, expect, it } from 'vitest';
import { hardBoundSplitRefusal, hardBoundUnlinkRefusal } from './hard-bound-po-line';
import { isBoundForCompany } from './bound-line-ordered';
import { dedicatedlyCoveredSoItemIds } from './check-stock-availability';
import { isUnitBoundCategory, loadUnitBoundCodes, NO_UNIT_BOUND_CODES } from './unit-bound-sku';

const works = { item_group: 'works', item_code: 'RN-HACKING' };
const bound = new Set(['RN-HACKING']);

/* Answers each table once; every chained call returns the same object. */
function fakeSb(tables: Record<string, unknown[]>, failing?: string) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      reads.push(table);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'filter', 'order', 'range']) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(
        table === failing ? { data: null, error: { message: 'down' } } : { data: tables[table] ?? [], error: null },
      ).then(ok);
      return q;
    },
  };
}

describe('isUnitBoundCategory', () => {
  it('names Works and Built-in, in any case, and nothing else', () => {
    expect(['WORKS', 'builtin', 'FURNITURE', 'MATTRESS', '', null].map(isUnitBoundCategory)).toEqual([true, true, false, false, false, false]);
  });
});

describe('loadUnitBoundCodes', () => {
  it('keeps only the Works and Built-in codes', async () => {
    const sb = fakeSb({ mfg_products: [{ code: 'A', category: 'WORKS' }, { code: 'B', category: 'BUILTIN' }, { code: 'C', category: 'APPLIANCE' }] });
    expect([...await loadUnitBoundCodes(sb, 1, ['A', 'B', 'C'])].sort()).toEqual(['A', 'B']);
  });
  it('costs no read with no codes or no company', async () => {
    const sb = fakeSb({});
    await loadUnitBoundCodes(sb, 1, ['', null]);
    await loadUnitBoundCodes(sb, null, ['A']);
    expect(sb.reads).toEqual([]);
  });
  it('a failed read throws rather than pooling the line', async () => {
    await expect(loadUnitBoundCodes(fakeSb({}, 'mfg_products'), 1, ['A'])).rejects.toThrow('unit_bound_load_failed');
  });
});

describe('a Works PO line stays with its SO', () => {
  it('cannot be unlinked', () => {
    expect(hardBoundUnlinkRefusal(1, works, 'so-1', null, bound)?.error).toBe('hard_bound_unlink_refused');
    expect(hardBoundUnlinkRefusal(1, works, 'so-1', null, NO_UNIT_BOUND_CODES)).toBeNull();
  });
  it('cannot be split across orders', () => {
    expect(hardBoundSplitRefusal(1, works, bound)?.error).toBe('hard_bound_line_not_splittable');
    expect(hardBoundSplitRefusal(1, works, NO_UNIT_BOUND_CODES)).toBeNull();
  });
  it('binding stays a company 1 rule', () => {
    expect(hardBoundSplitRefusal(2, works, bound)).toBeNull();
    expect(isBoundForCompany(2, works, bound)).toBe(false);
    expect(isBoundForCompany(1, works, bound)).toBe(true);
  });
});

describe('DO stock check', () => {
  const line = { soItemId: 'so-1', itemCode: 'RN-HACKING', itemGroup: 'RENOVATION', qty: 1, warehouseId: 'WH' };
  const received = {
    purchase_order_items: [{ so_item_id: 'so-1', received_qty: 1, po: { status: 'RECEIVED' } }],
    inventory_balances: [{ item_code: 'RN-HACKING', warehouse_id: 'WH', variant_key: '', qty: 1 }],
  };

  it('a Works line covered by its own received PO needs no pooled stock', async () => {
    const sb = fakeSb({ ...received, mfg_products: [{ code: 'RN-HACKING', category: 'WORKS' }] });
    expect([...await dedicatedlyCoveredSoItemIds(sb, [line], 1)]).toEqual(['so-1']);
  });
  it('other goods take the pooled check', async () => {
    const sb = fakeSb({ ...received, mfg_products: [{ code: 'RN-HACKING', category: 'APPLIANCE' }] });
    expect([...await dedicatedlyCoveredSoItemIds(sb, [line], 1)]).toEqual([]);
  });
  it('a failed category read falls back to the pooled check', async () => {
    const sb = fakeSb(received, 'mfg_products');
    expect([...await dedicatedlyCoveredSoItemIds(sb, [line], 1)]).toEqual([]);
  });
});
