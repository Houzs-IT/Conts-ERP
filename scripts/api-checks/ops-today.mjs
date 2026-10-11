// Operations > Today (GET /api/operations/day): check-ins and checkouts with the times guests were recorded in and out,
// the maintenance to watch that day, and the units with nobody staying that night, for today and tomorrow; and who may
// see it. Runs against a LOCAL app and its LOCAL database only, because it adds test stays, jobs and accounts:
//
//   BASE=http://127.0.0.1:8799 DB=postgres://pos_app:local@127.0.0.1:55449/postgres node scripts/api-checks/ops-today.mjs
//
// The app must run with the SESSION_SECRET in this folder's .dev.vars. PGlite serves one connection: run nothing else at once.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.BASE ?? 'http://127.0.0.1:8799';
const DB = process.env.DB ?? 'postgres://pos_app:local@127.0.0.1:55449/postgres';
if (!['127.0.0.1', 'localhost'].includes(new URL(DB).hostname) || !['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname)) {
  console.error('Refused: this check writes test data and only runs against a local app and database.'); process.exit(2);
}
const SECRET = readFileSync(join(root, '.dev.vars'), 'utf8').match(/^SESSION_SECRET="?([^"\r\n]+)"?/m)?.[1];
if (!SECRET) { console.error('SESSION_SECRET is not in .dev.vars'); process.exit(2); }

