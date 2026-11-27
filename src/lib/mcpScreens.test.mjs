// node --test src/lib/mcpScreens.test.mjs. AI Connector screen map (owner, 27 Nov 2026): every router page explained,
// explain_screen (from a URL or screenshot labels), where_is, and the ?highlight= matcher (functions/_lib/mcpScreens.ts,
// src/lib/highlightMatch.ts). Honesty first: every path is in the router and every label is in the frontend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { labelExists, pathExists, permissionProblem, ROOT } from './howtoCheck.mjs';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const S = await import('../../functions/_lib/mcpScreens.ts');
const { pickHighlightTarget, normaliseLabel } = await import('./highlightMatch.ts');
const { NOT_SCREENS } = await import('../../functions/_lib/howto/screensBasic.ts');

const ORIGIN = 'https://erp.example';
const yes = { gate: async () => true, level: async () => 'full' };
const no = { gate: async () => false, level: async () => 'none' };

/** Router pages that render a screen: App.tsx routes that are not redirects / placeholders, plus the supply chain
 *  menu addresses (scmEngine.ts ENGINE_PATH and the ledger screens). */
function pagePaths() {
  const out = new Set();
  const app = readFileSync(`${ROOT}/src/App.tsx`, 'utf8');
  const start = app.indexOf('<Route element={<AppLayout');
  for (const m of app.slice(start > 0 ? start : 0).matchAll(/<Route path="([^"]+)" element=\{(.{0,60})/g)) {
    if (/Navigate|<Moved|<To[A-Z]|<From|Placeholder|NotDesigned/.test(m[2]) || m[1] === '*') continue;
    out.add(m[1].replace(/\/:[^/]+\?$/, '/:section'));
  }
  const eng = readFileSync(`${ROOT}/src/lib/scmEngine.ts`, 'utf8');
  const block = eng.slice(eng.indexOf('export const ENGINE_PATH'));
  for (const m of block.slice(0, block.indexOf('};')).matchAll(/^\s*'([^']+)':/gm)) out.add(m[1]);
  for (const m of eng.matchAll(/slug: '([^']+)'/g)) { out.add(`/finance/${m[1]}`); out.add(`/supply/finance/${m[1]}`); }
  for (const p of NOT_SCREENS) out.delete(p);
  return [...out];
}

