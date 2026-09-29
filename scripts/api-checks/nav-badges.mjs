// Side-menu counts are live numbers from the database, not fixed figures. Field accounts get
// zeros (they have no side menu); statements are only counted for finance roles. Read-only.
import { call, callAsUser, check, done } from './harness.mjs';

const isCount = n => Number.isInteger(n) && n >= 0;
let r = await call('GET', '/api/nav/badges');
check('management gets four counts', r.status === 200 && ['today', 'maintenance', 'inbox', 'statements'].every(k => isCount(r.json?.[k])), r.text);
const ops = (await call('GET', '/api/operations/today')).json;
const opsRows = ops?.rows ?? ops?.data ?? [];
check('today count matches the Today screen', r.json.today === opsRows.length, `badge=${r.json.today} screen=${opsRows.length}`);
const mnt = (await call('GET', '/api/maintenance/issues')).json?.data ?? [];
check('maintenance count matches open jobs', r.json.maintenance === mnt.filter(m => m.state !== 'resolved').length, `badge=${r.json.maintenance}`);

r = await call('GET', '/api/nav/badges', undefined, 'housekeeper');
check('housekeeper gets zeros', r.status === 200 && r.json.today === 0 && r.json.statements === 0, r.text);
r = await callAsUser({ userId: '11111111-1111-4111-8111-00000000aa01', email: 'ops-check@theconts.test', role: 'operations_staff' }, 'GET', '/api/nav/badges');
check('operations staff are not shown the statements count', r.status === 200 && r.json.statements === 0, r.text);

done();
