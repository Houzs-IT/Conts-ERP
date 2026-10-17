// A cleaner login that is not on the roster yet still shows in every cleaner picker (QC, 17 Oct 2026: the Add
// cleaning job dialog listed nobody on the demo data). Run against a local server on a demo database
// (node scripts/dev-pglite.mjs):
//   API_BASE=http://127.0.0.1:8797 SESSION_SECRET=<.dev.vars> node scripts/api-checks/cleaner-roster-sync.mjs
// Adds one external cleaning job per run; leaves Nurul active on the roster.
import { call, check, done } from './harness.mjs';

const NURUL = '11111111-1111-4111-8111-000000000005'; // housekeeper login in the demo data
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const mine = (list) => (list.json?.data ?? []).filter(c => c.userId === NURUL);

const first = await call('GET', '/api/housekeeping/cleaners?active=1');
check('active roster: 200', first.status === 200, first.text);
const nurul = mine(first)[0];
check('the housekeeper login is on the active roster', !!nurul && nurul.isActive && nurul.employmentType === 'internal', first.text.slice(0, 300));

const again = await call('GET', '/api/housekeeping/cleaners?active=1');
check('asking again does not add her twice', mine(again).length === 1, mine(again).length);

const made = await call('POST', '/api/housekeeping/tasks', { external: { address: `Roster check ${Date.now()}` }, amount: 10000, date: today, kind: 'turnover', cleanerIds: [nurul?.id] });
check('an external job takes her as its cleaner: 201', made.status === 201, made.text);
const board = await call('GET', `/api/housekeeping/board?date=${today}`);
const row = [...(board.json?.rows ?? []), ...(board.json?.external ?? [])].find(r => r.id === made.json?.id);
check('the board shows her on that job', row?.cleaners?.[0]?.cleanerId === nurul?.id, JSON.stringify(row?.cleaners));

// Taken off the roster: she stays off (the sync only adds logins no roster entry links to).
const off = await call('PATCH', `/api/housekeeping/cleaners/${nurul?.id}`, { isActive: false });
check('take her off the roster: 200', off.status === 200, off.text);
const activeAfter = await call('GET', '/api/housekeeping/cleaners?active=1');
check('an inactive entry is not re-added to the pickers', mine(activeAfter).length === 0, activeAfter.text.slice(0, 300));
const everyone = await call('GET', '/api/housekeeping/cleaners');
check('the roster still has exactly one entry for her', mine(everyone).length === 1, mine(everyone).length);
const back = await call('PATCH', `/api/housekeeping/cleaners/${nurul?.id}`, { isActive: true });
check('put her back: 200', back.status === 200, back.text);

const field = await call('GET', '/api/housekeeping/cleaners?active=1', undefined, 'housekeeper');
check('a cleaner cannot read the roster: 403', field.status === 403, field.status);

done();
