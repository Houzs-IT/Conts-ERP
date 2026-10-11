// Cleaning: a job a cleaner finishes on the phone shows as done on the office board with its proof, and its History
// says who created, assigned, photographed and finished it. Needs a local server (see harness.mjs) on demo data.
//
// Run: API_BASE=http://localhost:8790 node scripts/api-checks/cleaning-pod-audit.mjs
import { call, check, done } from './harness.mjs';

const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const units = await call('GET', '/api/units?pageSize=5');
const unitId = (units.json?.data ?? units.json?.rows ?? [])[0]?.id;
check('a demo unit to clean', !!unitId, units.text);

// The roster entry linked to the demo housekeeper account, so the phone may act on the job.
const HOUSEKEEPER = '11111111-1111-4111-8111-000000000005';
let roster = await call('GET', '/api/housekeeping/cleaners');
if (!(roster.json?.data ?? []).some(c => c.userId === HOUSEKEEPER)) {
  await call('POST', '/api/housekeeping/cleaners', { name: 'Nurul Huda', employmentType: 'internal', userId: HOUSEKEEPER });
  roster = await call('GET', '/api/housekeeping/cleaners');
}
const nurul = (roster.json?.data ?? []).find(c => c.userId === HOUSEKEEPER);
check('the housekeeper is on the cleaner roster', !!nurul, roster.text);

const made = await call('POST', '/api/housekeeping/tasks', { unitId, date: today, kind: 'turnover', title: 'Standard clean' });
check('office adds a cleaning job', made.status === 201 || made.status === 200, made.text);
const id = made.json?.id ?? made.json?.task?.id;

const assigned = await call('POST', `/api/housekeeping/tasks/${id}/assign`, { cleanerId: nurul?.id, force: true });
check('office assigns the cleaner', assigned.status < 300, assigned.text);

const early = await call('POST', `/api/tasks/${id}/complete`, { photoIds: [] }, 'housekeeper');
check('the phone cannot finish without a photo', early.status === 422, early.text);

// A 1x1 PNG as the proof photo, uploaded the way the phone does (multipart, field "file").
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const { cookieFor } = await import('./harness.mjs');
const form = new FormData();
form.append('file', new Blob([png], { type: 'image/png' }), 'proof.png');
const up = await fetch(`${process.env.API_BASE ?? 'http://localhost:8788'}/api/tasks/${id}/photos`, { method: 'POST', headers: { cookie: cookieFor('housekeeper') }, body: form });
check('the phone uploads a proof photo', up.status < 300, await up.text());

const fin = await call('POST', `/api/tasks/${id}/complete`, { photoIds: [] }, 'housekeeper');
check('the phone marks it complete', fin.status === 200, fin.text);

const board = await call('GET', `/api/housekeeping/board?date=${today}`);
const row = (board.json?.rows ?? []).find(r => r.id === id);
check('the office board shows it done', row?.status === 'done', JSON.stringify(row));
check('with the time it was finished', !!row?.completedAt, JSON.stringify(row));
check('and its photo', (row?.photoCount ?? 0) + (row?.videoCount ?? 0) === 1, JSON.stringify(row));

const detail = await call('GET', `/api/housekeeping/tasks/${id}`);
check('the detail names who finished it', detail.json?.completedBy === 'Nurul Huda', detail.text);
check('the detail no longer carries a checklist', !('checklist' in (detail.json ?? {})), detail.text);

const hist = await call('GET', `/api/audit?entityTable=tasks&entityId=${id}&pageSize=50`);
const actions = (hist.json?.data ?? []).map(e => e.action);
for (const a of ['housekeeping.create', 'task.assign_cleaner', 'task.photo', 'task.complete']) {
  check(`History has ${a}`, actions.includes(a), actions.join(', '));
}
const who = (hist.json?.data ?? []).find(e => e.action === 'task.complete');
check('the finish is credited to the cleaner, via the phone', who?.actorLabel === 'Nurul Huda' && who?.source === 'field_app', JSON.stringify(who));

// A related reservation's other entries stay out when only its status changes are asked for.
const filtered = await call('GET', `/api/audit?entityTable=tasks&entityId=${id}&also=reservations:none&alsoActions=reservation.status`);
check('alsoActions is accepted', filtered.status === 200, filtered.text);

done();
