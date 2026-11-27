// node --test src/lib/mcpShowMe.test.mjs. show_me screenshots (owner, 27 Nov 2026): freshness without running a browser
// (every boxed label must still exist in the frontend, every picture must exist and the set stays small; if this fails
// the UI changed: re-capture screenshots with `node scripts/capture-help-shots.mjs`), how a request picks its box,
// and the annotated picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { register } from 'node:module';
import { labelExists, pathExists, ROOT } from './howtoCheck.mjs';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const M = await import('../../functions/_lib/mcpShowMe.ts');
const { HELP_SHOTS } = await import('../../functions/_lib/howto/helpShots.ts');
const { isEngineScreen } = await import('../../functions/_lib/mcpHowto.ts');

const RECAPTURE = 're-capture screenshots: node scripts/capture-help-shots.mjs (PLAYWRIGHT_CORE=<playwright-core folder>)';
const pages = Object.keys(HELP_SHOTS);
const pic = (f) => `${ROOT}/public/help-shots/${f}`;

test('help screenshots stay fresh: every boxed label still exists in the frontend', () => {
  const bad = [];
  for (const p of pages) for (const l of Object.keys(HELP_SHOTS[p].boxes)) if (!labelExists(l)) bad.push(`${p}: "${l}"`);
  assert.deepEqual(bad, [], `${RECAPTURE}\n${bad.join('\n')}`);
});

test('every shot is a router page of The Conts\' own screens, its picture exists, its boxes sit inside it, under 8 MB', () => {
  assert.ok(pages.length >= 10, `only ${pages.length} screenshots`);
  let bytes = 0;
  for (const p of pages) {
    const s = HELP_SHOTS[p];
    assert.ok(pathExists(p), `${p} is not a router page`);
    assert.ok(!isEngineScreen(p), `${p} is an engine screen`);
    assert.ok(existsSync(pic(s.file)), `missing ${s.file}: ${RECAPTURE}`);
    const buf = readFileSync(pic(s.file));
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'RIFF', `${s.file} is not WebP`);
    assert.equal(buf.subarray(8, 12).toString('latin1'), 'WEBP', `${s.file} is not WebP`);
    bytes += statSync(pic(s.file)).size;
    for (const [l, [x, y, w, h]] of Object.entries(s.boxes)) {
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0, `${p} "${l}" box`);
      assert.ok(x + w <= s.w && y + h <= s.h, `${p} "${l}" outside the picture`);
    }
  }
  assert.ok(bytes < 8 * 1024 * 1024, `screenshots are ${(bytes / 1048576).toFixed(1)} MB`);
});

test('show_me resolves a page + label, a guide step, a label alone; engine screens and unknown pages say why', () => {
  const p = '/owners/payouts';
  assert.ok(HELP_SHOTS[p], 'no payouts screenshot');
  const a = M.resolveShot({ path: p, label: 'start payout run' });
  assert.equal(a.hit.label, 'Start payout run');
  assert.equal(M.resolveShot({ path: `https://erp.test${p}?x=1`, label: 'Start payout run' }).hit.page, p);
  const g = M.resolveShot({ guide_id: 'owner-payout-run' });
  assert.equal(g.hit.label, 'Start payout run');
  assert.match(g.caption, /step 2/);
  assert.equal(M.resolveShot({ label: 'Start payout run' }).hit.page, p);
  assert.match(M.resolveShot({ guide_id: 'dc-create-quotation' }).error, /supply chain screen/);
  assert.match(M.resolveShot({ path: '/sales/quotations', label: 'New Quotation' }).error, /supply chain screen/);
  assert.match(M.resolveShot({ path: '/no/such', label: 'x' }).error, /No screenshot/);
  assert.match(M.resolveShot({ guide_id: 'nope' }).error, /No guide/);
  assert.match(M.resolveShot({}).error, /guide_id/);
});

test('the annotated picture: red box, arrow, escaped caption; the answer carries the box, the links and the test-data note', () => {
  const hit = M.resolveShot({ path: '/owners/payouts', label: 'Start payout run' }).hit;
  const svg = M.annotatedSvg(hit, 'QUJD', 'Press "New <x>"');
  assert.match(svg, /href="data:image\/webp;base64,QUJD"/);
  assert.match(svg, /stroke="red"/);
  assert.match(svg, /<polygon/);
  assert.match(svg, /Press &quot;New &lt;x&gt;&quot;/);
  assert.match(M.annotatedHtml(svg, 't'), /<svg/);
  const t = M.showMeText(hit, 'https://erp.test', 'c', 'https://erp.test/api/mcp/export?k=1', '2026-11-27');
  assert.equal(t.note, M.SHOT_NOTE);
  assert.match(t.note, /test data/);
  assert.equal(t.box.x, hit.box[0]);
  assert.equal(t.openThePage, 'https://erp.test/owners/payouts?highlight=Start%20payout%20run');
  assert.equal(t.annotatedImageExpires, '15 minutes');
  assert.equal(M.SHOW_ME_TOOL.annotations.readOnlyHint, true);
});

test('show_me returns a plain WebP image, never SVG, and serves the annotated page with no scripts allowed', () => {
  const tools = readFileSync(`${ROOT}/functions/_lib/mcpHowtoTools.ts`, 'utf8');
  assert.match(tools, /mimeType: 'image\/webp'/);
  assert.doesNotMatch(tools, /image\/svg\+xml/);
  const exp = readFileSync(`${ROOT}/functions/api/mcp/export.ts`, 'utf8');
  assert.match(exp, /default-src 'none'; img-src data:/);
});
