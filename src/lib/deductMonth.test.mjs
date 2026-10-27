// node --test src/lib/deductMonth.test.mjs (npm test). Which statement takes a utility bill (spec 2026-10-27 §3.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstOpenMonth } from './deductMonth.ts';

test('a bill for an open month stays in its month', () => assert.equal(firstOpenMonth('2026-09', new Set(['2026-08'])), '2026-09'));
test('a bill for a final month goes to the next month', () => assert.equal(firstOpenMonth('2026-08', new Set(['2026-08'])), '2026-09'));
test('two final months in a row are both passed, across a year end', () =>
  assert.equal(firstOpenMonth('2025-11', new Set(['2025-11', '2025-12'])), '2026-01'));
test('a final month after the bill month does not matter', () => assert.equal(firstOpenMonth('2026-08', new Set(['2026-09'])), '2026-08'));
