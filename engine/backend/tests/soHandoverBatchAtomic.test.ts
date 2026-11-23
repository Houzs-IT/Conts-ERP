/* PR #1126 deferred D17. A handover batch moves whole or not at all. Fails on the code before the fix: the first order
   stayed moved when the second order's write failed. */
import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';
import { fakeSb } from '../src/scm/lib/fake-postgrest';
import { fakeRunScmPgCommand } from './lib/fake-scm-command';

vi.mock('../src/scm/lib/pg-supabase-transaction', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  runScmPgCommand: fakeRunScmPgCommand,
}));
vi.mock('../src/scm/middleware/auth', () => ({ supabaseAuth: async (_c: unknown, next: () => Promise<void>) => next() }));
vi.mock('../src/scm/lib/migrated-so-readonly', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  migratedSoReadonlyState: async () => ({ locked: false }),
}));
vi.mock('../src/scm/lib/so-agent', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  readStaffAgentName: async () => 'NEW REP',
}));

const { soHandover } = await import('../src/scm/routes/so-handover');

const world = () => Object.assign(fakeSb({
  mfg_sales_orders: [
    { doc_no: 'SO-1', company_id: 1, salesperson_id: 'rep-a', agent: 'OLD REP', status: 'CONFIRMED', linked_ac_docno: null },
    { doc_no: 'SO-2', company_id: 1, salesperson_id: 'rep-a', agent: 'OLD REP', status: 'CONFIRMED', linked_ac_docno: null },
  ],
  mfg_so_audit_log: [], autocount_outbox: [], app_config: [],
}), { rpc: async () => ({ data: true, error: null }) });

const run = (sb: unknown) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, 1 as never);
    c.set('user' as never, { id: 'u1', user_metadata: { name: 'Ops' } } as never);
    c.set('houzsUser' as never, { id: 9, name: 'Ops', permissions_set: new Set(['*']) } as never);
    await next();
  });
  app.route('/', soHandover);
  return app.request('/apply', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromStaffId: 'rep-a', toStaffId: 'rep-b', docNos: ['SO-1', 'SO-2'] }),
  });
};

describe('D17: SO handover batch', () => {
  test('moves every named order', async () => {
    const sb = world();
    const res = await run(sb);
    expect(res.status).toBe(200);
    expect(sb.tables.mfg_sales_orders.map((o) => o.salesperson_id)).toEqual(['rep-b', 'rep-b']);
  });

  test('a write that fails on the second order leaves the first unmoved too', async () => {
    const sb = world();
    const rows = sb.tables.mfg_sales_orders;
    rows[1] = new Proxy(rows[1]!, {
      set(target, prop, value) {
        if (prop === 'salesperson_id') throw new Error('connection reset');
        return Reflect.set(target, prop, value);
      },
    });
    const res = await run(sb);
    expect(res.ok).toBe(false);
    expect(sb.tables.mfg_sales_orders.map((o) => o.salesperson_id)).toEqual(['rep-a', 'rep-a']);
  });
});
