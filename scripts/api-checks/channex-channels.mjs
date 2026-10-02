// Channel connections through Channex's Channel API, against the staging sandbox: Hotel ID lookup for
// Booking.com (refusal for an unknown id, rooms and rates for Channex's shared test hotels), connecting
// one when a test hotel is free, the Airbnb sign-in link, and role / not-set-up refusals. Needs the local
// server started with CHANNEX_API_KEY and CHANNEX_BASE_URL=https://staging.channex.io. Cleans up after itself.
import { readFileSync } from 'node:fs';
import { call, check, done } from './harness.mjs';

const key = readFileSync('C:/dev/Conts-ERP-deploy/.dev.vars.channex', 'utf8').split(/\r?\n/).find(l => l.startsWith('CHANNEX_API_KEY=')).slice(16).replace(/^"|"$/g, '');
const chx = (path, init = {}) => fetch('https://staging.channex.io/api/v1' + path, { ...init, headers: { 'user-api-key': key, 'content-type': 'application/json' } });
const tag = Date.now().toString().slice(-6);

let r = await call('POST', '/api/properties', { name: `Channex Channels ${tag}`, state: 'Kuala Lumpur', city: 'Kuala Lumpur' });
const BID = r.json?.id;
r = await call('POST', '/api/units', { buildingId: BID, unitCode: `CC-${tag}`, unitNumber: `CC-${tag}`, listingName: `Channex Channels Studio ${tag}` });
const UID = r.json?.id;

await call('PUT', '/api/rates', { unitId: UID, baseRate: 20000 });   // Channex setup needs a base price
r = await call('POST', `/api/units/${UID}/channels/lookup`, { ota: 'booking_com', hotelId: '5868189' });
check('lookup refused before the unit is in Channex (409)', r.status === 409, r.text);
r = await call('POST', `/api/units/${UID}/channex-setup`, {});
const ids = r.json ?? {};
check('unit set up in Channex', r.status === 201, r.text);

r = await call('POST', `/api/units/${UID}/channels/lookup`, { ota: 'booking_com', hotelId: '5868189' }, 'housekeeper');
check('housekeeper cannot look up hotels (403)', r.status === 403, r.text);
r = await call('POST', `/api/units/${UID}/channels/lookup`, { ota: 'booking_com', hotelId: 'abc' });
check('non-numeric Hotel ID refused (422)', r.status === 422, r.text);
r = await call('POST', `/api/units/${UID}/channels/lookup`, { ota: 'booking_com', hotelId: '1' + tag + '99' });
check('unknown Hotel ID refused with a clear message', r.status === 422 && r.json?.error?.code === 'HOTEL_NOT_READY', r.text.slice(0, 300));

// Channex's shared test hotels are often held by other testers; try each until one connects.
let found = null, anyRooms = false;
for (const hotelId of ['5868189', '6519420', '4372137', '10484818']) {
  r = await call('POST', `/api/units/${UID}/channels/lookup`, { ota: 'booking_com', hotelId });
  console.log(`   lookup ${hotelId}: ${r.status} ${r.text.slice(0, 120)}`);
  if (r.status !== 200 || !r.json?.rooms?.length) continue;
  anyRooms = true;
  const room = r.json.rooms.find(x => x.rates.length), rate = room.rates[0];
  const c = await call('POST', `/api/units/${UID}/channels`, { ota: 'booking_com', hotelId, roomId: room.id, roomTitle: room.title, rateId: rate.id, rateTitle: rate.title, occupancy: rate.maxPersons, pricingType: rate.pricing, readonly: rate.readonly });
  console.log(`   connect ${hotelId}: ${c.status} ${c.text.slice(0, 200)}`);
  if (c.status === 409 && c.json?.error?.code === 'HOTEL_TAKEN') continue;
  found = { hotelId, room, rate, res: c };
  break;
}
check('a Channex test hotel returns its Booking.com rooms and rates', anyRooms, 'all test hotels refused or empty');

if (found) {
  const { room, rate } = found;
  r = found.res;
  if (r.status === 201) {
    const list = await call('GET', `/api/units/${UID}/channels`);
    check('connection listed on the unit', list.json?.data?.some(c => c.ota === 'booking_com' && c.externalId === found.hotelId), list.text);
    r = await call('POST', `/api/units/${UID}/channels`, { ota: 'booking_com', hotelId: found.hotelId, roomId: room.id, rateId: rate.id });
    check('connecting Booking.com twice refused (409)', r.status === 409, r.text);
    const row = list.json.data.find(c => c.ota === 'booking_com');
    r = await call('DELETE', `/api/units/${UID}/channels/${row.id}`);
    check('disconnect removes it (and frees the shared test hotel)', r.status === 200 && !(await call('GET', `/api/units/${UID}/channels`)).json?.data?.length, r.text);
  } else {
    check('connect refusal is a clear Channex message, nothing stored', r.status >= 400 && !(await call('GET', `/api/units/${UID}/channels`)).json?.data?.length, r.text.slice(0, 300));
  }
}

r = await call('POST', `/api/units/${UID}/channels/airbnb-link`, {});
check('Airbnb sign-in link issued', r.status === 200 && (/^https:\/\//.test(r.json?.url ?? '') || !!r.json?.channelId), r.text.slice(0, 300));
console.log(`   airbnb link: ${(r.json?.url ?? r.json?.channelId ?? '').slice(0, 90)}`);

await call('PATCH', `/api/units/${UID}/channex-mapping`, { clear: true });
const del = await chx(`/properties/${ids.propertyId}`, { method: 'DELETE' });
check('sandbox listing deleted again', del.status === 200 || del.status === 204, String(del.status));
console.log(`   test unit ${UID} / building ${BID}`);

done();
