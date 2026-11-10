// node --test src/lib/export.test.mjs. The shared CSV writer (src/lib/export.ts) that table exports and the
// Products "CSV for import" button use: Excel must read it as UTF-8, and plain column labels must come back as-is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { toCsv } = await import('./export.ts');

test('a CSV export starts with the UTF-8 BOM, so Excel shows Chinese text', () => {
  const csv = toCsv([{ label: 'name', kind: 'text' }], [['双人沙发']]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.charCodeAt(1), 'n'.charCodeAt(0));
  assert.equal(csv.slice(1), 'name\r\n双人沙发\r\n');
});

test('text and number columns keep their label, so Products import reads the headings back', () => {
  const csv = toCsv([{ label: 'code', kind: 'text' }, { label: 'base_price', kind: 'number' }], [['SF-1', 3280], ['SF-2', null]]);
  assert.equal(csv.slice(1), 'code,base_price\r\nSF-1,3280\r\nSF-2,\r\n');
});
