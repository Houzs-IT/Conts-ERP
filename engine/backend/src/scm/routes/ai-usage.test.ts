/* GET /accounting/ai-usage — the active company's months and its latest failures; months clamped to 1..24; no company,
   no report. The Accounting area guard and the Ledger in front of it are scm/index.ts's (mounted on /accounting). */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { aiUsageRoutes } from './ai-usage';

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

  test('no active company: refused', async () => {
    expect((await appFor(null, []).req()).status).toBe(409);
  });
});
