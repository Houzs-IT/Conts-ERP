// Several cleaners on one cleaning job (owner request K2, migration 0122 task_cleaners), and "own task" for the field
// app meaning ANY cleaner listed on the job. Run against a local server on a demo database (node scripts/dev-pglite.mjs):
//   API_BASE=http://127.0.0.1:8797 node scripts/api-checks/cleaning-multi-cleaner.mjs
// Adds three roster cleaners and a few cleaning jobs on today's date; safe to re-run (each run adds its own).
import { call, check, done } from './harness.mjs';

const NURUL = '11111111-1111-4111-8111-000000000005'; // housekeeper login in the demo data
const run = Date.now().toString(36);
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// The roster: Nurul (internal, has a login) and two outsourced crew members (no login).
const roster = await call('GET', '/api/housekeeping/cleaners?active=1');
let nurul = roster.json?.data?.find(c => c.userId === NURUL)?.id;
if (!nurul) nurul = (await call('POST', '/api/housekeeping/cleaners', { name: 'Nurul Huda', employmentType: 'internal', userId: NURUL })).json?.id;
const out1 = (await call('POST', '/api/housekeeping/cleaners', { name: `Crew A ${run}`, employmentType: 'outsourced', vendorName: 'Test Crew' })).json?.id;
const out2 = (await call('POST', '/api/housekeeping/cleaners', { name: `Crew B ${run}`, employmentType: 'outsourced', vendorName: 'Test Crew' })).json?.id;
check('roster cleaners ready', nurul && out1 && out2, JSON.stringify(roster.json).slice(0, 200));

const units = (await call('GET', '/api/units?size=50')).json?.data ?? [];
check('demo units present', units.length >= 2, units.length);
const unit = units[0];

// 1. A new job with two cleaners: the outsourced crew first, Nurul second.
const made = await call('POST', '/api/housekeeping/tasks', { unitId: unit.id, date: today, kind: 'turnover', cleanerIds: [out1, nurul] });
check('create with two cleaners: 201', made.status === 201, made.text);
const id = made.json?.id;

const boardRow = async (taskId) => (await call('GET', `/api/housekeeping/board?date=${today}`)).json?.rows?.find(r => r.id === taskId);
let row = await boardRow(id);
check('board lists both cleaners in order', row?.cleaners?.length === 2 && row.cleaners[0].cleanerId === out1 && row.cleaners[1].cleanerId === nurul, JSON.stringify(row?.cleaners));
check('board: first cleaner mirrored into cleanerId', row?.cleanerId === out1, row?.cleanerId);
check('board: assigneeName names everyone', row?.assigneeName === `Crew A ${run}, Nurul Huda`, row?.assigneeName);
check('board: status is not unassigned', row?.status !== 'unassigned', row?.status);
check('board: unit size is sent', typeof row?.unit?.size === 'string' && /bath/.test(row.unit.size), JSON.stringify(row?.unit));

// 2. Nurul is the SECOND cleaner, with no claim on tasks.assignee_id: the field app still treats it as her job.
const mine = await call('GET', `/api/field/tasks?date=${today}`, undefined, 'housekeeper');
const fieldRow = mine.json?.rows?.find(r => r.id === id);
check('field list: second cleaner sees the job', !!fieldRow, mine.text.slice(0, 200));
check('field list: shows who else is on it', fieldRow?.team?.includes(`Crew A ${run}`), JSON.stringify(fieldRow?.team));
check('field: detail 200', (await call('GET', `/api/housekeeping/tasks/${id}`, undefined, 'housekeeper')).status === 200);
check('field: checklist 200', (await call('GET', `/api/housekeeping/tasks/${id}/checklist`, undefined, 'housekeeper')).status === 200);
check('field: photos 200', (await call('GET', `/api/housekeeping/tasks/${id}/photos`, undefined, 'housekeeper')).status === 200);
check('field: history 200', (await call('GET', `/api/audit?entityTable=tasks&entityId=${id}`, undefined, 'housekeeper')).status === 200);
check('field: start 200', (await call('POST', `/api/housekeeping/tasks/${id}/start`, {}, 'housekeeper')).status === 200);
check('technician (not on the job): detail 403', (await call('GET', `/api/housekeeping/tasks/${id}`, undefined, 'technician')).status === 403);
check('field: the office list still says Use your own', (await call('GET', `/api/housekeeping/board?date=${today}`, undefined, 'housekeeper')).status === 403);

