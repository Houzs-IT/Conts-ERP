import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { renovationSoWriteFence } from './renovation-write-fence';
import { setContractStatus } from './renovation-so';
import type { RenoDb } from './renovation-db';

const fenced = (cancels: string[]) => {
  const app = new Hono();
  app.use('*', renovationSoWriteFence(async () => ({ kind: 'RENOVATION', error: false }), async (c, docNo) => { cancels.push(docNo); return c.json({ status: 'CANCELLED' }); }));
  app.patch('/mfg-sales-orders/:docNo/status', (c) => c.json({ reached: 'generic handler' }));
  return app;
};
const patch = (app: Hono, status: string) =>
  app.request('/mfg-sales-orders/TC-SO-1/status', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });

describe('an approved contract cancel on the SO status route', () => {
  it('ends in the contract cancel, not the fence refusal', async () => {
    const cancels: string[] = [];
    const res = await patch(fenced(cancels), 'cancelled');
    expect(res.status).toBe(200);
    expect(cancels).toEqual(['TC-SO-1']);
  });
  it('every other status is still refused', async () => {
    const cancels: string[] = [];
    expect((await patch(fenced(cancels), 'RENO_COMPLETED')).status).toBe(409);
    expect(cancels).toEqual([]);
  });
});

describe('cancelling a contract checks every document on it', () => {
  const head = { doc_no: 'TC-SO-1', status: 'RENO_CONFIRMED', so_kind: 'RENOVATION', revision: 1, version: 1, debtor_code: null, debtor_name: null, company_id: 1, branding: null, local_total_sen: 0 };
  const dbWith = (counts: Record<string, number>): RenoDb => ({
    q: async (sql: string) => {
      if (/from scm\.mfg_sales_orders|reno_so_contracts/.test(sql) && /select/.test(sql) && !/count\(/.test(sql)) return [head] as never;
      if (/purchase_order_items/.test(sql)) return [{ n: counts.po ?? 0 }] as never;
      if (/production_order_items/.test(sql)) return [{ n: counts.pro ?? 0 }] as never;
      if (/scm\.delivery_orders/.test(sql)) return [{ n: counts.dord ?? 0 }] as never;
      return [{ n: 0 }] as never;
    },
  }) as unknown as RenoDb;
  const actor = { companyId: 1, name: 'T', staffId: 's', docPrefix: '', userId: 1 } as never;
  it('a live delivery order stops it', async () => {
    await expect(setContractStatus(dbWith({ dord: 1 }), actor, 'TC-SO-1', 'CANCELLED')).rejects.toMatchObject({ code: 'has_deliveries' });
  });
  it('a live production order stops it', async () => {
    await expect(setContractStatus(dbWith({ pro: 1 }), actor, 'TC-SO-1', 'CANCELLED')).rejects.toMatchObject({ code: 'has_production_orders' });
  });
});

describe('cancelling a contract releases its goods lines from stock allocation (Houzs f238fd2b4)', () => {
  const head = { doc_no: 'TC-SO-1', status: 'RENO_CONFIRMED', so_kind: 'RENOVATION', revision: 1, version: 1, debtor_code: null, debtor_name: null, company_id: 1, branding: null, local_total_sen: 0 };
  const actor = { companyId: 1, name: 'T', staffId: 's', docPrefix: '', userId: 1 } as never;
  const run = async (to: 'CANCELLED' | 'RENO_IN_PROGRESS') => {
    const writes: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      q: async (sql: string, params: unknown[] = []) => {
        if (/from scm\.mfg_sales_orders o/.test(sql)) return [head] as never;
        if (/count\(/.test(sql)) return [{ n: 0 }] as never;
        if (/select id, item_code, item_group from scm\.mfg_sales_order_items/.test(sql)) {
          return [
            { id: 'goods-1', item_code: 'CAB-01', item_group: 'CABINET' },
            { id: 'svc-1', item_code: 'SVC-INSTALL', item_group: 'SERVICE' },
          ] as never;
        }
        if (/^\s*update scm\.mfg_sales_order_items/.test(sql)) writes.push({ sql, params });
        return [] as never;
      },
    } as unknown as RenoDb;
    await setContractStatus(db, actor, 'TC-SO-1', to);
    return writes;
  };
  it('goods lines go back to PENDING with nothing ready and no claimed batch; service lines are left alone', async () => {
    const writes = await run('CANCELLED');
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/stock_status = 'PENDING', stock_qty_ready = 0, allocated_batch_no = null/);
    expect(writes[0].params).toEqual(['TC-SO-1', ['goods-1']]);
  });
  it('a non-cancel transition does not touch the lines', async () => {
    expect(await run('RENO_IN_PROGRESS')).toEqual([]);
  });
});
