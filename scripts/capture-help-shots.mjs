#!/usr/bin/env node
// capture-help-shots.mjs: screenshots for the AI Connector's show_me tool (owner, 27 Nov 2026: "send back a picture
// of the real ERP screen with a red box around the button to press"). Mirrors Hookka / Houzs.
//
//   node scripts/capture-help-shots.mjs                          every page
//   node scripts/capture-help-shots.mjs /owners/payouts /mail    only these
//
// SAFETY: never production data, never credentials.
//   * It starts its OWN Vite dev server for the SPA on a free local port (no wrangler, no database).
//   * Every /api/* request is answered HERE: a made-up management account for the session, and 503 for every data
//     read, so each screen shows its own built-in design sample data (dev builds only) or its empty state. No request
//     reaches any backend. Every request to a host other than that local server is aborted.
//   * Nothing is typed into a sign-in form: the mocked /api/auth/session answers with the demo account.
//   * Supply chain engine screens (Dream Crafter's projects, sales and procurement, Mail Center) are NOT captured: they
//     are a separate site embedded in the ERP, and without the engine the SPA would show its built-in fallback pages,
//     which production does not show. show_me says so for those pages.
//
// Output (both committed):
//   public/help-shots/<slug>.webp            compressed screenshot of the viewport (1280 x 800)
//   functions/_lib/howto/helpShots.ts        page -> file, size, and each label's box [x, y, w, h]
// src/lib/mcpShowMe.test.mjs fails with "re-capture screenshots" when a recorded label is gone from the frontend.
//
// Needs playwright-core (not a dependency of this repo): set PLAYWRIGHT_CORE to its folder if it is not installed, and
// CHROME_PATH to a Chromium if Playwright's own is not in %LOCALAPPDATA%\ms-playwright.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import sharp from 'sharp';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const VIEWPORT = { width: 1280, height: 800 };
const QUALITY = 50;
const OUT_DIR = join(ROOT, 'public', 'help-shots');
const DATA_FILE = join(ROOT, 'functions', '_lib', 'howto', 'helpShots.ts');
const ONLY = process.argv.slice(2).filter(a => a.startsWith('/'));
const tmp = mkdtempSync(join(tmpdir(), 'conts-help-shots-'));

async function loadPlaywright() {
  try { return await import('playwright-core'); } catch { /* not installed here */ }
  const p = process.env.PLAYWRIGHT_CORE;
  if (!p) throw new Error('playwright-core not found: set PLAYWRIGHT_CORE to its folder (e.g. a playwright-core in another project).');
  return await import(pathToFileURL(join(p, 'index.mjs')).href);
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(process.env.LOCALAPPDATA ?? join(homedir(), '.cache'), 'ms-playwright');
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
    const p = join(base, d, rel);
    if (existsSync(p)) return p;
  }
  return undefined;
}

const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const slug = p => (p.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home').slice(0, 80);

// The screen map, the guides and the matcher, bundled from the source (the same code the server and the SPA run).
async function bundle(entry, format, out, globalName) {
  await esbuild.build({ entryPoints: [join(ROOT, entry)], bundle: true, format, globalName, platform: format === 'iife' ? 'browser' : 'node', outfile: join(tmp, out), logLevel: 'silent', loader: { '.json': 'json' } });
  return join(tmp, out);
}
const { SCREENS } = await import(pathToFileURL(await bundle('functions/_lib/mcpScreens.ts', 'esm', 'screens.mjs')).href);
const { GUIDES, isEngineScreen } = await import(pathToFileURL(await bundle('functions/_lib/mcpHowto.ts', 'esm', 'howto.mjs')).href);
const matcher = await esbuild.build({ entryPoints: [join(ROOT, 'src/lib/highlightMatch.ts')], bundle: true, format: 'iife', globalName: 'HL', write: false, platform: 'browser' }).then(r => r.outputFiles[0].text);

// Pages that open without a record id, on The Conts' own screens; the labels to box (guide highlights first).
const pages = new Map();
const add = (page, label) => {
  const p = page.split('?')[0];
  if (p.includes(':') || isEngineScreen(p)) return;
  if (ONLY.length && !ONLY.includes(p)) return;
  if (!pages.has(p)) pages.set(p, new Set());
  if (label) pages.get(p).add(label);
};
for (const g of GUIDES) for (const s of g.steps) add(s.page ?? g.page, s.highlight);
for (const s of SCREENS) { add(s.path); for (const a of s.actions) add(s.path, a.label); for (const t of s.sections) add(s.path, t); }

const DEMO_USER = { id: 'demo-management', fullName: 'Demo Manager', email: 'demo@example.invalid', role: 'management', side: 'both', kind: 'management', mustChangePassword: false, locale: 'en-MY', permissions: [], demo: { allowed: false, on: false } };
function demoResponse(path) {
  if (path === '/api/auth/session') return { user: DEMO_USER };
  if (path === '/api/supply-chain/engine') return { enabled: false };
  if (path === '/api/nav/badges') return {};
  // Everything else answers 503: in the dev build a screen then shows its own design sample data (useApi's fallback:
  // made-up names and figures), or its empty state. Guessing each endpoint's shape crashed screens instead.
  return null;
}

// Our own Vite dev server, nowhere else.
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
const vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite did not start in 60 s')), 60_000);
  const on = d => { if (String(d).includes(String(port))) { clearTimeout(t); resolve(); } };
  vite.stdout.on('data', on); vite.stderr.on('data', on);
  vite.on('exit', c => reject(new Error(`vite exited ${c}`)));
});

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'en-MY', timezoneId: 'Asia/Kuala_Lumpur', colorScheme: 'light' });
await ctx.route('**/*', route => {
  let u;
  try { u = new URL(route.request().url()); } catch { return route.abort(); }
  if (u.host !== `127.0.0.1:${port}`) return route.abort(); // nothing leaves this machine
  if (u.pathname.startsWith('/api/')) {
    const body = demoResponse(u.pathname);
    return route.fulfill(body ? { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
      : { status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'DEMO', message: 'Demo screenshots: no data.' } }) });
  }
  return route.continue();
});

