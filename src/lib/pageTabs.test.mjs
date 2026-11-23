// The row of open pages under the top bar (chew, 20 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { visit, close, pageOf, MAX_TABS } = await import('./pageTabs.ts');

test('a new page goes on the end; the same page with another query keeps its place and takes the query', () => {
  let t = visit([], '/finance/payment-requests', 'Payment requests', 1);
  t = visit(t, '/sales/invoices', 'Sales invoices', 2);
  t = visit(t, '/finance/payment-requests?tab=utilities', 'Payment requests', 3);
  assert.deepEqual(t.map(x => x.path), ['/finance/payment-requests?tab=utilities', '/sales/invoices']);
  assert.equal(pageOf('/a/b/?x=1#y'), '/a/b');
});

test('past the limit the tab used longest ago goes, never the one being opened', () => {
  let t = [];
  for (let i = 0; i < MAX_TABS; i++) t = visit(t, `/p/${i}`, `P${i}`, i + 10);
  t = visit(t, '/p/0', 'P0', 100); // used again, so /p/1 is now the oldest
  t = visit(t, '/p/new', 'New', 101);
  assert.equal(t.length, MAX_TABS);
  assert.ok(!t.some(x => x.path === '/p/1'));
  assert.ok(t.some(x => x.path === '/p/0') && t.at(-1).path === '/p/new');
});

test('closing the open tab goes to the one on its right, else its left; another tab just goes', () => {
  const t = ['/a', '/b', '/c'].map((path, i) => ({ path, title: path, at: i }));
  assert.deepEqual(close(t, '/b', '/b?x=1'), { tabs: [t[0], t[2]], go: '/c' });
  assert.deepEqual(close(t, '/c', '/c').go, '/b');
  assert.deepEqual(close(t, '/a', '/c'), { tabs: [t[1], t[2]], go: null });
  assert.deepEqual(close([t[0]], '/a', '/a').go, '/');
});