async function sql(text, ...args) {
  const db = postgres(DB, { max: 1, prepare: false, fetch_types: false, connection: { search_path: 'pos' } });
  try { return await db.unsafe(text, args); } finally { await db.end({ timeout: 0 }); }
}
const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const U = {
  mgmt: ['ot-mgmt', 'ot-mgmt@local.test', 'OT Management', 'management'],
  ops: ['ot-ops', 'ot-ops@local.test', 'OT Ops Staff', 'operations_staff'],
  hk: ['ot-hk', 'ot-hk@local.test', 'OT Housekeeper', 'housekeeper'],
  tech: ['ot-tech', 'ot-tech@local.test', 'OT Technician', 'technician'],
};
const cookie = ([userId, email, fullName, role]) => {
  const body = Buffer.from(JSON.stringify({ userId, email, role, fullName, iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, '');
  return `tc_session=${body}.${b64(createHmac('sha256', SECRET).update(body).digest())}`;
};
async function call(who, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { cookie: cookie(U[who]), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not JSON */ }
  return { status: r.status, json: j, text: t };
}
let fails = 0;
const check = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' :: ' + String(extra).slice(0, 400)}`); };
const day = (d = 0) => new Date(Date.now() + 8 * 3600e3 + d * 864e5).toISOString().slice(0, 10);
const T0 = day(0), T1 = day(1);
const getDay = async (d, who = 'mgmt') => call(who, 'GET', `/api/operations/day?date=${d}`);

/* ---------- setup ---------- */
const now = new Date().toISOString();
for (const [id, email, name, role] of Object.values(U)) {
  await sql(`insert into users (id, email, full_name, password_hash, role, must_change_password, created_at, updated_at) values ($1, $2, $3, 'x', $4, 0, $5, $5)
             on conflict (id) do update set is_active = 1, role = excluded.role`, id, email, name, role, now);
}
// Six new units of their own (the demo data has three, already booked), across two buildings.
const homes = await sql(`select p.id as property_id, (select u.owner_id from units u limit 1) as owner_id from properties p order by p.name limit 2`);
const stamp = Date.now().toString(36).toUpperCase();
const free = [];
for (let i = 0; i < 6; i++) {
  const h = homes[i % homes.length], id = `ot-unit-${stamp}-${i}`;
  await sql(`insert into units (id, property_id, owner_id, unit_number, bedrooms, max_guests, readiness, base_rate, created_at, updated_at)
             values ($1, $2, $3, $4, 1, 2, 'ready', 20000, $5, $5)`, id, h.property_id, h.owner_id, `OT${stamp}-${i}`, now);
  free.push({ id });
}
const [uA, uB, uC, uD, uE, uF] = free;

// A: checks in today for two nights. B: checks in tomorrow. C: checked in yesterday, leaves today (written directly:
// the booking form does not take a stay that started yesterday).
let r = await call('mgmt', 'POST', '/api/reservations', { unitId: uA.id, channel: 'direct', guest: { fullName: 'OT Arrives Today' }, checkIn: T0, checkOut: day(2), guestsCount: 2, grossBookingValue: 40000 });
check('stay A (in today) made', r.status === 201, r.text); const resA = r.json?.id;
r = await call('mgmt', 'POST', '/api/reservations', { unitId: uB.id, channel: 'direct', guest: { fullName: 'OT Arrives Tomorrow' }, checkIn: T1, checkOut: day(3), guestsCount: 1, grossBookingValue: 30000 });
check('stay B (in tomorrow) made', r.status === 201, r.text); const resB = r.json?.id;
const resC = `ot-res-c-${Date.now()}`;
await sql(`insert into reservations (id, unit_id, channel, state, check_in, check_out, check_in_time, check_out_time, guests_count, gross_booking_value, created_at, updated_at)
           values ($1, $2, 'direct', 'checked_in', $3, $4, '15:00', '11:00', 1, 20000, $5, $5)`, resC, uC.id, day(-1), T0, now);
await sql(`update units set readiness = 'occupied' where id = $1`, uC.id);

// Maintenance: D urgent, E a visit today, F a visit yesterday that nobody finished (overdue).
r = await call('mgmt', 'POST', '/api/maintenance/issues', { unitId: uD.id, title: 'OT urgent leak', category: 'plumbing', urgency: 'urgent', chargeTo: 'the_conts' });
check('urgent job made', r.status === 201, r.text); const jobD = r.json?.id;
r = await call('mgmt', 'POST', '/api/maintenance/issues', { unitId: uE.id, title: 'OT aircon service', category: 'aircon', chargeTo: 'the_conts', assigneeName: 'OT Contractor' });
check('visit job made', r.status === 201, r.text); const jobE = r.json?.id;
r = await call('mgmt', 'POST', `/api/maintenance/issues/${jobE}/windows`, { startsAt: `${T0}T23:00`, endsAt: `${T0}T23:30` });
check('visit today booked', r.status === 201 || r.status === 200, r.text);
r = await call('mgmt', 'POST', '/api/maintenance/issues', { unitId: uF.id, title: 'OT missed visit', category: 'electrical', chargeTo: 'the_conts' });
check('missed-visit job made', r.status === 201, r.text); const jobF = r.json?.id;
await sql(`insert into maintenance_windows (id, issue_id, starts_at, ends_at, created_at) values ($1, $2, $3, $4, $5)`,
  `ot-w-${Date.now()}`, jobF, `${day(-1)}T10:00:00+08:00`, `${day(-1)}T12:00:00+08:00`, now);

/* ---------- today ---------- */
r = await getDay(T0);
check('today loads (management)', r.status === 200, r.text);
let d = r.json;
const arrA = d.arrivals.find(a => a.reservationId === resA);
check('A is a check-in today, not yet arrived', arrA && arrA.state === 'confirmed' && arrA.arrivedAt === null, JSON.stringify(arrA));
check('B is not a check-in today', !d.arrivals.some(a => a.reservationId === resB));
const depC = d.departures.find(x => x.reservationId === resC);
check('C is a checkout today, not yet out', depC && !depC.guestOut && depC.leftAt === null && depC.checkOutTime === '11:00', JSON.stringify(depC));
const freeIds = new Set(d.available.map(u => u.unitId));
check('A (guest tonight) is not available tonight', !freeIds.has(uA.id));
check('B (guest only from tomorrow) is available tonight', freeIds.has(uB.id));
const fc = d.available.find(u => u.unitId === uC.id);
check('C (guest leaving today) is available tonight but needs cleaning', fc?.status === 'needs_cleaning' && /Guest leaves 11:00/.test(fc.note ?? ''), JSON.stringify(fc));
check('a free unit carries its building', d.available.every(u => u.buildingId && u.propertyName));
const mD = d.maintenance.find(m => m.id === jobD), mE = d.maintenance.find(m => m.id === jobE), mF = d.maintenance.find(m => m.id === jobF);
check('urgent job listed as urgent, reported', mD?.why === 'urgent' && mD.progress === 'reported' && mD.urgent, JSON.stringify(mD));
check('visit today listed with its times and assignee', mE?.why === 'visit' && !!mE.visit && mE.progress === 'assigned' && mE.assigneeName === 'OT Contractor', JSON.stringify(mE));
check('job whose visit passed unfinished is overdue', mF?.why === 'overdue', JSON.stringify(mF));
check('overdue jobs come first', d.maintenance.findIndex(m => m.id === jobF) < d.maintenance.findIndex(m => m.id === jobD));

/* ---------- recording ---------- */
r = await call('mgmt', 'PATCH', `/api/reservations/${resA}/details`, { checkInTime: '13:30' });
check('check-in time changed through the reservation', r.status === 200 && r.json?.changed, r.text);
r = await call('ops', 'PATCH', `/api/reservations/${resA}`, { state: 'checked_in' });
check('guest arrived (operations staff) uses the Check in move', r.status === 200, r.text);
r = await call('mgmt', 'POST', '/api/housekeeping/guest-left', { reservationId: resC });
check('guest left recorded', r.status === 200, r.text);
d = (await getDay(T0)).json;
const arrA2 = d.arrivals.find(a => a.reservationId === resA);
check('A shows arrived, with the time, and the new expected time', arrA2?.state === 'checked_in' && !!arrA2.arrivedAt && arrA2.checkInTime === '13:30', JSON.stringify(arrA2));
const depC2 = d.departures.find(x => x.reservationId === resC);
check('C shows out, with the time', depC2?.guestOut && !!depC2.leftAt, JSON.stringify(depC2));
check('C (guest out) still needs cleaning tonight', d.available.find(u => u.unitId === uC.id)?.status === 'needs_cleaning');

r = await call('mgmt', 'POST', `/api/maintenance/issues/${jobD}/complete`, { finalAmount: 0, chargeTo: 'the_conts' });
check('urgent job closed', r.status === 200, r.text);
d = (await getDay(T0)).json;
const mD2 = d.maintenance.find(m => m.id === jobD);
check('urgent job closed today shows as done, after the open ones', mD2?.progress === 'done' && d.maintenance.at(-1)?.progress === 'done', JSON.stringify(mD2));

/* ---------- tomorrow ---------- */
r = await getDay(T1);
check('tomorrow loads', r.status === 200, r.text);
d = r.json;
check('B is a check-in tomorrow', d.arrivals.some(a => a.reservationId === resB));
check('A is not a check-in or checkout tomorrow', !d.arrivals.some(a => a.reservationId === resA) && !d.departures.some(x => x.reservationId === resA));
const free1 = new Set(d.available.map(u => u.unitId));
check('A (still staying) is not available tomorrow night', !free1.has(uA.id));
check('B (guest from tomorrow) is not available tomorrow night', !free1.has(uB.id));
check('C is available tomorrow night', free1.has(uC.id));
check("today's visit is not on tomorrow's list", !d.maintenance.some(m => m.id === jobE));
check("tomorrow's view does not call the job done today a job to watch", !d.maintenance.some(m => m.id === jobD));

/* ---------- who may see it ---------- */
for (const who of ['hk', 'tech']) {
  r = await getDay(T0, who);
  check(`${U[who][3]} cannot open Today (403)`, r.status === 403, r.text);
  r = await call(who, 'PATCH', `/api/reservations/${resB}`, { state: 'checked_in' });
  check(`${U[who][3]} cannot record a guest arrived (403)`, r.status === 403, r.text);
  r = await call(who, 'PATCH', `/api/reservations/${resB}/details`, { checkInTime: '12:00' });
  check(`${U[who][3]} cannot change a time (403)`, r.status === 403, r.text);
}
r = await getDay(T0, 'ops');
check('operations staff can open Today', r.status === 200, r.text);

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