if (!ONLY.length && existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
const previous = ONLY.length && existsSync(DATA_FILE) ? JSON.parse((await import('node:fs')).readFileSync(DATA_FILE, 'utf8').split('/* DATA */')[1] ?? '{}') : {};
const shots = { ...previous };
const page = await ctx.newPage();
let lastError = '';
page.on('pageerror', e => { lastError = String(e?.message ?? e).split(String.fromCharCode(10))[0].slice(0, 200); });
const apiSeen = new Set();
page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) apiSeen.add(u.pathname); });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForTimeout(3000);
let n = 0;
for (const [path, labels] of pages) {
  n++;
  try {
    // Client-side navigation, the way React Router moves between screens (a reload per page is far slower).
    await page.evaluate(p => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, path);
    await page.waitForTimeout(800);
    await page.waitForFunction(() => {
      const root = document.querySelector('main') ?? document.body;
      return root.innerText.trim().length > 40 && !root.querySelector('.animate-pulse');
    }, null, { timeout: 8000, polling: 250 }).catch(() => {});
    await page.waitForTimeout(400);
    if (new URL(page.url()).pathname !== path) { console.log(`skip ${path}: redirected to ${new URL(page.url()).pathname}`); continue; }
    if (!(await page.evaluate(() => Boolean(globalThis.HL)))) await page.addScriptTag({ content: matcher });
    const boxes = await page.evaluate(list => {
      const out = {};
      for (const label of list) {
        const main = document.querySelector('main');
        const el = (main && globalThis.HL.findHighlightElement(main, label)) || globalThis.HL.findHighlightElement(document, label);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
        const x = Math.max(0, Math.round(r.left)), y = Math.max(0, Math.round(r.top));
        out[label] = [x, y, Math.round(Math.min(r.right, innerWidth) - x), Math.round(Math.min(r.bottom, innerHeight) - y)];
      }
      return out;
    }, [...labels]);
    if (process.env.HELP_SHOTS_DEBUG) console.log(`debug ${path}: api=${[...apiSeen].join(',')} error=${lastError}`);
    apiSeen.clear(); lastError = '';
    if (!Object.keys(boxes).length) { console.log(`skip ${path}: no labelled element on screen`); continue; }
    const file = `${slug(path)}.webp`;
    await sharp(await page.screenshot({ type: 'png' })).webp({ quality: QUALITY, effort: 6 }).toFile(join(OUT_DIR, file));
    shots[path] = { file, w: VIEWPORT.width, h: VIEWPORT.height, boxes };
    console.log(`${n}/${pages.size} ${path}: ${Object.keys(boxes).length} boxes`);
  } catch (e) {
    console.log(`skip ${path}: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
await browser.close();
vite.kill();
rmSync(tmp, { recursive: true, force: true });

const bytes = readdirSync(OUT_DIR).reduce((t, f) => t + statSync(join(OUT_DIR, f)).size, 0);
writeFileSync(DATA_FILE, `// GENERATED by scripts/capture-help-shots.mjs from the local dev server with demo data: re-capture, do not edit.
// Each page's screenshot (public/help-shots/<file>) and the box of each label on it, [x, y, w, h] in pixels.
export type HelpShot = { file: string; w: number; h: number; boxes: Record<string, [number, number, number, number]> };
export const HELP_SHOTS_CAPTURED_AT = '${new Date().toISOString().slice(0, 10)}';
export const HELP_SHOTS: Record<string, HelpShot> = /* DATA */${JSON.stringify(shots, null, 1)}/* DATA */;
`);
console.log(`\n${Object.keys(shots).length} screenshots, ${Object.values(shots).reduce((t, s) => t + Object.keys(s.boxes).length, 0)} boxes, ${(bytes / 1048576).toFixed(2)} MB in public/help-shots`);
process.exit(0);
