// node --test src/lib/attendance.test.mjs. Punch arithmetic in functions/_lib/attendanceCalc.ts (migration 0163).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { distanceM, nearestBuilding, coord, workedMinutes, mytInstant } = await import('../../functions/_lib/attendanceCalc.ts');

test('distance: one degree of latitude is about 111 km, a point to itself is 0', () => {
  assert.ok(Math.abs(distanceM({ lat: 3, lng: 101 }, { lat: 4, lng: 101 }) - 111_195) < 50);
  assert.equal(distanceM({ lat: 3.1, lng: 101.6 }, { lat: 3.1, lng: 101.6 }), 0);
});

test('nearest building, or none without a location', () => {
  const sites = [{ id: 'a', name: 'Far', lat: 3.2, lng: 101.7 }, { id: 'b', name: 'Near', lat: 3.1001, lng: 101.6 }];
  const n = nearestBuilding({ lat: 3.1, lng: 101.6 }, sites);
  assert.equal(n.name, 'Near');
  assert.ok(n.metres > 5 && n.metres < 20);
  assert.equal(nearestBuilding(null, sites), null);
  assert.equal(nearestBuilding({ lat: 3.1, lng: 101.6 }, []), null);
});

test('coordinates: text or numbers in range, anything else is no location', () => {
  assert.equal(coord('3.139', 90), 3.139);
  assert.equal(coord(101.68, 180), 101.68);
  assert.equal(coord('', 90), null);
  assert.equal(coord(null, 90), null);
  assert.equal(coord('91', 90), null);
  assert.equal(coord('abc', 180), null);
});

test('worked minutes count to the clock-out, or to now while open, never below zero', () => {
  assert.equal(workedMinutes('2026-10-26T00:00:00.000Z', '2026-10-26T09:15:00.000Z'), 555);
  assert.equal(workedMinutes('2026-10-26T00:00:00.000Z', null, Date.parse('2026-10-26T01:00:30.000Z')), 60);
  assert.equal(workedMinutes('2026-10-26T09:00:00.000Z', '2026-10-26T08:00:00.000Z'), 0);
});

test('a Malaysia wall-clock time becomes the right instant', () => {
  assert.equal(mytInstant('2026-10-26', '08:30'), '2026-10-26T00:30:00.000Z');
  assert.equal(mytInstant('2026-10-26', '07:00'), '2026-10-25T23:00:00.000Z');
  assert.equal(mytInstant('2026-10-26', '24:00'), null);
  assert.equal(mytInstant('26-10-2026', '08:30'), null);
});
