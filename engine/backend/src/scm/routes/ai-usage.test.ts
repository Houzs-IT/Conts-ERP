/* GET /accounting/ai-usage — the active company's months and its latest failures; months clamped to 1..24; no company,
   no report. The Accounting area guard and the Ledger in front of it are scm/index.ts's (mounted on /accounting). */
import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';

/* The router now declares the supabaseAuth bridge itself; stub it here the way the sibling route tests do. */
vi.mock('../middleware/auth', () => ({ supabaseAuth: async (_c: unknown, next: () => Promise<void>) => next() }));

const { aiUsageRoutes } = await import('./ai-usage');

const dbStub = (seen: unknown[][]) => ({
  prepare: (sql: string) => ({
    bind: (...args: unknown[]) => {
      seen.push([sql.includes('NOT ok') ? 'failures' : sql.includes('min(created_at)') ? 'first' : 'months', ...args]);
      return {
        first: async () => ({ first: null }),
        all: async () => ({ results: sql.includes('NOT ok')
          ? [{ created_at: '2026-11-09T02:00:00Z', feature: 'bill_extract', error: 'overloaded_error: Overloaded', http_status: 529 }]
          : [] }),
      };
    },
  }),
});

const appFor = (companyId: number | null, seen: unknown[][]) => {
  const a = new Hono<{ Variables: Record<string, unknown> }>();
  a.use('*', async (c, next) => { if (companyId != null) c.set('companyId', companyId); await next(); });
  a.route('/accounting', aiUsageRoutes);
  return { req: (q = '') => a.request(`/accounting/ai-usage${q}`, {}, { DB: dbStub(seen) }) };
};

describe('GET /accounting/ai-usage', () => {
  test("the active company's report, with its latest failures named", async () => {
    const seen: unknown[][] = [];
    const r = await appFor(4, seen).req('?months=3');
    expect(r.status).toBe(200);
    const body = await r.json() as { months: Array<{ month: string }>; recentFailures: Array<{ label: string; httpStatus: number }> };
    expect(body.months).toHaveLength(3);
    expect(body.recentFailures).toEqual([{ at: '2026-11-09T02:00:00.000Z', feature: 'bill_extract', label: 'Scan bills (payment vouchers, AP invoices)', error: 'overloaded_error: Overloaded', httpStatus: 529 }]);
    expect(seen.every((s) => s[1] === 4)).toBe(true);
  });

  test('months is clamped to 1..24', async () => {
    expect(((await (await appFor(4, []).req('?months=99')).json()) as { months: unknown[] }).months).toHaveLength(24);
    expect(((await (await appFor(4, []).req('?months=0')).json()) as { months: unknown[] }).months).toHaveLength(1);
  });

  /* Review of #860: a database error is logged, never sent to the browser. */
  test('a failed read answers a fixed sentence, not the database error', async () => {
    const a = new Hono<{ Variables: Record<string, unknown> }>();
    a.use('*', async (c, next) => { c.set('companyId', 4); await next(); });
    a.route('/accounting', aiUsageRoutes);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await a.request('/accounting/ai-usage', {}, { DB: { prepare: () => { throw new Error('relation "public.ai_usage_events" does not exist'); } } });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toMatch(/relation|ai_usage_events/);
    expect(JSON.parse(body)).toEqual({ error: 'load_failed', message: 'AI usage could not be read. Try again in a moment.' });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  test('no active company: refused', async () => {
    expect((await appFor(null, []).req()).status).toBe(409);
  });
});
