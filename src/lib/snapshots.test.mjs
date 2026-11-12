// node --test src/lib/snapshots.test.mjs (NODE_OPTIONS=--experimental-strip-types). The saved snapshots of the main
// screens (lib/snapshots.ts) and the display-only lock while one is shown (lib/snapshotView.ts).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    try { return await next(specifier, context); }
    catch (e) { if (specifier.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(specifier)) return next(specifier + '.ts', context); throw e; }
  }`));

const snaps = await import('./snapshots.ts');
const { api, remember, writeCount } = await import('./api.ts');
const view = await import('./snapshotView.ts');
const { sharedGet } = await import('./useApi.ts');

/** Storage the tests can look into. */
function memoryBackend(initial = []) {
  const rows = new Map(initial.map(e => [e.id, e]));
  return {
    rows,
    loadAll: async () => [...rows.values()],
    put: async e => { rows.set(e.id, e); },
    remove: async ids => { ids.forEach(id => rows.delete(id)); },
    clear: async () => { rows.clear(); },
  };
}
const idle = () => new Promise(r => setTimeout(r, 5));

let calls = [];
globalThis.fetch = (url, init) => new Promise(resolve => {
  calls.push({ url, method: init?.method ?? 'GET', answer: (body, status = 200, headers = {}) => resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })) });
});

const ana = { id: 'u-ana', role: 'management', permissions: ['finance:view'] };
const ben = { id: 'u-ben', role: 'operations_staff', permissions: [], access: { dashboard: 'view', reservations: 'edit', calendar: 'view' } };

let store;
beforeEach(async () => {
  calls = [];
  store = memoryBackend();
  snaps.setSnapshotBackend(store);
  await snaps.snapshotsReady();
});

/** Keeps an answer the way a screen's read does: sent now, no write in between. */
async function keep(path, data) { remember(path, data, writeCount()); await idle(); }

test('a kept read comes back for the same person and is stored', async () => {
  snaps.setSnapshotOwner(ana);
  await keep('/dashboard/kpis', { kpis: [1] });
  assert.deepEqual(snaps.snapshotOf('/dashboard/kpis').data, { kpis: [1] });
  assert.equal(store.rows.size, 1);
});

test('snapshots are kept per person and role: another user or a role change never sees them', async () => {
  snaps.setSnapshotOwner(ana);
  await keep('/dashboard/today', { n: 'ana' });
  snaps.setSnapshotOwner(ben);
  assert.equal(snaps.snapshotOf('/dashboard/today'), undefined, 'another person sees nothing');
  assert.equal(store.rows.size, 0, 'and the other person\'s entries are dropped from storage');

  snaps.setSnapshotOwner(ana);
  await keep('/dashboard/today', { n: 'ana' });
  snaps.setSnapshotOwner({ ...ana, role: 'operations_staff', access: { dashboard: 'full' } });
  assert.equal(snaps.snapshotOf('/dashboard/today'), undefined, 'the same person in another role sees nothing');
});

test('the key differs by user, role and permissions', () => {
  const a = snaps.snapshotOwner(ana);
  assert.notEqual(a, snaps.snapshotOwner({ ...ana, id: 'u-other' }));
  assert.notEqual(a, snaps.snapshotOwner({ ...ana, role: 'operations_staff' }));
  assert.notEqual(a, snaps.snapshotOwner({ ...ana, permissions: [] }), 'losing money access changes the key');
  assert.notEqual(a, snaps.snapshotOwner({ ...ana, demo: { on: true } }), 'Demo mode changes the key');
  assert.equal(a, snaps.snapshotOwner({ ...ana, permissions: ['finance:view'] }), 'the same session gives the same key');
});

test('stored entries are only adopted by their own person after a reload', async () => {
  snaps.setSnapshotOwner(ana);
  await keep('/owners', { o: 1 });
  const saved = [...store.rows.values()];
  // A new page load: storage read again, then the session arrives.
  const again = memoryBackend(saved);
  snaps.setSnapshotBackend(again);
  await snaps.snapshotsReady();
  snaps.setSnapshotOwner(ben);
  assert.equal(snaps.snapshotOf('/owners'), undefined);
  assert.equal(again.rows.size, 0, 'another person signing in drops them');

  const third = memoryBackend(saved);
  snaps.setSnapshotBackend(third);
  await snaps.snapshotsReady();
  snaps.setSnapshotOwner(ana);
  assert.deepEqual(snaps.snapshotOf('/owners').data, { o: 1 });
});

test('a write clears every snapshot, in memory and in storage', async () => {
  snaps.setSnapshotOwner(ana);
  await keep('/reservations', { rows: [1] });
  await keep('/units', { data: [] });
  const save = api.post('/blocks', { unitId: 'u1' });
  assert.equal(snaps.snapshotOf('/reservations'), undefined, 'cleared as the write starts');
  calls.find(c => c.method === 'POST').answer({ id: 'b1' });
  await save;
  await idle();
  assert.equal(snaps.snapshotStats().entries, 0);
  assert.equal(store.rows.size, 0);
});

test('a read sent before a save is never kept as a snapshot', async () => {
  snaps.setSnapshotOwner(ana);
  const before = sharedGet('/operations/day?date=2026-11-12');
  const save = api.post('/housekeeping/tasks', { unitId: 'u1' });
  calls.find(c => c.method === 'POST').answer({ id: 't1' });
  await save;
  calls.find(c => c.method === 'GET').answer({ old: true });
  await before;
  await idle();
  assert.equal(snaps.snapshotOf('/operations/day?date=2026-11-12'), undefined);
});

test('a save scheduled before a write is dropped when the write lands first', async () => {
  snaps.setSnapshotOwner(ana);
  remember('/owners', { o: 1 }, writeCount());
  void api.post('/owners', { name: 'A' }).catch(() => {});
  await idle();
  assert.equal(snaps.snapshotOf('/owners'), undefined);
});

test('a snapshot is only used while the session may still open that read', async () => {
  snaps.setSnapshotOwner(ben);
  await keep('/reservations/calendar?from=2026-11-10&to=2026-12-09', { units: [] });
  assert.ok(snaps.snapshotOf('/reservations/calendar?from=2026-11-10&to=2026-12-09'));
  // Same person, the Calendar area taken away: the key changes and the snapshot is gone.
  snaps.setSnapshotOwner({ ...ben, access: { ...ben.access, calendar: 'none' } });
  assert.equal(snaps.snapshotOf('/reservations/calendar?from=2026-11-10&to=2026-12-09'), undefined);
  // The area check itself, with the key unchanged.
  assert.equal(snaps.snapshotAllowed({ ...ben, access: { calendar: 'none' } }, '/reservations/calendar?from=2026-11-10&to=2026-12-09'), false);
  assert.equal(snaps.snapshotAllowed(ben, '/reservations'), true);
  assert.equal(snaps.snapshotAllowed(ben, '/owners'), false, 'no Owners access');
  assert.equal(snaps.snapshotAllowed({ id: 'o', role: 'owner' }, '/units'), false, 'owners never');
  assert.equal(snaps.snapshotAllowed({ id: 'c', role: 'housekeeper' }, '/units'), false, 'field accounts never');
});

test('losing money access drops the snapshots kept with it', async () => {
  snaps.setSnapshotOwner(ana);
  await keep('/dashboard/kpis', { kpis: ['money'] });
  snaps.setSnapshotOwner({ ...ana, role: 'operations_staff', permissions: [], access: { dashboard: 'view' } });
  assert.equal(snaps.snapshotOf('/dashboard/kpis'), undefined);
  assert.equal(store.rows.size, 0);
});

test('signing out clears everything', async () => {
  snaps.setSnapshotOwner(ana);
  await keep('/dashboard/exceptions', { e: [] });
  await keep('/owners', { o: [] });
  snaps.setSnapshotOwner(null);
  await idle();
  assert.equal(snaps.snapshotStats().entries, 0);
  assert.equal(store.rows.size, 0);
  snaps.setSnapshotOwner(ana);
  assert.equal(snaps.snapshotOf('/owners'), undefined, 'not back for the same person either');
});

test('signing out through the API clears them as the logout is sent', async () => {
  snaps.setSnapshotOwner(ana);
  await keep('/owners', { o: [] });
  const out = api.post('/auth/logout');
  assert.equal(snaps.snapshotOf('/owners'), undefined);
  calls.find(c => c.method === 'POST').answer({ ok: true });
  await out;
});

test('money screens, users, health, reveals and no-store answers are never kept', async () => {
  for (const path of ['/finance/collections', '/statements?period=2026-10', '/payouts', '/owner-close/state', '/finance/deductions',
    '/airbnb-recon', '/approvals', '/users', '/users/access', '/departments', '/system/health', '/owners/o1/reveal',
    '/guests/g1/reveal', '/access-credentials/a1?reveal=true', '/dashboard/trend?range=12m', '/portfolio/performance',
    '/portfolio/owner-report?month=2026-10', '/analytics?range=12m', '/guests/g1', '/reservations/export']) {
    assert.equal(snaps.snapshottable(path), false, path);
  }
  for (const path of ['/dashboard/kpis', '/reservations?view=upcoming', '/guests?sort=recent', '/operations/day?date=2026-11-12',
    '/housekeeping/board?date=2026-11-12', '/maintenance/issues', '/properties', '/units/detail?unitId=u1', '/owners']) {
    assert.equal(snaps.snapshottable(path), true, path);
  }
  snaps.setSnapshotOwner(ana);
  const read = sharedGet('/owners');
  calls.find(c => c.method === 'GET').answer({ o: 1 }, 200, { 'cache-control': 'private, no-store' });
  await read;
  await idle();
  assert.equal(snaps.snapshotOf('/owners'), undefined, 'answered no-store');
});

test('at most 2 MB per person, the oldest go first', async () => {
  snaps.setSnapshotOwner(ana);
  const big = 'x'.repeat(380_000); // about 760 kB as the browser counts it
  await keep('/owners', { big });
  await new Promise(r => setTimeout(r, 3));
  await keep('/units', { big });
  await new Promise(r => setTimeout(r, 3));
  await keep('/properties', { big });
  const { bytes, paths } = snaps.snapshotStats();
  assert.ok(bytes <= snaps.SNAPSHOT_MAX_BYTES, `${bytes} bytes kept`);
  assert.deepEqual(paths.sort(), ['/properties', '/units']);
  await keep('/maintenance/issues', { big: 'y'.repeat(1_100_000) });
  assert.equal(snaps.snapshotOf('/maintenance/issues'), undefined, 'one answer over the cap is not kept');
});

// ---- Rule 2: display-only while a snapshot is shown -------------------------------------------------------------

/** A stand-in for a DOM element: `closest` answers from the selectors each level of its tree matches, element first. */
function el(...chain) {
  const make = i => ({
    closest(selector) {
      const wanted = selector.split(',').map(s => s.trim());
      for (let j = i; j < chain.length; j++) if (wanted.some(w => chain[j].includes(w))) return make(j);
      return null;
    },
  });
  return make(0);
}
const BUTTON = 'button';
const MAIN = '[data-app-main]';

test('actions are locked while any read shows a snapshot, and open once every fresh answer has landed', () => {
  assert.equal(view.snapshotLocked(), false);
  const a = view.snapshotSlot(), b = view.snapshotSlot();
  view.showSnapshot(a, { savedAt: Date.now() - 120_000, failed: false, retry: () => {} });
  view.showSnapshot(b, { savedAt: Date.now() - 5_000, failed: false, retry: () => {} });
  assert.equal(view.snapshotLocked(), true);
  assert.ok(view.lockedControl(el([BUTTON], [MAIN])), 'a button on the page is stopped');
  view.hideSnapshot(a);
  assert.equal(view.snapshotLocked(), true, 'still locked while one read is still on its snapshot');
  view.hideSnapshot(b);
  assert.equal(view.snapshotLocked(), false);
  assert.equal(view.lockedControl(el([BUTTON], [MAIN])), null, 'fresh data: the button works');
});

test('what the lock stops and what stays usable', () => {
  const id = view.snapshotSlot();
  view.showSnapshot(id, { savedAt: Date.now(), failed: false, retry: () => {} });
  try {
    assert.ok(view.lockedControl(el([BUTTON], [MAIN])), 'Assign, Mark done, Book: a button on the page');
    assert.ok(view.lockedControl(el(['span'], [BUTTON], [MAIN])), 'a click on the icon inside a button');
    assert.ok(view.lockedControl(el(['input[type="checkbox"]'], [MAIN])), 'a tick');
    assert.ok(view.lockedControl(el([BUTTON], ['[role="dialog"]'])), 'a button in a drawer or menu over the page');
    assert.equal(view.lockedControl(el([BUTTON], ['[data-live]'], [MAIN])), null, 'filters, pagers, column headers');
    assert.equal(view.lockedControl(el([BUTTON, '[role="tab"]'], ['[role="tablist"]'], [MAIN])), null, 'tabs');
    assert.equal(view.lockedControl(el([BUTTON], ['nav'])), null, 'the menu');
    assert.equal(view.lockedControl(el([BUTTON], ['header'])), null, 'the top bar, outside the page');
    assert.equal(view.lockedControl(el(['a'], [MAIN])), null, 'a link only moves to another page');
  } finally { view.hideSnapshot(id); }
});

test('a failed refresh keeps the snapshot locked, says so, and Retry reads again', () => {
  let retried = 0;
  const id = view.snapshotSlot();
  view.showSnapshot(id, { savedAt: 1_000, failed: false, retry: () => retried++ });
  view.showSnapshot(id, { savedAt: 1_000, failed: true, retry: () => retried++ });
  assert.equal(view.snapshotLocked(), true, 'actions stay disabled');
  assert.deepEqual(view.snapshotState(), { savedAt: 1_000, failed: true });
  view.retrySnapshots();
  assert.equal(retried, 1);
  view.hideSnapshot(id);
  assert.equal(view.snapshotState(), null);
});
