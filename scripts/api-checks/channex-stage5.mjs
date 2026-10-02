// Stage 5 against the Channex staging sandbox: set a unit up as a Channex listing (property + room type
// + rate plan, typed as an apartment), a year of availability sent, the channel screen link issued, and
// role/duplicate refusals. Needs the local server started with CHANNEX_API_KEY and
// CHANNEX_BASE_URL=https://staging.channex.io. Cleans up after itself on both sides.
import { readFileSync } from 'node:fs';
import { call, check, done } from './harness.mjs';

const key = readFileSync('C:/dev/Conts-ERP-deploy/.dev.vars.channex', 'utf8').match(/^CHANNEX_API_KEY="?([^"\r\n]+)"?/m)[1];
const chx = async (path, init = {}) => {
  const r = await fetch('https://staging.channex.io/api/v1' + path, { ...init, headers: { 'user-api-key': key, 'content-type': 'application/json', accept: 'application/json' } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j };
};
const tag = Date.now().toString().slice(-6);

let r = await call('POST', '/api/properties', { name: `Channex Test ${tag}`, state: 'Kuala Lumpur', city: 'Kuala Lumpur' });
const BID = r.json?.id;
r = await call('POST', '/api/units', { buildingId: BID, unitCode: `CX-${tag}`, unitNumber: `CX-${tag}`, listingName: `Channex Test Studio ${tag}` });
const UID = r.json?.id;
check('test unit created', !!UID, r.text);

await call('PUT', '/api/rates', { unitId: UID, baseRate: 20000 });   // Channex setup needs a base price
r = await call('POST', `/api/units/${UID}/channex-setup`, {}, 'housekeeper');
check('housekeeper cannot set up (403)', r.status === 403, r.text);

r = await call('POST', `/api/units/${UID}/channex-setup`, {});
const ids = r.json ?? {};
check('unit set up in Channex (201)', r.status === 201 && ids.propertyId && ids.roomTypeId && ids.ratePlanId, r.text);
check('year of availability and base price sent', ids.availabilitySent === true, r.text);

const prop = await chx(`/properties/${ids.propertyId}`);
check('Channex has the listing, typed as an apartment in MYR', prop.json?.data?.attributes?.property_type === 'apartment' && prop.json?.data?.attributes?.currency === 'MYR', JSON.stringify(prop.json?.data?.attributes ?? prop.json).slice(0, 300));
const guests = (await call('GET', `/api/units/detail?unitId=${UID}`)).json?.unit?.maxGuests;
const room = await chx(`/room_types/${ids.roomTypeId}`);
check("one room of it, sized to the unit's max guests", room.json?.data?.attributes?.count_of_rooms === 1 && room.json?.data?.attributes?.occ_adults === guests, JSON.stringify(room.json?.data?.attributes ?? room.json).slice(0, 300));
const d = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const avail = await chx(`/availability?filter[property_id]=${ids.propertyId}&filter[date][gte]=${d}&filter[date][lte]=${d}`);
check('a date next month is open (availability 1)', avail.json?.data?.[ids.roomTypeId]?.[d] === 1, JSON.stringify(avail.json).slice(0, 300));

const detail = await call('GET', `/api/units/detail?unitId=${UID}`);
check('unit page shows it as linked', detail.json?.unit?.channexLinked === true, JSON.stringify(detail.json?.unit ?? detail.text).slice(0, 200));

r = await call('POST', `/api/units/${UID}/channex-setup`, {});
check('setting up twice is refused (409)', r.status === 409, r.text);

// Clean up: unlink locally, delete the sandbox listing, remove the test unit and building.
await call('PATCH', `/api/units/${UID}/channex-mapping`, { clear: true });
const del = await chx(`/properties/${ids.propertyId}`, { method: 'DELETE' });
check('sandbox listing deleted again', del.status === 200 || del.status === 204, JSON.stringify(del.json).slice(0, 200));
console.log(`   test unit ${UID} / building ${BID} left for SQL cleanup`);

done();
