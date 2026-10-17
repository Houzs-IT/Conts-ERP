// Staff comment sheet UNIT (17 Oct 2026): unit purpose, beds, car park bays, unit delete, contract codes per purpose,
// extend-requires-file, the agreement generator and its template, Agent to let. Run against a fresh local database
// (scripts/dev-pglite.mjs) and a local server: API_BASE=http://localhost:8891 node scripts/api-checks/staff-units-contracts.mjs
import { call, check, done } from './harness.mjs';
const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const tag = Date.now().toString().slice(-6);

const props = (await call('GET', '/api/properties')).json;
const building = props.buildings[0];
const owners = (await call('GET', '/api/owners')).json.data;
const owner = owners[0];

// --- a new unit, with purpose, beds and bays ---
let r = await call('POST', '/api/units', { buildingId: building.id, ownerId: owner.id, unitCode: `T-${tag}`, purpose: 'rental' });
check('create unit', r.status === 201, r.text);
const id = r.json.id;
r = await call('PATCH', `/api/units/${id}`, { beds: [{ size: 'king', quantity: 1 }, { size: 'single', quantity: 2 }], parkingBays: [{ lotNumber: 'L2-105', level: 'P2' }, { lotNumber: 'L2-106' }, { lotNumber: 'B1-7' }] });
check('save beds and three bays', r.status === 200, r.text);
r = await call('PATCH', `/api/units/${id}`, { beds: [{ size: 'king', quantity: 1 }, { size: 'king', quantity: 2 }] });
check('a bed size twice is refused', r.status === 422 && r.json.error.fields?.beds, r.text);
r = await call('PATCH', `/api/units/${id}`, { parkingBays: [{ lotNumber: ' ' }] });
check('a bay with no lot number is refused', r.status === 422, r.text);
let u = (await call('GET', '/api/properties')).json.units.find(x => x.id === id);
check('beds read back as "1 King · 2 Single"', u.bedsLabel === '1 King · 2 Single', u.bedsLabel);
check('bays read back with count and lots', u.parkingLabel === '3 bays: L2-105 (P2), L2-106, B1-7', u.parkingLabel);
check('purpose defaults to rental', u.purpose === 'rental', u.purpose);

// --- contract codes follow the purpose ---
const draft = { revenueModel: 'management', contractCode: 'PS', ownerPct: 75, managementPct: 25, agentPct: 0, startsOn: '2026-01-01', endsOn: '2026-12-31', mode: 'update' };
r = await call('PUT', `/api/units/${id}/contract`, { ...draft, revenueModel: 'master_lease', contractCode: 'WH', monthlyRent: 200000 });
check('a rental unit cannot take WH', r.status === 422 && r.json.error.fields?.contractCode, r.text);
r = await call('PUT', `/api/units/${id}/contract`, draft);
check('a rental unit takes PS', r.status === 200, r.text);
r = await call('GET', `/api/units/${id}/contract`);
check('contract reads back PS, and the rental codes are offered', r.json.current.contractCode === 'PS' && r.json.allowedCodes.includes('PS YGRR') && !r.json.allowedCodes.includes('WH'), JSON.stringify(r.json.allowedCodes));

// --- purpose change refused while the contract does not fit, then ends it ---
r = await call('PATCH', `/api/units/${id}`, { purpose: 'warehouse' });
check('warehouse refused while on a PS contract (409 CONTRACT_MISMATCH)', r.status === 409 && r.json.error.code === 'CONTRACT_MISMATCH', r.text);
r = await call('PATCH', `/api/units/${id}`, { purpose: 'warehouse', endContract: true, usedBy: 'inhouse_reno' });
check('warehouse with "end the contract" saves', r.status === 200, r.text);
r = await call('GET', `/api/units/${id}/contract`);
check('the PS contract is in the history, no contract in force, only WH offered', r.json.current.id === null && r.json.history.length === 1 && r.json.allowedCodes.join() === 'WH', JSON.stringify({ c: r.json.current.id, h: r.json.history.length, a: r.json.allowedCodes }));
r = await call('PUT', `/api/units/${id}/contract`, { ...draft, contractCode: 'PS', mode: 'new', startsOn: '2027-01-01' });
check('a warehouse cannot take PS', r.status === 422, r.text);
r = await call('PUT', `/api/units/${id}/contract`, { revenueModel: 'master_lease', contractCode: 'WH', monthlyRent: 250000, startsOn: '2027-01-01', endsOn: '2027-12-31', mode: 'update' });
check('a warehouse takes a WH lease', r.status === 200, r.text);

