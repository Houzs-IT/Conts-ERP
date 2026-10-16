import { call, check, done } from './harness.mjs';
let r = await call('GET', '/api/properties'); check('properties shape', r.status === 200 && r.json.buildings.length > 0 && r.json.units.every(u => u.pkg && u.contract && Array.isArray(u.expenses) && 'bankAccount' in u), r.text.slice(0, 300));
const tag = Date.now().toString().slice(-6);
r = await call('POST', '/api/properties', { name: `Test Tower ${tag}`, city: 'Cheras, 56000 KL', state: 'Kuala Lumpur' }); check('create building', r.status === 201, r.text); const bid = r.json?.id;
r = await call('POST', '/api/properties', { name: `Test Tower ${tag}`, city: 'x', state: 'Selangor' }); check('duplicate building 409', r.status === 409, r.text);
r = await call('POST', '/api/properties', { name: '', city: 'x', state: 'Selangor' }); check('empty building name 422', r.status === 422, r.text);
const owners = (await call('GET', '/api/owners')).json.data; const oid = owners[0].id, oid2 = owners[1].id;
r = await call('POST', '/api/units', { buildingId: bid, listingName: '', unitCode: '' }); check('a unit needs an owner (422)', r.status === 422 && r.json?.error?.fields?.ownerId, r.text);
r = await call('POST', '/api/units', { buildingId: bid, ownerName: 'Someone New' }); check('create refuses owner identity fields (422)', r.status === 422 && r.json?.error?.fields?.ownerName, r.text);
r = await call('POST', '/api/units', { buildingId: bid, listingName: '', unitCode: '', ownerId: oid, pkg: 'Package C', term: 'Long term', split: 'Not set', splitValue: null, expenses: [{ category: 'Internet', amount: 12900 }], contract: { feePct: 25, startedOn: '2026-09-01', renewsOn: '2028-09-01' } }); check('create blank unit', r.status === 201, r.text); const uid = r.json?.id;
// The owner's identity and bank belong to the owner profile: a unit save carrying any of them is refused and changes nothing.
const identity = async () => { const o = (await call('GET', '/api/owners')).json.data.find(x => x.id === oid); return JSON.stringify([o.displayName, o.icLast4, o.bankName, o.bankAccountLast4, o.accountHolder]); };
const ownerBefore = await identity();
for (const [k, v] of [['ownerName', 'Renamed Owner'], ['ic', `9${tag}-01-5555`], ['bankName', 'MBBE'], ['bankAccount', '1234567890'], ['accountHolder', 'TEST OWNER']]) {
  r = await call('PATCH', `/api/units/${uid}`, { listingName: 'Should not save', [k]: v }); check(`unit save refuses ${k} (422)`, r.status === 422 && r.json?.error?.fields?.[k], r.text);
}
const ownerAfter = await identity();
check('the owner is unchanged by refused unit saves', ownerBefore === ownerAfter, `${ownerBefore} -> ${ownerAfter}`);
r = await call('PATCH', `/api/units/${uid}`, { ownerId: 'no-such-owner' }); check('unknown owner 404', r.status === 404, r.text);
r = await call('PATCH', `/api/units/${uid}`, { layoutType: 'castle' }); check('bad layout type 422', r.status === 422 && r.json?.error?.fields?.layoutType, r.text);
r = await call('PATCH', `/api/units/${uid}`, { bathrooms: 2.5 }); check('fractional bathrooms 422', r.status === 422, r.text);
r = await call('PATCH', `/api/units/${uid}`, { listingName: 'Test Suite', unitCode: `TT-${tag}`, address: '1 Test Road', ownerId: oid2, layoutType: 'dual_key', bedrooms: 2, bathrooms: 2, sizeSqft: 850, pkg: 'Package A', term: 'Short term', split: 'GRR — guaranteed rent', splitValue: 350000, expenses: [{ category: 'Internet', amount: 12900 }, { category: 'Water', amount: 4500 }], contract: { feePct: 30, startedOn: '2026-09-01', renewsOn: '2028-09-01' } }); check('save unit', r.status === 200, r.text);
r = await call('GET', '/api/properties'); const u = r.json.units.find(x => x.id === uid);
check('saved values persisted', u && u.listingName === 'Test Suite' && u.unitCode === `TT-${tag}` && u.pkg === 'Package A' && u.split.startsWith('GRR') && u.splitValue === 350000 && u.ownerId === oid2 && u.layoutType === 'dual_key' && u.bedrooms === 2 && u.bathrooms === 2 && u.sizeSqft === 850 && u.expenses.length === 2 && u.contract.feePct === 30, JSON.stringify(u));
r = await call('GET', '/api/units'); { const x = r.json.data.find(y => y.id === uid); check('roster carries layout, bed, bath', x && x.layoutType === 'dual_key' && x.bathrooms === 2 && x.unitCode === `TT-${tag}`, JSON.stringify(x)); }
r = await call('PATCH', `/api/units/${uid}`, { sizeSqft: null, layoutType: null }); check('layout cleared', r.status === 200, r.text);
r = await call('GET', '/api/properties'); { const x = r.json.units.find(y => y.id === uid); check('layout cleared persisted, bedrooms kept', x.layoutType === null && x.sizeSqft === null && x.bedrooms === 2, JSON.stringify(x)); }
r = await call('PATCH', `/api/units/${uid}`, { pkg: 'Package Z' }); check('bad package 422', r.status === 422, r.text);
r = await call('PATCH', `/api/units/${uid}`, { contract: { feePct: 130, startedOn: '2026-01-01', renewsOn: '' } }); check('fee over 100 rejected', r.status === 422, r.text);
r = await call('PATCH', '/api/units/nope', { pkg: 'Package A' }); check('unknown unit 404', r.status === 404, r.text);
r = await call('GET', '/api/properties', undefined, 'housekeeper'); check('field role forbidden', r.status === 403, r.text);
r = await call('PATCH', `/api/units/${uid}`, { pkg: 'Package B' }, 'finance_admin'); check('finance may edit master data', r.status === 200, r.text);
r = await call('GET', '/api/units'); check('roster has area + data', r.json.data.every(x => 'area' in x && x.id), '');
r = await call('GET', `/api/units/detail?unitId=${uid}`); check('detail for new unit', r.status === 200, r.text.slice(0, 200));
// inventory
r = await call('GET', '/api/inventory'); check('inventory shape', r.status === 200 && r.json.data.every(x => 'category' in x && 'replaceBy' in x && 'notes' in x), r.text.slice(0, 250));
r = await call('POST', '/api/inventory', { unitNumber: `TT-${tag}`, propertyName: `Test Tower ${tag}`, name: 'Test sofa', category: 'furniture', quantity: '1', condition: 'good', purchaseCost: 150000, installedOn: '2026-09-01', replaceBy: '2030-01-01', notes: 'new' }); check('inventory create', r.status === 201, r.text); const iid = r.json?.id;
r = await call('POST', '/api/inventory', { unitNumber: 'NOPE', name: 'x' }); check('inventory unknown unit 404', r.status === 404, r.text);
r = await call('PATCH', '/api/inventory', { id: iid, condition: 'damaged', notes: 'torn' }); check('inventory patch', r.status === 200, r.text);
r = await call('GET', '/api/inventory'); const it = r.json.data.find(x => x.id === iid); check('inventory persisted', it && it.condition === 'damaged' && it.notes === 'torn' && it.purchaseCost === 150000, JSON.stringify(it));
r = await call('GET', '/api/inventory', undefined, 'operations_manager'); check('ops manager: cost hidden? (ops manager is not finance)', r.status === 200, r.text.slice(0, 100));
// access
r = await call('GET', '/api/access-credentials'); const a = r.json.data[0]; check('access list masked', r.status === 200 && a && /•/.test(a.secret) && !JSON.stringify(r.json).includes('reveal'), r.text.slice(0, 250));
r = await call('GET', `/api/access-credentials/${a.id}?reveal=true`); check('reveal as management', r.status === 200 && typeof r.json.secret === 'string' && !/•/.test(r.json.secret), r.text);
r = await call('GET', `/api/access-credentials/${a.id}?reveal=true`, undefined, 'finance_admin'); check('reveal as finance 403', r.status === 403, r.text);
r = await call('GET', `/api/access-credentials/${a.id}`); check('reveal needs explicit flag 422', r.status === 422, r.text);
r = await call('GET', '/api/access-credentials'); check('last revealed recorded', r.json.data.find(x => x.id === a.id).lastRevealedBy === 'Test Bot (management)', JSON.stringify(r.json.data.find(x => x.id === a.id)));
r = await call('GET', '/api/access-credentials', undefined, 'housekeeper'); check('field role gets no secret', r.json.data.every(x => x.secret === ''), '');
r = await call('POST', '/api/documents', {}); check('document upload with no file refused (422)', r.status === 422, r.text);
// Building rename and delete: a typo can be corrected, a duplicate name is refused, only an empty building can go.
{
  const tag2 = Date.now().toString().slice(-6);
  let b = await call('POST', '/api/properties', { name: `Typo Tower ${tag2}`, state: 'Kuala Lumpur', city: 'KL' }); const bid = b.json?.id;
  b = await call('PATCH', `/api/properties/${bid}`, { name: `Regalia Test ${tag2}`, city: 'Kuala Lumpur', state: 'Kuala Lumpur' });
  check('building renamed', b.status === 200 && (await call('GET', '/api/properties')).json?.buildings?.some(x => x.id === bid && x.name === `Regalia Test ${tag2}`), b.text);
  const other = (await call('POST', '/api/properties', { name: `Other Tower ${tag2}`, state: 'Kuala Lumpur', city: 'KL' })).json?.id;
  b = await call('PATCH', `/api/properties/${other}`, { name: `Regalia Test ${tag2}` }); check('rename to an existing name refused (409)', b.status === 409, b.text);
  b = await call('PATCH', `/api/properties/${bid}`, { name: 'x' }, 'housekeeper'); check('housekeeper cannot rename (403)', b.status === 403, b.text);
  const u = await call('POST', '/api/units', { buildingId: bid, ownerId: (await call('GET', '/api/owners')).json.data[0].id, unitCode: `RT-${tag2}`, unitNumber: `RT-${tag2}`, listingName: 'Rename test' });
  b = await call('DELETE', `/api/properties/${bid}`); check('building with a unit cannot be deleted (409)', b.status === 409 && b.json?.error?.code === 'HAS_UNITS', b.text);
  b = await call('DELETE', `/api/properties/${other}`); check('empty building deleted', b.status === 200 && !(await call('GET', '/api/properties')).json?.buildings?.some(x => x.id === other), b.text);
  console.log(`   rename-test building ${bid} / unit ${u.json?.id} left for SQL cleanup`);
}

done();
