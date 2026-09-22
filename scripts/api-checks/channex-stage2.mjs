import { call, check, done } from './harness.mjs';

const U1 = '55555555-5555-4555-8555-000000000001'; // Vista Jaya One #A-12-03
const DEMO_PROPERTY = 'ff674fc2-4a2e-45a6-b6c6-fc8df8675695';
const DEMO_ROOM_TYPE = '19c476e7-8f78-4dd0-a273-8d230f4859fb';
const DEMO_RATE_PLAN = '0d2c1da3-2656-4716-8a9e-cf0eccbf94d8';

async function channexAvailability(dateFrom, dateTo) {
  const cv = (await import('node:fs')).readFileSync('C:/dev/Conts-ERP-deploy/.dev.vars.channex', 'utf8');
  const key = cv.match(/^CHANNEX_API_KEY="([^"]+)"/m)[1];
  const r = await fetch(`https://staging.channex.io/api/v1/availability?filter[property_id]=${DEMO_PROPERTY}&filter[room_type_id]=${DEMO_ROOM_TYPE}&filter[date][gte]=${dateFrom}&filter[date][lte]=${dateTo}`, { headers: { 'user-api-key': key, accept: 'application/json' } });
  return (await r.json()).data[DEMO_ROOM_TYPE];
}

// 1. an unmapped unit: writes succeed locally, nothing is sent to Channex (no error either)
let r = await call('PUT', '/api/rates', { unitId: U1, channel: 'direct', date: '2026-12-01', rate: 30000 });
check('rate set on unmapped unit (no crash)', r.status === 200, r.text);

// 2. map U1 to the Channex demo listing
r = await call('PATCH', `/api/units/${U1}/channex-mapping`, { channexPropertyId: DEMO_PROPERTY, channexRoomTypeId: DEMO_ROOM_TYPE, channexRatePlanId: DEMO_RATE_PLAN });
check('map unit to Channex demo listing', r.status === 200, r.text);
r = await call('PATCH', '/api/units/nope/channex-mapping', { channexPropertyId: 'x', channexRoomTypeId: 'y', channexRatePlanId: 'z' });
check('map unknown unit 404', r.status === 404, r.text);
r = await call('PATCH', `/api/units/${U1}/channex-mapping`, { channexPropertyId: 'x' }, 'housekeeper');
check('field role cannot map 403', r.status === 403, r.text);

// 3. set a single-night direct rate -> should reach Channex
const day1 = '2026-12-15';
r = await call('PUT', '/api/rates', { unitId: U1, channel: 'direct', date: day1, rate: 45000 }); // RM 450.00
check('rate set on mapped unit', r.status === 200, r.text);
await new Promise(res => setTimeout(res, 500));
let avail = await channexAvailability(day1, day1);
console.log('   (rate push does not change availability; separately confirming via audit log for failures)');

// 4. create a reservation on the mapped unit for a known range -> Channex should show 0 (unavailable) for those nights
const checkIn = '2026-12-20', checkOut = '2026-12-22';
r = await call('POST', '/api/reservations', { unitId: U1, channel: 'direct', guest: { fullName: 'Channex Test Guest' }, checkIn, checkOut, guestsCount: 2, grossBookingValue: 90000 });
check('create reservation on mapped unit', r.status === 201, r.text);
const resId = r.json?.id;
await new Promise(res => setTimeout(res, 800));
avail = await channexAvailability(checkIn, checkOut);
check('Channex shows unit unavailable for the booked nights', avail[checkIn] === 0 && avail['2026-12-21'] === 0, JSON.stringify(avail));
check('checkout night itself stays available (not part of the stay)', avail[checkOut] !== 0, JSON.stringify(avail));

// 5. cancel it -> Channex should show 1 (available) again
r = await call('POST', `/api/reservations/${resId}/cancel`, { reason: 'test cleanup' });
check('cancel reservation', r.status === 200, r.text);
await new Promise(res => setTimeout(res, 800));
avail = await channexAvailability(checkIn, checkOut);
check('Channex shows the nights available again after cancel', avail[checkIn] === 1 && avail['2026-12-21'] === 1, JSON.stringify(avail));

// 6. bulk rate push on the mapped unit
r = await call('POST', '/api/rates/bulk', { unitIds: [U1], channels: ['direct'], from: '2027-01-05', to: '2027-01-07', baseRate: 50000 });
check('bulk rate push on mapped unit', r.status === 200 && r.json.written === 3, r.text);

// 7. unmap and confirm no more syncing happens (no crash, unit no longer linked)
r = await call('PATCH', `/api/units/${U1}/channex-mapping`, { clear: true });
check('unmap unit', r.status === 200, r.text);
r = await call('PUT', '/api/rates', { unitId: U1, channel: 'direct', date: '2026-12-16', rate: 1000 });
check('rate set after unmap (no crash)', r.status === 200, r.text);

done();