// --- a warehouse is kept off the channels ---
r = await call('PUT', '/api/rates', { unitId: id, baseRate: 20000 });
check('no nightly price on a warehouse (409 NOT_RENTAL)', r.status === 409 && r.json.error.code === 'NOT_RENTAL', r.text);
r = await call('POST', `/api/units/${id}/channex-setup`, {});
check('no Channex setup on a warehouse', r.status === 409 || r.status === 501, r.text);
r = await call('PATCH', `/api/units/${id}/channex-mapping`, { channexPropertyId: 'p', channexRoomTypeId: 'r', channexRatePlanId: 'x' });
check('no Channex mapping on a warehouse (409 NOT_RENTAL)', r.status === 409 && r.json.error.code === 'NOT_RENTAL', r.text);
r = await call('POST', '/api/reservations', { unitId: id, checkIn: '2027-02-01', checkOut: '2027-02-03', channel: 'direct', guest: { fullName: 'Test Guest' } });
check('no reservation on a warehouse (409 NOT_RENTAL)', r.status === 409 && r.json.error.code === 'NOT_RENTAL', r.text);
r = await call('GET', '/api/reservations/calendar?from=2027-02-01&to=2027-02-05');
check('the warehouse is not on the reservations calendar', r.status === 200 && !JSON.stringify(r.json).includes(id), r.status);
r = await call('GET', '/api/pricing/rules');
check('the warehouse is not on the pricing screen', r.status === 200 && !JSON.stringify(r.json).includes(id), r.status);

// --- extend requires the new agreement file ---
r = await call('POST', `/api/units/${id}/contract-extend`, { startsOn: '2028-01-01', endsOn: '2028-12-31' });
check('extend without a file is refused (documentId)', r.status === 422 && r.json.error.fields?.documentId, r.text);
const fd = new FormData();
fd.append('file', new Blob(['%PDF-1.4 renewal memo'], { type: 'application/pdf' }), 'renewal-2028.pdf'); fd.append('unitId', id); fd.append('kind', 'contract');
const { cookieFor } = await import('./harness.mjs');
const up = await fetch(`${BASE}/api/documents`, { method: 'POST', headers: { cookie: cookieFor('management') }, body: fd });
const doc = await up.json().catch(() => ({}));
check('upload the renewal memo', up.status === 201 && doc.id, JSON.stringify(doc));
r = await call('POST', `/api/units/${id}/contract-extend`, { documentId: doc.id, startsOn: '2027-06-01', endsOn: '2027-05-01' });
check('extend with an end before the start is refused', r.status === 422 && r.json.error.fields?.endsOn, r.text);
r = await call('POST', `/api/units/${id}/contract-extend`, { documentId: doc.id, startsOn: '2028-01-01', endsOn: '2028-12-31' });
check('extend with the file saves a new period', r.status === 201 && r.json.code === 'WH', r.text);
r = await call('GET', `/api/units/${id}/contract`);
const prev = r.json.history.find(h => h.startsOn?.startsWith('2027-01-01'));
check('new period in force, old one ends the day before and is kept', r.json.current.startsOn.startsWith('2028-01-01') && r.json.current.agreementDocumentId === doc.id && prev?.endsOn?.startsWith('2027-12-31'), JSON.stringify({ cur: r.json.current.startsOn, prev: prev?.endsOn }));
r = await call('POST', `/api/units/${id}/contract-extend`, { documentId: doc.id, startsOn: '2029-01-01' });
check('the same file cannot be reused for another period', r.status === 422, r.text);

