// Record history (GET /api/audit by record), in-app notifications (/api/notifications/**), the notices the
// booking / cleaning / repair handlers send, the calendar block a finished repair gives back, and the scheduled
// jobs' dry run and real run, end to end against a LOCAL app and its LOCAL database.
//
//   BASE=http://127.0.0.1:8793 DB=postgres://postgres:local@127.0.0.1:55433/postgres node scripts/api-checks/history-notifications.mjs
//
// The app must run with the SESSION_SECRET in this folder's .dev.vars (sessions are signed with it here). The script adds
// five test accounts (s3-*) to the local database and refuses any database that is not on this computer.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.BASE ?? 'http://127.0.0.1:8793';
const DB = process.env.DB ?? 'postgres://postgres:local@127.0.0.1:55433/postgres';
if (!['127.0.0.1', 'localhost'].includes(new URL(DB).hostname) || !['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname)) {
  console.error('Refused: this check writes test accounts and only runs against a local app and database.'); process.exit(2);
}
const SECRET = readFileSync(join(root, '.dev.vars'), 'utf8').match(/^SESSION_SECRET="?([^"\r\n]+)"?/m)?.[1];
if (!SECRET) { console.error('SESSION_SECRET is not in .dev.vars'); process.exit(2); }

// PGlite serves one connection at a time: open, run, close, so the app is never kept waiting.
async function sql(text, ...args) {
  const db = postgres(DB, { max: 1, prepare: false, fetch_types: false, connection: { search_path: 'pos' } });
  try { return await db.unsafe(text, args); } finally { await db.end({ timeout: 0 }); }
}

