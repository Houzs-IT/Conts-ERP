// Calendar and Rate update, against a local server and its database:
//   - a unit's weekend rate prices Friday and Saturday nights (no 22% multiplier), on the board and in its uplifts
//   - POST /rates/bulk writes only the booking sites each unit is connected to, keeps each site's own uplift,
//     honours the day-of-week filter and the +/- percentage, and says which sites it left alone
//   - PUT /rates on one night saves and reports the Channex queue result
//   - blocks carry a reason (maintenance / owner stay / other), an owner stay is held as one
//   - the board says who may change prices (canSetRates), matching what the server allows
// It sets up its own fixtures (a Channex connection row, a test user) straight in the database, and removes
// everything it made at the end.
//
// Run, with the local server up (see scripts/api-checks/hostplatform-import.mjs --serve for real-sized data):
//   API_BASE=http://127.0.0.1:8822 SESSION_SECRET=<the server's> DB_URL=postgres://postgres:local@127.0.0.1:55492/postgres \
//     node scripts/api-checks/calendar-rates.mjs
import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { check, done } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const SECRET = process.env.SESSION_SECRET ?? 'smoke-test-secret-not-real-0123456789';
const DB_URL = process.env.DB_URL;
if (!DB_URL) { console.error('Set DB_URL to the database the server uses.'); process.exit(2); }
const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// One short connection at a time: PGlite serves a single wire connection.
async function db(fn) {
  const sql = postgres(DB_URL, { max: 1, idle_timeout: 1, onnotice: () => {} });
  try { return await fn(sql); } finally { await sql.end({ timeout: 2 }); }
}

