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
