/* POST /payment-vouchers/extract — each bill of the pile is its own request, so the 12-bill cap is the pile's; the
 * server adds the KV speed bump (middleware/rateLimit.ts) per person per company: past BILL_READS_PER_WINDOW in the
 * window it answers 429 before reading the body or calling the reader. Open when KV is unbound. (Review of #860.)
 */
import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';
import { extractBillsHandler, BILL_READS_PER_WINDOW } from '../src/scm/routes/pv-extract';

const kv = (start: number) => {
  const m = new Map<string, string>();
  return {
    m,
    seed: (k: string) => m.set(k, String(start)),
    get: vi.fn(async (k: string) => m.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { m.set(k, v); }),
    delete: vi.fn(async (k: string) => { m.delete(k); }),
  };
};

const appFor = () => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('houzsUser' as never, { id: 9, name: 'Tester', permissions_set: new Set(['*']) } as never);
    c.set('companyId' as never, 1 as never);
    await next();
  });
  app.post('/payment-vouchers/extract', extractBillsHandler as never);
  return app;
};
const post = (env: Record<string, unknown>) => appFor().request('/payment-vouchers/extract', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"bills":[]}',
}, env);

describe('bill reads per person per company', () => {
  test('past the limit: 429 with a sentence, the body never read', async () => {
    const store = kv(BILL_READS_PER_WINDOW);
    const env = { ANTHROPIC_API_KEY: 'k', SESSION_CACHE: store };
    const first = await post(env); // counts 1, then fails on the empty pile
    expect(first.status).toBe(400);
    const key = [...store.m.keys()][0]!;
    expect(key).toMatch(/bill_read:1:9$/);
    store.m.set(key, String(BILL_READS_PER_WINDOW));
    const res = await post(env);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'too_many_reads' });
  });

  test('no KV bound: no limit', async () => {
    const res = await post({ ANTHROPIC_API_KEY: 'k' });
    expect(res.status).toBe(400);
  });
});
