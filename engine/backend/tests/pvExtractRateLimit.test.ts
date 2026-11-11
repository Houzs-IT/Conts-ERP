/* POST /payment-vouchers/extract — each bill of the pile is its own request, so the 12-bill cap is the pile's; the
 * server limits bill reads per person per company by COUNTING the reads already logged in public.ai_usage_events
 * over the last 10 minutes (one indexed count, no KV write: SESSION_CACHE holds 2FA challenges and revocations).
 * The count is in bills; no table or a failed count allows. (Second review of #860.)
 */
import { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fakeSb } from '../src/scm/lib/fake-postgrest';
import { BILL_READS_PER_WINDOW, EXTRACT_BODY_LIMIT, extractBillsHandler } from '../src/scm/routes/pv-extract';

const dbCounting = (n: number | 'missing') => {
  const seen: Array<{ sql: string; args: unknown[] }> = [];
  return {
    seen,
    put: vi.fn(),
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        seen.push({ sql, args });
        return {
          first: async () => { if (n === 'missing') throw new Error('relation "public.ai_usage_events" does not exist'); return { n: String(n) }; },
          run: async () => ({}),
        };
      },
    }),
  };
};

const appFor = () => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('houzsUser' as never, { id: 9, name: 'Tester', permissions_set: new Set(['*']) } as never);
    c.set('companyId' as never, 1 as never);
    c.set('supabase' as never, fakeSb({ suppliers: [], acc_vendor_memory: [] }) as never);
    await next();
  });
  app.post('/payment-vouchers/extract', extractBillsHandler as never);
  return app;
};
const bill = { files: [{ name: 'a.png', mime: 'image/png', dataBase64: 'AAAA' }] };
const post = (env: Record<string, unknown>, bills: unknown[] = [bill], headers: Record<string, string> = {}) =>
  appFor().request('/payment-vouchers/extract', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ bills }),
  }, env);

const reader = () => vi.fn(async () => new Response(JSON.stringify({
  model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 1 },
  content: [{ type: 'text', text: '{"vendorName":"TNB","totalRm":10}' }],
}), { status: 200 }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('bill reads per person per company', () => {
  test("counts this company's and this person's bill reads of the last 10 minutes, in bills", async () => {
    const f = reader();
    vi.stubGlobal('fetch', f);
    const db = dbCounting(BILL_READS_PER_WINDOW - 2);
    const ok = await post({ ANTHROPIC_API_KEY: 'k', DB: db }, [bill, bill]);
    expect(ok.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    const count = db.seen.find((s) => /count\(\*\)/.test(s.sql))!;
    expect(count.sql).toMatch(/FROM public\.ai_usage_events/);
    expect(count.args[0]).toBe(1);
    expect(count.args[1]).toBe('bill_extract');
    expect(count.args[3]).toBe(9);
    expect(Date.now() - Date.parse(String(count.args[2]))).toBeGreaterThanOrEqual(600_000 - 5_000);

    const over = await post({ ANTHROPIC_API_KEY: 'k', DB: dbCounting(BILL_READS_PER_WINDOW - 1) }, [bill, bill]);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: 'too_many_reads' });
    expect(f).toHaveBeenCalledTimes(2); // the refused read never reached the reader
  });

  test('no table (or no database) allows, as the logger does', async () => {
    vi.stubGlobal('fetch', reader());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await post({ ANTHROPIC_API_KEY: 'k', DB: dbCounting('missing') })).status).toBe(200);
    expect((await post({ ANTHROPIC_API_KEY: 'k' })).status).toBe(200);
    warn.mockRestore();
  });

  test('nothing is written to SESSION_CACHE', async () => {
    vi.stubGlobal('fetch', reader());
    const kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
    await post({ ANTHROPIC_API_KEY: 'k', DB: dbCounting(0), SESSION_CACHE: kv });
    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
  });

  test('a body declared past the limit is a 413 before it is read', async () => {
    const res = await post({ ANTHROPIC_API_KEY: 'k' }, [bill], { 'Content-Length': String(EXTRACT_BODY_LIMIT + 1) });
    expect(res.status).toBe(413);
  });
});
