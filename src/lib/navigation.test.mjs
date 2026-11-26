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

test('My account, Users and roles and System health keep whichever side the person is on', () => {
  for (const path of ['/account', '/system/users', '/system/health']) {
    assert.equal(workspaceOf(path), null, path);
  }
});

test('Dream Crafter System holds Users and roles, System health and a Settings with only My account', () => {
  const dreamCrafterSystem = systemPaths('supply');
  for (const path of ['/system/users', '/system/health', '/account']) assert.ok(dreamCrafterSystem.includes(path), path);
  for (const path of ['/system/integrations', '/system/ai-connector', '/notifications', '/system/settings/company']) {
    assert.ok(!dreamCrafterSystem.includes(path), path);
  }
  const dreamCrafterSettings = navFor('management', true).find(group => group.workspace === 'supply' && group.label === 'SYSTEM')
    ?.items.find(item => item.key === 'settings');
  assert.deepEqual(dreamCrafterSettings?.children?.map(tab => tab.key), ['myAccount']);
});

test('one-side screens still switch the sidebar to their side', () => {
  assert.equal(workspaceOf('/supply/it-support'), 'supply');
  assert.equal(workspaceOf('/system/category-access'), 'supply');
  assert.equal(workspaceOf('/system/it-support'), 'rental');
  assert.equal(workspaceOf('/system/integrations'), 'rental');
  assert.equal(workspaceOf('/system/ai-connector'), 'rental');
  assert.equal(workspaceOf('/notifications'), 'rental');
  assert.equal(workspaceOf('/system/settings/company'), 'rental');
  assert.equal(workspaceOf('/properties/units'), 'rental');
  assert.equal(workspaceOf('/sales/orders'), 'supply');
});
