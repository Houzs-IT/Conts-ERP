// Import from Airbnb, against the staging sandbox: roles, the listing feed, sign-in link, refusals before any
// Airbnb account is connected, and the unit's standing minimum nights reaching Channex. The sandbox has no
// Airbnb account, so mapping a real listing is NOT covered here; that needs a real Airbnb sign-in.
// Needs the local server started with CHANNEX_API_KEY and CHANNEX_BASE_URL=https://staging.channex.io.
import { readFileSync } from 'node:fs';
import { call, check, done } from './harness.mjs';

const key = readFileSync('C:/dev/Conts-ERP-deploy/.dev.vars.channex', 'utf8').split(/\r?\n/).find(l => l.startsWith('CHANNEX_API_KEY=')).slice(16).replace(/^"|"$/g, '');
const chx = async (path, init = {}) => { const r = await fetch('https://staging.channex.io/api/v1' + path, { ...init, headers: { 'user-api-key': key, 'content-type': 'application/json' } }); return { status: r.status, json: await r.json().catch(() => null) }; };
const tag = Date.now().toString().slice(-6);
const day = n => new Date(Date.now() + 8 * 36e5 + n * 864e5).toISOString().slice(0, 10);
const IMPORT = '/api/integrations/channex/airbnb-import';

let r = await call('GET', IMPORT, undefined, 'housekeeper');
check('housekeeper cannot open the import (403)', r.status === 403, r.text);
r = await call('GET', IMPORT);
check('import feed lists buildings, owners and unlinked units', r.status === 200 && Array.isArray(r.json?.buildings) && Array.isArray(r.json?.owners) && Array.isArray(r.json?.units) && Array.isArray(r.json?.listings), r.text.slice(0, 300));
const connected = !!r.json?.channelId;
console.log(`   Airbnb account connected on this sandbox: ${connected} (${r.json?.listings?.length ?? 0} listings)`);
const OWNER = r.json?.owners?.[0]?.id;

r = await call('POST', '/api/properties', { name: `Airbnb Import ${tag}`, state: 'Kuala Lumpur', city: 'Kuala Lumpur' });
const BID = r.json?.id;
r = await call('POST', '/api/units', { buildingId: BID, unitCode: `AI-${tag}`, unitNumber: `AI-${tag}`, listingName: `Airbnb Import Studio ${tag}` });
const UID = r.json?.id;
await call('PUT', '/api/rates', { unitId: UID, baseRate: 20000 });

r = await call('PUT', '/api/rates', { unitId: UID, minStay: 0 });
check('minimum nights of 0 refused (422)', r.status === 422, r.text);
r = await call('PUT', '/api/rates', { unitId: UID, minStay: 3 });
check('standing minimum nights saved', r.status === 200, r.text);
r = await call('GET', '/api/pricing/rules');
check('Pricing shows the standing minimum nights', (r.json?.data ?? r.json?.units ?? []).some(u => (u.unitId ?? u.id) === UID && u.minStay === 3), r.text.slice(0, 200));
r = await call('GET', `/api/reservations/calendar?from=${day(0)}&to=${day(14)}`);
check('Calendar carries the unit minimum nights', r.json?.unitMinStay?.[UID] === 3, JSON.stringify(r.json?.unitMinStay ?? null));

r = await call('POST', `/api/units/${UID}/channex-setup`, {});
const ids = r.json ?? {};
check('unit set up in Channex (shared set-up code)', r.status === 201 && ids.availabilitySent === true, r.text);
r = await call('POST', '/api/rates/bulk', { unitIds: [UID], lines: [{ from: day(12), to: day(12), minStay: 5 }, { from: day(11), to: day(11), minStay: null }] });
check('a night given its own minimum stay, another cleared', r.status === 200, r.text);
await new Promise(res => setTimeout(res, 20000));   // the queue waits for a quiet period before sending
const rest = (await chx(`/restrictions?filter[property_id]=${ids.propertyId}&filter[date][gte]=${day(10)}&filter[date][lte]=${day(12)}&filter[restrictions]=min_stay_arrival`)).json?.data ?? {};
const mins = d => Object.values(rest).map(byDate => byDate?.[d]?.min_stay_arrival).filter(v => v !== undefined);
check('Channex has the standing minimum nights (3) on an ordinary night', mins(day(10)).length > 0 && mins(day(10)).every(v => Number(v) === 3), JSON.stringify(rest).slice(0, 300));
check("a night's own minimum stay (5) still wins", mins(day(12)).length > 0 && mins(day(12)).every(v => Number(v) === 5), JSON.stringify(mins(day(12))));
check('a cleared night goes back to the standing minimum nights (3)', mins(day(11)).length > 0 && mins(day(11)).every(v => Number(v) === 3), JSON.stringify(mins(day(11))));

r = await call('POST', `${IMPORT}/sign-in`, {}, 'housekeeper');
check('housekeeper cannot start the Airbnb sign-in (403)', r.status === 403, r.text);
r = await call('POST', `${IMPORT}/sign-in`, {});
check('account sign-in link issued', r.status === 200 && (/^https:\/\//.test(r.json?.url ?? '') || !!r.json?.channelId), r.text.slice(0, 300));

r = await call('POST', IMPORT, { title: 'x', baseRate: 10000, buildingId: BID, ownerId: OWNER });
check('import without a listing refused (422)', r.status === 422, r.text);
r = await call('POST', IMPORT, { listingId: '999', title: 'x', buildingId: BID, ownerId: OWNER });
check('import without a price refused (422)', r.status === 422 && !!r.json?.error?.fields?.baseRate, r.text);
r = await call('POST', IMPORT, { listingId: '999', title: 'x', baseRate: 10000, minStay: 99, buildingId: BID, ownerId: OWNER });
check('import with 99 minimum nights refused (422)', r.status === 422, r.text);

if (!connected) {
  r = await call('POST', IMPORT, { listingId: '999', title: 'x', baseRate: 10000, buildingId: BID, ownerId: OWNER });
  check('import refused until an Airbnb account is signed in (409)', r.status === 409 && r.json?.error?.code === 'NOT_CONNECTED', r.text);
  r = await call('GET', `${IMPORT}/listing?listingId=999`);
  check('listing price lookup refused until signed in (409)', r.status === 409, r.text);
} else {
  const before = (await call('GET', '/api/units')).json?.data?.length;
  r = await call('POST', IMPORT, { listingId: `nope-${tag}`, title: `Ghost ${tag}`, baseRate: 10000, weekendRate: 15000, minStay: 2, buildingId: BID, unitCode: `GH-${tag}`, ownerId: OWNER });
  check('an unknown listing is refused by Airbnb', r.status >= 400, r.text.slice(0, 300));
  const after = (await call('GET', '/api/units')).json?.data?.length;
  check('the unit made for a refused listing is removed again', before === after, `${before} -> ${after}`);
}

await call('PATCH', `/api/units/${UID}/channex-mapping`, { clear: true });
const del = await chx(`/properties/${ids.propertyId}`, { method: 'DELETE' });
check('sandbox listing deleted again', del.status === 200 || del.status === 204, String(del.status));
console.log(`   test unit ${UID} / building ${BID}`);

done();
