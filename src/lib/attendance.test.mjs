// node --test src/lib/attendance.test.mjs. Punch arithmetic in functions/_lib/attendanceCalc.ts (migration 0166) and the
// building punch radius in functions/_lib/punchSites.ts (migration 0183).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { distanceM, placeOf, coord, workedMinutes, mytInstant, openTooLong, isForgottenOut, FORGOTTEN_AFTER_HOURS } = await import('../../functions/_lib/attendanceCalc.ts');
const { radiusInput, toSite } = await import('../../functions/_lib/punchSites.ts');

test('distance: one degree of latitude is about 111 km, a point to itself is 0', () => {
  assert.ok(Math.abs(distanceM({ lat: 3, lng: 101 }, { lat: 4, lng: 101 }) - 111_195) < 50);
  assert.equal(distanceM({ lat: 3.1, lng: 101.6 }, { lat: 3.1, lng: 101.6 }), 0);
});

test('place: the closest site whose circle holds the punch, else the closest site off site, or none', () => {
  const far = { id: 'a', name: 'Far', lat: 3.2, lng: 101.7, radiusM: 200 };
  const near = { id: 'b', name: 'Near', lat: 3.1001, lng: 101.6, radiusM: 200 };
  const n = placeOf({ lat: 3.1, lng: 101.6 }, [far, near]);
  assert.equal(n.name, 'Near');
  assert.ok(n.metres > 5 && n.metres < 20 && n.onSite);
  assert.equal(placeOf(null, [near]), null);
  assert.equal(placeOf({ lat: 3.1, lng: 101.6 }, []), null);
});

test('place: each site has its own radius', () => {
  // A point about 555 m north of the site.
  const p = { lat: 3.105, lng: 101.6 };
  const small = { id: 's', name: 'Office', lat: 3.1, lng: 101.6, radiusM: 200 };
  const off = placeOf(p, [small]);
  assert.equal(off.onSite, false);
  assert.ok(off.metres > 540 && off.metres < 570);
  const wide = placeOf(p, [{ ...small, radiusM: 1000 }]);
  assert.equal(wide.onSite, true);
  assert.equal(wide.name, 'Office');
});

test('place: a site that holds the punch wins over a closer one that does not', () => {
  const p = { lat: 3.1, lng: 101.6 };
  // The yard's centre is closer, but its circle is tiny; the depot's wide circle holds the punch.
  const yard = { id: 'y', name: 'Yard', lat: 3.1003, lng: 101.6, radiusM: 20 };
  const depot = { id: 'd', name: 'Depot', lat: 3.103, lng: 101.6, radiusM: 500 };
  const n = placeOf(p, [yard, depot]);
  assert.equal(n.name, 'Depot');
  assert.equal(n.onSite, true);
  // Inside both: the closer one names it.
  const both = placeOf(p, [{ ...yard, radiusM: 100 }, depot]);
  assert.equal(both.name, 'Yard');
});

test('forgotten clock-out: open past 16 hours, or marked; a shift past midnight is not forgotten', () => {
  assert.equal(FORGOTTEN_AFTER_HOURS, 16);
  const inAt = '2026-10-26T12:00:00.000Z'; // 20:00 Malaysia
  const h = (n) => Date.parse(inAt) + n * 3_600_000;
  // 01:00 the next morning in Malaysia, still out with the crew.
  assert.equal(openTooLong(inAt, h(5)), false);
  assert.equal(openTooLong(inAt, h(16)), false);
  assert.equal(openTooLong(inAt, h(16) + 60_000), true);
  assert.equal(isForgottenOut({ clock_in_at: inAt, clock_out_at: null, forgot_out: 0 }, h(5)), false);
  assert.equal(isForgottenOut({ clock_in_at: inAt, clock_out_at: null, forgot_out: 0 }, h(17)), true);
  assert.equal(isForgottenOut({ clock_in_at: inAt, clock_out_at: null, forgot_out: 1 }, h(1)), true);
  // A day with its clock-out is never forgotten, however long ago.
  assert.equal(isForgottenOut({ clock_in_at: inAt, clock_out_at: '2026-10-26T20:00:00.000Z', forgot_out: 0 }, h(100)), false);
});

test('building radius: whole metres from 20 m to 5 km, or empty for the default', () => {
  assert.equal(radiusInput.safeParse({ radiusM: 150 }).success, true);
  assert.equal(radiusInput.safeParse({ radiusM: null }).data.radiusM, null);
  for (const radiusM of [10, 5001, 100.5, '150', undefined]) assert.equal(radiusInput.safeParse({ radiusM }).success, false, String(radiusM));
});

test('a building row reads as a punch site, with no radius of its own until one is set', () => {
  assert.deepEqual(toSite({ id: 'p1', name: 'Sky Suites', latitude: 3.1, longitude: 101.6, punch_radius_m: null }),
    { id: 'p1', name: 'Sky Suites', lat: 3.1, lng: 101.6, radiusM: null });
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