test('screen map: every path is in the router, every label in the frontend, every permission real', () => {
  const bad = [];
  for (const s of S.SCREENS) {
    if (!pathExists(s.path)) bad.push(`${s.path}: not in router`);
    if (!s.purpose.trim()) bad.push(`${s.path}: no purpose`);
    if (!s.sidebar.trim()) bad.push(`${s.path}: no sidebar`);
    for (const l of [...s.sections, ...s.actions.map(a => a.label)]) if (!labelExists(l)) bad.push(`${s.path}: label "${l}" not in the frontend`);
    for (const a of s.actions) if (a.permission) { const why = permissionProblem(a.permission); if (why) bad.push(`${s.path} ${a.label}: ${why}`); }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('screen map: every router page has exactly one entry', () => {
  const have = S.SCREENS.map(s => s.path);
  assert.equal(new Set(have).size, have.length, 'duplicate screen path');
  const missing = pagePaths().filter(p => !have.includes(p));
  assert.deepEqual(missing, [], `pages without a screen entry: ${missing.join(', ')}`);
});

test('screen map: the busiest pages are documented in full', () => {
  for (const p of ['/reservations/bookings', '/operations/today', '/operations/cleaning', '/operations/maintenance', '/owners/statements', '/owners/payouts', '/performance/pricing', '/projects/list', '/sales/quotations', '/sales/orders']) {
    const s = S.SCREENS.find(x => x.path === p);
    assert.ok(s, p);
    assert.equal(s.detail, 'full', `${p} is not full detail`);
    assert.ok(s.actions.length >= 3, `${p} has only ${s.actions.length} actions`);
  }
});

test('screenForPath: most specific pattern; URL, query and id handled', () => {
  assert.equal(S.screenForPath('/owners/statements').screen.path, '/owners/statements');
  assert.equal(S.screenForPath('https://erp.example/owners/statements/st_123').screen.path, '/owners/statements/:id');
  assert.equal(S.screenForPath('https://erp.example/properties/units/u_1?tab=contract#x').screen.path, '/properties/units/:id');
  assert.equal(S.screenForPath('/properties/units/new').screen.path, '/properties/units/new');
  const h = S.screenForPath('/hr/employees?tab=leave');
  assert.equal(h.screen.path, '/hr/employees');
  assert.equal(h.tab, 'leave');
  assert.equal(S.screenForPath('/nope/nothing/here'), null);
});

test('explain_screen from screenshot labels finds the page', async () => {
  const target = S.SCREENS.find(s => s.path === '/owners/payouts');
  const labels = [target.title, ...target.actions.slice(0, 4).map(a => a.label)];
  assert.equal(S.screensForLabels(labels)[0].screen.path, '/owners/payouts');
  const r = await S.explainScreen({ visible_text: labels }, ORIGIN, yes);
  assert.equal(r.value.identifiedBy, 'visible labels');
  assert.equal(r.value.screen.path, '/owners/payouts');
  assert.equal((await S.explainScreen({ visible_text: ['zzqq', 'xyzzy'] }, ORIGIN, yes)).matched, false);
});

test('explain_screen canDo follows the ERP access; links carry ?highlight=', async () => {
  const ok = await S.explainScreen({ path: '/reservations/bookings' }, ORIGIN, yes);
  assert.equal(ok.value.screen.canOpen, true);
  const a = ok.value.screen.actions.find(x => x.label === 'Create reservation');
  assert.equal(a.canDo, true);
  assert.equal(a.link, `${ORIGIN}/reservations/bookings?highlight=Create%20reservation`);
  const denied = await S.explainScreen({ path: '/reservations/bookings' }, ORIGIN, no);
  assert.equal(denied.value.screen.canOpen, false);
  assert.ok(denied.value.screen.actions.every(x => x.canDo === false));
  // Can open the page (Reservations at view) but not write: the write buttons are canDo false.
  const viewOnly = { gate: async (m) => m === 'GET', level: async (ar) => (ar === 'reservations' ? 'view' : 'none') };
  const v = await S.explainScreen({ path: '/reservations/bookings' }, ORIGIN, viewOnly);
  assert.equal(v.value.screen.canOpen, true);
  assert.equal(v.value.screen.actions.find(x => x.label === 'Create reservation').canDo, false);
  assert.equal(v.value.screen.actions.find(x => x.label === 'Duplicate').canDo, true);
  // Engine screens say the button is inside the engine frame.
  assert.ok((await S.explainScreen({ path: '/sales/quotations' }, ORIGIN, yes)).value.screen.engineScreenNote);
});

test('where_is: payouts, quotation, VO, maintenance job; follows the company', async () => {
  const top = async (q, side) => (await S.whereIs({ thing: q }, ORIGIN, yes, side)).value.places?.[0];
  assert.match((await top('owner payouts', 'conts')).link, /\/owners\/payouts/);
  assert.equal((await top('add a maintenance job', 'conts')).link, `${ORIGIN}/operations/maintenance?highlight=Add%20maintenance%20job`);
  assert.match((await top('quotation', 'dream_crafter')).link, /\/sales\/quotations/);
  assert.match((await top('new VO', 'dream_crafter')).link, /\/sales\/(orders|amendments)/);
  // A The Conts person is not sent to Dream Crafter's quotations.
  const c = await S.whereIs({ thing: 'quotation' }, ORIGIN, yes, 'conts');
  assert.ok(!(c.value.places ?? []).some(p => /quotations/.test(p.link)));
  assert.equal((await S.whereIs({ thing: 'zzqq xyzzy' }, ORIGIN, yes, 'conts')).matched, false);
});

test('highlight matcher: exact beats partial, interactive beats text, invisible never', () => {
  const c = (text, o = {}) => ({ text, interactive: true, visible: true, ...o });
  assert.equal(normaliseLabel('  Create   reservation '), 'create reservation');
  assert.equal(pickHighlightTarget([c('Create reservation and more text around it'), c('Create reservation')], 'create reservation'), 1);
  assert.equal(pickHighlightTarget([c('Guest left', { interactive: false }), c('guest left')], 'Guest left'), 1);
  assert.equal(pickHighlightTarget([c('Guest left', { visible: false })], 'Guest left'), -1);
  assert.equal(pickHighlightTarget([c('', { ariaLabel: 'Block nights' })], 'Block nights'), 0);
  assert.equal(pickHighlightTarget([c('Assign cleaner +2')], 'Assign cleaner'), 0);
  assert.equal(pickHighlightTarget([c('Save')], ''), -1);
  assert.equal(pickHighlightTarget([c('Cancel')], 'Save'), -1);
});

test('highlight hook is read-only and mounted in the app layout', () => {
  const hook = readFileSync(`${ROOT}/src/lib/useHighlightParam.ts`, 'utf8');
  assert.doesNotMatch(hook.replace(/\/\*[\s\S]*?\*\//g, ''), /\.click\(|\.focus\(|dispatchEvent|setTimeout|setInterval/);
  assert.match(hook, /replaceState/);
  assert.match(readFileSync(`${ROOT}/src/App.tsx`, 'utf8'), /<HighlightFromUrl \/>/);
});

test('screen tools are read-only', () => {
  for (const t of S.SCREEN_TOOLS) assert.equal(t.annotations.readOnlyHint, true);
});
