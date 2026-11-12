// The Unit report's click-to-lock shows a click before the server answers (src/lib/lockOverrides.ts). Final review I1:
// a double click (lock, then unlock before the lock saved) left the cell showing "open" while the lock was stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { cellKey, startClick, settleOverrides } = await import('./lockOverrides.ts');

test('a second click on a cell whose click is still on its way is ignored; another cell is not', () => {
  const busy = new Set();
  assert.equal(startClick(busy, cellKey('u1', 'cleaning')), true);
  assert.equal(startClick(busy, cellKey('u1', 'cleaning')), false);
  assert.equal(startClick(busy, cellKey('u1', 'misc')), true);
  assert.equal(startClick(busy, cellKey('u2', 'cleaning')), true);
});

test('when the report reloads, a finished click no longer overrides what the server says, even when they disagree', () => {
  // The screen showed "open" for u1's cleaning; the server stored the lock. Nothing is on its way any more.
  assert.deepEqual(settleOverrides({ u1: { cleaning: null } }, new Set()), {});
});

test('a click still on its way keeps its override over the reload; the finished one beside it goes', () => {
  const at = '2026-11-13T00:00:00Z';
  const over = { u1: { cleaning: { by: 'You', at }, misc: null }, u2: { o2: null } };
  assert.deepEqual(settleOverrides(over, new Set([cellKey('u1', 'cleaning')])), { u1: { cleaning: { by: 'You', at } } });
});

test('with nothing to drop the same overrides come back, so the screen does not draw again', () => {
  const over = { u1: { cleaning: null } };
  assert.equal(settleOverrides(over, new Set([cellKey('u1', 'cleaning')])), over);
  const none = {};
  assert.equal(settleOverrides(none, new Set()), none);
});
