/* WORKS AND BUILT-IN SERVE ONE UNIT (owner, 4 Nov 2026): the PO opened from an SO is for that unit, as a sofa's is; other
   goods pool like a mattress. The category decides, as the group differs by path. A renovation contract never reaches this
   allocator (RENO_* are terminal here): its pill comes from MRP, routes/mrp.ts boundLine. */
import { describe, expect, test } from 'vitest';
import { recomputeSoStockAllocation } from './so-stock-allocation';

type Row = Record<string, any>;

function fakeSb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let pendingUpdate: Row | null = null;
    let pendingInsert: Row | Row[] | null = null;
    const src = () => (tables[table] ??= []);
    const rows = () => src().filter((r) => filters.every((f) => f(r)));
    const settle = () => {
      if (pendingInsert) {
        const add = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
        src().push(...add);
        return { data: add, error: null };
      }
      if (pendingUpdate) {
        const hit = rows();
        for (const r of hit) Object.assign(r, pendingUpdate);
        return { data: hit, error: null };
      }
      return { data: rows(), error: null };
    };
    const builder: any = {
      select: () => builder,
      insert: (p: Row | Row[]) => { pendingInsert = p; return builder; },
      upsert: (p: Row | Row[]) => { pendingInsert = p; return builder; },
      update: (p: Row) => { pendingUpdate = p; return builder; },
      eq: (c: string, v: unknown) => { filters.push((r) => String(r[c]) === String(v)); return builder; },
      in: (c: string, vs: unknown[]) => { const set = new Set(vs.map(String)); filters.push((r) => set.has(String(r[c]))); return builder; },
      gt: (c: string, v: unknown) => {
        if (c.includes('.')) {
          const [head, tail] = c.split('.') as [string, string];
          filters.push((r) => Array.isArray(r[head]) && r[head].some((e: Row) => Number(e[tail] ?? 0) > Number(v)));
        } else filters.push((r) => Number(r[c] ?? 0) > Number(v));
        return builder;
      },
      not: (c: string, op: string, v: string | null) => {
        if (op === 'is' && v === null) { filters.push((r) => r[c] !== null && r[c] !== undefined); return builder; }
        if (op !== 'in') throw new Error(`fake: unsupported not(${op})`);
        const set = new Set(String(v).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')));
        filters.push((r) => !set.has(String(r[c.includes('.') ? c.split('.').pop()! : c])));
        return builder;
      },
      or: () => builder,
      order: () => builder,
      range: () => builder,
      limit: () => builder,
      maybeSingle: async () => { const s = settle(); return { data: (s.data as Row[])?.[0] ?? null, error: null }; },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(settle()).then(resolve),
    };
    return builder;
  };
  return { from, tables } as any;
}

const WH = 'WH-MAIN';

const world = (code: string, category: string, poItems: Row[], onHand: number) => fakeSb({
  stock_allocation_recompute_lock: [{ lock_key: 'GLOBAL', locked_by: null, locked_until: null }],
  mfg_sales_orders: [{
    doc_no: 'TEST-SO-0001', status: 'CONFIRMED', created_at: '2026-08-01T00:00:00Z',
    customer_delivery_date: '2026-09-01', company_id: 1, processing_date: '2026-08-15', proceeded_at: null,
  }],
  mfg_sales_order_items: [{
    id: 'line-1', doc_no: 'TEST-SO-0001', item_code: code, item_group: 'works',
    variants: null, qty: 1, warehouse_id: WH, stock_status: 'PENDING', stock_qty_ready: 0,
    cancelled: false, allocated_batch_no: null, po_items: poItems,
  }],
  mfg_products: [{ code, category }],
  inventory_balances: onHand ? [{ warehouse_id: WH, item_code: code, variant_key: '', qty: onHand }] : [],
  v_inventory_lots_open: [],
  delivery_orders: [], delivery_order_items: [], delivery_returns: [], delivery_return_items: [],
  purchase_order_items: [], mfg_so_audit_log: [], mfg_so_status_changes: [],
});

const lineOf = (sb: any) => sb.tables['mfg_sales_order_items'][0];

describe('Works and Built-in are bound to their own SO', () => {
  test.each(['WORKS', 'BUILTIN'])('%s stock received for another unit does not light the line', async (category) => {
    const sb = world('RN-FEATURE_WALL', category, [], 5);
    expect((await recomputeSoStockAllocation(sb)).ok).toBe(true);
    expect(lineOf(sb).stock_status).toBe('PENDING');
  });

  test.each(['WORKS', 'BUILTIN'])('%s its own received PO lights the line with nothing in the pool', async (category) => {
    const sb = world('RN-FEATURE_WALL', category, [{ qty: 1, received_qty: 1 }], 0);
    expect((await recomputeSoStockAllocation(sb)).ok).toBe(true);
    expect(lineOf(sb).stock_status).toBe('READY');
  });

  test('other goods still pool', async () => {
    const sb = world('TV-HIS-50', 'APPLIANCE', [], 5);
    expect((await recomputeSoStockAllocation(sb)).ok).toBe(true);
    expect(lineOf(sb).stock_status).toBe('READY');
  });
});
