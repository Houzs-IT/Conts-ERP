// Cleaning and Maintenance APIs, end to end, against a local server on real-sized data.
//
//   BIGDATA_PORT=55490 node scripts/api-checks/hostplatform-import.mjs <data folder> --serve      (one terminal)
//   npx vite build && WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://postgres:local@127.0.0.1:55490/postgres \
//     npx wrangler pages dev --port 8820                                                              (another)
//   OPS_BASE=http://localhost:8820 OPS_DB=postgres://postgres:local@127.0.0.1:55490/postgres node scripts/api-checks/ops.mjs
//
// Local only: it signs its own sessions with SESSION_SECRET from .dev.vars, adds a test housekeeper (no password)
// and a test cleaner (switched off again at the end), and puts back what it changed (bookings, settings, its own rows).
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import postgres from 'postgres';

const BASE = process.env.OPS_BASE ?? 'http://127.0.0.1:8820';
const DB = process.env.OPS_DB ?? 'postgres://postgres:local@127.0.0.1:55490/postgres';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB) || !/localhost|127\.0\.0\.1/.test(BASE)) { console.error('Local databases and servers only.'); process.exit(1); }
const SECRET = process.env.SESSION_SECRET ?? readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8').match(/^SESSION_SECRET=(.+)$/m)?.[1]?.trim();
if (!SECRET) { console.error('No SESSION_SECRET (env or .dev.vars).'); process.exit(1); }
// The local PGlite server takes one connection at a time and the app needs it for every request: each query here
// opens its own connection and closes it straight after, so the server is never left waiting.
async function sql(strings, ...values) {
  const db = postgres(DB, { max: 1, onnotice: () => {} });
  try { return await db(strings, ...values); } finally { await db.end({ timeout: 1 }); }
}

