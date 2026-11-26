// node --test src/lib/navigation.test.mjs. Which side (The Conts or Dream Crafter) a screen keeps the sidebar on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { navFor, workspaceOf } = await import('./navigation.ts');

const systemPaths = side => navFor('management', true)
  .filter(group => group.workspace === side && group.label === 'SYSTEM')
  .flatMap(group => group.items.flatMap(item => [item.path, ...(item.children ?? []).map(child => child.path)]))
  .filter(Boolean);

test('Settings, My account, Users and roles and System health keep whichever side the person is on', () => {
  for (const path of ['/account', '/notifications', '/system/settings/company', '/system/users', '/system/health']) {
    assert.equal(workspaceOf(path), null, path);
  }
});

test('Dream Crafter System offers every company-wide screen The Conts System does', () => {
  const dreamCrafterSystem = new Set(systemPaths('supply'));
  const missing = systemPaths('rental').filter(path => workspaceOf(path) === null && !dreamCrafterSystem.has(path));
  assert.deepEqual(missing, []);
  assert.ok(dreamCrafterSystem.has('/account'));
  assert.ok(!dreamCrafterSystem.has('/system/integrations'));
  assert.ok(!dreamCrafterSystem.has('/system/ai-connector'));
});

test('one-side screens still switch the sidebar to their side', () => {
  assert.equal(workspaceOf('/supply/it-support'), 'supply');
  assert.equal(workspaceOf('/system/category-access'), 'supply');
  assert.equal(workspaceOf('/system/it-support'), 'rental');
  assert.equal(workspaceOf('/system/integrations'), 'rental');
  assert.equal(workspaceOf('/system/ai-connector'), 'rental');
  assert.equal(workspaceOf('/properties/units'), 'rental');
  assert.equal(workspaceOf('/sales/orders'), 'supply');
});
