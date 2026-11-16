import { test } from 'node:test';
import assert from 'node:assert/strict';

const { clampDoneCount, doneText, isLineDone, formatPlanDates, formatDoneDay, groupByRoom, parseCount, summarizeProject } = await import('./renoJobs.ts');

const line = (over) => ({
  id: 'l1', itemCode: 'W-1', name: 'Tile floor', remark: null, qty: 3, uom: 'unit', room: 'Kitchen', group: 'works', isOnPo: false,
  planKey: 'tiling', tradeLabel: 'Tiling', onSiteBy: null, doneQty: 0, doneAt: null, isTradeClosed: false, photoCount: 0, ...over,
});
const plan = (over) => ({ taskId: 1, planKey: 'tiling', label: 'Tiling', plannedStart: '2026-11-12', plannedEnd: '2026-11-20', status: 'planned', ...over });

test('a count stays between 0 and the line qty, and junk becomes 0', () => {
  assert.equal(clampDoneCount(5, 3), 3);
  assert.equal(clampDoneCount(-1, 3), 0);
  assert.equal(clampDoneCount(2.5, 3), 2.5);
  assert.equal(clampDoneCount(Number.NaN, 3), 0);
});

test('reads "2 of 3" and knows when a line is done', () => {
  assert.equal(doneText(2, 3), '2 of 3');
  assert.equal(doneText(1.5, 3), '1.5 of 3');
  assert.equal(isLineDone({ qty: 3, doneQty: 3 }), true);
  assert.equal(isLineDone({ qty: 3, doneQty: 2 }), false);
  assert.equal(isLineDone({ qty: 0, doneQty: 0 }), false);
});

test('plan dates read day/month, one date when both are the same, nothing when unset', () => {
  assert.equal(formatPlanDates(plan()), '12/11 to 20/11');
  assert.equal(formatPlanDates(plan({ plannedEnd: '2026-11-12' })), '12/11');
  assert.equal(formatPlanDates(plan({ plannedStart: null, plannedEnd: null })), null);
});

test('rooms keep first-seen order, Works sit under their trade with its plan, Built-in under Carpentry', () => {
  const project = {
    lines: [
      line({ id: 'a', itemCode: 'W-2', room: 'Kitchen' }),
      line({ id: 'b', itemCode: 'W-1', room: 'Kitchen', planKey: 'paint', tradeLabel: 'Painting' }),
      line({ id: 'c', itemCode: 'B-1', room: 'Kitchen', group: 'builtin', planKey: 'carpentry', tradeLabel: 'Carpentry' }),
      line({ id: 'd', itemCode: 'W-3', room: null, planKey: null, tradeLabel: null }),
    ],
    plans: [plan(), plan({ planKey: 'carpentry', label: 'Carpentry', status: 'overdue' })],
  };
  const rooms = groupByRoom(project);
  assert.deepEqual(rooms.map(room => room.room), ['Kitchen', 'No room']);
  const [kitchen, noRoom] = rooms;
  assert.deepEqual(kitchen.trades.map(trade => trade.label), ['Painting', 'Tiling']);
  assert.equal(kitchen.trades[0].plan, null);
  assert.equal(kitchen.trades[1].plan?.planKey, 'tiling');
  assert.equal(kitchen.carpentry?.plan?.status, 'overdue');
  assert.equal(noRoom.carpentry, null);
  assert.equal(noRoom.trades[0].plan, null);
});

test('a project summary counts lines and flags a late trade', () => {
  const project = {
    lines: [line({ doneQty: 3 }), line({ id: 'x', group: 'builtin' })],
    plans: [plan({ status: 'late_start' })],
  };
  assert.deepEqual(summarizeProject(project), { worksCount: 1, builtInCount: 1, doneLineCount: 1, lineCount: 2, isLate: true });
});

test('a typed count is a number or null, never 0 by accident', () => {
  assert.equal(parseCount('2'), 2);
  assert.equal(parseCount(' 2,5 '), 2.5);
  assert.equal(parseCount('.5'), 0.5);
  assert.equal(parseCount(''), null);
  assert.equal(parseCount('abc'), null);
  assert.equal(parseCount('1e3'), null);
  assert.equal(parseCount('-1'), null);
  assert.equal(parseCount('1.2.3'), null);
});

test('a done time reads as the day and month in Kuala Lumpur', () => {
  assert.equal(formatDoneDay('2026-11-15T17:30:00Z'), '16/11');
  assert.equal(formatDoneDay('2026-11-15T15:30:00Z'), '15/11');
  assert.equal(formatDoneDay(null), null);
  assert.equal(formatDoneDay('nope'), null);
});

test('a trade with several plans shows its most urgent status and its latest end date', () => {
  const project = {
    lines: [line({ planKey: 'electrical', tradeLabel: 'Electrical' })],
    plans: [
      plan({ taskId: 1, planKey: 'electrical', status: 'done', plannedStart: '2026-11-01', plannedEnd: '2026-11-05' }),
      plan({ taskId: 2, planKey: 'electrical', status: 'late_start', plannedStart: '2026-11-10', plannedEnd: '2026-11-25' }),
      plan({ taskId: 3, planKey: 'electrical', status: 'planned', plannedStart: '2026-11-20', plannedEnd: '2026-11-22' }),
    ],
  };
  const [kitchen] = groupByRoom(project);
  assert.equal(kitchen.trades[0].plan?.status, 'late_start');
  assert.equal(kitchen.trades[0].plan?.plannedEnd, '2026-11-25');
  assert.equal(kitchen.trades[0].plan?.plannedStart, '2026-11-01');
});