const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cookieFor = (u) => {
  const body = Buffer.from(JSON.stringify({ ...u, iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, '');
  return `tc_session=${body}.${b64(createHmac('sha256', SECRET).update(body).digest())}`;
};
const ADMIN = { userId: 'dev-admin', email: 'dev@local.test', role: 'management', fullName: 'Dev Admin' };
const HK = { userId: 'ops-check-hk', email: 'ops-check-hk@local.test', role: 'housekeeper', fullName: 'Ops Check Cleaner' };
async function call(method, path, body, who = ADMIN) {
  const form = body instanceof FormData;
  const r = await fetch(BASE + path, { method, headers: { cookie: cookieFor(who), ...(form ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + String(extra).slice(0, 400)}`); };
const file = (name, type, bytes = 64) => { const fd = new FormData(); fd.append('file', new File([new Uint8Array(bytes).fill(7)], name, { type })); return fd; };
const myt = (o = 0) => new Date(Date.now() + 8 * 3600e3 + o * 864e5).toISOString().slice(0, 10);
const today = myt(0);

// ---- setup: a housekeeper login linked to a roster cleaner (local test rows) ----
const now = new Date().toISOString();
await sql`insert into users (id, email, full_name, password_hash, role, must_change_password, failed_attempts, locale, is_active, created_at, updated_at)
          values (${HK.userId}, ${HK.email}, ${HK.fullName}, 'no-password', 'housekeeper', 0, 0, 'en-MY', 1, ${now}, ${now}) on conflict (id) do update set is_active = 1`;
await sql`insert into cleaners (id, full_name, employment_type, user_id, is_active, created_at, updated_at)
          values ('ops-check-cleaner', 'Ops Check Cleaner', 'internal', ${HK.userId}, 1, ${now}, ${now}) on conflict (id) do update set is_active = 1`;
const made = { tasks: [], issues: [] };
const restore = [];

try {
  // ---- board ----
  let r = await call('GET', `/api/housekeeping/board?date=${today}`);
  check('board answers rows, departures, repairs', r.status === 200 && Array.isArray(r.json.rows) && Array.isArray(r.json.departures) && Array.isArray(r.json.repairs), r.text.slice(0, 300));
  check('board rows carry status, previous, next, checklist', r.json.rows.every(x => x.status && 'previous' in x && 'next' in x && x.checklist), '');
  console.log(`   board ${today}: ${r.json.rows.length} cleans, ${r.json.departures.length} departures with no clean, ${r.json.repairs.length} repair windows`);
  r = await call('GET', `/api/housekeeping/board?date=${today}`, undefined, HK); check('field role cannot open the board (403)', r.status === 403, r.text);

  const dep = (await call('GET', `/api/housekeeping/board?date=${today}`)).json.departures.find(d => d.next) ?? (await call('GET', `/api/housekeeping/board?date=${today}`)).json.departures[0];
  check('a guest leaves today with no clean (real data)', !!dep, 'no departure to test with');
  if (!dep) throw new Error('nothing to test with');
  const before = (await sql`select state from reservations where id = ${dep.reservationId}`)[0].state;
  restore.push(() => sql`update reservations set state = ${before} where id = ${dep.reservationId}`);

  // ---- late check-out / early check-in come from the booking ----
  const nextRes = (await sql`select id, check_in_time from reservations where unit_id = ${dep.unitId} and check_in = ${today} and id <> ${dep.reservationId} and state not in ('cancelled','no_show','inquiry') and channel <> 'maintenance_block' limit 1`)[0];
  const outBefore = (await sql`select check_out_time from reservations where id = ${dep.reservationId}`)[0].check_out_time;
  await sql`update reservations set check_out_time = '13:00' where id = ${dep.reservationId}`;
  restore.push(() => sql`update reservations set check_out_time = ${outBefore} where id = ${dep.reservationId}`);
  if (nextRes) {
    await sql`update reservations set check_in_time = '13:30' where id = ${nextRes.id}`;
    restore.push(() => sql`update reservations set check_in_time = ${nextRes.check_in_time} where id = ${nextRes.id}`);
  }

  // ---- guest left on a departure with no clean: creates the clean, shows it ready ----
  r = await call('POST', '/api/housekeeping/guest-left', { reservationId: dep.reservationId });
  check('guest left creates the clean', r.status === 200 && r.json.cleanCreated === true && !!r.json.taskId, r.text);
  const taskId = r.json.taskId; made.tasks.push(taskId);
  check('a checked-in booking moves to checked out', before === 'checked_in' ? r.json.bookingCheckedOut === true : r.json.bookingCheckedOut === false, `${before} ${r.text}`);
  r = await call('GET', `/api/housekeeping/board?date=${today}`);
  let row = r.json.rows.find(x => x.id === taskId);
  check('board shows "guest out, ready to clean" at once', row?.status === 'ready' && row.guestOut === true && !!row.guestLeftAt, JSON.stringify(row));
  check('late check-out on the booking shows (13:00)', row?.previous?.checkOutTime === '13:00' && row.previous.lateCheckOut === true, JSON.stringify(row?.previous));
  if (nextRes) check('early check-in on the booking shows (13:30)', row?.next?.checkInTime === '13:30' && row.next.earlyCheckIn === true && row.next.checkInAt.endsWith('T13:30:00+08:00'), JSON.stringify(row?.next));
  check('the departure left the "no clean" list', !r.json.departures.some(d => d.reservationId === dep.reservationId), '');
  r = await call('POST', '/api/housekeeping/guest-left', { taskId, undo: true }, HK); check('field role cannot undo guest left (403)', r.status === 403, r.text);

  // ---- assign the whole building ----
  r = await call('POST', '/api/housekeeping/assign-building', { buildingId: dep.buildingId, date: today, cleanerId: 'ops-check-cleaner' });
  check('assign whole building', r.status === 200 && r.json.assigned >= 1, r.text);
  r = await call('POST', '/api/housekeeping/assign-building', { buildingId: dep.buildingId, date: today, cleanerId: 'nobody' }); check('assign building to unknown cleaner 404', r.status === 404, r.text);
  r = await call('POST', '/api/housekeeping/assign-building', { buildingId: dep.buildingId, date: today, cleanerId: 'ops-check-cleaner' }, HK); check('field role cannot assign (403)', r.status === 403, r.text);
  row = (await call('GET', `/api/housekeeping/board?date=${today}`)).json.rows.find(x => x.id === taskId);
  check('board shows the cleaner', row?.cleanerId === 'ops-check-cleaner' && row.assigneeName === 'Ops Check Cleaner', JSON.stringify(row));

  // ---- the cleaner's phone ----
  r = await call('GET', `/api/field/tasks?date=${today}`, undefined, HK);
  const job = r.json?.rows?.find(x => x.id === taskId);
  check('field list has the job with guests and checklist', r.status === 200 && job && job.guestOut === true && job.checklist.total >= 5 && 'next' in job, r.text.slice(0, 300));
  check('field list carries no money', !JSON.stringify(r.json).match(/revenue|payout|amount/i), '');
  r = await call('GET', `/api/housekeeping/tasks/${taskId}`, undefined, HK);
  check('detail for the cleaner: checklist, access instruction only, no cost', r.status === 200 && r.json.checklist.length >= 5 && r.json.cost === null && r.json.access.every(a => a.masked === ''), r.text.slice(0, 300));
  r = await call('GET', `/api/housekeeping/tasks/${taskId}`);
  check('detail for the office has the cost', r.status === 200 && r.json.cost && r.json.cost.amount > 0 && r.json.cost.charged === false, r.text.slice(0, 300));
  console.log('   clean cost:', r.json.cost);

  // ---- checklist ----
  r = await call('POST', `/api/housekeeping/tasks/${taskId}/checklist`, { key: 'std-1', done: true }, HK);
  check('tick a checklist item', r.status === 200 && r.json.data.find(i => i.key === 'std-1')?.done === true, r.text);
  r = await call('POST', `/api/housekeeping/tasks/${taskId}/checklist`, { label: 'Replace kettle' }, HK);
  check('add a checklist item', r.status === 201 && r.json.data.some(i => i.custom && i.label === 'Replace kettle'), r.text);
  r = await call('POST', `/api/housekeeping/tasks/${taskId}/checklist`, { key: 'std-99', done: true }, HK); check('unknown checklist item 404', r.status === 404, r.text);
  row = (await call('GET', `/api/housekeeping/board?date=${today}`)).json.rows.find(x => x.id === taskId);
  check('board counts the tick', row?.checklist.done === 1 && row.checklist.total >= 6, JSON.stringify(row?.checklist));

  // ---- proof: photos AND videos, refused without ----
  r = await call('POST', `/api/tasks/${taskId}/complete`, {}, HK); check('complete without proof refused (PHOTO_REQUIRED)', r.status === 422 && r.json?.error?.code === 'PHOTO_REQUIRED', r.text);
  r = await call('POST', `/api/tasks/${taskId}/photos`, file('room.jpg', 'image/jpeg'), HK); check('upload a photo', r.status === 201 && r.json.kind === 'photo', r.text);
  r = await call('POST', `/api/tasks/${taskId}/photos`, file('walkthrough.mp4', 'video/mp4', 2048), HK); check('upload a video', r.status === 201 && r.json.kind === 'video', r.text);
  r = await call('POST', `/api/tasks/${taskId}/photos`, file('notes.txt', 'text/plain'), HK); check('a text file is refused', r.status === 422, r.text);
  r = await call('GET', `/api/housekeeping/tasks/${taskId}/photos`); check('gallery lists the photo and the video', r.status === 200 && r.json.data.length === 2 && r.json.data.some(x => x.kind === 'video'), r.text);
  const vid = r.json.data.find(x => x.kind === 'video');
  const dl = await fetch(BASE + vid.url, { headers: { cookie: cookieFor(ADMIN) } });
  check('the video downloads with its type', dl.status === 200 && dl.headers.get('content-type') === 'video/mp4', `${dl.status} ${dl.headers.get('content-type')}`);

  // ---- report damage from the clean ----
  r = await call('POST', '/api/maintenance/issues', { unitId: dep.unitId, title: 'Ops check: shower leaking', category: 'plumbing', urgency: 'urgent', reportSource: 'cleaner', sourceTaskId: taskId }, HK);
  check('cleaner reports damage: a maintenance job on the unit', r.status === 201 && !!r.json.id, r.text);
  const damageId = r.json?.id; made.issues.push(damageId);
  r = await call('GET', `/api/housekeeping/tasks/${taskId}`); check('the clean lists the damage', r.json.damage.some(d => d.id === damageId), '');

  // ---- start, complete, charge ----
  r = await call('POST', `/api/housekeeping/tasks/${taskId}/start`, {}, HK); check('start', r.status === 200, r.text);
  r = await call('POST', `/api/tasks/${taskId}/complete`, {}, HK);
  check('complete with proof, charged to the unit', r.status === 200 && r.json.cost && (r.json.cost.created || r.json.cost.reason), r.text);
  console.log('   charge:', r.json.cost);
  const exp = await sql`select amount, charge_to, category from expenses where task_id = ${taskId}`;
  if (r.json.cost?.created) check('one cleaning expense on the unit, owner pays', exp.length === 1 && exp[0].category === 'cleaning' && exp[0].charge_to === 'owner' && exp[0].amount === r.json.cost.amount, JSON.stringify(exp));
  r = await call('POST', `/api/tasks/${taskId}/complete`, {}, HK); check('completing twice charges once', r.status === 200 && (await sql`select count(*)::int n from expenses where task_id = ${taskId}`)[0].n === exp.length, r.text);
  row = (await call('GET', `/api/housekeeping/board?date=${today}`)).json.rows.find(x => x.id === taskId);
  check('board shows done with 2 files', row?.status === 'done' && row.photoCount + row.videoCount === 2, JSON.stringify(row));

  // ---- maintenance: threshold, approval, windows, payer, expense ----
  r = await call('GET', '/api/maintenance/issues'); check('jobs list has threshold and new fields', r.status === 200 && r.json.threshold === 30000 && r.json.data.every(x => x.category && x.urgency && Array.isArray(x.windows)), r.text.slice(0, 300));
  r = await call('PATCH', `/api/maintenance/issues/${damageId}`, { quotedAmount: 45000 }); check('quote above RM 300 waits for the owner', r.status === 200 && r.json.state === 'waiting', r.text);
  r = await call('POST', `/api/maintenance/issues/${damageId}/start`, {}); check('cannot start before approval (409)', r.status === 409 && r.json.error.code === 'APPROVAL_PENDING', r.text);
  r = await call('PATCH', `/api/maintenance/issues/${damageId}`, { chargeTo: 'the_conts' }); check('company pays: no owner approval needed', r.status === 200 && r.json.state !== 'waiting', r.text);
  r = await call('PATCH', `/api/maintenance/issues/${damageId}`, { chargeTo: 'owner' }); check('owner pays again: waits again', r.json?.state === 'waiting', r.text);
  r = await call('PATCH', `/api/maintenance/issues/${damageId}`, { quotedAmount: 1 }, HK); check('field role cannot change a job (403)', r.status === 403, r.text);
  r = await call('POST', `/api/maintenance/issues/${damageId}/approve`, { approved: true, quotedAmount: 45000 }); check('management records the owner approval', r.status === 200, r.text);
  r = await call('PATCH', `/api/maintenance/issues/${damageId}`, { assigneeName: 'Ops Check Plumbing', assigneeKind: 'contractor' }); check('assign a contractor', r.status === 200, r.text);

  // A window inside a stay that is coming (a guest arriving tomorrow) is saved with a warning; one in an empty gap is clean.
  const stay = (await sql`select check_in, check_out from reservations where unit_id = ${dep.unitId} and check_in >= ${myt(1)} and state in ('confirmed','pending') and channel <> 'maintenance_block' order by check_in limit 1`)[0];
  if (stay) {
    r = await call('POST', `/api/maintenance/issues/${damageId}/windows`, { startsAt: `${stay.check_in}T20:00`, endsAt: `${stay.check_in}T21:00`, note: 'guest agreed' });
    check('window during a stay: saved, with the overlap', r.status === 201 && r.json.overlaps.length >= 1, r.text);
    r = await call('DELETE', `/api/maintenance/issues/${damageId}/windows/${r.json.id}`); check('remove a window', r.status === 200, r.text);
  }
  r = await call('POST', `/api/maintenance/issues/${damageId}/windows`, { startsAt: `${today}T13:00`, endsAt: `${today}T12:00` }); check('window ending before it starts 422', r.status === 422, r.text);
  r = await call('POST', `/api/maintenance/issues/${damageId}/windows`, { startsAt: `${today}T11:30`, endsAt: `${today}T12:30`, note: 'between guests' });
  check('add a repair window', r.status === 201 && r.json.startsAt === `${today}T11:30:00+08:00`, r.text);
  r = await call('GET', `/api/housekeeping/board?date=${today}`); check('the window shows on Cleaning', r.json.repairs.some(w => w.issueId === damageId), '');
  r = await call('GET', `/api/operations/day?date=${today}`);
  check('Today: arrivals, departures, cleans, repairs', r.status === 200 && Array.isArray(r.json.arrivals) && Array.isArray(r.json.departures) && r.json.cleans.total >= 1 && r.json.repairs.some(w => w.issueId === damageId), r.text.slice(0, 300));
  check('Today: the departure shows guest out', r.json.departures.find(d => d.reservationId === dep.reservationId)?.guestOut === true, '');

  r = await call('POST', `/api/maintenance/issues/${damageId}/photos`, file('after.jpg', 'image/jpeg'), ADMIN); check('maintenance accepts a photo', r.status === 201, r.text);
  const fd = file('after.mp4', 'video/mp4', 1024); fd.append('kind', 'after');
  r = await call('POST', `/api/maintenance/issues/${damageId}/photos`, fd); check('maintenance accepts a video', r.status === 201 && r.json.kind === 'video', r.text);
  const inv = file('invoice.pdf', 'application/pdf'); inv.append('kind', 'invoice');
  r = await call('POST', `/api/maintenance/issues/${damageId}/documents`, inv); check('invoice upload', r.status === 201, r.text);
  r = await call('GET', `/api/maintenance/issues/${damageId}/documents`);
  check('job files: before/after media and the invoice', r.status === 200 && r.json.data.length === 3 && r.json.data.some(d => d.stage === 'after' && d.kind === 'video') && r.json.data.some(d => d.kind === 'invoice'), r.text);

  r = await call('POST', `/api/maintenance/issues/${damageId}/start`, {}); check('start after approval', r.status === 200, r.text);
  r = await call('POST', `/api/maintenance/issues/${damageId}/complete`, { finalAmount: 42000, chargeTo: 'guest_deposit' });
  check('done with cost and payer', r.status === 200 && r.json.chargeTo === 'guest_deposit', r.text);
  const mexp = await sql`select amount, charge_to, category from expenses where maintenance_id = ${damageId}`;
  check('expense on the unit with the payer chosen', mexp.length === 1 && mexp[0].amount === 42000 && mexp[0].charge_to === 'guest_deposit' && mexp[0].category === 'maintenance', JSON.stringify(mexp));

  r = await call('POST', '/api/maintenance/issues', { unitId: dep.unitId, title: 'Ops check: small fix', quotedAmount: 10000, category: 'other' });
  made.issues.push(r.json?.id);
  check('quote under the threshold goes straight to work', r.status === 201 && r.json.state !== 'waiting' && r.json.ownerApprovalRequired === false, r.text);
  r = await call('POST', '/api/maintenance/issues', { unitId: dep.unitId, title: 'x', category: 'roof' }); check('unknown category 422', r.status === 422, r.text);

  // ---- threshold is a setting ----
  r = await call('PUT', '/api/settings', { operations: { maintenanceApprovalThreshold: 50000 } }); check('set the approval threshold', r.status === 200, r.text);
  restore.push(() => sql`delete from settings where key = 'operations.maintenanceApprovalThreshold'`);
  r = await call('GET', '/api/maintenance/issues'); check('threshold read back', r.json.threshold === 50000, r.json.threshold);
} catch (e) {
  check('run finished', false, e.stack ?? e);
} finally {
  // ---- put everything back ----
  const ids = made.tasks.filter(Boolean), iss = made.issues.filter(Boolean);
  if (ids.length || iss.length) {
    await sql`delete from expenses where task_id = any(${ids}::text[]) or maintenance_id = any(${iss}::text[])`;
    await sql`delete from documents where task_id = any(${ids}::text[]) or maintenance_id = any(${iss}::text[])`;
    await sql`delete from maintenance_issues where id = any(${iss}::text[])`;
    await sql`delete from tasks where id = any(${ids}::text[])`;
  }
  for (const f of restore.reverse()) await f();
  await sql`update tasks set cleaner_id = null, assignee_id = null where cleaner_id = 'ops-check-cleaner'`;
  // The audit trail keeps naming the test account, so it is switched off rather than deleted.
  await sql`update cleaners set is_active = 0 where id = 'ops-check-cleaner'`;
  await sql`update users set is_active = 0 where id = ${HK.userId}`;
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
