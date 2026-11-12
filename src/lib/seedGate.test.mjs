// node --test src/lib/seedGate.test.mjs. An edit form is filled once per record, not on every answer useApi hands it
// (the kept copy, the fresh copy, each timed re-read), so a refetch never wipes what is being typed (Hookka 96ed60fbd).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SeedGate } from './seedGate.ts';

/** Plays answers through the gate the way useSeedOnce does, returning the form after each. */
function play(steps) {
  const gate = new SeedGate();
  let form = null;
  const seen = [];
  for (const s of steps) {
    if (s.type === 'type') form = s.text;
    else if (s.type === 'again') gate.again();
    else if (gate.due(s.id, s.data != null)) form = s.data;
    seen.push(form);
  }
  return seen;
}

test('the kept copy fills the form; the fresh copy and a timed re-read do not wipe what was typed', () => {
  const seen = play([
    { id: 'r1', data: 'kept' },
    { type: 'type', text: 'typing' },
    { id: 'r1', data: 'fresh' },
    { id: 'r1', data: 'polled' },
  ]);
  assert.deepEqual(seen, ['kept', 'typing', 'typing', 'typing']);
});

test('no data yet fills nothing, and the first answer that arrives fills it', () => {
  assert.deepEqual(play([{ id: 'r1', data: null }, { id: 'r1', data: 'loaded' }]), [null, 'loaded']);
});

test('another record fills the form again', () => {
  const seen = play([{ id: 'r1', data: 'one' }, { type: 'type', text: 'edit' }, { id: 'r2', data: 'two' }]);
  assert.deepEqual(seen, ['one', 'edit', 'two']);
});

test('after a save, the record read back fills the form once more, and only once', () => {
  const seen = play([
    { id: 'r1', data: 'v1' },
    { type: 'type', text: 'v2 typed' },
    { type: 'again' },
    { id: 'r1', data: 'v2 saved' },
    { type: 'type', text: 'v3 typing' },
    { id: 'r1', data: 'v2 polled' },
  ]);
  assert.deepEqual(seen, ['v1', 'v2 typed', 'v2 typed', 'v2 saved', 'v3 typing', 'v3 typing']);
});
