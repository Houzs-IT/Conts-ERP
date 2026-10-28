// Side-menu counts are live numbers from the database, not fixed figures. Field accounts get
// zeros (they have no side menu); statements are only counted for finance roles. Read-only.
import { call, callAsUser, check, done } from './harness.mjs';

const isCount = n => Number.isInteger(n) && n >= 0;
let r = await call('GET', '/api/nav/badges');
check('management gets five counts', r.status === 200 && ['today', 'cleaning', 'maintenance', 'inbox', 'statements'].every(k => isCount(r.json?.[k])), r.text);
const day = (await call('GET', '/api/operations/day')).json;
check('today count is the Today screen\'s check-ins plus checkouts', r.json.today === (day?.arrivals?.length ?? NaN) + (day?.departures?.length ?? NaN), `badge=${r.json.today} arrivals=${day?.arrivals?.length} departures=${day?.departures?.length}`);
const mnt = (await call('GET', '/api/maintenance/issues')).json?.data ?? [];
check('maintenance count matches open jobs', r.json.maintenance === mnt.filter(m => m.state !== 'resolved').length, `badge=${r.json.maintenance}`);

r = await call('GET', '/api/nav/badges', undefined, 'housekeeper');
check('housekeeper gets zeros', r.status === 200 && r.json.today === 0 && r.json.cleaning === 0 && r.json.statements === 0, r.text);
r = await callAsUser({ userId: '11111111-1111-4111-8111-000000000004', email: 'weiwen@theconts.com', role: 'operations_staff' }, 'GET', '/api/nav/badges');
check('operations staff are not shown the statements count', r.status === 200 && r.json.statements === 0, r.text);

// The booking-site cards and the header chip come from real connections, never stored sample status.
r = await call('GET', '/api/nav/badges');
check('header chip data present (units, last sent, failed)', Number.isInteger(r.json?.channels?.units) && Number.isInteger(r.json?.channels?.failed), r.text);
const integ = (await call('GET', '/api/integrations')).json?.data ?? [];
const real = (await call('GET', '/api/integrations/channex/status')).json;
for (const p of ['airbnb', 'booking_com', 'agoda']) {
  const row = integ.find(i => i.provider === p);
  check(`${p} card matches real connections`, row?.viaChannex === true && (row.unitsLinked === 0 ? row.state === 'not_connected' && row.lastSyncedAt === null : ['connected', 'degraded'].includes(row.state)) && row.credentialMasked === null, JSON.stringify(row));
}
check('no booking site claims to be connected while no unit is', r.json.channels.units > 0 || integ.filter(i => i.viaChannex).every(i => i.state === 'not_connected'), JSON.stringify({ units: r.json.channels.units, linked: real?.linkedUnits }));

done();