// --- agreement generator ---
r = await call('GET', '/api/settings/agreement-template');
check('template v1 seeded with its placeholders', r.status === 200 && r.json.current?.version >= 1 && r.json.placeholders.some(p => p.key === 'owner_ic'), r.text.slice(0, 200));
r = await call('GET', `/api/units/${id}/agreement?check=1`);
check('generator says what is missing', r.status === 200 && Array.isArray(r.json.missing), r.text);
const missing = r.json.missing.map(m => m.key);
if (missing.length) {
  r = await call('GET', `/api/units/${id}/agreement`);
  check('generate with missing details is refused (409 INCOMPLETE)', r.status === 409 && r.json.error.code === 'INCOMPLETE', r.text);
}
r = await call('POST', '/api/settings/agreement-template', { title: 'Short test agreement', body: `Unit {{unit_code}} at {{building}}, {{model_code}}, from {{start_date}} to {{end_date}}. Owner {{owner_name}}.\n\n# Rent\n{{monthly_rent}}` });
check('management saves template v2', r.status === 201 && r.json.version >= 2, r.text);
r = await call('POST', '/api/settings/agreement-template', { title: 'x', body: 'Hello {{not_a_field}}' });
check('an unknown placeholder is refused', r.status === 422, r.text);
r = await call('POST', '/api/settings/agreement-template', { title: 'x', body: 'x' }, 'finance_admin');
check('finance cannot change the template', r.status === 403, r.text);
r = await call('GET', `/api/units/${id}/agreement?check=1`);
check('with the short template nothing is missing', r.json.ready === true, JSON.stringify(r.json.missing));
r = await call('GET', `/api/units/${id}/agreement`);
check('agreement generated as a print page with the unit, code and rent filled', r.status === 200 && r.text.includes(`T-${tag}`) && r.text.includes('WH') && r.text.includes('RM 2,500.00 a month'), r.text.slice(0, 300));
r = await call('GET', `/api/units/${id}/agreement`, undefined, 'operations_staff');
// 401 where the local demo data has no operations-staff login (seed.sql in CI has one): refused either way.
check('operations staff cannot generate', r.status === 403 || r.status === 401, r.status);

// --- Agent to let ---
r = await call('POST', '/api/lettings', { unitId: id, status: 'rented', tenantName: 'Tan' });
check('rented without dates and rent is refused', r.status === 422 && r.json.error.fields?.endsOn && r.json.error.fields?.monthlyRent, r.text);
const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
r = await call('POST', '/api/lettings', { unitId: id, status: 'rented', tenantName: 'Tan Ah Kow', startsOn: '2026-01-01', endsOn: soon, monthlyRent: 180000, agentFee: 90000 });
check('record a rented letting', r.status === 201, r.text);
const lid = r.json.id;
r = await call('GET', `/api/lettings?unitId=${id}`);
check('ending in 60 days is flagged to remind (90-day window)', r.json.data[0]?.remind === true && r.json.data[0].daysLeft <= 90, JSON.stringify(r.json.data[0]));
r = await call('PATCH', `/api/lettings/${lid}`, { status: 'closed' });
check('close the letting', r.status === 200, r.text);

// --- delete: refused with history, allowed for a bare unit ---
r = await call('DELETE', `/api/units/${id}`);
check('delete refused: unit has a contract and a letting (409)', r.status === 409 && /contract/.test(r.json.error.message) && /Blocked/.test(r.json.error.message), r.text);
r = await call('POST', '/api/units', { buildingId: building.id, ownerId: owner.id, unitCode: `D-${tag}` });
const bare = r.json.id;
await call('PATCH', `/api/units/${bare}`, { parkingBays: [{ lotNumber: 'X1' }] });
r = await call('DELETE', `/api/units/${bare}`, undefined, 'operations_staff');
check('operations staff cannot delete a unit', r.status === 403 || r.status === 401, r.status);
r = await call('DELETE', `/api/units/${bare}`);
check('a bare unit is deleted', r.status === 200, r.text);
r = await call('GET', '/api/properties');
check('deleted unit gone from the list', !r.json.units.some(x => x.id === bare), '');
const withStays = (await call('GET', '/api/reservations?pageSize=1')).json?.data?.[0]?.unitId;
if (withStays) {
  r = await call('DELETE', `/api/units/${withStays}`);
  check('a unit with reservations is refused (409)', r.status === 409 && /reservation/.test(r.json.error.message), r.text);
}
done();
