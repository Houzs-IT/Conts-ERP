// The cleaning order and late checkout (owner, 2 Nov 2026), end to end on the board and the cleaner's phone list:
// - the order (src/lib/cleanOrder.ts): soonest next check-in first, then units nobody is booked into, then very late
//   arrivals (after VERY_LATE_CHECK_IN, or on a later day); done jobs last. A changed check-in re-sorts on the next read.
// - a late checkout request moves the cleaning job's checkout time at once (paid or not): "Checkout by 14:00", and the
//   red "Checkout time passed" (src/lib/cleanRowTone.ts) only from 14:00.
// - inside a building, a guest still in goes below the units ready to clean, by checkout time; buildings A to Z.
// - "Guest has left" by itself at the checkout time (the cron job auto-guest-left, run here through
//   scripts/cron-dry-run.mjs --apply against the same local database: CRON_DB, default the dev-pglite address):
//   11:00 by default, 13:00 for a late checkout, once only, never on another day, never again after staff Undo.
// Needs a local server on demo data (node scripts/dev-pglite.mjs + wrangler pages dev; see harness.mjs).
//
// Run: API_BASE=http://localhost:8788 node scripts/api-checks/cleaning-sort-late-checkout.mjs
import { execFileSync } from 'node:child_process';
import { call, check, done } from './harness.mjs';

const { sortForCleaner, sortBuildings, VERY_LATE_CHECK_IN } = await import('../../src/lib/cleanOrder.ts');
const { cleanRowTone } = await import('../../src/lib/cleanRowTone.ts');

const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const today = day(0);
const at = (hm) => Date.parse(`${today}T${hm}:00+08:00`);
const tag = `S${Date.now().toString(36)}`;

// Its own building and eight units, so nothing else on the demo data is in the way.
const building = await call('POST', '/api/properties', { name: `Cleaning Order ${tag}`, state: 'Kuala Lumpur', city: 'Kuala Lumpur' });
check('a building for the check', building.status === 201 || building.status === 200, building.text);
const ownerId = (await call('GET', '/api/owners')).json?.data?.[0]?.id;
const units = [];
for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const r = await call('POST', '/api/units', { buildingId: building.json?.id, ownerId, unitCode: `CO${n}-${tag}`, unitNumber: `CO${n}-${tag}`, listingName: `Cleaning Order ${n} ${tag}` });
  if (r.status === 201 || r.status === 200) units.push({ id: r.json.id, unitNumber: `CO${n}-${tag}` });
  else check(`unit ${n} made`, false, r.text);
}
check('eight units made', units.length === 8, units.length);
const used = new Set();