const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const U = {
  management: ['dev-admin', 'dev@local.test', 'Dev Admin', 'management'],
  opsMgr: ['s3-ops-mgr', 's3-opsmgr@local.test', 'S3 Ops Manager', 'operations_manager'],
  ops: ['s3-ops', 's3-ops@local.test', 'S3 Ops Staff', 'operations_staff'],
  hk: ['s3-hk', 's3-hk@local.test', 'S3 Housekeeper', 'housekeeper'],
  tech: ['s3-tech', 's3-tech@local.test', 'S3 Technician', 'technician'],
  fin: ['s3-fin', 's3-fin@local.test', 'S3 Finance', 'finance_admin'],
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
let fails = 0, passes = 0;
const check = (name, cond, extra = '') => { cond ? passes++ : fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' :: ' + String(extra).slice(0, 400)}`); };
const notices = async (who, kind) => (await call(who, 'GET', '/api/notifications?pageSize=100')).json?.data?.filter(n => !kind || n.kind === kind) ?? [];
const history = async (who, table, id) => call(who, 'GET', `/api/audit?entityTable=${table}&entityId=${encodeURIComponent(id)}&pageSize=50`);

/* ---------- setup ---------- */
const now = new Date().toISOString();
for (const [id, email, name, role] of Object.values(U).slice(1)) {
  await sql(`insert into users (id, email, full_name, password_hash, role, must_change_password, created_at, updated_at) values ($1, $2, $3, 'x', $4, 0, $5, $5) on conflict (id) do update set is_active = 1, role = excluded.role, full_name = excluded.full_name`, id, email, name, role, now);
}
await sql(`insert into cleaners (id, full_name, employment_type, user_id, is_active, created_at, updated_at) values ('s3-cleaner', 'S3 Housekeeper', 'internal', 's3-hk', 1, $1, $1) on conflict (id) do update set is_active = 1, user_id = 's3-hk'`, now);
await sql(`update user_notifications set read_at = $1 where user_id like 's3-%' and read_at is null`, now);
const [unit] = await sql(`select u.id, u.unit_number, p.name from units u join properties p on p.id = u.property_id where u.parent_unit_id is null order by u.id limit 1`);
check('setup: a unit to work on', !!unit, 'no unit');

// Dates far ahead and unique to this run, so nothing clashes with the imported bookings or a previous run.
const base = new Date(Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 3000) * 864e5);
const day = (n) => new Date(base.getTime() + n * 864e5).toISOString().slice(0, 10);

/* ---------- notifications endpoints ---------- */
let r = await call('opsMgr', 'GET', '/api/notifications/count');
check('count: answers for a signed-in person', r.status === 200 && typeof r.json.unread === 'number', r.text);
const before = r.json?.unread ?? 0;
r = await call('opsMgr', 'GET', '/api/notifications');
check('list: own notices with total and unread', r.status === 200 && Array.isArray(r.json.data) && 'unread' in r.json && 'total' in r.json, r.text);
r = await fetch(BASE + '/api/notifications/count'); check('count: signed out is 401', r.status === 401, r.status);
r = await call('opsMgr', 'PATCH', '/api/notifications', { ids: 'x' }); check('mark read: bad body is 422', r.status === 422, r.text);

/* ---------- bookings ---------- */
r = await call('management', 'POST', '/api/reservations', { unitId: unit.id, checkIn: day(0), checkOut: day(3), channel: 'direct', guest: { fullName: 'S3 History Guest' }, grossBookingValue: 45000 });
check('booking created', r.status === 201, r.text);
const bookingId = r.json?.id;
let n = (await notices('opsMgr', 'booking.created')).find(x => x.entityId === bookingId);
check('new booking: operations manager notified', !!n && n.link === `/reservations/bookings?open=${bookingId}` && /New booking/.test(n.title), JSON.stringify(n));
check('new booking: operations staff notified', (await notices('ops', 'booking.created')).some(x => x.entityId === bookingId));
check('new booking: housekeeper not told', !(await notices('hk', 'booking.created')).some(x => x.entityId === bookingId));
check('new booking: whoever made it is not told', !(await notices('management', 'booking.created')).some(x => x.entityId === bookingId));
r = await call('opsMgr', 'GET', '/api/notifications/count');
check('bell count went up', r.json.unread >= before + 1, `${before} -> ${r.json.unread}`);

r = await call('opsMgr', 'PATCH', '/api/notifications', { ids: [n.id] });
check('mark one read: count goes down by one', r.status === 200 && r.json.read === 1, r.text);
const opsNotice = (await notices('ops', 'booking.created')).find(x => x.entityId === bookingId);
r = await call('opsMgr', 'PATCH', '/api/notifications', { ids: [opsNotice.id] });
check("mark read: someone else's notice is left alone", r.status === 200 && r.json.read === 0, r.text);
r = await call('ops', 'GET', '/api/notifications?unread=1&pageSize=100');
check("the other person's notice is still unread", r.json.data.some(x => x.id === opsNotice.id), r.text.slice(0, 200));

r = await call('management', 'PATCH', `/api/reservations/${bookingId}/dates`, { checkIn: day(1), checkOut: day(4), confirm: true });
check('dates changed', r.status === 200, r.text);
check('date change: operations told', (await notices('opsMgr', 'booking.dates_changed')).some(x => x.entityId === bookingId));

r = await history('management', 'reservations', bookingId);
const dates = r.json?.data?.find(e => e.action === 'reservation.dates');
check('history: the date change with old and new values', !!dates && dates.before.checkIn === day(0) && dates.after.checkIn === day(1) && dates.actorKind === 'person' && dates.actorLabel === 'Dev Admin', JSON.stringify(dates));
check('history: newest first, with the create entry', r.json.data[0].action === 'reservation.dates' && r.json.data.some(e => e.action === 'reservation.create'), r.json.data.map(e => e.action).join());
check('history: total counts only this record', r.json.total === r.json.data.length && r.json.total >= 2, r.json.total);
r = await call('management', 'GET', `/api/audit?entityTable=reservations&entityId=${bookingId}&pageSize=1&page=2`);
check('history: pages', r.status === 200 && r.json.data.length === 1 && r.json.page === 2, r.text.slice(0, 200));

r = await call('management', 'PATCH', `/api/reservations/${bookingId}`, { state: 'cancelled', reason: 'S3 check' });
check('booking cancelled', r.status === 200, r.text);
check('cancellation: operations told', (await notices('opsMgr', 'booking.cancelled')).some(x => x.entityId === bookingId));

/* ---------- who may read which history ---------- */
r = await history('hk', 'reservations', bookingId); check('housekeeper cannot read a booking history (403)', r.status === 403, r.text);
r = await history('fin', 'reservations', bookingId); check('finance can read a booking history', r.status === 200, r.text);
const [stmt] = await sql(`select id from owner_statements limit 1`);
r = await history('ops', 'owner_statements', stmt.id); check('operations staff cannot read a statement history (403)', r.status === 403, r.text);
r = await history('fin', 'owner_statements', stmt.id); check('finance can read a statement history', r.status === 200, r.text);
r = await call('ops', 'GET', '/api/audit'); check('the whole trail stays management and finance only', r.status === 403, r.text);
r = await call('ops', 'GET', `/api/audit?entityTable=units&entityId=${unit.id}&also=owner_contracts:x`);
check('a record the role may not see is left out of "also", not refused', r.status === 200, r.text);

/* ---------- unit edits show field by field ---------- */
const [u0] = await sql(`select listing_name from units where id = $1`, unit.id);
const label = `S3 listing ${Date.now()}`;
r = await call('management', 'PATCH', `/api/units/${unit.id}`, { listingName: label });
check('unit edited', r.status === 200, r.text);
r = await history('management', 'units', unit.id);
const ue = r.json?.data?.find(e => e.action === 'unit.update');
check('unit history: the changed field only, old -> new', !!ue && ue.after.listingName === label && ue.before.listingName === (u0.listing_name ?? null) && !('unitNumber' in ue.after), JSON.stringify(ue));
await call('management', 'PATCH', `/api/units/${unit.id}`, { listingName: u0.listing_name ?? '' });

/* ---------- cleaning ---------- */
r = await call('opsMgr', 'POST', '/api/housekeeping/tasks', { unitId: unit.id, date: day(5), kind: 'turnover', scheduledFor: '11:00', dueAt: '15:00' });
check('clean created', r.status === 201, r.text);
const taskId = r.json?.id;
r = await call('opsMgr', 'POST', `/api/housekeeping/tasks/${taskId}/assign`, { cleanerId: 's3-cleaner' });
check('clean assigned to the housekeeper', r.status === 200, r.text);
n = (await notices('hk', 'cleaning.assigned')).find(x => x.entityId === taskId);
check('assignment: the housekeeper is told', !!n && n.link === `/operations/cleaning?task=${taskId}`, JSON.stringify(n));
r = await history('hk', 'tasks', taskId); check('housekeeper can read their own clean history', r.status === 200 && r.json.data.some(e => e.action === 'task.assign_cleaner'), r.text.slice(0, 200));
r = await history('hk', 'tasks', 'not-theirs'); check("housekeeper cannot read someone else's clean (403)", r.status === 403, r.text);
r = await call('management', 'GET', `/api/audit?entityTable=tasks&entityId=${taskId}`);
check('history names people, not ids', r.json?.names?.['s3-cleaner'] === 'S3 Housekeeper', JSON.stringify(r.json?.names));

/* ---------- repairs and the calendar block ---------- */
r = await call('ops', 'POST', '/api/maintenance/issues', { unitId: unit.id, title: `S3 leak ${Date.now()}`, category: 'plumbing', urgency: 'urgent' });
check('repair reported', r.status === 201, r.text);
const issueId = r.json?.id;
check('repair reported: operations manager told', (await notices('opsMgr', 'maintenance.reported')).some(x => x.entityId === issueId));
r = await call('opsMgr', 'PATCH', `/api/maintenance/issues/${issueId}`, { assigneeName: 'S3 Technician', assigneeKind: 'in_house' });
check('repair assigned', r.status === 200, r.text);
check('assignment: the technician with that name is told', (await notices('tech', 'maintenance.assigned')).some(x => x.entityId === issueId));
r = await call('opsMgr', 'POST', `/api/maintenance/issues/${issueId}/windows`, { startsAt: `${day(6)}T10:00`, endsAt: `${day(6)}T12:00` });
check('visit planned', r.status === 201, r.text);
n = (await notices('tech', 'maintenance.window')).find(x => x.entityId === issueId);
check('visit: the technician is told when', !!n && /10:00/.test(n.body), JSON.stringify(n));
r = await history('tech', 'maintenance_issues', issueId); check('technician can read the history of a job assigned to them', r.status === 200, r.text);

r = await call('opsMgr', 'POST', '/api/blocks', { unitId: unit.id, from: day(7), to: day(10), reason: 'Maintenance: linked', issueId });
check('block made from the job', r.status === 201, r.text);
const linkedBlock = r.json?.id;
const [lb] = await sql(`select maintenance_issue_id from reservations where id = $1`, linkedBlock);
check('the block remembers its job', lb?.maintenance_issue_id === issueId, JSON.stringify(lb));
const [{ title }] = await sql(`select title from maintenance_issues where id = $1`, issueId);
r = await call('opsMgr', 'POST', '/api/blocks', { unitId: unit.id, from: day(11), to: day(12), reason: `Maintenance: ${title}` });
check('a block written the old way (note only)', r.status === 201, r.text);
const legacyBlock = r.json?.id;

r = await call('management', 'POST', `/api/maintenance/issues/${issueId}/complete`, { finalAmount: 0 });
check('job closed: both blocks given back at once', r.status === 200 && r.json.blocksReleased === 2, r.text);
const blocks = await sql(`select id, state from reservations where id in ($1, $2)`, linkedBlock, legacyBlock);
check('released blocks are no longer on the calendar', blocks.length === 2 && blocks.every(b => b.state === 'cancelled'), JSON.stringify(blocks));
r = await history('management', 'reservations', linkedBlock);
check('the block history says why it went', r.json?.data?.some(e => e.action === 'reservation.block_released' && e.after.reason === 'repair job closed'), r.text.slice(0, 300));
check('job done: operations told', (await notices('opsMgr', 'maintenance.done')).some(x => x.entityId === issueId));
r = await history('management', 'maintenance_issues', issueId);
check('job history: reported, assigned, visit, closed, nights given back', ['maintenance.create', 'maintenance.assign', 'maintenance.window_add', 'maintenance.complete', 'maintenance.block_released'].every(a => r.json.data.some(e => e.action === a)), r.json?.data?.map(e => e.action).join());

/* ---------- scheduled jobs ---------- */
await sql(`update tasks set due_at = $1, state = 'assigned' where id = $2`, new Date(Date.now() - 2 * 3600e3).toISOString(), taskId);
let run = spawnSync(process.execPath, [join(root, 'scripts/cron-dry-run.mjs'), `--db=${DB}`], { encoding: 'utf8' });
check('cron dry run: every job reports, nothing written', run.status === 0 && /\[overdue-sweep\] Would mark/.test(run.stdout) && /\[daily-digest\] Would send/.test(run.stdout), run.stdout + run.stderr);
const [t1] = await sql(`select state from tasks where id = $1`, taskId);
check('dry run left the clean as it was', t1.state === 'assigned', t1.state);
run = spawnSync(process.execPath, [join(root, 'scripts/cron-dry-run.mjs'), `--db=${DB}`, '--apply', '--job=overdue-sweep'], { encoding: 'utf8' });
check('overdue sweep runs', run.status === 0, run.stdout + run.stderr);
const [t2] = await sql(`select state from tasks where id = $1`, taskId);
check('the late clean is marked Overdue', t2.state === 'overdue', t2.state);
check('overdue: the housekeeper is told', (await notices('hk', 'cleaning.overdue')).some(x => x.entityId === taskId));
run = spawnSync(process.execPath, [join(root, 'scripts/cron-dry-run.mjs'), `--db=${DB}`, '--apply', '--job=overdue-sweep'], { encoding: 'utf8' });
check('overdue: a second run does not tell anyone twice', (await notices('hk', 'cleaning.overdue')).filter(x => x.entityId === taskId).length === 1);
run = spawnSync(process.execPath, [join(root, 'scripts/cron-dry-run.mjs'), `--db=${DB}`, '--apply', '--job=daily-digest'], { encoding: 'utf8' });
check('daily digest reaches operations once a day', run.status === 0 && (await notices('opsMgr', 'digest.today')).length === 1, run.stdout);

/* ---------- read all ---------- */
r = await call('opsMgr', 'PATCH', '/api/notifications', { all: true });
check('mark all read', r.status === 200 && r.json.read >= 1, r.text);
r = await call('opsMgr', 'GET', '/api/notifications/count');
check('bell count is zero after mark all read', r.json.unread === 0, r.text);

console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
