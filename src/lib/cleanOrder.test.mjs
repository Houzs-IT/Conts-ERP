// node --test src/lib/cleanOrder.test.mjs. The cleaner's job order on the board and the phone (src/lib/cleanOrder.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { sortForCleaner, sortGroupsForCleaner, checkInBucket, compareForCleaner, VERY_LATE_CHECK_IN } = await import('./cleanOrder.ts');

const units = rows => sortForCleaner(rows, r => r).map(r => r.unit);

test('soonest check-in first, then no check-in, then very late (after 20:00)', () => {
  assert.equal(VERY_LATE_CHECK_IN, '20:00');
  assert.deepEqual(units([
    { unit: 'late', checkIn: '21:00' },
    { unit: 'none', checkIn: null },
    { unit: 'evening', checkIn: '18:00' },
    { unit: 'early', checkIn: '14:00' },
  ]), ['early', 'evening', 'none', 'late']);
});

test('20:00 itself is not very late, 20:01 is', () => {
  assert.equal(checkInBucket('20:00'), 0);
  assert.equal(checkInBucket('20:01'), 2);
  assert.deepEqual(units([
    { unit: 'b', checkIn: '20:01' },
    { unit: 'none', checkIn: null },
    { unit: 'a', checkIn: '20:00' },
  ]), ['a', 'none', 'b']);
});

test('a next check-in on a later day is very late, after the units with nobody booked', () => {
  assert.equal(checkInBucket('12:00', '2026-11-03', '2026-11-02'), 2);
  assert.equal(checkInBucket('12:00', '2026-11-02', '2026-11-02'), 0);
  assert.deepEqual(units([
    { unit: 'tomorrow', checkIn: '12:00', checkInDay: '2026-11-03', day: '2026-11-02' },
    { unit: 'tonight', checkIn: '22:00', day: '2026-11-02' },
    { unit: 'none', checkIn: null, day: '2026-11-02' },
    { unit: 'today', checkIn: '15:00', day: '2026-11-02' },
  ]), ['today', 'none', 'tonight', 'tomorrow']);
});

test('carried-over jobs: the earlier arrival comes first even at a later clock time', () => {
  assert.deepEqual(units([
    { unit: 'today-13', checkIn: '13:00', day: '2026-11-02' },
    { unit: 'yesterday-15', checkIn: '15:00', day: '2026-11-01' },
  ]), ['yesterday-15', 'today-13']);
});

test('inside each group the earliest check-in comes first', () => {
  assert.deepEqual(units([
    { unit: 'e3', checkIn: '19:00' },
    { unit: 'l2', checkIn: '23:00' },
    { unit: 'e1', checkIn: '12:00' },
    { unit: 'l1', checkIn: '20:30' },
    { unit: 'e2', checkIn: '15:30' },
  ]), ['e1', 'e2', 'e3', 'l1', 'l2']);
});

test('a missing or unreadable time is treated as no check-in', () => {
  assert.equal(checkInBucket(undefined), 1);
  assert.equal(checkInBucket(''), 1);
  assert.equal(checkInBucket('3pm'), 1);
});

test('finished jobs go to the bottom, keeping the same order among themselves', () => {
  assert.deepEqual(units([
    { unit: 'done-early', checkIn: '12:00', done: true },
    { unit: 'late', checkIn: '21:00' },
    { unit: 'done-none', checkIn: null, done: true },
    { unit: 'early', checkIn: '13:00' },
  ]), ['early', 'late', 'done-early', 'done-none']);
});

test('ties fall back to building, then unit number read as numbers', () => {
  assert.deepEqual(units([
    { unit: 'B-10-02', building: 'Vortex', checkIn: null },
    { unit: 'B-08-11', building: 'Vortex', checkIn: null },
    { unit: 'A-01-01', building: 'Sky', checkIn: null },
    { unit: 'B-9-01', building: 'Vortex', checkIn: '14:00' },
  ]), ['B-9-01', 'A-01-01', 'B-08-11', 'B-10-02']);
});

test('a changed check-in time re-sorts on the next read (nothing is remembered)', () => {
  const rows = [{ unit: 'x', checkIn: '16:00' }, { unit: 'y', checkIn: '14:00' }];
  assert.deepEqual(units(rows), ['y', 'x']);
  rows[1] = { ...rows[1], checkIn: '21:00' };
  assert.deepEqual(units(rows), ['x', 'y']);
});

test('the input is not changed and the comparison is symmetric', () => {
  const rows = [{ unit: 'b', checkIn: '16:00' }, { unit: 'a', checkIn: '10:00' }];
  sortForCleaner(rows, r => r);
  assert.deepEqual(rows.map(r => r.unit), ['b', 'a']);
  assert.equal(Math.sign(compareForCleaner(rows[0], rows[1])), -Math.sign(compareForCleaner(rows[1], rows[0])));
});

test('buildings sort by their most urgent open job; external last; all-done buildings sink', () => {
  const g = (name, jobs, ext = false) => ({ name, jobs, ext });
  const order = sortGroupsForCleaner([
    g('Alpha', [{ checkIn: null }, { checkIn: '21:00' }]),
    g('External', [{ checkIn: null }], true),
    g('Bravo', [{ checkIn: '16:00' }, { checkIn: null }]),
    g('Charlie', [{ checkIn: '12:00', done: true }]),
    g('Delta', [{ checkIn: '13:00' }]),
  ], x => x.jobs, x => x.name, x => x.ext).map(x => x.name);
  assert.deepEqual(order, ['Delta', 'Bravo', 'Alpha', 'Charlie', 'External']);
});

test('buildings whose lead jobs tie fall back to name order', () => {
  const order = sortGroupsForCleaner([
    { name: 'Zeta', jobs: [{ checkIn: '15:00', unit: 'A-1' }] },
    { name: 'Eta', jobs: [{ checkIn: '15:00', unit: 'Z-9' }] },
  ], x => x.jobs, x => x.name).map(x => x.name);
  assert.deepEqual(order, ['Eta', 'Zeta']);
});
