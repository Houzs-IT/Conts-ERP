// Cleaning board (11 Oct 2026): several cleaners per cleaning job (task_cleaners, migration 0101), the arriving guest's
// expected arrival time, and the board's layout / crew / damage fields.
// Runs against any local server with real-size data: API_BASE=http://127.0.0.1:8813 SESSION_SECRET=... node scripts/api-checks/cleaning-crew.mjs
// MANAGER_ID names the management user to sign in as (default: the seed's). HOUSEKEEPER_ID, when that user exists, adds
// the field-role checks. Leaves its own two roster cleaners ("Check crew A/B") in the database.
import { callAsUser, check, done } from './harness.mjs';

const manager = { userId: process.env.MANAGER_ID ?? '11111111-1111-4111-8111-000000000002', email: 'm@local.test', role: 'management', fullName: 'Check bot' };
const call = (m, p, b) => callAsUser(manager, m, p, b);
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

let r = await call('GET', `/api/housekeeping/board?date=${today}`);
check('board answers', r.status === 200 && Array.isArray(r.json?.rows), r.text.slice(0, 300));
let board = r.json;
if (board.departures.length) {
  r = await call('POST', '/api/housekeeping/plan', { reservationIds: board.departures.slice(0, 3).map(d => d.reservationId) });
  check('plan cleaning jobs for departures', r.status === 200, r.text.slice(0, 300));
  board = (await call('GET', `/api/housekeeping/board?date=${today}`)).json;
}
check('every row carries layout, cleaners and damage', board.rows.length > 0 && board.rows.every(x => 'layout' in x && Array.isArray(x.cleaners) && Array.isArray(x.damage)), JSON.stringify(board.rows[0] ?? {}).slice(0, 300));
check('departures carry layout', board.departures.every(d => 'layout' in d), '');
const job = board.rows.find(x => x.status !== 'done');
check('an open cleaning job to work with', !!job, '');

// Two roster cleaners of our own, so the check never depends on who is on the roster.
const roster = (await call('GET', '/api/housekeeping/cleaners?active=1')).json?.data ?? [];
const crew = [];
for (const name of ['Check crew A', 'Check crew B']) {
  let c = roster.find(x => x.name === name);
  if (!c) {
    const made = await call('POST', '/api/housekeeping/cleaners', { name, fullName: name, employmentType: 'outsourced', vendorName: 'Check vendor' });
    check(`roster cleaner ${name} added`, made.status === 200 || made.status === 201, made.text.slice(0, 200));
    c = { id: made.json?.id ?? made.json?.cleaner?.id };
  }
  crew.push(c.id);
}

if (job) {
  r = await call('PUT', `/api/housekeeping/tasks/${job.id}/cleaners`, { cleanerIds: crew });
  check('two cleaners on one job', r.status === 200 && r.json.cleaners.length === 2, r.text.slice(0, 300));
  board = (await call('GET', `/api/housekeeping/board?date=${job.day}`)).json;
  const row = board.rows.find(x => x.id === job.id);
  check('board shows both cleaners, in the order picked', row && row.cleaners.map(c => c.id).join() === crew.join(), JSON.stringify(row?.cleaners));
  check('the single cleaner column follows the first', row && row.cleanerId === crew[0], row?.cleanerId);
  r = await call('GET', `/api/tasks?kind=cleaning&state=all&assignee=c:${crew[1]}&from=${job.day}&to=${job.day}`);
  check('History filter by the second cleaner finds the job', r.status === 200 && r.json.data.some(x => x.id === job.id), r.text.slice(0, 300));
  check('History names both cleaners', r.json.data.find(x => x.id === job.id)?.assigneeName?.includes(','), r.json.data.find(x => x.id === job.id)?.assigneeName);

  r = await call('PUT', `/api/housekeeping/tasks/${job.id}/cleaners`, { cleanerIds: [] });
  check('empty crew takes everyone off', r.status === 200 && r.json.cleaners.length === 0, r.text.slice(0, 200));
  board = (await call('GET', `/api/housekeeping/board?date=${job.day}`)).json;
  check('job reads unassigned again', board.rows.find(x => x.id === job.id)?.status === 'unassigned' || board.rows.find(x => x.id === job.id)?.cleaners.length === 0, '');

  r = await call('POST', '/api/tasks/bulk-assign', { taskIds: [job.id], cleanerIds: [crew[0]], mode: 'add' });
  check('bulk add one cleaner', r.status === 200 && r.json.assigned === 1, r.text.slice(0, 200));
  r = await call('POST', '/api/tasks/bulk-assign', { taskIds: [job.id], cleanerIds: [crew[1]], mode: 'add' });
  check('bulk add keeps the first', r.status === 200 && r.json.assigned === 1, r.text.slice(0, 200));
  board = (await call('GET', `/api/housekeeping/board?date=${job.day}`)).json;
  check('after two adds the job has both', board.rows.find(x => x.id === job.id)?.cleaners.length === 2, '');
  r = await call('POST', '/api/tasks/bulk-assign', { taskIds: [job.id], cleanerId: crew[1] });
  check('a single cleanerId still replaces (old callers)', r.status === 200, r.text.slice(0, 200));
  board = (await call('GET', `/api/housekeeping/board?date=${job.day}`)).json;
  check('replace left one cleaner', board.rows.find(x => x.id === job.id)?.cleaners.map(c => c.id).join() === crew[1], '');

  r = await call('PUT', `/api/housekeeping/tasks/${job.id}/cleaners`, { cleanerIds: ['no-such-cleaner'] });
  check('unknown cleaner refused (404)', r.status === 404, r.text);
  r = await call('PUT', `/api/housekeeping/tasks/${job.id}/cleaners`, { cleanerIds: 'x' });
  check('not a list refused (422)', r.status === 422, r.text);

  r = await call('GET', `/api/audit?entityTable=tasks&entityId=${job.id}`);
  check('crew changes are in the audit trail', r.status === 200 && r.json.data.some(e => e.action === 'task.cleaners'), r.text.slice(0, 300));
}