const ADMIN = await db(sql => sql`select id, email, full_name, role from pos.users where role = 'management' and coalesce(is_active, 1) = 1 order by (id = 'dev-admin') desc limit 1`.catch(() => sql`select id, email, full_name, role from pos.users where role = 'management' limit 1`));
const tag = Date.now().toString().slice(-6);
const STAFF = { id: `check-staff-${tag}`, email: `staff-${tag}@check.test`, full_name: 'Check staff', role: 'operations_staff' };
const cookieFor = (u) => {
  const body = Buffer.from(JSON.stringify({ userId: u.id, email: u.email, role: u.role, fullName: u.full_name, exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, '');
  return `tc_session=${body}.${b64(createHmac('sha256', SECRET).update(body).digest())}`;
};
async function call(method, path, body, user = ADMIN[0]) {
  const r = await fetch(BASE + path, { method, headers: { cookie: cookieFor(user), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}
check('a management user to act as', ADMIN.length === 1, 'no management user in the database');

// Two priced units, nights a few weeks out.
const units = await db(sql => sql`select id, unit_number, base_rate, weekend_rate from pos.units where base_rate > 0 order by unit_number limit 2`);
check('two priced units', units.length === 2);
const [A, B] = units;
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const wd = d => new Date(`${d}T00:00:00Z`).getUTCDay();
let MON = null; for (let n = 40; !MON; n++) if (wd(day(n)) === 1) MON = day(n);
const add = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const LAST = add(MON, 13);                       // two whole weeks, Monday to Sunday
const FRI = add(MON, 4), SAT = add(MON, 5), TUE = add(MON, 1);

const before = await db(async sql => ({
  rates: await sql`select unit_id, channel, rate_date, rate from pos.channel_rates where unit_id in (${A.id}, ${B.id}) and rate_date between ${MON} and ${LAST}`,
  uplifts: await sql`select unit_id, channel, uplift from pos.channel_uplifts where unit_id in (${A.id}, ${B.id})`,
  restr: await sql`select unit_id, rate_date, min_stay, stop_sell from pos.unit_restrictions where unit_id in (${A.id}, ${B.id}) and rate_date between ${MON} and ${LAST}`,
}));
await db(async sql => {
  await sql`delete from pos.channel_rates where unit_id in (${A.id}, ${B.id}) and rate_date between ${MON} and ${LAST}`;
  await sql`delete from pos.unit_restrictions where unit_id in (${A.id}, ${B.id}) and rate_date between ${MON} and ${LAST}`;
  // Unit A is on Airbnb (only); unit B on no booking site.
  await sql`delete from pos.channex_channels where unit_id in (${A.id}, ${B.id})`;
  await sql`insert into pos.channex_channels (id, unit_id, ota, channex_channel_id, external_id, created_at) values (${`check-${tag}`}, ${A.id}, 'airbnb', 'check', 'check', now()::text)`;
  await sql`insert into pos.users (id, email, full_name, password_hash, role, must_change_password, created_at, updated_at) values (${STAFF.id}, ${STAFF.email}, ${STAFF.full_name}, 'x', 'operations_staff', 0, now()::text, now()::text)`;
});

try {
  /* ---------- weekend rate ---------- */
  let r = await call('PUT', '/api/rates', { unitId: A.id, baseRate: 20000 });
  check('base rate set', r.status === 200, r.text);
  r = await call('PUT', '/api/rates', { unitId: A.id, weekendRate: 26000 });
  check('weekend rate set', r.status === 200, r.text);
  r = await call('PUT', '/api/rates', { unitId: A.id, weekendRate: -5 });
  check('a negative weekend rate is refused (422)', r.status === 422, r.text);
  r = await call('PUT', '/api/rates', { unitId: A.id, channel: 'airbnb', uplift: 3000 });
  check('Airbnb uplift set by hand', r.status === 200, r.text);
  r = await call('GET', `/api/reservations/calendar?from=${MON}&to=${LAST}`);
  const cal = r.json;
  check('calendar loads', r.status === 200, r.text.slice(0, 200));
  check('calendar carries the weekend rate, no multiplier', cal.weekendRate?.[A.id] === 26000 && cal.weekendMultiplier === undefined, JSON.stringify({ w: cal.weekendRate?.[A.id], m: cal.weekendMultiplier }));
  check('weekday uplifts: Airbnb as set, Booking.com 18% of the base', cal.uplifts[`${A.id}:airbnb`] === 3000 && cal.uplifts[`${A.id}:booking_com`] === 3600, JSON.stringify([cal.uplifts[`${A.id}:airbnb`], cal.uplifts[`${A.id}:booking_com`]]));
  check('weekend uplifts follow the weekend rate (Booking.com 18% of 260 = 46.80)', cal.weekendUplifts[`${A.id}:booking_com`] === 4680 && cal.weekendUplifts[`${A.id}:airbnb`] === 3000, JSON.stringify([cal.weekendUplifts[`${A.id}:booking_com`], cal.weekendUplifts[`${A.id}:airbnb`]]));
  check('connected sites listed: A on Airbnb, B on none', JSON.stringify(cal.units.find(u => u.id === A.id)?.linked) === '["airbnb"]' && cal.units.find(u => u.id === B.id)?.linked?.length === 0);
  check('management may change prices', cal.canSetRates === true);
  const pr = await call('GET', '/api/pricing/rules');
  check('Pricing reports the weekend rate', pr.json?.units?.find(u => u.unitId === A.id)?.weekendRate === 26000, pr.text.slice(0, 200));

  /* ---------- bulk: connected channels, uplifts kept, weekday filter ---------- */
  r = await call('POST', '/api/rates/bulk', { unitIds: [A.id, B.id], channels: ['web', 'airbnb', 'booking_com', 'agoda'], weekdays: [5, 6], lines: [{ from: MON, to: LAST, baseRate: 50000 }] });
  check('bulk saved', r.status === 200, r.text);
  check('4 nights (two Fri, two Sat); A web+Airbnb, B web only = 12 rows', r.json?.nights === 4 && r.json?.written === 12, r.text);
  check('reports the sites it left alone', r.json?.skipped?.airbnb === 1 && r.json?.skipped?.booking_com === 2 && r.json?.skipped?.agoda === 2, JSON.stringify(r.json?.skipped));
  let rows = await db(sql => sql`select unit_id, channel, rate_date, rate from pos.channel_rates where unit_id in (${A.id}, ${B.id}) and rate_date between ${MON} and ${LAST} order by unit_id, channel, rate_date`);
  const at = (u, c, d) => rows.find(x => x.unit_id === u && x.channel === c && x.rate_date === d)?.rate;
  check('only Fridays and Saturdays were written', rows.every(x => [5, 6].includes(wd(x.rate_date))), rows.map(x => x.rate_date).join(','));
  check('no price on a site a unit is not connected to', !rows.some(x => x.channel === 'booking_com' || x.channel === 'agoda' || (x.unit_id === B.id && x.channel !== 'web')), JSON.stringify(rows.filter(x => x.channel !== 'web')));
  check('web gets the price as set (500)', at(A.id, 'web', FRI) === 50000 && at(B.id, 'web', SAT) === 50000, `${at(A.id, 'web', FRI)} ${at(B.id, 'web', SAT)}`);
  check('Airbnb keeps its own uplift (500 + 30 = 530), not one flat price', at(A.id, 'airbnb', SAT) === 53000, String(at(A.id, 'airbnb', SAT)));

  /* ---------- bulk: a percentage on the current price ---------- */
  r = await call('POST', '/api/rates/bulk', { unitIds: [A.id], channels: ['web', 'airbnb'], lines: [{ from: TUE, to: TUE, adjustPct: 10 }] });
  check('raise by 10% saved', r.status === 200, r.text);
  rows = await db(sql => sql`select channel, rate from pos.channel_rates where unit_id = ${A.id} and rate_date = ${TUE}`);
  const web = rows.find(x => x.channel === 'web')?.rate, air = rows.find(x => x.channel === 'airbnb')?.rate;
  check('Tuesday web 200 + 10% = 220, Airbnb 220 + 30 = 250', web === 22000 && air === 25000, `${web} ${air}`);
  r = await call('POST', '/api/rates/bulk', { unitIds: [A.id], channels: ['web', 'airbnb'], lines: [{ from: FRI, to: FRI, adjustPct: -10 }] });
  rows = await db(sql => sql`select channel, rate from pos.channel_rates where unit_id = ${A.id} and rate_date = ${FRI}`);
  check('a percentage moves the night\'s own price: Friday 500 - 10% = 450', rows.find(x => x.channel === 'web')?.rate === 45000, JSON.stringify(rows));

  /* ---------- bulk: refusals and restrictions ---------- */
  r = await call('POST', '/api/rates/bulk', { unitIds: [A.id], weekdays: [0], lines: [{ from: TUE, to: TUE, baseRate: 30000 }] });
  check('no night on the chosen days is refused (422)', r.status === 422, r.text);
  r = await call('POST', '/api/rates/bulk', { unitIds: [A.id], lines: [{ from: TUE, to: TUE, baseRate: 30000, adjustPct: 5 }] });
  check('a price and a percentage together are refused (422)', r.status === 422, r.text);
  r = await call('POST', '/api/rates/bulk', { unitIds: [A.id], weekdays: [5, 6], lines: [{ from: MON, to: LAST, minStay: 2 }] });
  check('minimum stay on Fri/Sat saved', r.status === 200, r.text);
  rows = await db(sql => sql`select rate_date, min_stay from pos.unit_restrictions where unit_id = ${A.id} and rate_date between ${MON} and ${LAST}`);
  check('minimum stay only on the 4 Fri/Sat nights', rows.length === 4 && rows.every(x => x.min_stay === 2 && [5, 6].includes(wd(x.rate_date))), JSON.stringify(rows));

  /* ---------- one night ---------- */
  r = await call('PUT', '/api/rates', { unitId: A.id, channel: 'web', date: TUE, rate: 23300 });
  check('one night saved, queue result reported', r.status === 200 && ['queued', 'failed'].includes(r.json?.sync), r.text);

  /* ---------- permissions ---------- */
  r = await call('GET', `/api/reservations/calendar?from=${MON}&to=${MON}`, undefined, STAFF);
  check('operations staff see the board without price rights', r.status === 200 && r.json?.canSetRates === false, r.text.slice(0, 200));
  r = await call('POST', '/api/rates/bulk', { unitIds: [A.id], lines: [{ from: TUE, to: TUE, baseRate: 30000 }] }, STAFF);
  check('and the server refuses them the same (403)', r.status === 403, r.text);

  /* ---------- blocks with a reason ---------- */
  const free = add(MON, 60);
  r = await call('POST', '/api/blocks', { unitId: B.id, from: free, to: add(free, 2), kind: 'other' });
  check('"other" without a note is refused (422)', r.status === 422, r.text);
  r = await call('POST', '/api/blocks', { unitId: B.id, from: free, to: add(free, 2), kind: 'owner_stay', reason: 'Owner and family' });
  check('owner stay held', r.status === 201 && r.json?.kind === 'owner_stay', r.text);
  const ownerId = r.json?.id;
  r = await call('POST', '/api/blocks', { unitId: B.id, from: add(free, 2), to: add(free, 3), kind: 'maintenance', reason: 'Aircon service' });
  check('maintenance block held next to it', r.status === 201, r.text);
  const mntId = r.json?.id;
  r = await call('POST', '/api/blocks', { unitId: B.id, from: add(free, 1), to: add(free, 2), kind: 'maintenance' });
  check('a block over the owner stay clashes (409)', r.status === 409, r.text);
  r = await call('GET', `/api/reservations/calendar?from=${free}&to=${add(free, 4)}`);
  const own = r.json?.blocks?.find(b => b.id === ownerId), mnt = r.json?.blocks?.find(b => b.id === mntId);
  check('the board shows an owner stay and a maintenance block, with their reasons', own?.channel === 'owner_stay' && own?.blockReason === 'owner_stay' && mnt?.channel === 'maintenance_block' && mnt?.blockReason === 'maintenance', JSON.stringify([own, mnt]));
  await db(sql => sql`delete from pos.reservations where id in (${ownerId ?? ''}, ${mntId ?? ''})`);
} finally {
  // Put back what was there.
  await db(async sql => {
    await sql`delete from pos.channel_rates where unit_id in (${A.id}, ${B.id}) and rate_date between ${MON} and ${LAST}`;
    for (const x of before.rates) await sql`insert into pos.channel_rates (unit_id, channel, rate_date, rate, updated_at) values (${x.unit_id}, ${x.channel}, ${x.rate_date}, ${x.rate}, now()::text)`;
    await sql`delete from pos.unit_restrictions where unit_id in (${A.id}, ${B.id}) and rate_date between ${MON} and ${LAST}`;
    for (const x of before.restr) await sql`insert into pos.unit_restrictions (unit_id, rate_date, min_stay, stop_sell, updated_at) values (${x.unit_id}, ${x.rate_date}, ${x.min_stay}, ${x.stop_sell}, now()::text)`;
    await sql`delete from pos.channel_uplifts where unit_id in (${A.id}, ${B.id})`;
    for (const x of before.uplifts) await sql`insert into pos.channel_uplifts (unit_id, channel, uplift, updated_at) values (${x.unit_id}, ${x.channel}, ${x.uplift}, now()::text)`;
    await sql`update pos.units set base_rate = ${A.base_rate}, weekend_rate = ${A.weekend_rate} where id = ${A.id}`;
    await sql`delete from pos.channex_channels where id = ${`check-${tag}`}`;
    await sql`delete from pos.channex_outbox where unit_id in (${A.id}, ${B.id}) and status = 'queued'`.catch(() => {});
    await sql`delete from pos.users where id = ${STAFF.id}`;
  });
}
done();
