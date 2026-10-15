// Building listings (migration 0117) against the Channex staging sandbox: units of one building become room types of
// one Channex property, the building screen lists them, and a Booking.com hotel is connected for the building with
// each room paired to a unit. Needs the local server started with CHANNEX_API_KEY and
// CHANNEX_BASE_URL=https://staging.channex.io on a throwaway database. Deletes what it made in Channex afterwards.
//   node scripts/api-checks/channex-buildings.mjs [bookingComTestHotelId]
import { readFileSync } from 'node:fs';
import { call, check, done } from './harness.mjs';

const key = readFileSync('C:/dev/Conts-ERP-deploy/.dev.vars.channex', 'utf8').match(/^CHANNEX_API_KEY="?([^"\r\n]+)"?/m)[1];
const chx = async (path, init = {}) => {
  const r = await fetch('https://staging.channex.io/api/v1' + path, { ...init, headers: { 'user-api-key': key, 'content-type': 'application/json', accept: 'application/json' } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j };
};
const tag = Date.now().toString().slice(-6);
const made = { properties: new Set(), channels: new Set() };

try {
  let r = await call('POST', '/api/properties', { name: `Building Test ${tag}`, state: 'Kuala Lumpur', city: 'Kuala Lumpur' });
  const BID = r.json?.id;
  check('test building created', !!BID, r.text);
  const units = [];
  for (const n of ['A-01', 'A-02', 'A-03']) {
    r = await call('POST', '/api/units', { buildingId: BID, unitCode: `${n}-${tag}`, unitNumber: `${n}-${tag}`, listingName: `Building Test ${n} ${tag}` });
    units.push(r.json?.id);
    await call('PUT', '/api/rates', { unitId: r.json?.id, baseRate: 20000 });
  }
  check('three test units created', units.every(Boolean));

  r = await call('GET', `/api/properties/${BID}/channels`);
  check('building screen before setup: no listing, no unit set up', r.status === 200 && r.json.channexListing === false && r.json.units.every(u => !u.setUp), r.text);
  r = await call('POST', `/api/properties/${BID}/channels/lookup`, { ota: 'booking_com', hotelId: '5868189' });
  check('Booking.com lookup refused before the building has a listing (409)', r.status === 409, r.text);

  r = await call('POST', `/api/units/${units[0]}/channex-setup`, {});
  const first = r.json ?? {};
  check('first unit set up (201) and creates the building listing', r.status === 201 && !!first.propertyId, r.text);
  if (first.propertyId) made.properties.add(first.propertyId);
  r = await call('POST', `/api/units/${units[1]}/channex-setup`, {});
  const second = r.json ?? {};
  if (second.propertyId) made.properties.add(second.propertyId);
  check('second unit goes into the same Channex property', r.status === 201 && second.propertyId === first.propertyId, r.text);
  check('each unit has its own room type and rate plan', second.roomTypeId && second.roomTypeId !== first.roomTypeId && second.ratePlanId !== first.ratePlanId, r.text);
  check('the second unit\'s dates and prices were sent', second.availabilitySent === true, r.text);

  const rooms = await chx(`/room_types?filter[property_id]=${first.propertyId}`);
  check('Channex shows one property with two room types', rooms.status === 200 && rooms.json?.data?.length === 2, JSON.stringify(rooms.json).slice(0, 300));
  const prop = await chx(`/properties/${first.propertyId}`);
  check('the Channex property is named after the building', prop.json?.data?.attributes?.title === `Building Test ${tag}`, prop.json?.data?.attributes?.title);

  r = await call('GET', `/api/properties/${BID}/channels`);
  const listed = r.json?.units ?? [];
  check('building screen: listing exists, two units set up, one not yet', r.json?.channexListing === true && listed.filter(u => u.setUp).length === 2 && listed.filter(u => !u.setUp).length === 1, r.text);

  r = await call('POST', `/api/properties/${BID}/channels`, { ota: 'booking_com', hotelId: '5868189', rooms: [{ unitId: units[2], roomId: '1', rateId: '1' }] });
  check('connecting a unit not set up yet is refused (409)', r.status === 409 && /Set .* up in Channex first/.test(r.json?.error?.message ?? r.text), r.text);
  r = await call('POST', `/api/properties/${BID}/channels`, { ota: 'booking_com', hotelId: '5868189', rooms: [{ unitId: units[0], roomId: '1', rateId: '1' }, { unitId: units[0], roomId: '2', rateId: '2' }] });
  check('one unit for two rooms is refused (422)', r.status === 422, r.text);
  r = await call('POST', `/api/properties/${BID}/channels`, { ota: 'booking_com', hotelId: '5868189', rooms: [{ unitId: units[0], roomId: '1', rateId: '1' }] }, 'housekeeper');
  check('housekeeper cannot connect a building (403)', r.status === 403, r.text);

  // A real connection needs one of Channex's shared test hotels to be free (support@channex.io frees them).
  const hotel = process.argv[2];
  if (!hotel) console.log('skip Booking.com connection: pass a free Channex test hotel id to run it');
  else {
    r = await call('POST', `/api/properties/${BID}/channels/lookup`, { ota: 'booking_com', hotelId: hotel });
    check('test hotel rooms found', r.status === 200 && r.json.rooms.length >= 2, r.text);
    const pairs = (r.json?.rooms ?? []).slice(0, 2).map((room, i) => ({ unitId: units[i], roomId: room.id, roomTitle: room.title, rateId: room.rates[0]?.id, rateTitle: room.rates[0]?.title }));
    r = await call('POST', `/api/properties/${BID}/channels`, { ota: 'booking_com', hotelId: hotel, pricingType: r.json?.pricingType, rooms: pairs });
    if (r.json?.channelId) made.channels.add(r.json.channelId);
    check('both units connected to the one Booking.com hotel in one go (201)', r.status === 201 && r.json.connected === 2, r.text);
    const channelId = r.json?.channelId;
    const ch = await chx(`/channels/${channelId}`);
    check('Channex: one channel, two rooms mapped', (ch.json?.data?.attributes?.rate_plans ?? []).length === 2, JSON.stringify(ch.json).slice(0, 300));
    // channexEnsureChannelProperty reads the channel's properties from here.
    check('Channex lists the building\'s property on the channel (attributes.properties)', (ch.json?.data?.attributes?.properties ?? []).includes(first.propertyId), JSON.stringify(ch.json?.data?.attributes?.properties));

    // A unit set up later joins the same hotel: its room is added to the channel that exists.
    r = await call('POST', `/api/units/${units[2]}/channex-setup`, {});
    check('third unit set up into the building listing', r.status === 201 && r.json?.propertyId === first.propertyId, r.text);
    const look = await call('POST', `/api/properties/${BID}/channels/lookup`, { ota: 'booking_com', hotelId: hotel });
    const third = look.json?.rooms?.[2];
    if (!third) console.log('skip adding a room later: the test hotel has fewer than three rooms');
    else {
      r = await call('POST', `/api/properties/${BID}/channels`, { ota: 'booking_com', hotelId: hotel, pricingType: look.json.pricingType,
        rooms: [{ unitId: units[2], roomId: third.id, roomTitle: third.title, rateId: third.rates[0]?.id, rateTitle: third.rates[0]?.title }] });
      check('a later unit is added to the same Booking.com connection (201)', r.status === 201 && r.json.addedToExisting === true && r.json.channelId === channelId, r.text);
      const ch2 = await chx(`/channels/${channelId}`);
      check('Channex: the channel now maps three rooms', (ch2.json?.data?.attributes?.rate_plans ?? []).length === 3, JSON.stringify(ch2.json?.data?.attributes?.rate_plans ?? []).slice(0, 300));
    }
    // Disconnecting one unit keeps the building's connection for the others.
    const row = (await call('GET', `/api/units/${units[0]}/channels`)).json?.data?.find(c => c.ota === 'booking_com');
    r = await call('DELETE', `/api/units/${units[0]}/channels/${row?.id}`);
    check('disconnecting one unit answers ok', r.status === 200, r.text);
    const ch3 = await chx(`/channels/${channelId}`);
    check('Channex: the connection stays on, without that unit\'s room', ch3.json?.data?.attributes?.is_active === true && (ch3.json?.data?.attributes?.rate_plans ?? []).length === (third ? 2 : 1), JSON.stringify(ch3.json?.data?.attributes ?? {}).slice(0, 300));
    r = await call('GET', `/api/properties/${BID}/channels`);
    check('building screen shows the Booking.com room of each unit still connected', (r.json?.units ?? []).filter(u => u.connections.some(c => c.ota === 'booking_com' && c.hotelId === hotel)).length === (third ? 2 : 1), r.text);
  }
} finally {
  // Channex deletes a channel only once it is switched off.
  for (const id of made.channels) { await chx(`/channels/${id}/deactivate`, { method: 'POST' }); await chx(`/channels/${id}`, { method: 'DELETE' }); }
  for (const id of made.properties) await chx(`/properties/${id}`, { method: 'DELETE' });
}
done();
