// A status write must not overwrite a cancel that landed after it read the row, and a cancel whose stock reversal
// failed must be retryable: pressing Cancel again used to echo CANCELLED and leave the stock deducted for good.
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { cancelReversalRetryDue, patchDeliveryOrderStatusHandler } from '../src/scm/routes/delivery-orders-mfg';
import { fakeSb } from '../src/scm/lib/fake-postgrest';

type Row = Record<string, any>;

function harness(tables: Record<string, Row[]>, hook?: (table: string) => void) {
  const rpcCalls: string[] = [];
  const base = fakeSb(tables);
  const sb = {
    ...base,
    from: (t: string) => { hook?.(t); return base.from(t); },
    rpc: async (name: string) => { rpcCalls.push(name); return { data: 1, error: null }; },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, 1 as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { id: 9, name: 'Tester', permissions_set: new Set(['*']) } as never);
    await next();
  });
  app.patch('/do/:id/status', patchDeliveryOrderStatusHandler as never);
  const patch = (status: string) => app.request('/do/d1/status', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
  return { patch, rpcCalls };
}

describe('DO status write', () => {
  test('a cancel landing between the read and the write wins', async () => {
    const row: Row = { id: 'd1', company_id: 1, do_number: 'DO-1', status: 'LOADED', so_doc_no: null, warehouse_id: 'w', updated_at: null, customer_delivered_date: null, delivered_at: null };
    let reads = 0;
    const { patch } = harness({ delivery_orders: [row] }, (t) => { if (t === 'delivery_orders' && ++reads === 2) row.status = 'CANCELLED'; });
    const res = await patch('DISPATCHED');
    expect(res.status).toBe(409);
    expect(row.status).toBe('CANCELLED');
  });
});

describe('retrying a failed cancel', () => {
  const longAgo = new Date(Date.now() - 3_600_000).toISOString();
  const tables = (updatedAt: string): Record<string, Row[]> => ({
    delivery_orders: [{ id: 'd1', company_id: 1, do_number: 'DO-1', status: 'CANCELLED', so_doc_no: null, warehouse_id: 'w', updated_at: updatedAt, is_dropship: false }],
    inventory_movements: [],
  });
  test('a later Cancel runs the reversal again', async () => {
    const { patch, rpcCalls } = harness(tables(longAgo));
    expect((await patch('CANCELLED')).status).toBe(200);
    expect(rpcCalls).toEqual(['fn_reverse_do_out']);
  });
  test('a double press does not', async () => {
    const { patch, rpcCalls } = harness(tables(new Date().toISOString()));
    expect((await patch('CANCELLED')).status).toBe(200);
    expect(rpcCalls).toEqual([]);
  });
  test('the window', () => {
    expect(cancelReversalRetryDue(null, Date.now())).toBe(false);
    expect(cancelReversalRetryDue('2026-11-06T00:00:00Z', Date.parse('2026-11-06T00:00:59Z'))).toBe(false);
    expect(cancelReversalRetryDue('2026-11-06T00:00:00Z', Date.parse('2026-11-06T00:01:00Z'))).toBe(true);
  });
});
