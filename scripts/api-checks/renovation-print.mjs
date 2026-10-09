// Draws the renovation print formats from the fixtures transcribed from the owner's sample PDFs
// (engine/frontend/src/lib/renovation/print-fixtures.ts) with the same jsPDF renderer the screens use,
// writes the PDFs, and prints each page's TOTAL so they can be compared with the samples side by side.
//
// Run: node scripts/api-checks/renovation-print.mjs <out folder> [--logo-dream=<png>] [--logo-conts=<png>]
// (logos optional: without them the brand name prints as text, as it does until a logo is uploaded.)
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = process.argv[2];
if (!outDir) { console.error('Usage: node scripts/api-checks/renovation-print.mjs <out folder>'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;

const fe = join(root, 'engine', 'frontend');
const out = await build({
  stdin: {
    contents: `export * from './src/lib/renovation/print-fixtures.ts';
export { renderRenovationDoc } from './src/lib/renovation/renovation-doc-pdf.ts';
export { pageTotalSen, summaryRows } from './src/lib/renovation/print-layout.ts';
export { rmPlain } from './src/lib/renovation/print-model.ts';
export { jsPDF } from 'jspdf';`,
    resolveDir: fe, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = mkdtempSync(join(tmpdir(), 'reno-print-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

const logo = (path) => {
  if (!path) return null;
  const buf = readFileSync(path);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, format: 'PNG', width, height };
};
const dream = logo(arg('logo-dream'));
const conts = logo(arg('logo-conts'));

const jobs = [
  ['AVA-format1-amount', { ...M.doc('AMOUNT', M.AVA), docNo: 'HC-SO-2511-001', brand: { ...M.DREAM_CRAFTER, logo: dream } }, 'normal'],
  ['AVA-format2-unit-price', { ...M.doc('UNIT_PRICE', M.AVA), docNo: 'HC-SO-2511-001', brand: { ...M.DREAM_CRAFTER, logo: dream } }, 'normal'],
  ['DCLOVER-format3-discount', { ...M.dclover(), docNo: 'QT-2608-001-R3', brand: { ...M.DREAM_CRAFTER, logo: dream } }, 'compact'],
  ['SKYLINE-format4-qty-only', { ...M.skyline(), docNo: 'QT-2601-002', brand: { ...M.THE_CONTS, logo: conts } }, 'normal'],
  ['KL48-format5-promo', { ...M.kl48(), docNo: 'QT-2601-003', brand: { ...M.THE_CONTS, logo: conts } }, 'normal'],
];
for (const [name, d, density] of jobs) {
  const pdf = new M.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const layout = M.renderRenovationDoc(pdf, d, density);
  writeFileSync(join(outDir, `${name}.pdf`), Buffer.from(pdf.output('arraybuffer')));
  const totals = layout.pages.map((p) => { const t = M.pageTotalSen(d, p); return t === null ? '-' : M.rmPlain(t); });
  const summary = M.summaryRows(d, layout.closing.summary).map((r) => `${r.label} ${M.rmPlain(r.sen)}`).join(' / ');
  console.log(`${name}: ${layout.pages.length} page(s); page totals ${totals.join(' / ')}; ${summary}`);
}
