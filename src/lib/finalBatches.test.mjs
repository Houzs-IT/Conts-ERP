// The Unit report's Final column "Lock all" makes every ready owner final; the finalise route takes at most 200
// statements a request (functions/api/statements/finalise.ts), so the owners go in batches (src/lib/finalBatches.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { FINALISE_LIMIT, finalBatches } = await import('./finalBatches.ts');

test('a month with more ready owners than finalise takes goes in batches under its limit, every owner once, in order', () => {
  const owners = Array.from({ length: 450 }, (_, i) => `owner-${i}`);
  const batches = finalBatches(owners);
  assert.equal(FINALISE_LIMIT, 200);
  assert.ok(batches.length >= 3, `${batches.length} batches`);
  assert.ok(batches.every(b => b.length > 0 && b.length <= FINALISE_LIMIT), JSON.stringify(batches.map(b => b.length)));
  assert.deepEqual(batches.flat(), owners);
});

test('a month with fewer owners is one request, and none is none', () => {
  assert.deepEqual(finalBatches(['a', 'b']), [['a', 'b']]);
  assert.deepEqual(finalBatches([]), []);
});
