// Each booking site gets its own price, against the Channex staging sandbox: a unit set up in Channex has
// four rate plans (Direct, Airbnb, Booking.com, Agoda); the full sync sends each one its channel's price
// (the night's web price + uplift; Fri/Sat use the unit's weekend rate) in the same single call; a price set for one channel goes
// only to that channel's plan; a minimum stay goes to all of them; an uplift change re-sends that unit's
// prices. Needs the local server started with CHANNEX_API_KEY and CHANNEX_BASE_URL=https://staging.channex.io.
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
const weekday = d => new Date(`${d}T00:00:00Z`).getUTCDay();
// A Tuesday and a Saturday a few weeks out.
let TUE = null, SAT = null;
for (let n = 20; n < 40; n++) { const d = day(n); if (weekday(d) === 2 && !TUE) TUE = d; if (weekday(d) === 6 && !SAT) SAT = d; }
const tag = Date.now().toString().slice(-6);

let r = await call('POST', '/api/properties', { name: `Channex Prices ${tag}`, state: 'Kuala Lumpur', city: 'Kuala Lumpur' });
const BID = r.json?.id;
r = await call('POST', '/api/units', { buildingId: BID, ownerId: (await call('GET', '/api/owners')).json.data[0].id, unitCode: `CP-${tag}`, unitNumber: `CP-${tag}`, listingName: `Channex Prices Studio ${tag}` });
const UID = r.json?.id;

r = await call('POST', `/api/units/${UID}/channex-setup`, {});
check('setup refused without a base price (409 NO_BASE_PRICE)', r.status === 409 && r.json?.error?.code === 'NO_BASE_PRICE', r.text);
await call('PUT', '/api/rates', { unitId: UID, baseRate: 20000 });
await call('PUT', '/api/rates', { unitId: UID, weekendRate: 24400 });
await call('PUT', '/api/rates', { unitId: UID, channel: 'airbnb', uplift: 2800 });
await call('PUT', '/api/rates', { unitId: UID, channel: 'booking_com', uplift: 4200 });
await call('PUT', '/api/rates', { unitId: UID, channel: 'agoda', uplift: 3700 });

const since = new Date().toISOString();
r = await call('POST', `/api/units/${UID}/channex-setup`, {});
const ids = r.json ?? {};
check('unit set up, full sync accepted', r.status === 201 && ids.availabilitySent === true, r.text);
const status = await call('GET', '/api/integrations/channex/status');
const mine = (status.json?.recentCalls ?? []).filter(c => c.calledAt > since && c.propertyId === ids.propertyId);
check('still exactly 2 calls for the unit (all four price lists in one)', mine.length === 2 && mine.every(c => c.status < 300), JSON.stringify(mine));

const plans = (await chx(`/rate_plans?filter[property_id]=${ids.propertyId}`)).json?.data ?? [];
const planId = title => plans.find(p => p.attributes?.title === title)?.id;
check('Channex has four rate plans: Direct, Airbnb, Booking.com, Agoda', ['Direct', 'Airbnb', 'Booking.com', 'Agoda'].every(planId), plans.map(p => p.attributes?.title).join(','));

const read = async (from, to) => (await chx(`/restrictions?filter[property_id]=${ids.propertyId}&filter[date][gte]=${from}&filter[date][lte]=${to}&filter[restrictions]=rate,min_stay_arrival`)).json?.data ?? {};
let v = await read(TUE, TUE);
const rate = (data, title, d) => Number(data?.[planId(title)]?.[d]?.rate);
check('weekday: Direct 200, Airbnb 228, Booking.com 242, Agoda 237', rate(v, 'Direct', TUE) === 200 && rate(v, 'Airbnb', TUE) === 228 && rate(v, 'Booking.com', TUE) === 242 && rate(v, 'Agoda', TUE) === 237,
  `${rate(v, 'Direct', TUE)} ${rate(v, 'Airbnb', TUE)} ${rate(v, 'Booking.com', TUE)} ${rate(v, 'Agoda', TUE)}`);
v = await read(SAT, SAT);
check('Saturday uses the weekend rate: Direct 244, Airbnb 244 + 28 = 272', rate(v, 'Direct', SAT) === 244 && rate(v, 'Airbnb', SAT) === 272, `${rate(v, 'Direct', SAT)} ${rate(v, 'Airbnb', SAT)}`);

// The Calendar shows the same numbers.
const cal = await call('GET', `/api/reservations/calendar?from=${TUE}&to=${TUE}`);
check('calendar carries the uplifts and the weekend rate', cal.json?.uplifts?.[`${UID}:airbnb`] === 2800 && cal.json?.weekendRate?.[UID] === 24400, JSON.stringify({ u: cal.json?.uplifts?.[`${UID}:airbnb`], w: cal.json?.weekendRate?.[UID] }));

// A price for one channel goes only to that channel's plan; a minimum stay goes to all of them.
r = await call('PUT', '/api/rates', { unitId: UID, channel: 'airbnb', date: TUE, rate: 30000 });
check('Airbnb price for one night saved', r.status === 200, r.text);
r = await call('POST', '/api/rates/bulk', { unitIds: [UID], lines: [{ from: TUE, to: TUE, minStay: 3 }] });
check('minimum stay saved', r.status === 200, r.text);
await sleep(24_000);
v = await read(TUE, TUE);
check('only the Airbnb plan changed price (300), Direct stays 200', rate(v, 'Airbnb', TUE) === 300 && rate(v, 'Direct', TUE) === 200 && rate(v, 'Booking.com', TUE) === 242, `${rate(v, 'Airbnb', TUE)} ${rate(v, 'Direct', TUE)} ${rate(v, 'Booking.com', TUE)}`);
check('minimum stay 3 on every plan', ['Direct', 'Airbnb', 'Booking.com', 'Agoda'].every(t => v?.[planId(t)]?.[TUE]?.min_stay_arrival === 3), JSON.stringify(v).slice(0, 300));

// Changing an uplift re-sends that unit's prices.
await call('PUT', '/api/rates', { unitId: UID, channel: 'agoda', uplift: 5000 });
await sleep(24_000);
const WED = new Date(Date.parse(`${TUE}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
v = await read(WED, WED);
check('Agoda uplift change reaches Channex (250), others unchanged', rate(v, 'Agoda', WED) === 250 && rate(v, 'Airbnb', WED) === 228, `${rate(v, 'Agoda', WED)} ${rate(v, 'Airbnb', WED)}`);

await call('PATCH', `/api/units/${UID}/channex-mapping`, { clear: true });
const del = await chx(`/properties/${ids.propertyId}`, { method: 'DELETE' });
check('sandbox listing deleted again', del.status === 200 || del.status === 204, String(del.status));
console.log(`   test unit ${UID} / building ${BID}`);
done();
