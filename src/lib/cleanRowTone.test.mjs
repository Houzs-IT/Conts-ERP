// node --test src/lib/cleanRowTone.test.mjs. The Cleaning board's red / yellow row (src/lib/cleanRowTone.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { cleanRowTone } = await import('./cleanRowTone.ts');

const at = iso => Date.parse(iso);
const row = (o = {}) => ({ day: '2026-10-26', status: 'waiting', guestOut: false, checkOutTime: '11:00', ...o });

test('before the checkout time a row has no colour', () => {
  assert.equal(cleanRowTone(row(), at('2026-10-26T10:59:00+08:00')), null);
});

test('past the checkout time with nobody ticked the row is red', () => {
  assert.equal(cleanRowTone(row(), at('2026-10-26T11:00:00+08:00')), 'overdue');
  assert.equal(cleanRowTone(row({ status: 'guest_in' }), at('2026-10-26T15:00:00+08:00')), 'overdue');
});

test('a late checkout moves the red to its own time', () => {
  assert.equal(cleanRowTone(row({ checkOutTime: '14:00' }), at('2026-10-26T13:00:00+08:00')), null);
  assert.equal(cleanRowTone(row({ checkOutTime: '14:00' }), at('2026-10-26T14:01:00+08:00')), 'overdue');
});

test('a clean carried over from an earlier day and still not ticked stays red', () => {
  assert.equal(cleanRowTone(row({ day: '2026-10-25' }), at('2026-10-26T09:00:00+08:00')), 'overdue');
});

test('ticked out, or cleaning started, the row is yellow until the clean is done', () => {
  const late = at('2026-10-26T12:00:00+08:00');
  assert.equal(cleanRowTone(row({ guestOut: true, status: 'ready' }), late), 'out');
  assert.equal(cleanRowTone(row({ status: 'cleaning' }), late), 'out');
  assert.equal(cleanRowTone(row({ guestOut: true, status: 'done' }), late), null);
});

test('no departing guest is never red', () => {
  assert.equal(cleanRowTone(row({ checkOutTime: null }), at('2026-10-26T18:00:00+08:00')), null);
});
