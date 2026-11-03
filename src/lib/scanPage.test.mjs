// node --test src/lib/scanPage.test.mjs (npm test). A photo picked on Scan bills is sent with its own image type: a PNG
// labelled JPEG was refused by the reader (3 Nov 2026, the September TNB run). Images the reader cannot take, or too big
// for it, are redrawn as a JPEG first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageFileName, needsJpeg } from './scanPage.ts';

test('the uploaded page keeps its own type in its name', () => {
  assert.equal(pageFileName('e09-p1-2.png', 1, 'image/png'), 'e09-p1-2-p1.png');
  assert.equal(pageFileName('TNB Sept.pdf', 3, 'image/jpeg'), 'TNB Sept-p3.jpg');
  assert.equal(pageFileName('bill.webp', 1, 'image/webp'), 'bill-p1.webp');
  assert.equal(pageFileName('bill', 1, ''), 'bill-p1.jpg');
});

test('only what the reader cannot take, or a too-big photo, is redrawn as a JPEG', () => {
  assert.equal(needsJpeg('image/jpeg', 800_000), false);
  assert.equal(needsJpeg('image/png', 800_000), false);
  assert.equal(needsJpeg('image/webp', 800_000), false);
  assert.equal(needsJpeg('image/heic', 800_000), true);
  assert.equal(needsJpeg('image/gif', 800_000), true);
  assert.equal(needsJpeg('', 800_000), true);
  assert.equal(needsJpeg('image/png', 4_000_000), true);
});
