// node --test src/lib/statementActions.test.mjs (npm test). Review I5: Mark final and Send on one statement report a refusal
// (finalised or sent 0, the server's reason) instead of a green toast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementActionToast } from './statementActions.ts';

test('a statement made final says so', () => {
  assert.deepEqual(statementActionToast('finalise', { finalised: 1, failed: [] }), { tone: 'success', title: 'Statement marked final.' });
});

test('a refused Mark final gives the reason, not success', () => {
  const t = statementActionToast('finalise', { finalised: 0, failed: [{ id: 's', reason: 'Waiting: O2. Lock every step on Owner statement close before marking it final.' }] });
  assert.equal(t.tone, 'warning');
  assert.equal(t.title, 'Not marked final.');
  assert.match(t.body, /^Waiting: O2/);
});

test('a sent statement says so, a refused Send gives the reason', () => {
  assert.deepEqual(statementActionToast('send', { sent: 1, failed: [] }), { tone: 'success', title: 'Statement sent to the owner.' });
  const t = statementActionToast('send', { sent: 0, failed: [{ id: 's', reason: 'Not sent. This statement is still a draft. Mark it final first.' }] });
  assert.equal(t.tone, 'warning');
  assert.equal(t.title, 'Not sent.');
  assert.match(t.body, /still a draft/);
});