// 3. Replace the team with the other crew only: Nurul loses the job.
const other = await call('POST', '/api/housekeeping/tasks', { unitId: units[1].id, date: today, kind: 'deep_clean', cleanerIds: [nurul] });
const id2 = other.json?.id;
let r = await call('POST', `/api/housekeeping/tasks/${id2}/assign`, { cleanerIds: [out2], force: true });
check('replace team: 200', r.status === 200 && r.json?.assigneeName === `Crew B ${run}`, r.text);
check('replaced: Nurul gets 403 on it', (await call('GET', `/api/housekeeping/tasks/${id2}`, undefined, 'housekeeper')).status === 403);
check('replaced: not in her list', !(await call('GET', `/api/field/tasks?date=${today}`, undefined, 'housekeeper')).json?.rows?.some(x => x.id === id2));
check('replaced: she cannot complete it', (await call('POST', `/api/tasks/${id2}/complete`, { photoIds: [] }, 'housekeeper')).status === 403);

// 4. mode add keeps who is there.
r = await call('POST', `/api/housekeeping/tasks/${id2}/assign`, { cleanerIds: [nurul], mode: 'add', force: true });
row = await boardRow(id2);
check('add: both kept, crew first', r.status === 200 && row?.cleaners?.map(c => c.cleanerId).join() === [out2, nurul].join(), JSON.stringify(row?.cleaners));
check('add: Nurul may open it again', (await call('GET', `/api/housekeeping/tasks/${id2}`, undefined, 'housekeeper')).status === 200);

// 5. History filter by cleaner finds jobs where they are not first.
const hist = await call('GET', `/api/tasks?state=all&kind=cleaning&from=${today}&to=${today}&assignee=c:${nurul}`);
check('history cleaner filter: finds jobs where she is second', [id, id2].every(x => hist.json?.data?.some(d => d.id === x)), hist.text.slice(0, 200));
check('history: cleaner column names everyone', hist.json?.data?.find(d => d.id === id2)?.assigneeName === `Crew B ${run}, Nurul Huda`, JSON.stringify(hist.json?.data?.find(d => d.id === id2)));

// 6. Bulk assign several cleaners to several jobs.
const third = (await call('POST', '/api/housekeeping/tasks', { unitId: unit.id, date: today, kind: 'light_clean' })).json?.id;
r = await call('POST', '/api/tasks/bulk-assign', { taskIds: [third, id2], cleanerIds: [out1, out2], force: true });
check('bulk: both jobs assigned', r.status === 200 && r.json?.assigned === 2 && r.json?.cleaner === `Crew A ${run}, Crew B ${run}`, r.text);
row = await boardRow(third);
check('bulk: the job has both cleaners', row?.cleaners?.length === 2, JSON.stringify(row?.cleaners));

// 7. Whole building with a team.
r = await call('POST', '/api/housekeeping/assign-building', { buildingId: unit.propertyId, date: today, cleanerIds: [nurul, out1] });
row = await boardRow(third);
check('building: every job gets the team', r.status === 200 && r.json?.assigned >= 1 && row?.cleaners?.map(c => c.cleanerId).join() === [nurul, out1].join(), r.text + JSON.stringify(row?.cleaners));

// 8. A clash counts every job a cleaner is on, not only where they are first.
const at1 = (await call('POST', '/api/housekeeping/tasks', { unitId: unit.id, date: today, kind: 'turnover', scheduledFor: '12:00', dueAt: '14:00', cleanerIds: [out1, out2] })).json?.id;
const at2 = (await call('POST', '/api/housekeeping/tasks', { unitId: units[1].id, date: today, kind: 'turnover', scheduledFor: '12:30', dueAt: '14:30' })).json?.id;
r = await call('POST', `/api/housekeeping/tasks/${at2}/assign`, { cleanerIds: [out2] });
check('clash with a job where the cleaner is second: 409', r.status === 409 && r.json?.error?.code === 'ASSIGNEE_BUSY' && r.json?.conflicts?.some(c => c.id === at1), r.text);
check('clash: force assigns anyway', (await call('POST', `/api/housekeeping/tasks/${at2}/assign`, { cleanerIds: [out2], force: true })).status === 200);

// 9. Validation and unassigning.
r = await call('POST', `/api/housekeeping/tasks/${third}/assign`, { cleanerIds: [nurul, 'no-such-cleaner'] });
check('unknown cleaner: 404 and nothing changed', r.status === 404 && (await boardRow(third))?.cleaners?.length === 2, r.text);
check('field cannot assign: 403', (await call('POST', `/api/housekeeping/tasks/${third}/assign`, { cleanerIds: [nurul] }, 'housekeeper')).status === 403);
r = await call('POST', `/api/housekeeping/tasks/${third}/assign`, { cleanerIds: [] });
row = await boardRow(third);
check('empty list: unassigned', r.status === 200 && row?.cleaners?.length === 0 && row?.status === 'unassigned' && row?.state === 'open', JSON.stringify(row));
check('single cleanerId still works', (await call('POST', `/api/housekeeping/tasks/${third}/assign`, { cleanerId: out2, force: true })).status === 200 && (await boardRow(third))?.cleaners?.length === 1);

done();
