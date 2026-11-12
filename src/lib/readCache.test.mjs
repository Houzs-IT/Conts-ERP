// node --test src/lib/readCache.test.mjs (NODE_OPTIONS=--experimental-strip-types). A read sent before a save must not
// come back as fresh: not kept in readCache, not joined by a screen opened after the save (Houzs 5c7810697).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// useApi.ts imports './api' with no extension, as Vite allows; Node needs '.ts'.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    try { return await next(specifier, context); }
    catch (e) { if (specifier.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(specifier)) return next(specifier + '.ts', context); throw e; }
  }`));

const { api, readCache, remember, writeCount } = await import('./api.ts');
const { sharedGet } = await import('./useApi.ts');

/** A fetch whose answers the test hands out one by one. */
let calls = [];
globalThis.fetch = (url, init) => new Promise(resolve => {
  calls.push({ url, method: init?.method ?? 'GET', answer: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) });
});
const lastGet = () => calls.filter(c => c.method === 'GET').at(-1);
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { calls = []; readCache.clear(); });

test('a read with no write in between is kept and joined', async () => {
  const first = sharedGet('/units');
  const second = sharedGet('/units');
  assert.equal(calls.length, 1, 'the second screen joins the first read');
  lastGet().answer({ n: 1 });
  assert.deepEqual(await first, { n: 1 });
  assert.deepEqual(await second, { n: 1 });
  assert.deepEqual(readCache.get('/units'), { n: 1 });
});

test('a read sent before a save and landing after it is not kept', async () => {
  const before = sharedGet('/reservations');
  const save = api.post('/blocks', { unitId: 'u1' });
  calls.find(c => c.method === 'POST').answer({ id: 'b1' });
  await save;
  lastGet().answer({ old: true });
  assert.deepEqual(await before, { old: true }, 'the screen that asked still gets its answer');
  assert.equal(readCache.has('/reservations'), false, 'but it is not kept as fresh');
});

test('a read sent while a save is on its way is not kept either', async () => {
  const save = api.post('/blocks', { unitId: 'u1' });
  const during = sharedGet('/calendar');
  calls.find(c => c.method === 'POST').answer({ id: 'b1' });
  await save;
  lastGet().answer({ old: true });
  await during;
  assert.equal(readCache.has('/calendar'), false);
});

test('a screen opened after a save does not join a read sent before it', async () => {
  const before = sharedGet('/board');
  const save = api.post('/housekeeping/tasks', { unitId: 'u1' });
  calls.find(c => c.method === 'POST').answer({ id: 't1' });
  await save;
  const after = sharedGet('/board');
  assert.equal(calls.filter(c => c.method === 'GET').length, 2, 'the new screen asks again');
  calls.filter(c => c.method === 'GET')[1].answer({ fresh: true });
  assert.deepEqual(await after, { fresh: true });
  assert.deepEqual(readCache.get('/board'), { fresh: true });
  calls.filter(c => c.method === 'GET')[0].answer({ old: true });
  await before;
  assert.deepEqual(readCache.get('/board'), { fresh: true }, 'the older answer landing later does not overwrite it');
});

test('the older read settling does not drop the newer one from the shared list', async () => {
  const before = sharedGet('/owners');
  const save = api.post('/owners', { name: 'A' });
  calls.find(c => c.method === 'POST').answer({ id: 'o1' });
  await save;
  const newer = sharedGet('/owners');
  calls.filter(c => c.method === 'GET')[0].answer({ old: true });
  await before;
  await flush();
  const third = sharedGet('/owners');
  assert.equal(calls.filter(c => c.method === 'GET').length, 2, 'the third screen joins the newer read, not a new one');
  calls.filter(c => c.method === 'GET')[1].answer({ fresh: true });
  assert.deepEqual(await newer, { fresh: true });
  assert.deepEqual(await third, { fresh: true });
});

test('remember refuses an answer sent before the latest write', () => {
  const sentAt = writeCount();
  remember('/x', 1, sentAt);
  assert.equal(readCache.get('/x'), 1);
  readCache.clear();
  void api.post('/units', {}).catch(() => {});
  remember('/x', 2, sentAt);
  assert.equal(readCache.has('/x'), false);
});
