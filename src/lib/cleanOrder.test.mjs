// node --test src/lib/cleanOrder.test.mjs. The cleaner's job order on the phone (src/lib/cleanOrder.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { sortForCleaner, checkInBucket, compareForCleaner } = await import('./cleanOrder.ts');

const units = rows => sortForCleaner(rows, r => r).map(r => r.unit);

test('check-ins by 15:00 first, then no check-in, then after 15:00', () => {
  assert.deepEqual(units([
    { unit: 'late', checkIn: '16:00' },
    { unit: 'none', checkIn: null },
    { unit: 'early', checkIn: '14:00' },
  ]), ['early', 'none', 'late']);
});

test('15:00 itself counts as early, 15:01 as late', () => {
  assert.equal(checkInBucket('15:00'), 0);
  assert.equal(checkInBucket('15:01'), 2);
  assert.deepEqual(units([
    { unit: 'b', checkIn: '15:01' },
    { unit: 'none', checkIn: null },
    { unit: 'a', checkIn: '15:00' },
  ]), ['a', 'none', 'b']);
});

test('inside each group the earliest check-in comes first', () => {
  assert.deepEqual(units([
    { unit: 'e3', checkIn: '15:00' },
    { unit: 'l2', checkIn: '20:00' },
    { unit: 'e1', checkIn: '12:00' },
    { unit: 'l1', checkIn: '15:30' },
    { unit: 'e2', checkIn: '14:30' },
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
    { unit: 'late', checkIn: '18:00' },
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

test('the input is not changed and the comparison is symmetric', () => {
  const rows = [{ unit: 'b', checkIn: '16:00' }, { unit: 'a', checkIn: '10:00' }];
  sortForCleaner(rows, r => r);
  assert.deepEqual(rows.map(r => r.unit), ['b', 'a']);
  assert.equal(Math.sign(compareForCleaner(rows[0], rows[1])), -Math.sign(compareForCleaner(rows[1], rows[0])));
});
