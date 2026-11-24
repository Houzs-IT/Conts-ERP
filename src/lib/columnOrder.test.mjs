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

// Review, 13 Nov 2026: a shared computer (the front desk) keeps each person's own order; drag only where the Columns
// menu can put a column back; a change waiting to be sent goes at once when the list is left.
const { layoutKeys, readLayout, columnControls, columnSaver } = await import('./columnOrder.ts');
const store = o => ({ getItem: k => (k in o ? o[k] : null) });

test('each person on a shared computer has their own column order there; the one order a browser kept before is their start', () => {
  const a = layoutKeys('user-a', 'bookings'), b = layoutKeys('user-b', 'bookings');
  assert.notEqual(a.columns, b.columns);
  assert.notEqual(a.at, b.at);
  const s = store({ [a.columns]: JSON.stringify([{ key: 'unit', hidden: false }]), 'dt:bookings:columns': JSON.stringify([{ key: 'guest', hidden: false }]) });
  assert.deepEqual(readLayout(s, a), [{ key: 'unit', hidden: false }]);
  assert.deepEqual(readLayout(s, b), [{ key: 'guest', hidden: false }]);
  assert.equal(readLayout(store({}), a), null);
  assert.equal(readLayout(store({ [a.columns]: '{not json' }), a), null);
  assert.equal(readLayout({ getItem() { throw new Error('blocked'); } }, a), null);
  assert.equal(readLayout(null, a), null);
});

test('headers drag only where the Columns menu can put a column back, and the order goes with desk accounts on every such list', () => {
  assert.deepEqual(columnControls({ desk: true, visible: 5 }), { drag: true, account: true });
  // A list inside a record: no toolbar or no Columns menu (owner, Oct 2026).
  assert.deepEqual(columnControls({ noToolbar: true, desk: true, visible: 5 }), { drag: false, account: false });
  assert.deepEqual(columnControls({ noColumns: true, desk: true, visible: 5 }), { drag: false, account: false });
  // One column left on screen: nothing to drag onto, but the Columns menu still saves.
  assert.deepEqual(columnControls({ desk: true, visible: 1 }), { drag: false, account: true });
  // Owners and field roles keep no views on the account: the order stays in their browser.
  assert.deepEqual(columnControls({ desk: false, visible: 5 }), { drag: true, account: false });
});

const settle = () => new Promise(r => setImmediate(r));

test('changes made within a moment of each other are sent once, the last of them', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = [];
  const s = columnSaver(async c => { sent.push(c); return 'T1'; }, () => {}, 800);
  s.schedule('A'); t.mock.timers.tick(500); s.schedule('B'); t.mock.timers.tick(799);
  assert.deepEqual(sent, []);
  t.mock.timers.tick(1); await settle();
  assert.deepEqual(sent, ['B']);
});

test('leaving the list sends a waiting change at once; with nothing waiting it sends nothing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = [];
  const s = columnSaver(async c => { sent.push(c); return 'T1'; }, () => {}, 800);
  s.flush(); await settle();
  assert.deepEqual(sent, []);
  s.schedule('A'); s.flush(); await settle();
  assert.deepEqual(sent, ['A']);
  t.mock.timers.tick(800); await settle();
  assert.deepEqual(sent, ['A']);
});

test('saves go one after another, so the account ends with the last; the time is noted and pending clears after', async () => {
  const sent = [], noted = [];
  let release;
  const first = new Promise(r => { release = r; });
  const s = columnSaver(async c => { sent.push(c); return c === 'A' ? first : 'T2'; }, at => noted.push(at), 800);
  s.schedule('A'); s.flush();
  assert.equal(s.pending(), true);
  s.schedule('B'); s.flush(); await settle();
  assert.deepEqual(sent, ['A']);
  release('T1'); await settle(); await settle();
  assert.deepEqual(sent, ['A', 'B']);
  assert.deepEqual(noted, ['T1', 'T2']);
  assert.equal(s.pending(), false);
});

test('a save that fails is quiet and the next one still goes', async () => {
  const sent = [], noted = [];
  const s = columnSaver(async c => { sent.push(c); if (c === 'A') throw new Error('offline'); return c === 'B' ? null : 'T3'; }, at => noted.push(at), 800);
  s.schedule('A'); s.flush(); s.schedule('B'); s.flush(); s.schedule('C'); s.flush();
  await settle(); await settle(); await settle();
  assert.deepEqual(sent, ['A', 'B', 'C']);
  assert.deepEqual(noted, ['T3']);
  assert.equal(s.pending(), false);
});

// Review, 13 Nov 2026: the drop works out its side from where the pointer is let go, not from the last hover drawn.
const { dropSide, COLUMN_DRAG_TYPE } = await import('./columnOrder.ts');

test('a column lands before a header when let go over its left half, after it over its right half', () => {
  const box = { left: 100, width: 80 };
  assert.equal(dropSide(101, box), 'before');
  assert.equal(dropSide(139, box), 'before');
  assert.equal(dropSide(140, box), 'after');
  assert.equal(dropSide(179, box), 'after');
});

test('a dragged header carries its own kind of data, which a text box does not take as typing', () => {
  assert.match(COLUMN_DRAG_TYPE, /^application\/x-/);
});
