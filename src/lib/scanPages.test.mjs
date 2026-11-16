// A bill's later pages are not read (chew, 16 Nov 2026: a Unifi bill's 5 pages, only the first is to be read).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { nextToRead, pagesToSkip } = await import('./scanPages.ts');

const A = {}, B = {};
const page = (file, pageNo, state = 'waiting') => ({ key: `${file === A ? 'a' : 'b'}${pageNo}`, file, pageNo, state });

test('a page waits for the page before it in its PDF; another PDF is read side by side', () => {
  const rows = [page(A, 1, 'reading'), page(A, 2), page(A, 3), page(B, 1)];
  assert.equal(nextToRead(rows)?.key, 'b1');
  rows[0].state = 'done';
  assert.equal(nextToRead(rows)?.key, 'a2');
  rows[1].state = 'skipped';
  assert.equal(nextToRead(rows)?.key, 'a3');
});

test('page 1 of 5: the other four of that bill are skipped; a later page read on its own is skipped itself', () => {
  const rows = [page(A, 1, 'done'), page(A, 2), page(A, 3), page(A, 4), page(A, 5), page(A, 6)];
  assert.deepEqual(pagesToSkip(rows[0], { pageNo: 1, pageCount: 5 }, rows), ['a2', 'a3', 'a4', 'a5']);
  assert.deepEqual(pagesToSkip(rows[5], { pageNo: 2, pageCount: 2 }, rows), ['a6']);
  assert.deepEqual(pagesToSkip(rows[0], { pageNo: 1, pageCount: 1 }, rows), []);
  assert.deepEqual(pagesToSkip(rows[0], { pageNo: null, pageCount: null }, rows), []);
});