// Expected arrival on the next guest.
const withNext = board.rows.find(x => x.next?.reservationId) ?? null;
check('a job with an arriving guest', !!withNext, '');
if (withNext) {
  const res = withNext.next.reservationId;
  r = await call('PUT', `/api/reservations/${res}/arrival`, { time: '16:30' });
  check('record expected arrival', r.status === 200 && r.json.expectedArrival === '16:30', r.text);
  board = (await call('GET', `/api/housekeeping/board?date=${withNext.day}`)).json;
  const row = board.rows.find(x => x.id === withNext.id);
  check('board shows it and counts time left to it', row?.next?.expectedArrival === '16:30' && row.next.checkInAt.includes('T16:30'), JSON.stringify(row?.next));
  r = await call('PUT', `/api/reservations/${res}/arrival`, { time: '25:00' });
  check('bad time refused (422)', r.status === 422, r.text);
  r = await call('PUT', `/api/reservations/${res}/arrival`, { time: null });
  check('clear expected arrival', r.status === 200 && r.json.expectedArrival === null, r.text);
  board = (await call('GET', `/api/housekeeping/board?date=${withNext.day}`)).json;
  const back = board.rows.find(x => x.id === withNext.id);
  check('clean-by falls back to the check-in time', back?.next?.expectedArrival === null && back.next.checkInAt.includes(`T${back.next.checkInTime}`), JSON.stringify(back?.next));
  r = await call('GET', `/api/audit?entityTable=reservations&entityId=${res}`);
  check('arrival changes are audited', r.json?.data?.some(e => e.action === 'reservation.expected_arrival'), r.text.slice(0, 200));
}

if (process.env.HOUSEKEEPER_ID && job) {
  const hk = { userId: process.env.HOUSEKEEPER_ID, email: 'hk@local.test', role: 'housekeeper', fullName: 'Field check' };
  r = await callAsUser(hk, 'PUT', `/api/housekeeping/tasks/${job.id}/cleaners`, { cleanerIds: [] });
  check('a cleaner cannot change the crew (403)', r.status === 403, r.text);
  r = await callAsUser(hk, 'PUT', `/api/reservations/${withNext?.next?.reservationId ?? 'x'}/arrival`, { time: '12:00' });
  check('a cleaner cannot change a reservation (403)', r.status === 403, r.text);
  if (process.env.HOUSEKEEPER_CLEANER_ID) {
    await call('PUT', `/api/housekeeping/tasks/${job.id}/cleaners`, { cleanerIds: [crew[0], process.env.HOUSEKEEPER_CLEANER_ID] });
    r = await callAsUser(hk, 'GET', `/api/field/tasks?date=${job.day}`);
    check('the second cleaner sees the job in the field app', r.status === 200 && JSON.stringify(r.json).includes(job.id), r.text.slice(0, 300));
    r = await callAsUser(hk, 'GET', `/api/housekeeping/tasks/${job.id}`);
    check('and may open it', r.status === 200, r.text.slice(0, 200));
  }
}
done();
