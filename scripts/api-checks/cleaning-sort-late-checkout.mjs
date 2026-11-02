// The cleaning order and late checkout (owner, 2 Nov 2026), end to end on the board and the cleaner's phone list:
// - the order (src/lib/cleanOrder.ts): soonest next check-in first, then units nobody is booked into, then very late
//   arrivals (after VERY_LATE_CHECK_IN, or on a later day); done jobs last. A changed check-in re-sorts on the next read.
// - a late checkout request moves the cleaning job's checkout time at once (paid or not): "Checkout by 14:00", and the
//   red "Checkout time passed" (src/lib/cleanRowTone.ts) only from 14:00.
// Needs a local server on demo data (node scripts/dev-pglite.mjs + wrangler pages dev; see harness.mjs).
//
// Run: API_BASE=http://localhost:8788 node scripts/api-checks/cleaning-sort-late-checkout.mjs
import { call, check, done } from './harness.mjs';

const { sortForCleaner, VERY_LATE_CHECK_IN } = await import('../../src/lib/cleanOrder.ts');
const { cleanRowTone } = await import('../../src/lib/cleanRowTone.ts');

const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const today = day(0);
const at = (hm) => Date.parse(`${today}T${hm}:00+08:00`);
const tag = `S${Date.now().toString(36)}`;

// Its own building and five units, so nothing else on the demo data is in the way.
const building = await call('POST', '/api/properties', { name: `Cleaning Order ${tag}`, state: 'Kuala Lumpur', city: 'Kuala Lumpur' });
check('a building for the check', building.status === 201 || building.status === 200, building.text);
const ownerId = (await call('GET', '/api/owners')).json?.data?.[0]?.id;
const units = [];
for (const n of [1, 2, 3, 4, 5]) {
  const r = await call('POST', '/api/units', { buildingId: building.json?.id, ownerId, unitCode: `CO${n}-${tag}`, unitNumber: `CO${n}-${tag}`, listingName: `Cleaning Order ${n} ${tag}` });
  if (r.status === 201 || r.status === 200) units.push({ id: r.json.id, unitNumber: `CO${n}-${tag}` });
  else check(`unit ${n} made`, false, r.text);
}
check('five units made', units.length === 5, units.length);
const used = new Set();

/** A guest leaving `unit` today, and optionally one arriving on `nextDay` at `nextTime`. Returns ids, or null. */
async function scene(name, next) {
  for (const u of units) {
    if (used.has(u.id)) continue;
    const out = await call('POST', '/api/reservations', { unitId: u.id, channel: 'direct', guest: { fullName: `${tag} ${name} out` }, checkIn: day(-2), checkOut: today, guestsCount: 2, grossBookingValue: 30000 });
    if (out.status !== 201) continue;
    used.add(u.id);
    let nextId = null;
    if (next) {
      const inn = await call('POST', '/api/reservations', { unitId: u.id, channel: 'direct', guest: { fullName: `${tag} ${name} in` }, checkIn: next.day, checkOut: day(next.day === today ? 2 : 4), guestsCount: 2, grossBookingValue: 30000 });
      if (inn.status !== 201) continue;
      nextId = inn.json.id;
      const t = await call('PATCH', `/api/reservations/${nextId}/details`, { checkInTime: next.time });
      check(`${name}: next check-in set to ${next.time}`, t.status === 200, t.text);
    }
    return { name, unitId: u.id, unitNumber: u.unitNumber ?? u.unit_number, outId: out.json.id, nextId };
  }
  return null;
}

const A = await scene('A soon', { day: today, time: '14:00' });
const E = await scene('E evening', { day: today, time: '18:00' });
const C = await scene('C none', null);
const D = await scene('D late', { day: today, time: '21:00' });
const B = await scene('B tomorrow', { day: day(1), time: '12:00' });
const scenes = [A, E, C, D, B];
check('five units with a checkout today', scenes.every(Boolean), scenes.map(s => s?.name ?? 'missing').join(', '));

const board = async () => (await call('GET', `/api/housekeeping/board?date=${today}`)).json;
const rowOf = (b, s) => b?.rows?.find(r => r.unitId === s.unitId && r.day === today);
// The same key the Cleaning page builds (src/pages/CleaningPage.tsx rowOrder).
const key = (r) => ({ checkIn: r.next?.checkInTime ?? r.nextLater?.checkInTime ?? null, checkInDay: r.next ? r.day : r.nextLater?.day ?? null, day: r.day, done: r.status === 'done', building: '', unit: r.unitNumber });
const order = (b) => sortForCleaner(scenes.map(s => rowOf(b, s)).filter(Boolean), key).map(r => scenes.find(s => s.unitId === r.unitId).name);

