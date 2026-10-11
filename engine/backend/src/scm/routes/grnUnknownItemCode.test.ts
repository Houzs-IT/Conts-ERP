// Owner decision C6 (Conts, 11 Oct 2026): a goods receipt with an item code that
// is not in Products is refused before anything is written.
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';

import { fakeSb, type Row } from '../lib/fake-postgrest';
import type { Env, Variables } from '../env';

const tables: Record<string, Row[]> = {
  grns: [], grn_items: [],
  mfg_products: [{ code: 'X-1', company_id: 1, status: 'ACTIVE' }],
  purchase_orders: [], purchase_order_items: [],
  warehouses: [{ id: 'wh-1', company_id: 1, is_default: true, code: 'KL' }],
  inventory_movements: [], entity_audit_log: [], app_config: [],
};
const sb = Object.assign(fakeSb(tables), { rpc: async () => ({ data: true, error: null }) });
vi.mock('../../db/supabase', () => ({ getSupabaseService: () => sb }));

const CALLER = { id: '7', email: 'buyer@example.test', app_metadata: {}, user_metadata: { name: 'Buyer' }, aud: 'authenticated', created_at: '' } as unknown as User;
const { grns } = await import('./grns');

function post(itemCode: string) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => { c.set('user', CALLER); c.set('companyId', 1); c.set('supabase', sb as never); await next(); });
  app.route('/', grns);
  return app.request('/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      supplierId: 'sup-1', warehouseId: 'wh-1',
      items: [{ materialKind: 'mfg_product', itemCode, materialName: 'Widget', qtyReceived: 1, qtyAccepted: 1, unitPriceSen: 10000, unitCostSen: 10000 }],
    }),
  });
}

describe('GRN create refuses an item code that is not in Products (C6)', () => {
  it('409 unknown_item_code, and no GRN is written', async () => {
    const res = await post('NOT-A-PRODUCT');
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; unknown: string[] };
    expect(body.error).toBe('unknown_item_code');
    expect(body.unknown).toEqual(['NOT-A-PRODUCT']);
    expect(tables.grns).toHaveLength(0);
  });
});
