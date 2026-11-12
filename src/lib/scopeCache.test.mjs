// node --test src/lib/scopeCache.test.mjs (NODE_OPTIONS=--experimental-strip-types). The dashboard's server-side
// cache of heavy reads by scope (functions/_lib/scopeCache.ts).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { scopeCached, forgetScopeCache, SCOPE_CACHE_MS } = await import('../../functions/_lib/scopeCache.ts');

const env = { SESSION_SECRET: 'test' };
const request = new Request('https://os.example.test/api/dashboard/kpis');
let clock = 1_800_000_000_000;
const now = () => clock;

beforeEach(() => { forgetScopeCache(); clock = 1_800_000_000_000; });

test('the same scope is worked out once a minute and says when', async () => {
  let runs = 0;
  const compute = async () => ({ n: ++runs });
  const first = await scopeCached(env, request, 'kpis|2026-11|money', compute, { now });
  clock += 30_000;
  const second = await scopeCached(env, request, 'kpis|2026-11|money', compute, { now });
  assert.equal(runs, 1);
  assert.deepEqual(second, first);
  assert.equal(first.cachedAt, new Date(1_800_000_000_000).toISOString());
  clock += SCOPE_CACHE_MS;
  const third = await scopeCached(env, request, 'kpis|2026-11|money', compute, { now });
  assert.equal(runs, 2, 'older than a minute: worked out again');
  assert.equal(third.n, 2);
});

test('scopes never share an answer: occupancy-only never gets the money tiles', async () => {
  const money = await scopeCached(env, request, 'kpis|2026-11|money', async () => ({ kpis: ['occupancy', 'revenue'] }), { now });
  const plain = await scopeCached(env, request, 'kpis|2026-11|occupancy', async () => ({ kpis: ['occupancy'] }), { now });
  assert.deepEqual(money.kpis, ['occupancy', 'revenue']);
  assert.deepEqual(plain.kpis, ['occupancy']);
});

test('a failed computation is not kept', async () => {
  await assert.rejects(scopeCached(env, request, 's', async () => { throw new Error('db down'); }, { now }));
  const ok = await scopeCached(env, request, 's', async () => ({ ok: true }), { now });
  assert.equal(ok.ok, true);
});
