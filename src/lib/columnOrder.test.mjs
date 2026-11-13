// Dragging a list's column header onto another moves it before or after that column (chew, 13 Nov 2026: "这个header 可以拖动
// 自己排吗？根据user"). src/lib/columnOrder.ts moves the column in the table's whole layout, hidden columns included.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { moveColumn } = await import('./columnOrder.ts');

const layout = [
  { key: 'code', hidden: false }, { key: 'rule', hidden: false }, { key: 'note', hidden: true },
  { key: 'unit', hidden: false }, { key: 'amount', hidden: false },
];
const keys = l => l.map(c => c.key).join(' ');

test('a column dropped on the left half of another goes before it', () => {
  assert.equal(keys(moveColumn(layout, 'amount', 'rule', 'before')), 'code amount rule note unit');
});

test('a column dropped on the right half of another goes after it', () => {
  assert.equal(keys(moveColumn(layout, 'code', 'unit', 'after')), 'rule note unit code amount');
});

test('hidden columns keep their place among the others and keep being hidden', () => {
  const moved = moveColumn(layout, 'unit', 'code', 'before');
  assert.equal(keys(moved), 'unit code rule note amount');
  assert.equal(moved.find(c => c.key === 'note').hidden, true);
});

test('dropping a column where it already is, on itself, or on a column the table does not have changes nothing', () => {
  assert.equal(moveColumn(layout, 'rule', 'rule', 'before'), layout);
  assert.equal(moveColumn(layout, 'rule', 'note', 'before'), layout);
  assert.equal(moveColumn(layout, 'code', 'rule', 'before'), layout);
  assert.equal(moveColumn(layout, 'gone', 'rule', 'after'), layout);
  assert.equal(moveColumn(layout, 'rule', 'gone', 'after'), layout);
});

const { accountOrderNewer, viewKeepsColumns } = await import('./columnOrder.ts');

test("the account's column order replaces this browser's only when it was saved later than the one the browser has", () => {
  assert.equal(accountOrderNewer('2026-11-13T09:00:00.000Z', '2026-11-13T08:00:00.000Z'), true);
  assert.equal(accountOrderNewer('2026-11-13T09:00:00.000Z', null), true);
  assert.equal(accountOrderNewer('2026-11-13T08:00:00.000Z', '2026-11-13T08:00:00.000Z'), false);
  assert.equal(accountOrderNewer('2026-11-13T07:00:00.000Z', '2026-11-13T08:00:00.000Z'), false);
  assert.equal(accountOrderNewer(null, null), false);
  assert.equal(accountOrderNewer(undefined, '2026-11-13T08:00:00.000Z'), false);
});

test('opening a saved view changes the columns only when the view keeps some (ready-made company views keep none)', () => {
  assert.equal(viewKeepsColumns({ columns: [{ key: 'code', hidden: false }] }), true);
  assert.equal(viewKeepsColumns({ columns: [] }), false);
  assert.equal(viewKeepsColumns({}), false);
});
