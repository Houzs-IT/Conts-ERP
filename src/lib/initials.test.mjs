// node --test src/lib/initials.test.mjs. Avatar letters (src/lib/format.ts initials).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { initials } = await import('./format.ts');

test('avatar letters are one or two uppercase letters', () => {
  assert.equal(initials('zaim'), 'Z');
  assert.equal(initials('Poh ying'), 'PY');
  assert.equal(initials('Laphii (Claude)'), 'LC');
  assert.equal(initials('It-Owner'), 'IO');
  assert.equal(initials('  Lim  Wei Siang '), 'LW');
});