let b1 = await board();
check('every scene has its turnover job on today\'s board', scenes.every(s => rowOf(b1, s)), scenes.filter(s => !rowOf(b1, s)).map(s => s.name).join(', '));
check(`very late is after ${VERY_LATE_CHECK_IN}`, VERY_LATE_CHECK_IN === '20:00');
check('B (nobody today, next guest tomorrow) carries nextLater', rowOf(b1, B)?.next === null && rowOf(b1, B)?.nextLater?.day === day(1) && rowOf(b1, B)?.nextLater?.checkInTime === '12:00', JSON.stringify(rowOf(b1, B)?.nextLater));
check('C (nobody booked) has no next and no nextLater', rowOf(b1, C)?.next === null && rowOf(b1, C)?.nextLater === null, JSON.stringify(rowOf(b1, C)?.nextLater));
check('A has no nextLater (someone arrives today)', rowOf(b1, A)?.next?.checkInTime === '14:00' && rowOf(b1, A)?.nextLater === null);
check('order: soonest check-in, then none, then very late, then a later day', order(b1).join(' > ') === 'A soon > E evening > C none > D late > B tomorrow', order(b1).join(' > '));

// A booking change shows on the next read: A's guest now arrives at 22:00, so A moves behind C (nobody) and D (21:00).
const moved = await call('PATCH', `/api/reservations/${A.nextId}/details`, { checkInTime: '22:00' });
check('A\'s next check-in moved to 22:00', moved.status === 200, moved.text);
let b2 = await board();
check('the board answers the new time, not the old one', rowOf(b2, A)?.next?.checkInTime === '22:00', rowOf(b2, A)?.next?.checkInTime);
check('re-sorted on the next read', order(b2).join(' > ') === 'E evening > C none > D late > A soon > B tomorrow', order(b2).join(' > '));

// Late checkout on C: requested 14:00, not paid yet.
const before = rowOf(b2, C);
check('C: standard checkout before any request', before?.previous?.checkOutTime === '11:00' && before?.previous?.lateCheckOut === false, JSON.stringify(before?.previous));
const req = await call('POST', `/api/reservations/${C.outId}/late-checkout`, { checkoutTime: '14:00', amount: 5000, remark: tag });
check('late checkout 14:00 requested', req.status === 201 || req.status === 200, `${req.status} ${req.text}`);
let b3 = await board();
let c3 = rowOf(b3, C);
check('C: "Checkout by 14:00" as soon as it is requested', c3?.previous?.checkOutTime === '14:00' && c3?.previous?.lateCheckOut === true && c3?.previous?.lateCheckOutUnpaid === true, JSON.stringify(c3?.previous));
const tone = (row, hm) => cleanRowTone({ day: row.day, status: row.status, guestOut: row.guestOut, checkOutTime: row.previous?.checkOutTime ?? null }, at(hm));
check('C: not red at 11:30 (the old checkout time)', tone(c3, '11:30') === null, tone(c3, '11:30'));
check('C: not red at 13:59', tone(c3, '13:59') === null, tone(c3, '13:59'));
check('C: red from 14:00', tone(c3, '14:00') === 'overdue', tone(c3, '14:00'));
check('C: not marked out by itself', c3?.guestOut === false && c3?.guestLeftAt === null, JSON.stringify({ out: c3?.guestOut, at: c3?.guestLeftAt }));
check('C: the order still treats it as "nobody arriving"', order(b3).indexOf('C none') === order(b2).indexOf('C none'));

// The cleaner's phone list says the same.
const assign = await call('POST', `/api/housekeeping/tasks/${c3.id}/assign`, { assigneeId: '11111111-1111-4111-8111-000000000005', force: true });
const assigned = assign.status === 200 || assign.status === 201;
check('C given to the housekeeper', assigned, `${assign.status} ${assign.text}`);
if (assigned) {
  const mine = (await call('GET', `/api/field/tasks?date=${today}`, undefined, 'housekeeper')).json?.rows ?? [];
  const f = mine.find(j => j.id === c3.id);
  check('phone list: checkout by 14:00 too', f?.previous?.checkOutTime === '14:00', JSON.stringify(f?.previous));
}

// Paid: the booking's own checkout time is now 14:00, and the board still says 14:00, no longer "not paid".
const paid = await call('POST', `/api/reservations/${C.outId}/late-checkout/paid`, { receivedOn: today, method: 'cash' });
check('late checkout paid', paid.status === 200, `${paid.status} ${paid.text}`);
const c4 = rowOf(await board(), C);
check('C after payment: 14:00, paid', c4?.previous?.checkOutTime === '14:00' && c4?.previous?.lateCheckOut === true && c4?.previous?.lateCheckOutUnpaid === false, JSON.stringify(c4?.previous));

// Staff tick the guest out: the card shows the real moment, not the checkout time, and it is not called automatic.
const left = await call('POST', '/api/housekeeping/guest-left', { taskId: c4.id });
check('Guest has left ticked on C', left.status === 200, left.text);
const c5 = rowOf(await board(), C);
check('C: out at the real moment of the tick', c5?.guestOut === true && !!c5.guestLeftAt && !c5.guestLeftAt.endsWith(':00+08:00') && c5.guestLeftAuto === false, JSON.stringify({ out: c5?.guestOut, at: c5?.guestLeftAt, auto: c5?.guestLeftAuto }));
check('C: once out, no longer red even past 14:00', tone(c5, '15:00') === 'out', tone(c5, '15:00'));

done();
