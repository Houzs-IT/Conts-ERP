// Page tabs go back to the record a Supply chain screen was left on (24 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.sessionStorage = {
  getItem: k => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

const { lastEnginePath, rememberEnginePath, isResume, RESUME, ENGINE_PLACES_KEY } = await import('./enginePlaces.ts');

test('each menu keeps its own last record', () => {
  store.clear();
  rememberEnginePath('/projects/list', '/beta/projects/42');
  rememberEnginePath('/projects/calendar', '/beta/calendar?month=2026-11');
  assert.equal(lastEnginePath('/projects/list'), '/beta/projects/42');
  assert.equal(lastEnginePath('/projects/calendar'), '/beta/calendar?month=2026-11');
  assert.equal(lastEnginePath('/projects/defects'), null);
});

test('a broken or foreign stored value is ignored', () => {
  store.set(ENGINE_PLACES_KEY, '{not json');
  assert.equal(lastEnginePath('/projects/list'), null);
  store.set(ENGINE_PLACES_KEY, JSON.stringify({ '/a': '//evil.example', '/b': 7, '/c': '/ok' }));
  assert.equal(lastEnginePath('/a'), null);
  assert.equal(lastEnginePath('/b'), null);
  assert.equal(lastEnginePath('/c'), '/ok');
});

test('only a page tab click resumes', () => {
  assert.equal(isResume(RESUME), true);
  assert.equal(isResume(null), false);
  assert.equal(isResume(undefined), false);
  assert.equal(isResume({ resume: 'yes' }), false);
});
