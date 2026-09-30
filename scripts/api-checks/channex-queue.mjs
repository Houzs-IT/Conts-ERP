// The Channex outbox against the staging sandbox (certification behaviour): setup runs a full sync as
// exactly two calls; several edits made together leave as ONE call once the edits go quiet; price,
// minimum stay, stop sell and a block all reach Channex with the right values; the Full sync button
// sends two calls. Needs the local server started with CHANNEX_API_KEY and
// CHANNEX_BASE_URL=https://staging.channex.io. Cleans up after itself on both sides.
import { readFileSync } from 'node:fs';
import { call, check, done } from './harness.mjs';

const key = readFileSync('C:/dev/Conts-ERP-deploy/.dev.vars.channex', 'utf8').split(/\r?\n/).find(l => l.startsWith('CHANNEX_API_KEY=')).slice(16).replace(/^"|"$/g, '');
const chx = async (path, init = {}) => {
  const r = await fetch('https://staging.channex.io/api/v1' + path, { ...init, headers: { 'user-api-key': key, 'content-type': 'application/json', accept: 'application/json' } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const calls = async () => (await call('GET', '/api/integrations/channex/status')).json?.recentCalls ?? [];
let PROP = null;   // the test unit's Channex property: other linked units on staging batch separately
const newCalls = async (since) => (await calls()).filter(c => c.calledAt > since && (!PROP || c.propertyId === PROP));
const tag = Date.now().toString().slice(-6);

let r = await call('POST', '/api/properties', { name: `Channex Queue ${tag}`, state: 'Kuala Lumpur', city: 'Kuala Lumpur' });
const BID = r.json?.id;
r = await call('POST', '/api/units', { buildingId: BID, unitCode: `CQ-${tag}`, unitNumber: `CQ-${tag}`, listingName: `Channex Queue Studio ${tag}` });
const UID = r.json?.id;

// 1. Setup: full sync through the outbox, exactly one availability + one restrictions call.
let since = new Date().toISOString();
r = await call('POST', `/api/units/${UID}/channex-setup`, {});
const ids = r.json ?? {};
PROP = ids.propertyId;
check('unit set up, full sync accepted', r.status === 201 && ids.availabilitySent === true, r.text);
let c = await newCalls(since);
// Channex gives no task id when a value changes nothing (the new rate plan already holds the base rate).
check('full sync is exactly 2 calls (availability + restrictions)', c.length === 2 && c.every(x => x.fullSync && x.status < 300) && new Set(c.map(x => x.kind)).size === 2, JSON.stringify(c));

// 2. Three price edits in a row leave as ONE restrictions call.
since = new Date().toISOString();
const prices = [[day(20), 33300], [day(21), 44400], [day(25), 45623]];
for (const [date, rate] of prices) {
  r = await call('PUT', '/api/rates', { unitId: UID, channel: 'web', date, rate });
  check(`price ${rate / 100} saved for ${date}`, r.status === 200, r.text);
}
check('nothing sent while the edits are still coming', (await newCalls(since)).length === 0);
await sleep(24_000);
c = await newCalls(since);
check('the three edits went as ONE call', c.length === 1 && c[0].kind === 'restrictions' && c[0].rows === 3 && c[0].status < 300, JSON.stringify(c));
const rest = await chx(`/restrictions?filter[property_id]=${ids.propertyId}&filter[date][gte]=${day(20)}&filter[date][lte]=${day(25)}&filter[restrictions]=rate,min_stay_arrival,stop_sell`);
const onPlan = rest.json?.data?.[ids.ratePlanId] ?? {};
check('Channex shows the three prices', Number(onPlan[day(20)]?.rate) === 333 && Number(onPlan[day(21)]?.rate) === 444 && Number(onPlan[day(25)]?.rate) === 456.23, JSON.stringify(onPlan).slice(0, 400));

// 3. Minimum stay and stop sell from the Calendar's Rate update.
since = new Date().toISOString();
r = await call('POST', '/api/rates/bulk', { unitIds: [UID], from: day(30), to: day(32), minStay: 3 });
check('minimum stay 3 saved', r.status === 200, r.text);
r = await call('POST', '/api/rates/bulk', { unitIds: [UID], from: day(34), to: day(34), stopSell: true });
check('stop sell saved', r.status === 200, r.text);
const cal = await call('GET', `/api/reservations/calendar?from=${day(29)}&to=${day(35)}`);
check('calendar shows min 3 and closed', cal.json?.restrictions?.[`${UID}:${day(31)}`]?.minStay === 3 && cal.json?.restrictions?.[`${UID}:${day(34)}`]?.stopSell === true, JSON.stringify(cal.json?.restrictions ?? cal.text).slice(0, 300));
await sleep(24_000);
c = await newCalls(since);
check('both went as ONE call', c.length === 1 && c[0].kind === 'restrictions' && c[0].status < 300, JSON.stringify(c));
const rest2 = await chx(`/restrictions?filter[property_id]=${ids.propertyId}&filter[date][gte]=${day(30)}&filter[date][lte]=${day(34)}&filter[restrictions]=min_stay_arrival,stop_sell`);
const p2 = rest2.json?.data?.[ids.ratePlanId] ?? {};
check('Channex shows min stay 3 and stop sell', p2[day(31)]?.min_stay_arrival === 3 && p2[day(34)]?.stop_sell === true, JSON.stringify(p2).slice(0, 400));

// 3b. One Rate update save holding several ranges (how tests 3-8 are run) leaves as ONE call.
since = new Date().toISOString();
r = await call('POST', '/api/rates/bulk', { unitIds: [UID], channels: ['web'], lines: [
  { from: day(50), to: day(59), baseRate: 24100 },
  { from: day(59), to: day(65), baseRate: 31266, minStay: 2 },
  { from: day(66), to: day(70), minStay: 5, stopSell: false },
] });
check('three ranges saved in one go', r.status === 200, r.text);
await sleep(24_000);
c = await newCalls(since);
check('three ranges went as ONE call', c.length === 1 && c[0].kind === 'restrictions' && c[0].status < 300, JSON.stringify(c));
const rest3 = await chx(`/restrictions?filter[property_id]=${ids.propertyId}&filter[date][gte]=${day(50)}&filter[date][lte]=${day(70)}&filter[restrictions]=rate,min_stay_arrival`);
const p3 = rest3.json?.data?.[ids.ratePlanId] ?? {};
check('Channex shows each range (later range wins on the overlap night)', Number(p3[day(52)]?.rate) === 241 && Number(p3[day(59)]?.rate) === 312.66 && p3[day(60)]?.min_stay_arrival === 2 && p3[day(68)]?.min_stay_arrival === 5, JSON.stringify(p3).slice(0, 500));

// 4. Blocking dates closes availability.
since = new Date().toISOString();
r = await call('POST', '/api/blocks', { unitId: UID, from: day(40), to: day(42), reason: 'Queue test block' });
check('dates blocked', r.status === 201 || r.status === 200, r.text);
await sleep(24_000);
c = await newCalls(since);
check('block went as ONE availability call', c.length === 1 && c[0].kind === 'availability' && c[0].status < 300, JSON.stringify(c));
const av = await chx(`/availability?filter[property_id]=${ids.propertyId}&filter[date][gte]=${day(40)}&filter[date][lte]=${day(42)}`);
const avRoom = av.json?.data?.[ids.roomTypeId] ?? {};
check('Channex shows the blocked nights closed, check-out night open', avRoom[day(40)] === 0 && avRoom[day(41)] === 0 && avRoom[day(42)] === 1, JSON.stringify(avRoom));

// 5. The Full sync button: two calls; roles.
r = await call('POST', '/api/integrations/channex/full-sync', {}, 'housekeeper');
check('housekeeper cannot run a full sync (403)', r.status === 403, r.text);
since = new Date().toISOString();
r = await call('POST', '/api/integrations/channex/full-sync', {});
const mine = (r.json?.sent?.calls ?? []).filter(x => x.propertyId === PROP);
check('full sync button accepted for the test unit (one call per kind)', r.status === 200 && mine.length === 2 && mine.every(x => x.status < 300 && x.taskId), r.text.slice(0, 400));
c = await newCalls(since);
check('full sync button is 2 calls', c.length === 2 && c.every(x => x.fullSync), JSON.stringify(c));

// Clean up: unlink, delete the sandbox listing. Local rows are removed with SQL afterwards.
await call('PATCH', `/api/units/${UID}/channex-mapping`, { clear: true });
const del = await chx(`/properties/${ids.propertyId}`, { method: 'DELETE' });
check('sandbox listing deleted again', del.status === 200 || del.status === 204, JSON.stringify(del.json).slice(0, 200));
console.log(`   test unit ${UID} / building ${BID}`);

done();