/** A guest leaving `unit` today, and optionally one arriving on `nextDay` at `nextTime`. Returns ids, or null. */
async function scene(name, next, leaves = today) {
  for (const u of units) {
    if (used.has(u.id)) continue;
    const out = await call('POST', '/api/reservations', { unitId: u.id, channel: 'direct', guest: { fullName: `${tag} ${name} out` }, checkIn: day(-2), checkOut: leaves, guestsCount: 2, grossBookingValue: 30000 });
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
const key = (r) => ({ checkIn: r.next?.checkInTime ?? r.nextLater?.checkInTime ?? null, checkInDay: r.next ? r.day : r.nextLater?.day ?? null, day: r.day,
  guestIn: !!r.previous && !r.guestOut && r.status !== 'cleaning' && r.status !== 'done', checkOut: r.previous?.checkOutTime ?? null,
  done: r.status === 'done', building: '', unit: r.unitNumber });
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
check('C: its guest stays till 14:00, so it waits behind every guest due out at 11:00', order(b3).at(-1) === 'C none', order(b3).join(' > '));

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

// A guest who has left goes above every unit whose guest is still in, whatever the check-in times.
const tickE = await call('POST', '/api/housekeeping/guest-left', { taskId: rowOf(await board(), E).id });
check('E ticked out', tickE.status === 200, tickE.text);
const b6 = await board();
const o6 = order(b6);
check('units ready to clean come first (E, C out), then guests still in by checkout time', o6[0] === 'E evening' && o6[1] === 'C none' && o6.length === 5, o6.join(' > '));
const waitingTimes = sortForCleaner(scenes.map(s => rowOf(b6, s)), key).filter(r => key(r).guestIn).map(r => r.previous.checkOutTime);
check('guests still in are ordered by checkout time, earliest first', waitingTimes.every((t, i) => i === 0 || waitingTimes[i - 1] <= t), waitingTimes.join(', '));
const names = [...new Set(b6.rows.map(r => r.propertyName))];
const az = sortBuildings(names.map(n => ({ n })), x => x.n).map(x => x.n);
check('buildings A to Z, the same whatever is urgent', az.every((n, i) => i === 0 || az[i - 1].localeCompare(n, undefined, { sensitivity: 'base', numeric: true }) <= 0), az.join(' | '));

/* ---------- "Guest has left" by itself at the checkout time ---------- */
const CRON_DB = process.env.CRON_DB ?? 'postgres://pos_app:local@127.0.0.1:55441/postgres';
const cronAt = (hm) => execFileSync(process.execPath, ['scripts/cron-dry-run.mjs', '--apply', '--job=auto-guest-left', `--db=${CRON_DB}`, `--at=${new Date(at(hm)).toISOString()}`], { encoding: 'utf8' });
const F = await scene('F standard', { day: today, time: '16:00' });
const G = await scene('G late 13', { day: today, time: '17:00' });
const H = await scene('H leaves tomorrow', null, day(1));
check('three more units for the automatic mark', !!F && !!G && !!H);
const lateG = await call('POST', `/api/reservations/${G.outId}/late-checkout`, { checkoutTime: '13:00', amount: 3000 });
check('G: late checkout 13:00 requested', lateG.status === 201 || lateG.status === 200, lateG.text);
await board();
await call('GET', `/api/housekeeping/board?date=${day(1)}`);

let run = cronAt('10:59');
let bA = await board();
check('10:59: nobody marked yet', !rowOf(bA, F).guestOut && !rowOf(bA, G).guestOut, run.split('\n').find(l => l.startsWith('[auto')));
run = cronAt('11:01');
bA = await board();
const f1 = rowOf(bA, F), g1 = rowOf(bA, G);
check('11:01: F is out by itself, at 11:00, called automatic', f1.guestOut && f1.guestLeftAt === `${today}T11:00:00+08:00` && f1.guestLeftAuto === true && f1.status === 'ready', JSON.stringify({ out: f1.guestOut, at: f1.guestLeftAt, auto: f1.guestLeftAuto, status: f1.status }));
check('11:01: G (late checkout 13:00) is not, and still says Checkout by 13:00', !g1.guestOut && g1.previous.checkOutTime === '13:00', JSON.stringify({ out: g1.guestOut, by: g1.previous.checkOutTime }));
const hRow = (await call('GET', `/api/housekeeping/board?date=${day(1)}`)).json?.rows?.find(r => r.unitId === H.unitId);
check('11:01: H checks out tomorrow and is left alone', !!hRow && hRow.guestOut === false, JSON.stringify({ out: hRow?.guestOut }));
const hist = async (taskId) => (await call('GET', `/api/audit?entityTable=tasks&entityId=${taskId}`)).json?.data ?? [];
const fMarks = (await hist(f1.id)).filter(h => h.action === 'task.guest_left');
check('F: the same audit row as a tap, by System, source system, marked auto', fMarks.length === 1 && fMarks[0].actorLabel === 'System' && fMarks[0].after?.auto === true, JSON.stringify(fMarks.map(h => ({ by: h.actorLabel, src: h.source, after: h.after }))));
run = cronAt('11:06');
check('a second run marks nobody new', /Marked 0 guests/.test(run), run.split('\n').find(l => l.startsWith('[auto')));
check('F: still one mark after the repeat run', (await hist(f1.id)).filter(h => h.action === 'task.guest_left').length === 1);

run = cronAt('13:01');
const g2 = rowOf(await board(), G);
check('13:01: G is out by itself at 13:00 (its late checkout)', g2.guestOut && g2.guestLeftAt === `${today}T13:00:00+08:00` && g2.guestLeftAuto === true && g2.previous.lateCheckOut === true, JSON.stringify({ out: g2.guestOut, at: g2.guestLeftAt }));

// Staff Undo wins: the next run does not mark F again.
const undo = await call('POST', '/api/housekeeping/guest-left', { taskId: f1.id, undo: true });
check('staff undo the automatic mark on F', undo.status === 200, undo.text);
run = cronAt('13:06');
const f3 = rowOf(await board(), F);
check('after Undo the cron leaves F alone', f3.guestOut === false && f3.guestLeftAt === null, JSON.stringify({ out: f3.guestOut, at: f3.guestLeftAt }));
const tap = await call('POST', '/api/housekeeping/guest-left', { taskId: f1.id });
check('staff can still tick F out by hand afterwards', tap.status === 200 && rowOf(await board(), F).guestLeftAuto === false, tap.text);

done();
