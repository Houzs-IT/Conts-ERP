// POST /stock-transfers must refuse a transfer the SOURCE warehouse cannot cover
// (found 20 Nov 2026: 99 out of a bucket holding 5 posted), before anything is
// written, with a sentence naming the item, the warehouse, on hand and asked.
// A transfer within stock still posts, and the database's own race refusal
// (migration 0353, P0414) is worded the same way.
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';

import { fakeSb } from '../lib/fake-postgrest';
import type { Env, Variables } from '../env';

type RpcResult = { data: unknown; error: { code?: string; message: string; details?: string } | null };
let rpcResult: RpcResult = { data: 1, error: null };
const rpcCalls: unknown[] = [];

function makeSb() {
  rpcCalls.length = 0;
  return Object.assign(
    fakeSb({
      warehouses: [
        { id: 'wh-1', code: 'WH-A', name: 'Warehouse A', company_id: 1 },
        { id: 'wh-2', code: 'WH-B', name: 'Warehouse B', company_id: 1 },
      ],
      stock_transfers: [],
      stock_transfer_lines: [],
      v_inventory_lots_open: [
        { warehouse_id: 'wh-1', item_code: 'SKU-1', variant_key: '', qty_remaining: 5, batch_no: null, company_id: 1 },
        // Stock elsewhere does NOT count for a transfer out of wh-1.
        { warehouse_id: 'wh-2', item_code: 'SKU-1', variant_key: '', qty_remaining: 500, batch_no: null, company_id: 1 },
      ],
      inventory_movements: [],
      entity_audit_log: [],
      app_config: [],
    }),
    {
      rpc: async (fn: string, args: unknown) => {
        if (fn !== 'fn_stock_transfer_apply') return { data: true, error: null }; // audit probe etc.
        rpcCalls.push(args);
        return rpcResult;
      },
    },
  );
}

vi.mock('../../db/supabase', () => ({ getSupabaseService: () => sb }));
let sb = makeSb();

const CALLER = {
  id: '7', email: 'buyer@houzs.test', app_metadata: {},
  user_metadata: { name: 'Buyer' }, aud: 'authenticated', created_at: '',
} as unknown as User;

const { stockTransfers } = await import('./stock-transfers');

async function post(body: Record<string, unknown>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('user', CALLER);
    c.set('companyId', 1);
    c.set('supabase', sb as never);
    await next();
  });
  app.route('/', stockTransfers);
  return app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const base = { fromWarehouseId: 'wh-1', toWarehouseId: 'wh-2', transferDate: '2026-11-20' };

describe('POST stock-transfers — the source must hold the qty', () => {
  it('refuses 99 out of 5 with a plain sentence, and writes nothing', async () => {
    sb = makeSb();
    rpcResult = { data: 1, error: null };
    const res = await post({ ...base, items: [{ itemCode: 'SKU-1', variantKey: '', qty: 99 }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'insufficient_stock',
      message: 'Only 5 of SKU-1 in WH-A; this transfer asks for 99.',
    });
    expect(sb.tables.stock_transfers).toHaveLength(0);
    expect(sb.tables.stock_transfer_lines).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it('two lines of one bucket are added together', async () => {
    sb = makeSb();
    const res = await post({ ...base, items: [{ itemCode: 'SKU-1', variantKey: '', qty: 3 }, { itemCode: 'SKU-1', variantKey: '', qty: 3 }] });
    expect(res.status).toBe(409);
    expect(sb.tables.stock_transfers).toHaveLength(0);
  });

  it('posts a transfer within stock', async () => {
    sb = makeSb();
    rpcResult = { data: 1, error: null };
    const res = await post({ ...base, items: [{ itemCode: 'SKU-1', variantKey: '', qty: 5 }] });
    expect(res.status).toBe(201);
    expect(sb.tables.stock_transfers).toHaveLength(1);
    expect(sb.tables.stock_transfers[0]!.status).toBe('POSTED');
    expect(rpcCalls).toHaveLength(1);
  });

  it('words the database race refusal (P0414) the same way, and the header is cancelled', async () => {
    sb = makeSb();
    rpcResult = {
      data: null,
      error: {
        code: 'P0414',
        message: 'insufficient_stock: only 2 of SKU-1 at the source warehouse; this transfer asks for 4',
        details: '{"item_code" : "SKU-1", "variant_key" : "", "available" : 2, "requested" : 4}',
      },
    };
    const res = await post({ ...base, items: [{ itemCode: 'SKU-1', variantKey: '', qty: 4 }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'insufficient_stock',
      message: 'Only 2 of SKU-1 in WH-A; this transfer asks for 4.',
      status: 'CANCELLED',
    });
    expect(sb.tables.stock_transfers[0]!.status).toBe('CANCELLED');
    rpcResult = { data: 1, error: null };
  });
});
