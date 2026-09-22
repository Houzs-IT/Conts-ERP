import { call, check, done } from './harness.mjs';
const tag = Date.now().toString().slice(-6);

// case 1: create a fresh owner with no unit -> delete succeeds
let r = await call('POST', '/api/owners', { displayName: `Delete Me ${tag}`, email: `delme${tag}@example.com` });
check('create owner (no units)', r.status === 201, r.text); const id1 = r.json?.id;
r = await call('DELETE', `/api/owners/${id1}`); check('delete empty owner succeeds', r.status === 200, r.text);
r = await call('GET', '/api/owners'); check('deleted owner gone from list', !r.json.data.some(o => o.id === id1), '');

// case 2: field role forbidden
r = await call('POST', '/api/owners', { displayName: `Delete Me2 ${tag}`, email: `delme2${tag}@example.com` });
const id2 = r.json?.id;
r = await call('DELETE', `/api/owners/${id2}`, undefined, 'housekeeper'); check('field role cannot delete 403', r.status === 403, r.text);

// case 3: owner with a unit linked -> refused
const units = (await call('GET', '/api/units')).json.data;
const u = units.find(x => x.unitNumber === '#B-08-11') ?? units[0];
r = await call('PATCH', `/api/units/${u.id}`, { ownerId: id2 }); check('link unit to owner', r.status === 200, r.text);
r = await call('DELETE', `/api/owners/${id2}`); check('delete refused: has unit (409 HAS_UNITS)', r.status === 409 && r.json.error.code === 'HAS_UNITS', r.text);
// move the unit back off so we can clean up, then delete should still fail due to leftover contract
r = await call('POST', '/api/contracts', { ownerId: id2, model: 'management', managementFeePct: 20, startsOn: '2026-09-01' });
check('add contract for owner2', r.status === 201, r.text);
// reassign unit to someone else, leaving an orphaned contract on owner2
const lim = '22222222-2222-4222-8222-000000000001';
r = await call('PATCH', `/api/units/${u.id}`, { ownerId: lim }); check('reassign unit away from owner2', r.status === 200, r.text);
r = await call('DELETE', `/api/owners/${id2}`); check('delete refused: orphaned contract (409 HAS_CONTRACT)', r.status === 409 && r.json.error.code === 'HAS_CONTRACT', r.text);

// case 4: unknown id -> 404
r = await call('DELETE', '/api/owners/does-not-exist'); check('unknown owner 404', r.status === 404, r.text);

// case 5: owner with a portal login gets the login removed too
r = await call('POST', '/api/owners', { displayName: `Delete Me3 ${tag}`, email: `delme3${tag}@example.com` });
const id3 = r.json?.id;
r = await call('POST', `/api/owners/${id3}/invite`, {}); check('invite owner3', r.status === 201, r.text); const uid3 = r.json?.userId;
r = await call('DELETE', `/api/owners/${id3}`); check('delete owner with portal login', r.status === 200, r.text);
r = await call('PATCH', `/api/users/${uid3}`, { isActive: false }); check('the login was actually removed (patch on it now 404s)', r.status === 404, r.text);

// case 6: statement history blocks delete
r = await call('POST', '/api/statements/generate', { period: '2026-09' });
r = await call('GET', '/api/statements?pageSize=500'); const stmt = r.json.data.find(s => s.period === '2026-09');
if (stmt) {
  const ownerId = (await call('GET', '/api/owners')).json.data.find(o => o.displayName.includes(stmt.ownerName))?.id;
  if (ownerId) { r = await call('DELETE', `/api/owners/${ownerId}`); check('delete refused: owner with real history (units or statements)', r.status === 409 && ['HAS_UNITS','HAS_STATEMENTS'].includes(r.json.error.code), r.text); }
}
done();
